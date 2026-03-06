import Stripe from "npm:stripe@14.25.0";
import { createClient } from "npm:@supabase/supabase-js@2.40.0";
import { syncStripeCustomerIdentity } from "../_shared/stripeCustomer.ts";

export const config = { verify_jwt: false };

const SUPABASE_URL =
  Deno.env.get("EDGE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("EDGE_SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("EDGE_SERVICE_ROLE_KEY") ??
  "";
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("EDGE_SUPABASE_ANON_KEY") ??
  "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const BILLING_CRON_SECRET =
  Deno.env.get("BILLING_CRON_SECRET") ?? Deno.env.get("PUSH_CRON_SECRET") ?? "";
const BIWEEKLY_PERIOD_DAYS = 14;

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const createAdminClient = () =>
  createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const createAuthClient = () =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const getPeriod = () => {
  const now = new Date();
  const end = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  ));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - BIWEEKLY_PERIOD_DAYS);
  return { start, end };
};

const getInvoiceIdempotencyKey = (
  businessId: string,
  periodStart: string,
  periodEnd: string,
) => `commission_invoice_${businessId}_${periodStart}_${periodEnd}`;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
    return new Response("Missing server configuration.", { status: 500 });
  }

  try {
    const cronSecret = req.headers.get("x-cron-secret") ?? "";
    const isCronAuthorized =
      Boolean(BILLING_CRON_SECRET) &&
      Boolean(cronSecret) &&
      cronSecret === BILLING_CRON_SECRET;

    const supabase = createAdminClient();

    if (!isCronAuthorized) {
      const authHeader =
        req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
      const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : "";
      if (!token) {
        return new Response(
          JSON.stringify({ error: "Missing authorization header." }),
          { status: 401 },
        );
      }

      const authClient = createAuthClient();
      const { data: authData, error: authError } = await authClient.auth.getUser(
        token,
      );
      if (authError || !authData?.user?.id) {
        return new Response(JSON.stringify({ error: "Invalid JWT" }), {
          status: 401,
        });
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("id", authData.user.id)
        .maybeSingle();
      if (
        profileError ||
        !profile ||
        !["admin", "supervisor"].includes(String(profile.role || ""))
      ) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
        });
      }
    }

    const { start, end } = getPeriod();
    const periodStart = start.toISOString().slice(0, 10);
    const periodEnd = end.toISOString().slice(0, 10);

    const { data: events, error } = await supabase
      .from("commission_events")
      .select("id, business_id, amount_cents, created_at, status")
      .in("status", ["pending", "invoiced"])
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString());

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message || "Unable to load events." }),
        { status: 500 },
      );
    }

    const grouped = new Map();
    for (const event of events || []) {
      const list = grouped.get(event.business_id) || [];
      list.push(event);
      grouped.set(event.business_id, list);
    }

    const results = [];
    for (const [businessId, list] of grouped.entries()) {
      const totalCents = list.reduce(
        (sum, item) => sum + Number(item.amount_cents || 0),
        0,
      );
      if (!totalCents) continue;

      const { data: business } = await supabase
        .from("businesses")
        .select("stripe_customer_id, name")
        .eq("id", businessId)
        .maybeSingle();

      if (!business?.stripe_customer_id) {
        results.push({ businessId, error: "missing_stripe_customer" });
        continue;
      }

      await syncStripeCustomerIdentity({
        stripe,
        customerId: business.stripe_customer_id,
        businessName: business.name,
        context: "stripe-create-monthly-invoices",
        businessId,
      });

      const { data: existingInvoice } = await supabase
        .from("commission_invoices")
        .select("stripe_invoice_id, status")
        .eq("business_id", businessId)
        .eq("period_start", periodStart)
        .eq("period_end", periodEnd)
        .in("status", ["draft", "open"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let invoiceId = existingInvoice?.stripe_invoice_id || "";
      if (!invoiceId) {
        const invoice = await stripe.invoices.create({
          customer: business.stripe_customer_id,
          collection_method: "charge_automatically",
          auto_advance: false,
          metadata: {
            business_id: businessId,
            period_start: periodStart,
            period_end: periodEnd,
            mode: "scheduled",
          },
        }, {
          idempotencyKey: getInvoiceIdempotencyKey(
            businessId,
            periodStart,
            periodEnd,
          ),
        });
        invoiceId = invoice.id;
        await supabase.from("commission_invoices").insert({
          business_id: businessId,
          stripe_invoice_id: invoiceId,
          period_start: periodStart,
          period_end: periodEnd,
          amount_cents: invoice.amount_due || 0,
          status: invoice.status || "draft",
        });
      }

      const pendingItems = list.filter((item) => item.status === "pending");
      for (const event of pendingItems) {
        const amount = Number(event.amount_cents || 0);
        if (amount <= 0) continue;
        await stripe.invoiceItems.create(
          {
            customer: business.stripe_customer_id,
            amount,
            currency: "usd",
            description: `Wello commission (${periodStart} to ${periodEnd})`,
            invoice: invoiceId,
            metadata: {
              business_id: businessId,
              commission_event_id: event.id,
            },
          },
          { idempotencyKey: `commission_${event.id}` },
        );
      }

      let invoice = await stripe.invoices.retrieve(invoiceId);
      if (invoice.status === "draft") {
        invoice = await stripe.invoices.finalizeInvoice(invoiceId);
      }
      if (invoice.status !== "paid" && invoice.amount_due > 0) {
        invoice = await stripe.invoices.pay(invoiceId);
      }

      const eventIds = list.map((item) => item.id);
      await supabase
        .from("commission_events")
        .update({
          status: invoice.status === "paid" ? "paid" : "invoiced",
        })
        .in("id", eventIds);

      await supabase
        .from("commission_invoices")
        .update({
          status: invoice.status || "open",
          amount_cents: invoice.amount_paid || invoice.total || totalCents,
        })
        .eq("stripe_invoice_id", invoiceId);

      results.push({
        businessId,
        totalCents,
        invoiceId,
        paid: invoice.status === "paid",
      });
    }

    return new Response(JSON.stringify({ ok: true, results }), { status: 200 });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error?.message || "Server error" }),
      { status: 500 },
    );
  }
});
