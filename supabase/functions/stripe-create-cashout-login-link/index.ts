import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const config = { verify_jwt: false };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !STRIPE_SECRET_KEY ||
    !CONNECT_REFRESH_URL ||
    !CONNECT_RETURN_URL
  ) {
    return new Response("Missing server configuration.", { status: 500 });
  }

  try {
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
    const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    if (!authResponse.ok) {
      const authErrorBody = await authResponse.text();
      return new Response(
        JSON.stringify({
          error: "Unauthorized",
          reason: "invalid_token",
          message: authErrorBody || authResponse.statusText,
        }),
        { status: 401 },
      );
    }
    const authData = await authResponse.json();
    const userId = authData?.id;
    if (!userId) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized",
          reason: "missing_sub",
        }),
        { status: 401 },
      );
    }

    const supabase = createSupabase();

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
      refresh_url: CONNECT_REFRESH_URL,
      return_url: CONNECT_RETURN_URL,
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
