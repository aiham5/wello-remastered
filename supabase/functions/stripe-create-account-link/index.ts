import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      typeof body?.accessToken === "string" ? body.accessToken : "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader || bodyAccessToken;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: authData, error: authError } = token
      ? await supabase.auth.getUser(token)
      : { data: null, error: new Error("Missing auth token.") };
    if (authError || !authData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const { businessId } = body ?? {};
    if (!businessId) {
      return new Response(JSON.stringify({ error: "Missing businessId" }), {
        status: 400,
      });
    }

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("id, owner_id, name, stripe_account_id")
      .eq("id", businessId)
      .maybeSingle();

    if (businessError || !business) {
      return new Response(JSON.stringify({ error: "Business not found." }), {
        status: 404,
      });
    }

    if (business.owner_id !== authData.user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
      });
    }

    let accountId = business.stripe_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        email: authData.user.email ?? undefined,
        business_profile: {
          name: business.name ?? undefined,
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      accountId = account.id;
      await supabase
        .from("businesses")
        .update({ stripe_account_id: accountId })
        .eq("id", businessId);
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: CONNECT_REFRESH_URL,
      return_url: CONNECT_RETURN_URL,
      type: "account_onboarding",
    });

    return new Response(
      JSON.stringify({ url: accountLink.url, accountId }),
      { status: 200 },
    );
  } catch (error) {
    console.error("stripe-create-account-link failed", error);
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
