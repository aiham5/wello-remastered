import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
