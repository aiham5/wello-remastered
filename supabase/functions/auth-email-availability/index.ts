import { createClient } from "npm:@supabase/supabase-js@2.40.0";
import { extractClientIp, HttpError } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";

export const config = { verify_jwt: false };

const SUPABASE_URL =
  Deno.env.get("EDGE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("EDGE_SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("EDGE_SERVICE_ROLE_KEY") ??
  "";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const allowOrigin = (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const allowed = [
    "https://wellopartners.com",
    "https://www.wellopartners.com",
  ];
  if (allowed.includes(origin)) return origin;
  // Native app requests may not include an Origin header; use a first-party
  // origin fallback instead of wildcard to reduce browser abuse surface.
  return allowed[0];
};

const corsHeaders = (req: Request) => ({
  "Access-Control-Allow-Origin": allowOrigin(req),
  Vary: "Origin",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});

const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });

const createAdminClient = () =>
  createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
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

  const payload = await req.json().catch(() => ({}));
  const email = String(payload?.email || "")
    .trim()
    .toLowerCase();
  if (!email || !EMAIL_REGEX.test(email)) {
    return json(req, 400, { error: "Invalid email address" });
  }

  const adminClient = createAdminClient();
  try {
    const ip = extractClientIp(req);
    await enforceRateLimit({
      req,
      scope: "auth:email-availability:ip",
      identifier: `ip:${ip}`,
      maxRequests: 80,
      windowSeconds: 10 * 60,
      supabase: adminClient,
    });
    await enforceRateLimit({
      req,
      scope: "auth:email-availability",
      identifier: `${ip}|${email}`,
      maxRequests: 12,
      windowSeconds: 10 * 60,
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

  const { data: profileRows, error: profileError } = await adminClient
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .limit(1);
  if (profileError) {
    return json(req, 500, { error: "Unable to verify email availability" });
  }
  if (Array.isArray(profileRows) && profileRows.length > 0) {
    return json(req, 200, {
      ok: true,
      available: false,
      reason: "already_registered",
    });
  }

  const { data: authExistsData, error: authExistsError } = await adminClient.rpc(
    "auth_user_email_exists",
    { p_email: email },
  );
  if (authExistsError) {
    return json(req, 500, { error: "Unable to verify email availability" });
  }
  if (Boolean(authExistsData)) {
    return json(req, 200, {
      ok: true,
      available: false,
      reason: "already_registered",
    });
  }

  return json(req, 200, {
    ok: true,
    available: true,
  });
});
