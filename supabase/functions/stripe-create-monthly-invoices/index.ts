import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const getPeriod = () => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start, end };
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
    return new Response("Missing server configuration.", { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { start, end } = getPeriod();

  const { data: events, error } = await supabase
    .from("commission_events")
    .select("id, business_id, amount_cents, created_at")
    .eq("status", "pending")
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
      .select("stripe_customer_id")
      .eq("id", businessId)
      .maybeSingle();

    if (!business?.stripe_customer_id) {
      continue;
    }

    const description = `Wello verified redemptions (${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)})`;
    await stripe.invoiceItems.create({
      customer: business.stripe_customer_id,
      amount: totalCents,
      currency: "usd",
      description,
    });

    const invoice = await stripe.invoices.create({
      customer: business.stripe_customer_id,
      collection_method: "charge_automatically",
      auto_advance: true,
      metadata: {
        business_id: businessId,
        period_start: start.toISOString().slice(0, 10),
        period_end: end.toISOString().slice(0, 10),
      },
    });

    await supabase.from("commission_invoices").insert({
      business_id: businessId,
      stripe_invoice_id: invoice.id,
      period_start: start.toISOString().slice(0, 10),
      period_end: end.toISOString().slice(0, 10),
      amount_cents: totalCents,
      status: invoice.status || "open",
    });

    const eventIds = list.map((item) => item.id);
    await supabase
      .from("commission_events")
      .update({ status: "invoiced" })
      .in("id", eventIds);

    results.push({ businessId, totalCents, invoiceId: invoice.id });
  }

  return new Response(JSON.stringify({ ok: true, results }), { status: 200 });
});
