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

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const createAdminSupabase = () =>
  createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const createAuthSupabase = () =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

Deno.serve(async (req) => {
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
  let userId: string | null = null;
  let transferId: string | null = null;
  let splitEventId: string | null = null;
  let splitOverage: number = 0;
  let adjustmentId: string | null = null;
  let reserveIds: string[] = [];

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

    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData?.user?.id) {
      return new Response(JSON.stringify({ error: "Invalid JWT" }), {
        status: 401,
      });
    }
    userId = authData.user.id;

    const body = await req.json().catch(() => ({}));
    const requestedAmountCentsRaw = body?.amountCents;
    const requestedAmountCents =
      requestedAmountCentsRaw == null || requestedAmountCentsRaw === ""
        ? null
        : Math.trunc(Number(requestedAmountCentsRaw));

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
      .select("id, amount_cents, business_id, created_at")
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
    const availableCents = eventRows.reduce(
      (sum, row) => sum + (Number(row.amount_cents) || 0),
      0,
    );
    if (availableCents <= 0) {
      return new Response(
        JSON.stringify({ error: "No cashback balance available." }),
        { status: 400 },
      );
    }

    if (requestedAmountCents != null) {
      if (!Number.isFinite(requestedAmountCents) || requestedAmountCents <= 0) {
        return new Response(
          JSON.stringify({ error: "Invalid amountCents." }),
          { status: 400 },
        );
      }
      if (requestedAmountCents > availableCents) {
        return new Response(
          JSON.stringify({
            error: "Requested amount exceeds available cashback balance.",
            availableCents,
          }),
          { status: 400 },
        );
      }
    }

    const payoutAmountCents =
      requestedAmountCents == null ? availableCents : requestedAmountCents;

    // Deterministic selection: oldest first.
    const sorted = [...eventRows].sort((a, b) => {
      const aMs = Date.parse(a?.created_at || "") || 0;
      const bMs = Date.parse(b?.created_at || "") || 0;
      return aMs - bMs;
    });

    const selected = [];
    let selectedSum = 0;
    for (const row of sorted) {
      if (selectedSum >= payoutAmountCents) break;
      const amount = Number(row?.amount_cents) || 0;
      if (amount <= 0) continue;
      selected.push(row);
      selectedSum += amount;
    }
    if (!selected.length) {
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
        amount_cents: payoutAmountCents,
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

    // Reserve selected rows so the balance can't be double-spent if anything retries.
    // We can safely keep these reserved for this payout_id; the UI treats only 'available' as withdrawable.
    reserveIds = selected.map((row) => row.id).filter(Boolean);
    if (reserveIds.length) {
      const { error: reserveError } = await supabase
        .from("cashback_events")
        .update({ status: "reserved", payout_id: payoutId })
        .in("id", reserveIds)
        .eq("user_id", userId)
        .eq("status", "available");
      if (reserveError) {
        throw new Error(reserveError.message || "Unable to reserve cashback.");
      }
    }

    // If the selected rows sum to more than the payout amount, split the last reserved row and put the remainder back
    // as an 'adjustment' row that stays available for future cashouts.
    const overage = Math.max(0, selectedSum - payoutAmountCents);
    if (overage > 0) {
      const last = selected[selected.length - 1];
      const lastAmount = Number(last?.amount_cents) || 0;
      const newLastAmount = Math.max(0, lastAmount - overage);
      if (newLastAmount <= 0) {
        throw new Error("Unable to split cashback rows for this amount.");
      }
      splitEventId = String(last.id || "") || null;
      splitOverage = overage;
      const { error: splitError } = await supabase
        .from("cashback_events")
        .update({ amount_cents: newLastAmount })
        .eq("id", last.id)
        .eq("user_id", userId)
        .eq("status", "reserved")
        .eq("payout_id", payoutId);
      if (splitError) {
        throw new Error(splitError.message || "Unable to split cashback.");
      }
      const { data: adjustment, error: adjustmentError } = await supabase
        .from("cashback_events")
        .insert({
          receipt_upload_id: null,
          redemption_id: null,
          business_id: last.business_id,
          user_id: userId,
          amount_cents: overage,
          status: "available",
          payout_id: null,
          source: "adjustment",
          parent_event_id: last.id,
        })
        .select("id")
        .maybeSingle();
      if (adjustmentError || !adjustment?.id) {
        throw new Error(adjustmentError?.message || "Unable to create adjustment.");
      }
      adjustmentId = adjustment.id;
    }

    const transfer = await stripe.transfers.create({
      amount: payoutAmountCents,
      currency: "usd",
      destination: accountId,
      metadata: {
        user_id: userId,
        payout_id: payoutId,
        purpose: "cashback_weekly_cashout",
      },
    });
    transferId = transfer.id;

    if (reserveIds.length) {
      await supabase
        .from("cashback_events")
        .update({ status: "paid" })
        .in("id", reserveIds)
        .eq("user_id", userId)
        .eq("payout_id", payoutId)
        .eq("status", "reserved");
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
        amountCents: payoutAmountCents,
        availableCents,
        overageCents: overage || 0,
        adjustmentId,
        nextEligibleAt: new Date(Date.now() + ONE_WEEK_MS).toISOString(),
      }),
      { status: 200 },
    );
  } catch (error) {
    if (payoutId) {
      if (!transferId) {
        // Best-effort rollback for reserved rows, so users aren't stuck.
        try {
          if (adjustmentId) {
            await supabase
              .from("cashback_events")
              .delete()
              .eq("id", adjustmentId)
              .eq("user_id", userId || "");
          }
          if (splitEventId && splitOverage > 0) {
            const { data: splitRow } = await supabase
              .from("cashback_events")
              .select("amount_cents")
              .eq("id", splitEventId)
              .eq("user_id", userId || "")
              .maybeSingle();
            const current = Number(splitRow?.amount_cents) || 0;
            if (current > 0) {
              await supabase
                .from("cashback_events")
                .update({ amount_cents: current + splitOverage })
                .eq("id", splitEventId)
                .eq("user_id", userId || "")
                .eq("status", "reserved")
                .eq("payout_id", payoutId);
            }
          }
          await supabase
            .from("cashback_events")
            .update({ status: "available", payout_id: null })
            .eq("user_id", userId || "")
            .eq("payout_id", payoutId)
            .eq("status", "reserved");
        } catch (_error) {}
        await supabase
          .from("cashout_payouts")
          .update({
            status: "failed",
            failure_reason: error?.message || "Cashout failed",
            processed_at: new Date().toISOString(),
          })
          .eq("id", payoutId);
      } else {
        // Transfer succeeded but we failed after; keep rows reserved/paid state as-is to avoid double cashout.
        try {
          await supabase
            .from("cashout_payouts")
            .update({
              status: "paid",
              stripe_transfer_id: transferId,
              failure_reason: error?.message || null,
              processed_at: new Date().toISOString(),
            })
            .eq("id", payoutId);
        } catch (_error) {}
      }
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
