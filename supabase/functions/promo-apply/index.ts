import { createClient } from "npm:@supabase/supabase-js@2.40.0";

// We verify the user JWT ourselves so web + mobile behave consistently even when API keys change.
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
  // Fall back to wildcard for native clients (no Origin) and dev environments.
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

  const body = await req.json().catch(() => ({}));
  const rawCode = String(body?.code ?? "").trim();

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

  // Allow clearing promo codes by sending blank.
  if (!rawCode) {
    const { error } = await adminClient
      .from("profiles")
      .update({ promo_code_id: null })
      .eq("id", userId);
    if (error) return json(req, 500, { error: error.message || "Update failed" });
    return json(req, 200, { ok: true, cleared: true, cashbackRateBps: 750 });
  }

  if (profile?.role && String(profile.role) !== "consumer") {
    return json(req, 403, {
      error: "Promo codes are available on personal accounts only.",
    });
  }

  const codeClean = rawCode.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(codeClean)) {
    return json(req, 400, { error: "Invalid promo code" });
  }
  const nowIso = new Date().toISOString();

  const { data: promo, error: promoError } = await adminClient
    .from("promo_codes")
    .select("id, code, cashback_rate_bps, active, starts_at, ends_at")
    .eq("active", true)
    .eq("code", codeClean) // fast path (exact match)
    .maybeSingle();

  let resolved = promo;
  if (!resolved || promoError) {
    // Case-insensitive lookup.
    const { data: promo2, error: promo2Error } = await adminClient
      .from("promo_codes")
      .select("id, code, cashback_rate_bps, active, starts_at, ends_at")
      .ilike("code", codeClean)
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (promo2Error) {
      return json(req, 500, { error: promo2Error.message || "Lookup failed" });
    }
    resolved = promo2;
  }

  if (!resolved?.id) {
    return json(req, 400, { error: "Invalid promo code" });
  }

  if (resolved.starts_at && String(resolved.starts_at) > nowIso) {
    return json(req, 400, { error: "Promo code not active yet" });
  }
  if (resolved.ends_at && String(resolved.ends_at) < nowIso) {
    return json(req, 400, { error: "Promo code expired" });
  }

  const rateBps = Number(resolved.cashback_rate_bps) || 750;
  const { error: updateError } = await adminClient
    .from("profiles")
    .update({ promo_code_id: resolved.id })
    .eq("id", userId);

  if (updateError) {
    return json(req, 500, { error: updateError.message || "Update failed" });
  }

  return json(req, 200, {
    ok: true,
    promo: {
      id: resolved.id,
      code: resolved.code,
      cashbackRateBps: rateBps,
      cashbackRatePercent: rateBps / 100,
    },
  });
});
