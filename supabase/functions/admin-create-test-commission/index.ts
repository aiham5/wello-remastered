import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
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
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
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
    const amountCents = Number(body?.amountCents);
    const eventDate = String(body?.eventDate || "").trim();

    if (!businessId) {
      return new Response(JSON.stringify({ error: "Missing businessId." }), {
        status: 400,
        headers: corsHeaders,
      });
    }
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid amountCents." }),
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

    let targetRedemptionId = redemptionId;
    let targetUserId = "";

    if (targetRedemptionId) {
      const { data: redemption } = await adminClient
        .from("redemptions")
        .select("id, business_id, scanned_by")
        .eq("id", targetRedemptionId)
        .maybeSingle();
      if (!redemption || redemption.business_id !== businessId) {
        return new Response(
          JSON.stringify({ error: "Redemption not found for this business." }),
          { status: 404, headers: corsHeaders },
        );
      }
      targetUserId = redemption.scanned_by || "";
    } else {
      const { data: redemption } = await adminClient
        .from("redemptions")
        .select("id, scanned_by")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!redemption?.id) {
        return new Response(
          JSON.stringify({
            error:
              "No redemptions found for this business. Provide a redemption ID.",
          }),
          { status: 404, headers: corsHeaders },
        );
      }
      targetRedemptionId = redemption.id;
      targetUserId = redemption.scanned_by || "";
    }

    if (!targetUserId) {
      return new Response(
        JSON.stringify({ error: "Redemption is missing a scanned_by user." }),
        { status: 400, headers: corsHeaders },
      );
    }

    const { data: existing } = await adminClient
      .from("commission_events")
      .select("id")
      .eq("redemption_id", targetRedemptionId)
      .maybeSingle();
    if (existing?.id) {
      return new Response(
        JSON.stringify({
          error:
            "A commission event already exists for this redemption. Provide a different redemption ID.",
        }),
        { status: 409, headers: corsHeaders },
      );
    }

    let createdAt = new Date().toISOString();
    if (eventDate) {
      const normalized =
        eventDate.length === 10 ? `${eventDate}T12:00:00Z` : eventDate;
      const parsed = new Date(normalized);
      if (!Number.isNaN(parsed.getTime())) {
        createdAt = parsed.toISOString();
      }
    }

    const { data: inserted, error: insertError } = await adminClient
      .from("commission_events")
      .insert({
        business_id: businessId,
        redemption_id: targetRedemptionId,
        user_id: targetUserId,
        amount_cents: Math.round(amountCents),
        status: "pending",
        created_at: createdAt,
      })
      .select("id, business_id, amount_cents, created_at, redemption_id")
      .maybeSingle();

    if (insertError || !inserted) {
      return new Response(
        JSON.stringify({ error: insertError?.message || "Insert failed." }),
        { status: 500, headers: corsHeaders },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        eventId: inserted.id,
        businessId: inserted.business_id,
        amountCents: inserted.amount_cents,
        createdAt: inserted.created_at,
        redemptionId: inserted.redemption_id,
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
