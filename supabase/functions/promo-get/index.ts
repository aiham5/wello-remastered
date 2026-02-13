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

const allowOrigin = (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const allowed = [
    "https://wellopartners.com",
    "https://www.wellopartners.com",
    "http://localhost:3000",
    "http://localhost:5173",
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
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role, promo_code_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) {
    return json(req, 500, { error: profileError.message || "Profile load failed" });
  }

  if (profile?.role && String(profile.role) !== "consumer") {
    // Promo codes are a consumer-only feature.
    return json(req, 200, { ok: true, cashbackRateBps: 750, promo: null });
  }

  const promoId = profile?.promo_code_id || null;
  if (!promoId) {
    return json(req, 200, { ok: true, cashbackRateBps: 750, promo: null });
  }

  const nowIso = new Date().toISOString();
  const { data: promo, error: promoError } = await adminClient
    .from("promo_codes")
    .select("id, code, cashback_rate_bps, active, starts_at, ends_at")
    .eq("id", promoId)
    .maybeSingle();

  if (promoError || !promo?.id) {
    return json(req, 200, { ok: true, cashbackRateBps: 750, promo: null });
  }

  const isActive =
    promo.active === true &&
    (!promo.starts_at || String(promo.starts_at) <= nowIso) &&
    (!promo.ends_at || String(promo.ends_at) >= nowIso);

  if (!isActive) {
    return json(req, 200, { ok: true, cashbackRateBps: 750, promo: null });
  }

  const rateBps = Number(promo.cashback_rate_bps) || 750;
  return json(req, 200, {
    ok: true,
    cashbackRateBps: rateBps,
    cashbackRatePercent: rateBps / 100,
    promo: { id: promo.id, code: promo.code, cashbackRateBps: rateBps },
  });
});
