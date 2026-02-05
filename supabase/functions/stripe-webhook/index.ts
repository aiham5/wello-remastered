import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL =
  Deno.env.get("EDGE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("EDGE_SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("EDGE_SERVICE_ROLE_KEY") ??
  "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const STRIPE_WEBHOOK_TOLERANCE_SECONDS = Number(
  Deno.env.get("STRIPE_WEBHOOK_TOLERANCE_SECONDS") ?? "300",
);

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
    return new Response("Missing server configuration.", { status: 500 });
  }

  const signature =
    req.headers.get("Stripe-Signature") ??
    req.headers.get("stripe-signature");
  const webhookSecrets = STRIPE_WEBHOOK_SECRET.split(",")
    .map((entry) =>
      entry
        .trim()
        .replace(/\s+/g, "")
        .replace(/^['"]|['"]$/g, ""),
    )
    .filter(Boolean);
  if (!signature || webhookSecrets.length === 0) {
    return new Response(
      JSON.stringify({
        error: "Missing webhook signature.",
        signaturePresent: Boolean(signature),
        secretCount: webhookSecrets.length,
      }),
      { status: 400 },
    );
  }

  const body = await req.text();
  let event: Stripe.Event | null = null;
  let lastError: unknown = null;
  for (const secret of webhookSecrets) {
    try {
      event = await stripe.webhooks.constructEventAsync(
        body,
        signature,
        secret,
        Number.isFinite(STRIPE_WEBHOOK_TOLERANCE_SECONDS)
          ? STRIPE_WEBHOOK_TOLERANCE_SECONDS
          : undefined,
      );
      break;
    } catch (_error) {
      // Try next secret.
      lastError = _error;
    }
  }
  if (!event) {
    return new Response(
      JSON.stringify({
        error: "Invalid signature",
        secretCount: webhookSecrets.length,
        invalidReason: lastError?.message ?? null,
      }),
      { status: 400 },
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode === "setup") {
      const customerId = session.customer as string | null;
      const setupIntentId = session.setup_intent as string | null;
      if (customerId && setupIntentId) {
        const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
        const paymentMethodId = setupIntent.payment_method as string | null;
        if (paymentMethodId) {
          await stripe.paymentMethods.attach(paymentMethodId, {
            customer: customerId,
          });
          await stripe.customers.update(customerId, {
            invoice_settings: { default_payment_method: paymentMethodId },
          });
          const paymentMethod = await stripe.paymentMethods.retrieve(
            paymentMethodId,
          );
          const brand =
            paymentMethod.card?.brand ?? null;
          const last4 =
            paymentMethod.card?.last4 ?? null;
          await supabase
            .from("businesses")
            .update({
              stripe_payment_method_id: paymentMethodId,
              stripe_payment_method_brand: brand,
              stripe_payment_method_last4: last4,
            })
            .eq("stripe_customer_id", customerId);
        }
      }
    }
  }

  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const purpose = account.metadata?.purpose;
    const cashoutUserId = account.metadata?.user_id;
    if (purpose === "consumer_cashout" && cashoutUserId) {
      await supabase
        .from("profiles")
        .update({
          stripe_cashout_payouts_enabled: account.payouts_enabled ?? false,
          stripe_cashout_onboarded_at: account.payouts_enabled
            ? new Date().toISOString()
            : null,
        })
        .eq("id", cashoutUserId);
    } else {
      await supabase
        .from("businesses")
        .update({
          stripe_charges_enabled: account.charges_enabled ?? false,
          stripe_payouts_enabled: account.payouts_enabled ?? false,
          stripe_onboarded_at: account.charges_enabled
            ? new Date().toISOString()
            : null,
        })
        .eq("stripe_account_id", account.id);
    }
  }

  if (
    event.type === "invoice.created" ||
    event.type === "invoice.finalized" ||
    event.type === "invoice.payment_succeeded" ||
    event.type === "invoice.payment_failed" ||
    event.type === "invoice.voided"
  ) {
    const invoice = event.data.object as Stripe.Invoice;
    const invoiceId = invoice.id;
    const customerId = invoice.customer as string | null;
    const businessIdFromMeta = invoice.metadata?.business_id;
    let businessId = businessIdFromMeta || null;
    if (!businessId && customerId) {
      const { data: business } = await supabase
        .from("businesses")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      businessId = business?.id ?? null;
    }

    if (businessId && invoiceId) {
      const amountCents =
        typeof invoice.amount_due === "number"
          ? invoice.amount_due
          : typeof invoice.total === "number"
            ? invoice.total
            : 0;
      const periodStart = invoice.metadata?.period_start || null;
      const periodEnd = invoice.metadata?.period_end || null;
      await supabase.from("commission_invoices").upsert(
        {
          business_id: businessId,
          stripe_invoice_id: invoiceId,
          period_start: periodStart,
          period_end: periodEnd,
          amount_cents: amountCents,
          status: invoice.status || "open",
        },
        { onConflict: "stripe_invoice_id" },
      );

      const hasPeriod = Boolean(periodStart && periodEnd);
      if (event.type === "invoice.payment_succeeded") {
        const updateQuery = supabase
          .from("commission_events")
          .update({ status: "paid" })
          .eq("business_id", businessId)
          .eq("status", "invoiced");
        if (hasPeriod) {
          await updateQuery
            .gte("created_at", `${periodStart}T00:00:00.000Z`)
            .lt("created_at", `${periodEnd}T00:00:00.000Z`);
        } else {
          await updateQuery;
        }
      }

      if (event.type === "invoice.payment_failed") {
        const updateQuery = supabase
          .from("commission_events")
          .update({ status: "failed" })
          .eq("business_id", businessId)
          .eq("status", "invoiced");
        if (hasPeriod) {
          await updateQuery
            .gte("created_at", `${periodStart}T00:00:00.000Z`)
            .lt("created_at", `${periodEnd}T00:00:00.000Z`);
        } else {
          await updateQuery;
        }
      }

      if (event.type === "invoice.voided") {
        const updateQuery = supabase
          .from("commission_events")
          .update({ status: "failed" })
          .eq("business_id", businessId)
          .eq("status", "invoiced");
        if (hasPeriod) {
          await updateQuery
            .gte("created_at", `${periodStart}T00:00:00.000Z`)
            .lt("created_at", `${periodEnd}T00:00:00.000Z`);
        } else {
          await updateQuery;
        }
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
