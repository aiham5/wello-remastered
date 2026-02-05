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
const CHECKOUT_SUCCESS_URL =
  Deno.env.get("STRIPE_CHECKOUT_SUCCESS_URL") ?? "";
const CHECKOUT_CANCEL_URL =
  Deno.env.get("STRIPE_CHECKOUT_CANCEL_URL") ?? "";

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const normalizeStripeId = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  try {
    if (
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY ||
      !STRIPE_SECRET_KEY ||
      !CHECKOUT_SUCCESS_URL ||
      !CHECKOUT_CANCEL_URL
    ) {
      return new Response(
        JSON.stringify({
          error: "Missing server configuration.",
          missing: {
            SUPABASE_URL: !SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY: !SUPABASE_SERVICE_ROLE_KEY,
            STRIPE_SECRET_KEY: !STRIPE_SECRET_KEY,
            STRIPE_CHECKOUT_SUCCESS_URL: !CHECKOUT_SUCCESS_URL,
            STRIPE_CHECKOUT_CANCEL_URL: !CHECKOUT_CANCEL_URL,
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
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const supabaseAuth = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY,
    );

    const { data: authData, error: authError } = token
      ? await supabaseAuth.auth.getUser(token)
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

    const { data: business, error: businessError } = await supabaseAdmin
      .from("businesses")
      .select("id, owner_id, name, stripe_customer_id")
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

    let customerId = normalizeStripeId(business.stripe_customer_id);
    let needsNewCustomer =
      !customerId || !/^cus_[A-Za-z0-9]+$/.test(customerId);

    if (!needsNewCustomer && customerId) {
      try {
        await stripe.customers.retrieve(customerId);
      } catch (error) {
        const message = String(error?.message || "").toLowerCase();
        const code = String(error?.code || "").toLowerCase();
        const type = String(error?.type || "").toLowerCase();
        const noAccess = message.includes("does not have access to customer");
        const isMissing =
          code === "resource_missing" || message.includes("no such customer");
        const isInvalid =
          code === "customer_invalid" || noAccess || type === "stripepermissionerror";
        if (isMissing || isInvalid) {
          needsNewCustomer = true;
        } else {
          throw error;
        }
      }
    }

    if (needsNewCustomer) {
      const customer = await stripe.customers.create({
        name: business.name ?? undefined,
        email: authData.user.email ?? undefined,
        metadata: { business_id: businessId },
      });
      customerId = customer.id;
      await supabaseAdmin
        .from("businesses")
        .update({ stripe_customer_id: customerId })
        .eq("id", businessId);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customerId,
      payment_method_types: ["card"],
      success_url: CHECKOUT_SUCCESS_URL,
      cancel_url: CHECKOUT_CANCEL_URL,
      metadata: { business_id: businessId },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
    });
  } catch (error) {
    console.error("stripe-create-setup-session failed", error);
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
