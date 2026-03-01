import { createClient } from "npm:@supabase/supabase-js@2.40.0";
import { HttpError } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";

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

const REFERRAL_REWARD_CENTS = 500;
const REFERRAL_MONTHLY_CAP_CENTS = 50000;
const REFERRAL_BASE_URL =
  Deno.env.get("REFERRAL_BASE_URL") ||
  "https://www.wellopartners.com/referral";

const allowOrigin = (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const allowed = [
    "https://wellopartners.com",
    "https://www.wellopartners.com",
  ];
  if (allowed.includes(origin)) return origin;
  return "*";
};

const corsHeaders = (req: Request) => ({
  "Access-Control-Allow-Origin": allowOrigin(req),
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});

const createAdminClient = () =>
  createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const createAuthClient = () =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });

const getUtcMonthWindow = () => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
};

const mapClaimStatus = (status: string | null) => {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "pending") return "pending";
  if (normalized === "rewarded_both") return "rewarded";
  if (normalized === "rewarded_referred_only_referrer_capped") return "capped";
  return "none";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, 405, { error: "Method not allowed" });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(req, 500, { error: "Missing server configuration" });
  }

  const authHeader =
    req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!token) {
    return json(req, 401, { error: "Missing authorization header" });
  }

  const authClient = createAuthClient();
  const { data: userData, error: userError } = await authClient.auth.getUser(
    token,
  );
  const userId = userData?.user?.id || "";
  if (userError || !userId) {
    return json(req, 401, { error: "Invalid JWT" });
  }

  const adminClient = createAdminClient();
  try {
    await enforceRateLimit({
      req,
      scope: "referral:get",
      userId,
      maxRequests: 60,
      windowSeconds: 5 * 60,
      supabase: adminClient,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return json(req, error.status, {
        error: error.message,
        ...(error.details || {}),
      });
    }
    throw error;
  }

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    return json(req, 500, { error: profileError.message || "Profile load failed" });
  }
  if (String(profile?.role || "") !== "consumer") {
    return json(req, 403, {
      error: "Referrals are available on personal accounts only.",
    });
  }

  const { data: ensuredCode, error: ensureError } = await adminClient.rpc(
    "ensure_referral_code",
    { p_user_id: userId },
  );
  if (ensureError || !ensuredCode) {
    return json(req, 500, {
      error: ensureError?.message || "Unable to load referral code.",
    });
  }

  const { data: referralRows, error: referralsError } = await adminClient
    .from("referrals")
    .select("status")
    .eq("referrer_user_id", userId);
  if (referralsError) {
    return json(req, 500, {
      error: referralsError.message || "Unable to load referrals.",
    });
  }

  let pendingCount = 0;
  let rewardedBothCount = 0;
  let cappedCount = 0;
  (Array.isArray(referralRows) ? referralRows : []).forEach((row) => {
    const status = String(row?.status || "");
    if (status === "pending") pendingCount += 1;
    else if (status === "rewarded_both") rewardedBothCount += 1;
    else if (status === "rewarded_referred_only_referrer_capped") cappedCount += 1;
  });

  const { data: claimRow, error: claimError } = await adminClient
    .from("referrals")
    .select("status")
    .eq("referred_user_id", userId)
    .maybeSingle();
  if (claimError) {
    return json(req, 500, {
      error: claimError.message || "Unable to load referral claim status.",
    });
  }

  const { startIso, endIso } = getUtcMonthWindow();
  const { data: earnedRows, error: earnedError } = await adminClient
    .from("cashback_events")
    .select("amount_cents")
    .eq("user_id", userId)
    .eq("source", "referral")
    .eq("referral_reward_role", "referrer")
    .in("status", ["available", "reserved", "paid"])
    .gte("created_at", startIso)
    .lt("created_at", endIso);
  if (earnedError) {
    return json(req, 500, {
      error: earnedError.message || "Unable to load referral earnings.",
    });
  }

  const referrerMonthlyEarnedCents = (Array.isArray(earnedRows) ? earnedRows : [])
    .reduce((sum, row) => sum + (Number(row?.amount_cents) || 0), 0);
  const referrerMonthlyRemainingCents = Math.max(
    REFERRAL_MONTHLY_CAP_CENTS - referrerMonthlyEarnedCents,
    0,
  );
  const code = String(ensuredCode || "").toUpperCase();

  return json(req, 200, {
    ok: true,
    code,
    link: `${REFERRAL_BASE_URL}?ref=${encodeURIComponent(code)}`,
    rewardCents: REFERRAL_REWARD_CENTS,
    monthlyCapCents: REFERRAL_MONTHLY_CAP_CENTS,
    referrerMonthlyEarnedCents,
    referrerMonthlyRemainingCents,
    stats: {
      pendingCount,
      rewardedBothCount,
      cappedCount,
    },
    yourClaimStatus: mapClaimStatus(claimRow?.status || null),
  });
});
