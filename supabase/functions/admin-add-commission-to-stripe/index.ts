import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
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
const PUSH_CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") ?? "";
const BIWEEKLY_PERIOD_DAYS = 14;
const BILLING_ANCHOR_END_DATE = "2026-04-03";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const getCorsHeaders = (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  if (origin && ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) {
    return null;
  }
  return {
    "Access-Control-Allow-Origin": origin || "*",
    Vary: "Origin",
    ...baseCorsHeaders,
  };
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
  const anchorEnd = new Date(`${BILLING_ANCHOR_END_DATE}T00:00:00.000Z`);
  if (Number.isNaN(anchorEnd.getTime())) {
    return null;
  }
  const targetDate = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor(
    (targetDate.getTime() - anchorEnd.getTime()) / millisecondsPerDay,
  );
  const endOffset = Math.floor(diffDays / BIWEEKLY_PERIOD_DAYS) + 1;
  const end = new Date(anchorEnd);
  end.setUTCDate(
    end.getUTCDate() + (endOffset * BIWEEKLY_PERIOD_DAYS),
  );
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - BIWEEKLY_PERIOD_DAYS);
  return { start, end };
};

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (!corsHeaders) {
    return new Response(JSON.stringify({ error: "CORS blocked" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({ error: "Missing server configuration." }),
      { status: 500, headers: corsHeaders },
    );
  }

  try {
    const cronSecret = req.headers.get("x-cron-secret") ?? "";
    const isCronAuthorized =
      Boolean(PUSH_CRON_SECRET) &&
      Boolean(cronSecret) &&
      cronSecret === PUSH_CRON_SECRET;

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

    const adminClient = createAdminClient();

    if (!isCronAuthorized) {
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

      const { data: profile, error: profileError } = await adminClient
        .from("profiles")
        .select("id, role")
        .eq("id", authData.user.id)
        .maybeSingle();
      if (
        profileError ||
        !profile ||
        !["admin", "supervisor"].includes(profile.role)
      ) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: corsHeaders,
        });
      }
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

    return new Response(
      JSON.stringify({
        ok: true,
        mode: "local_only",
        eventId: event.id,
        amountCents,
        eventStatus: event.status,
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
