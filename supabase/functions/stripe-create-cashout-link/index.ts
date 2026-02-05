import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const config = { verify_jwt: false };

const SUPABASE_URL =
  Deno.env.get("EDGE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("EDGE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const CONNECT_REFRESH_URL =
  Deno.env.get("STRIPE_CONNECT_REFRESH_URL") ?? "";
const CONNECT_RETURN_URL =
  Deno.env.get("STRIPE_CONNECT_RETURN_URL") ?? "";

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const createSupabase = () =>
  createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
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

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  try {
    if (
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY ||
      !STRIPE_SECRET_KEY ||
      !CONNECT_REFRESH_URL ||
      !CONNECT_RETURN_URL
    ) {
      return new Response(
        JSON.stringify({
          error: "Missing server configuration.",
          missing: {
            SUPABASE_URL: !SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY: !SUPABASE_SERVICE_ROLE_KEY,
            STRIPE_SECRET_KEY: !STRIPE_SECRET_KEY,
            STRIPE_CONNECT_REFRESH_URL: !CONNECT_REFRESH_URL,
            STRIPE_CONNECT_RETURN_URL: !CONNECT_RETURN_URL,
          },
        }),
        { status: 500 },
      );
    }

    const authHeader =
      req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
    const body = await req.json().catch(() => ({}));
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

    const supabase = createSupabase();
    const { data: authData, error: authError } =
      await supabase.auth.getUser(token);
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
      .select("id, full_name, email, stripe_cashout_account_id")
      .eq("id", userId)
      .maybeSingle();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "Profile not found." }), {
        status: 404,
      });
    }

    let accountId = profile.stripe_cashout_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        default_currency: "usd",
        business_type: "individual",
        metadata: {
          purpose: "consumer_cashout",
          user_id: userId,
        },
        capabilities: {
          transfers: { requested: true },
        },
      });
      accountId = account.id;
      await supabase
        .from("profiles")
        .update({ stripe_cashout_account_id: accountId })
        .eq("id", userId);
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: CONNECT_REFRESH_URL,
      return_url: CONNECT_RETURN_URL,
      type: "account_onboarding",
      collect: "currently_due",
    });

    return new Response(JSON.stringify({ url: accountLink.url, accountId }), {
      status: 200,
    });
  } catch (error) {
    console.error("stripe-create-cashout-link failed", error);
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
