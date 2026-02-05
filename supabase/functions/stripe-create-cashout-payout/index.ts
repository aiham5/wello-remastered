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

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const createAdminSupabase = () =>
  createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const createAuthSupabase = () =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
    return new Response(
      JSON.stringify({ error: "Missing server configuration." }),
      { status: 500 },
    );
  }

  const supabase = createAdminSupabase();
  const authClient = createAuthSupabase();
  let payoutId: string | null = null;

  try {
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

    const { data: authData, error: authError } = await authClient.auth.getUser(
      token,
    );
    if (authError || !authData?.user?.id) {
      return new Response(JSON.stringify({ error: "Invalid JWT" }), {
        status: 401,
      });
    }
    const userId = authData.user.id;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("stripe_cashout_account_id, stripe_cashout_payouts_enabled")
      .eq("id", userId)
      .maybeSingle();
    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "Profile not found." }), {
        status: 404,
      });
    }

    const accountId = String(profile.stripe_cashout_account_id || "").trim();
    if (!accountId) {
      return new Response(
        JSON.stringify({ error: "Link a bank account before cashing out." }),
        { status: 400 },
      );
    }

    const account = await stripe.accounts.retrieve(accountId);
    const payoutsEnabled = Boolean(account.payouts_enabled);
    if (!payoutsEnabled) {
      return new Response(
        JSON.stringify({ error: "Bank account not ready for payouts yet." }),
        { status: 400 },
      );
    }

    await supabase
      .from("profiles")
      .update({ stripe_cashout_payouts_enabled: payoutsEnabled })
      .eq("id", userId);

    const { data: lastPayout, error: lastPayoutError } = await supabase
      .from("cashout_payouts")
      .select("id, created_at, status")
      .eq("user_id", userId)
      .in("status", ["pending", "paid"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastPayoutError) {
      return new Response(
        JSON.stringify({ error: lastPayoutError.message || "Unable to cash out." }),
        { status: 500 },
      );
    }

    if (lastPayout?.created_at) {
      const lastAtMs = Date.parse(lastPayout.created_at);
      if (Number.isFinite(lastAtMs) && Date.now() - lastAtMs < ONE_WEEK_MS) {
        const nextEligibleAt = new Date(lastAtMs + ONE_WEEK_MS).toISOString();
        return new Response(
          JSON.stringify({
            error: "Cashout available once per week.",
            nextEligibleAt,
            lastPayoutAt: new Date(lastAtMs).toISOString(),
          }),
          { status: 429 },
        );
      }
    }

    const { data: availableEvents, error: eventsError } = await supabase
      .from("cashback_events")
      .select("id, amount_cents")
      .eq("user_id", userId)
      .eq("status", "available")
      .is("payout_id", null);
    if (eventsError) {
      return new Response(
        JSON.stringify({ error: eventsError.message || "Unable to cash out." }),
        { status: 500 },
      );
    }

    const eventRows = Array.isArray(availableEvents) ? availableEvents : [];
    const amountCents = eventRows.reduce(
      (sum, row) => sum + (Number(row.amount_cents) || 0),
      0,
    );
    if (amountCents <= 0) {
      return new Response(
        JSON.stringify({ error: "No cashback balance available." }),
        { status: 400 },
      );
    }

    const { data: payout, error: payoutInsertError } = await supabase
      .from("cashout_payouts")
      .insert({
        user_id: userId,
        stripe_account_id: accountId,
        amount_cents: amountCents,
        status: "pending",
      })
      .select("id")
      .maybeSingle();
    if (payoutInsertError || !payout?.id) {
      return new Response(
        JSON.stringify({
          error: payoutInsertError?.message || "Unable to create payout.",
        }),
        { status: 500 },
      );
    }
    payoutId = payout.id;

    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: "usd",
      destination: accountId,
      metadata: {
        user_id: userId,
        payout_id: payoutId,
        purpose: "cashback_weekly_cashout",
      },
    });

    const eventIds = eventRows.map((row) => row.id).filter(Boolean);
    if (eventIds.length) {
      await supabase
        .from("cashback_events")
        .update({ status: "paid", payout_id: payoutId })
        .in("id", eventIds);
    }

    const processedAt = new Date().toISOString();
    await supabase
      .from("cashout_payouts")
      .update({
        status: "paid",
        stripe_transfer_id: transfer.id,
        processed_at: processedAt,
      })
      .eq("id", payoutId);

    return new Response(
      JSON.stringify({
        success: true,
        payoutId,
        transferId: transfer.id,
        amountCents,
        nextEligibleAt: new Date(Date.now() + ONE_WEEK_MS).toISOString(),
      }),
      { status: 200 },
    );
  } catch (error) {
    if (payoutId) {
      await supabase
        .from("cashout_payouts")
        .update({
          status: "failed",
          failure_reason: error?.message || "Cashout failed",
          processed_at: new Date().toISOString(),
        })
        .eq("id", payoutId);
    }
    console.error("stripe-create-cashout-payout failed", error);
    return new Response(
      JSON.stringify({
        error: error?.message || "Unable to cash out right now.",
      }),
      { status: 500 },
    );
  }
});
