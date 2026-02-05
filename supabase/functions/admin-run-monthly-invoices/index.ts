import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const getDefaultPeriod = () => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
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
    if (!businessId) {
      return new Response(JSON.stringify({ error: "Missing businessId." }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const periodStartRaw = String(body?.periodStart || "").trim();
    const periodEndRaw = String(body?.periodEnd || "").trim();
    const defaultPeriod = getDefaultPeriod();
    const start = periodStartRaw
      ? new Date(periodStartRaw)
      : defaultPeriod.start;
    const end = periodEndRaw ? new Date(periodEndRaw) : defaultPeriod.end;

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return new Response(
        JSON.stringify({ error: "Invalid period dates." }),
        { status: 400, headers: corsHeaders },
      );
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

    const { data: events, error: eventsError } = await adminClient
      .from("commission_events")
      .select("id, amount_cents, created_at")
      .eq("status", "pending")
      .eq("business_id", businessId)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString());

    if (eventsError) {
      return new Response(
        JSON.stringify({ error: eventsError.message || "Unable to load events." }),
        { status: 500, headers: corsHeaders },
      );
    }

    const list = events || [];
    const totalCents = list.reduce(
      (sum, item) => sum + Number(item.amount_cents || 0),
      0,
    );
    if (totalCents <= 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          totalCents: 0,
          invoiceId: null,
          periodStart: start.toISOString(),
          periodEnd: end.toISOString(),
        }),
        { status: 200, headers: corsHeaders },
      );
    }

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

    const description = `Wello verified redemptions (${start
      .toISOString()
      .slice(0, 10)} to ${end.toISOString().slice(0, 10)})`;
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
        test_run: "true",
      },
    });

    await adminClient.from("commission_invoices").insert({
      business_id: businessId,
      stripe_invoice_id: invoice.id,
      period_start: start.toISOString().slice(0, 10),
      period_end: end.toISOString().slice(0, 10),
      amount_cents: totalCents,
      status: invoice.status || "open",
    });

    const eventIds = list.map((item) => item.id);
    if (eventIds.length) {
      await adminClient
        .from("commission_events")
        .update({ status: "invoiced" })
        .in("id", eventIds);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        invoiceId: invoice.id,
        totalCents,
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
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
