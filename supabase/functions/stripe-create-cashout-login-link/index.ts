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
const CONNECT_REFRESH_URL =
  Deno.env.get("STRIPE_CONNECT_REFRESH_URL") ?? "";
const CONNECT_RETURN_URL =
  Deno.env.get("STRIPE_CONNECT_RETURN_URL") ?? "";
const CONNECT_ALLOWED_REDIRECT_PREFIXES = [
  "https://www.wellopartners.com",
  "https://wellopartners.com",
];

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

const decodeJwtPayload = (token: string) => {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const decodeJwtHeader = (token: string) => {
  try {
    const header = token.split(".")[0];
    if (!header) return null;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const normalizeConnectRedirectUrl = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:") return "";
  const lower = raw.toLowerCase();
  const allowed = CONNECT_ALLOWED_REDIRECT_PREFIXES.some((prefix) =>
    lower.startsWith(prefix.toLowerCase()),
  );
  return allowed ? raw : "";
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.json().catch(() => ({}));
  const requestedRefreshUrl = normalizeConnectRedirectUrl(
    body?.refreshUrl ?? body?.refresh_url,
  );
  const requestedReturnUrl = normalizeConnectRedirectUrl(
    body?.returnUrl ?? body?.return_url,
  );
  const refreshUrl = requestedRefreshUrl || CONNECT_REFRESH_URL;
  const returnUrl = requestedReturnUrl || CONNECT_RETURN_URL;

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !STRIPE_SECRET_KEY ||
    !refreshUrl ||
    !returnUrl
  ) {
    return new Response("Missing server configuration.", { status: 500 });
  }

  try {
    const authHeader =
      req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
    const bodyAccessToken =
      typeof body?.accessToken === "string"
        ? body.accessToken
        : typeof body?.access_token === "string"
          ? body.access_token
          : typeof body?.session?.access_token === "string"
            ? body.session.access_token
            : "";
    const headerToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;
    const token = String(bodyAccessToken || headerToken || "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized",
          reason: "missing_token",
          hasAuthHeader: Boolean(headerToken),
          hasBodyToken: Boolean(bodyAccessToken),
        }),
        { status: 401 },
      );
    }
    const tokenPayload = decodeJwtPayload(token) || {};
    const tokenHeader = decodeJwtHeader(token) || {};
    const expectedIssuer = `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1`;
    if (tokenPayload?.iss && tokenPayload.iss !== expectedIssuer) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized",
          reason: "project_mismatch",
          message: "Session belongs to a different Supabase project.",
          debug: {
            supabaseUrl: SUPABASE_URL,
            expectedIssuer,
            tokenIssuer: tokenPayload?.iss || null,
            tokenAud: tokenPayload?.aud || null,
            tokenSub: tokenPayload?.sub || null,
            tokenKid: tokenHeader?.kid || null,
            tokenAlg: tokenHeader?.alg || null,
          },
        }),
        { status: 401 },
      );
    }

    const supabase = createAdminSupabase();
    const authClient = createAuthSupabase();
    const { data: authData, error: authError } =
      await authClient.auth.getUser(token);
    if (authError || !authData?.user?.id) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized",
          reason: "invalid_token",
          message: authError?.message || "Invalid JWT",
          debug: {
            supabaseUrl: SUPABASE_URL,
            expectedIssuer,
            tokenIssuer: tokenPayload?.iss || null,
            tokenAud: tokenPayload?.aud || null,
            tokenSub: tokenPayload?.sub || null,
            tokenKid: tokenHeader?.kid || null,
            tokenAlg: tokenHeader?.alg || null,
          },
        }),
        { status: 401 },
      );
    }
    const userId = authData.user.id;
    if (!userId) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized",
          reason: "missing_sub",
        }),
        { status: 401 },
      );
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("stripe_cashout_account_id")
      .eq("id", userId)
      .maybeSingle();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "Profile not found." }), {
        status: 404,
      });
    }

    const accountId = profile.stripe_cashout_account_id;
    if (!accountId) {
      return new Response(
        JSON.stringify({ error: "Link a bank account first." }),
        { status: 400 },
      );
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
      collect: "currently_due",
    });
    return new Response(JSON.stringify({ url: accountLink.url }), {
      status: 200,
    });
  } catch (error) {
    console.error("stripe-create-cashout-login-link failed", error);
    return new Response(
      JSON.stringify({
        error: error?.message || "Server error",
        type: error?.type,
        code: error?.code,
      }),
      { status: 500 },
    );
  }
});
