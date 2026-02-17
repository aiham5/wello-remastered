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

const REFERRAL_CODE_REGEX = /^[A-Z0-9]{6,32}$/;

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

const normalizeCode = (raw: unknown) =>
  String(raw || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();

const mapExistingStatus = (status: string | null) => {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "pending") {
    return {
      status: "already_pending",
      message: "Referral already claimed and waiting for first verified purchase.",
    };
  }
  if (normalized === "rewarded_both") {
    return {
      status: "already_rewarded",
      message: "Referral reward already completed.",
    };
  }
  if (normalized === "rewarded_referred_only_referrer_capped") {
    return {
      status: "already_capped",
      message: "Referral already completed (referrer monthly limit reached).",
    };
  }
  return null;
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

  const body = await req.json().catch(() => ({}));
  const ref = normalizeCode(body?.ref);
  if (!REFERRAL_CODE_REGEX.test(ref)) {
    return json(req, 400, { error: "Invalid referral code." });
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

  const { data: referrerCodeRow, error: codeError } = await adminClient
    .from("referral_codes")
    .select("user_id, code")
    .eq("code", ref)
    .maybeSingle();
  if (codeError) {
    return json(req, 500, {
      error: codeError.message || "Unable to validate referral code.",
    });
  }
  if (!referrerCodeRow?.user_id) {
    return json(req, 400, { error: "Referral code not found." });
  }

  const referrerUserId = String(referrerCodeRow.user_id);
  if (referrerUserId === userId) {
    return json(req, 400, { error: "You cannot use your own referral code." });
  }
  const { data: referrerProfile, error: referrerProfileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", referrerUserId)
    .maybeSingle();
  if (referrerProfileError) {
    return json(req, 500, {
      error: referrerProfileError.message || "Unable to validate referral code.",
    });
  }
  if (String(referrerProfile?.role || "") !== "consumer") {
    return json(req, 400, { error: "Referral code not found." });
  }

  const { data: existingReferral, error: existingReferralError } = await adminClient
    .from("referrals")
    .select("id, referrer_user_id, status")
    .eq("referred_user_id", userId)
    .maybeSingle();
  if (existingReferralError) {
    return json(req, 500, {
      error: existingReferralError.message || "Unable to check referral status.",
    });
  }
  if (existingReferral?.id) {
    const mapped = mapExistingStatus(existingReferral.status || null);
    if (mapped) {
      return json(req, 200, {
        ok: true,
        status: mapped.status,
        message: mapped.message,
      });
    }
    return json(req, 200, {
      ok: true,
      status: "already_pending",
      message: "Referral is already claimed.",
    });
  }

  const [redemptionCheck, receiptCheck, cashbackCheck] = await Promise.all([
    adminClient
      .from("redemptions")
      .select("id")
      .eq("scanned_by", userId)
      .limit(1)
      .maybeSingle(),
    adminClient
      .from("receipt_uploads")
      .select("id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
    adminClient
      .from("cashback_events")
      .select("id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
  ]);

  if (redemptionCheck.error || receiptCheck.error || cashbackCheck.error) {
    return json(req, 500, {
      error:
        redemptionCheck.error?.message ||
        receiptCheck.error?.message ||
        cashbackCheck.error?.message ||
        "Unable to validate referral eligibility.",
    });
  }

  const hasActivity = Boolean(
    redemptionCheck.data?.id || receiptCheck.data?.id || cashbackCheck.data?.id,
  );
  if (hasActivity) {
    return json(req, 409, {
      error: "Referral is only available to new accounts with no activity yet.",
    });
  }

  const { data: inserted, error: insertError } = await adminClient
    .from("referrals")
    .insert({
      referrer_user_id: referrerUserId,
      referred_user_id: userId,
      referral_code: ref,
      status: "pending",
      claimed_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (insertError) {
    // Handle racing claims gracefully.
    const code = String(insertError.code || "").toLowerCase();
    if (code === "23505") {
      const { data: racedRow } = await adminClient
        .from("referrals")
        .select("status")
        .eq("referred_user_id", userId)
        .maybeSingle();
      const mapped = mapExistingStatus(racedRow?.status || null);
      return json(req, 200, {
        ok: true,
        status: mapped?.status || "already_pending",
        message: mapped?.message || "Referral already claimed.",
      });
    }
    return json(req, 500, {
      error: insertError.message || "Unable to claim referral.",
    });
  }

  if (!inserted?.id) {
    return json(req, 500, { error: "Unable to claim referral." });
  }

  return json(req, 200, {
    ok: true,
    status: "pending",
    message:
      "Referral claimed. Your $5 cashback will unlock after your first verified purchase.",
  });
});
