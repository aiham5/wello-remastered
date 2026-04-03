import Stripe from "npm:stripe@14.25.0";
import { createClient } from "npm:@supabase/supabase-js@2.40.0";
import { syncStripeCustomerIdentity } from "../_shared/stripeCustomer.ts";

export const config = { verify_jwt: false };

const SUPABASE_URL =
  Deno.env.get("EDGE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("EDGE_SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("EDGE_SERVICE_ROLE_KEY") ??
  "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const createAdminClient = () =>
  createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const toText = (value: unknown) => String(value || "").trim();

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
    return json({ error: "Missing server configuration." }, 500);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const chargeId = toText(body?.chargeId || body?.id);
    if (!chargeId) {
      return json({ error: "Missing chargeId." }, 400);
    }

    const actorId = toText(req.headers.get("x-admin-actor-id"));
    const supabase = createAdminClient();

    const { data: charge, error: chargeError } = await supabase
      .from("business_manual_charges")
      .select(
        "id,business_id,amount_cents,reason,notes,status,stripe_payment_intent_id,"
          + "stripe_charge_id,business:businesses(id,name,stripe_customer_id,"
          + "stripe_payment_method_id)",
      )
      .eq("id", chargeId)
      .maybeSingle();

    if (chargeError || !charge?.id) {
      return json({ error: "Manual charge not found." }, 404);
    }

    const currentStatus = toText(charge.status).toLowerCase();
    if (!["pending", "failed"].includes(currentStatus)) {
      return json({ error: "Only pending or failed manual charges can be charged." }, 400);
    }
    if ((Number(charge.amount_cents) || 0) <= 0) {
      return json({ error: "Only positive manual charges can be charged." }, 400);
    }

    const business = charge.business as {
      id?: string;
      name?: string | null;
      stripe_customer_id?: string | null;
      stripe_payment_method_id?: string | null;
    } | null;
    const customerId = toText(business?.stripe_customer_id);
    if (!customerId) {
      return json({ error: "Business has no Stripe customer configured." }, 400);
    }

    await syncStripeCustomerIdentity({
      stripe,
      customerId,
      businessName: toText(business?.name),
      context: "admin-charge-manual-business-charge",
      businessId: toText(charge.business_id),
    });

    const customer = await stripe.customers.retrieve(customerId, {
      expand: ["invoice_settings.default_payment_method"],
    });
    if (customer.deleted) {
      return json({ error: "Stripe customer is deleted." }, 400);
    }

    const invoiceDefault = customer.invoice_settings?.default_payment_method;
    const defaultPaymentMethodId =
      typeof invoiceDefault === "string"
        ? toText(invoiceDefault)
        : toText(invoiceDefault?.id);
    const fallbackPaymentMethodId = toText(business?.stripe_payment_method_id);
    const paymentMethodId = defaultPaymentMethodId || fallbackPaymentMethodId;

    if (!paymentMethodId) {
      return json({ error: "Business has no default payment method on file." }, 400);
    }

    const nowIso = new Date().toISOString();
    await supabase
      .from("business_manual_charges")
      .update({
        status: "processing",
        failure_reason: null,
        updated_at: nowIso,
        updated_by: actorId || null,
      })
      .eq("id", charge.id);

    try {
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: Number(charge.amount_cents) || 0,
          currency: "usd",
          customer: customerId,
          payment_method: paymentMethodId,
          confirm: true,
          off_session: true,
          description: `Wello manual business charge: ${toText(charge.reason) || "Manual charge"}`,
          metadata: {
            business_id: toText(charge.business_id),
            manual_charge_id: charge.id,
            reason: toText(charge.reason).slice(0, 200),
          },
        },
        { idempotencyKey: `manual_charge_${charge.id}` },
      );

      const chargeObject = Array.isArray(paymentIntent.charges?.data)
        ? paymentIntent.charges.data[0]
        : null;

      if (paymentIntent.status !== "succeeded") {
        await supabase
          .from("business_manual_charges")
          .update({
            status: "failed",
            failure_reason: `Payment intent status: ${paymentIntent.status}`,
            stripe_payment_intent_id: paymentIntent.id,
            stripe_charge_id: chargeObject?.id || null,
            updated_at: new Date().toISOString(),
            updated_by: actorId || null,
          })
          .eq("id", charge.id);
        return json(
          {
            ok: false,
            error: `Payment intent did not succeed (${paymentIntent.status}).`,
            paymentIntentId: paymentIntent.id,
          },
          400,
        );
      }

      await supabase
        .from("business_manual_charges")
        .update({
          status: "paid",
          failure_reason: null,
          stripe_payment_intent_id: paymentIntent.id,
          stripe_charge_id: chargeObject?.id || null,
          charged_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          updated_by: actorId || null,
        })
        .eq("id", charge.id);

      return json({
        ok: true,
        chargeId: charge.id,
        paymentIntentId: paymentIntent.id,
        stripeChargeId: chargeObject?.id || null,
      });
    } catch (error) {
      const paymentIntentId = toText(error?.raw?.payment_intent?.id || error?.payment_intent?.id);
      const chargeIdFromError = toText(
        error?.raw?.payment_intent?.latest_charge ||
          error?.payment_intent?.latest_charge,
      );
      await supabase
        .from("business_manual_charges")
        .update({
          status: "failed",
          failure_reason: toText(error?.message || "Charge failed."),
          stripe_payment_intent_id: paymentIntentId || null,
          stripe_charge_id: chargeIdFromError || null,
          updated_at: new Date().toISOString(),
          updated_by: actorId || null,
        })
        .eq("id", charge.id);
      return json({ ok: false, error: toText(error?.message || "Charge failed.") }, 400);
    }
  } catch (error) {
    return json({ error: toText(error?.message || "Server error.") }, 500);
  }
});
