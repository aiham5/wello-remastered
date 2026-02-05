import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "npm:stripe@14.25.0";
import { createClient } from "npm:@supabase/supabase-js@2.40.0";

export const config = { verify_jwt: false };

const SUPABASE_URL =
  Deno.env.get("EDGE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("EDGE_SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("EDGE_SERVICE_ROLE_KEY") ??
  "";
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("EDGE_SUPABASE_ANON_KEY") ??
  "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const createAdminClient = () =>
  createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const createAuthClient = () =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const getPeriodForDate = (value?: string) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  return { start, end };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
    return new Response(
      JSON.stringify({ error: "Missing server configuration." }),
      { status: 500, headers: corsHeaders },
    );
  }

  try {
    const authHeader =
      req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header." }),
        { status: 401, headers: corsHeaders },
      );
    }

    const body = await req.json().catch(() => ({}));
    const businessId = String(body?.businessId || "").trim();
    const redemptionId = String(body?.redemptionId || "").trim();
    const eventDate = String(body?.eventDate || "").trim();

    if (!businessId) {
      return new Response(JSON.stringify({ error: "Missing businessId." }), {
        status: 400,
        headers: corsHeaders,
      });
    }
    if (!redemptionId) {
      return new Response(JSON.stringify({ error: "Missing redemptionId." }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const authClient = createAuthClient();
    const { data: authData, error: authError } = await authClient.auth.getUser(
      token,
    );
    if (authError || !authData?.user?.id) {
      return new Response(JSON.stringify({ error: "Invalid JWT" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (profileError || !profile || !["admin", "supervisor"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    const { data: event, error: eventError } = await adminClient
      .from("commission_events")
      .select("id, amount_cents, status, created_at")
      .eq("redemption_id", redemptionId)
      .eq("business_id", businessId)
      .maybeSingle();
    if (eventError || !event) {
      return new Response(
        JSON.stringify({ error: "Commission event not found." }),
        { status: 404, headers: corsHeaders },
      );
    }
    if (event.status === "paid") {
      return new Response(
        JSON.stringify({ ok: true, alreadyPaid: true, eventId: event.id }),
        { status: 200, headers: corsHeaders },
      );
    }
    if (event.status === "invoiced") {
      return new Response(
        JSON.stringify({ ok: true, alreadyInvoiced: true, eventId: event.id }),
        { status: 200, headers: corsHeaders },
      );
    }

    const amountCents = Number(event.amount_cents) || 0;
    if (amountCents <= 0) {
      return new Response(
        JSON.stringify({ error: "Commission amount is invalid." }),
        { status: 400, headers: corsHeaders },
      );
    }

    const period = getPeriodForDate(eventDate || event.created_at);
    if (!period) {
      return new Response(
        JSON.stringify({ error: "Invalid event date." }),
        { status: 400, headers: corsHeaders },
      );
    }
    const periodStart = period.start.toISOString().slice(0, 10);
    const periodEnd = period.end.toISOString().slice(0, 10);

    const { data: business } = await adminClient
      .from("businesses")
      .select("stripe_customer_id")
      .eq("id", businessId)
      .maybeSingle();
    if (!business?.stripe_customer_id) {
      return new Response(
        JSON.stringify({ error: "Business has no Stripe customer id." }),
        { status: 400, headers: corsHeaders },
      );
    }

    const { data: existingInvoice } = await adminClient
      .from("commission_invoices")
      .select("id, stripe_invoice_id, status")
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
          mode: "draft",
        },
      });
      invoiceId = invoice.id;
      await adminClient.from("commission_invoices").insert({
        business_id: businessId,
        stripe_invoice_id: invoiceId,
        period_start: periodStart,
        period_end: periodEnd,
        amount_cents: invoice.amount_due || 0,
        status: invoice.status || "draft",
      });
    }

    await stripe.invoiceItems.create(
      {
        customer: business.stripe_customer_id,
        amount: amountCents,
        currency: "usd",
        description: `Wello commission (${periodStart} to ${periodEnd})`,
        invoice: invoiceId,
        metadata: {
          business_id: businessId,
          redemption_id: redemptionId,
          commission_event_id: event.id,
        },
      },
      { idempotencyKey: `commission_${event.id}` },
    );

    const updatedInvoice = await stripe.invoices.retrieve(invoiceId);
    const invoiceTotal =
      updatedInvoice.amount_due || updatedInvoice.total || amountCents;

    await adminClient
      .from("commission_invoices")
      .update({
        amount_cents: invoiceTotal,
        status: updatedInvoice.status || "draft",
      })
      .eq("stripe_invoice_id", invoiceId);

    await adminClient
      .from("commission_events")
      .update({ status: "invoiced" })
      .eq("id", event.id)
      .eq("status", "pending");

    return new Response(
      JSON.stringify({
        ok: true,
        invoiceId,
        invoiceTotalCents: invoiceTotal,
        eventId: event.id,
        periodStart,
        periodEnd,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error?.message || "Server error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
