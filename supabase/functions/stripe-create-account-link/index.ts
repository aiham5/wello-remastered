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
const STRIPE_MODE = STRIPE_SECRET_KEY.startsWith("sk_live_")
  ? "live"
  : STRIPE_SECRET_KEY.startsWith("sk_test_")
    ? "test"
    : "unknown";

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const normalizeStripeId = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const maskStripeId = (value: unknown) => {
  const id = normalizeStripeId(value);
  if (!id) return null;
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
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
  let phase = "init";
  const debug: Record<string, unknown> = {
    stripeMode: STRIPE_MODE,
  };
  try {
    const body = await req.json().catch(() => ({}));
    const requestedRefreshUrl = normalizeConnectRedirectUrl(
      body?.refreshUrl ?? body?.refresh_url,
    );
    const requestedReturnUrl = normalizeConnectRedirectUrl(
      body?.returnUrl ?? body?.return_url,
    );
    const refreshUrl = requestedRefreshUrl || CONNECT_REFRESH_URL;
    const returnUrl = requestedReturnUrl || CONNECT_RETURN_URL;

    phase = "validate_env";
    if (
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY ||
      !STRIPE_SECRET_KEY ||
      !refreshUrl ||
      !returnUrl
    ) {
      return new Response(
        JSON.stringify({
          error: "Missing server configuration.",
          missing: {
            SUPABASE_URL: !SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY: !SUPABASE_SERVICE_ROLE_KEY,
            STRIPE_SECRET_KEY: !STRIPE_SECRET_KEY,
            STRIPE_CONNECT_REFRESH_URL: !refreshUrl,
            STRIPE_CONNECT_RETURN_URL: !returnUrl,
          },
        }),
        { status: 500 },
      );
    }

    const authHeader =
      req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
    phase = "parse_token";
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
    debug.hasAuthorizationHeader = Boolean(authHeader);
    debug.hasBodyToken = Boolean(bodyAccessToken);

    phase = "auth_user";
    const { data: authData, error: authError } = token
      ? await supabaseAuth.auth.getUser(token)
      : { data: null, error: new Error("Missing auth token.") };
    if (authError || !authData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const { businessId } = body ?? {};
    debug.businessId = businessId || null;
    if (!businessId) {
      return new Response(JSON.stringify({ error: "Missing businessId" }), {
        status: 400,
      });
    }

    phase = "load_business";
    const { data: business, error: businessError } = await supabaseAdmin
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
    debug.ownerId = business.owner_id;
    debug.userId = authData.user.id;
    debug.ownerMatches = business.owner_id === authData.user.id;
    debug.existingAccountId = maskStripeId(business.stripe_account_id);

    let accountId = normalizeStripeId(business.stripe_account_id);
    debug.normalizedAccountId = maskStripeId(accountId);
    let needsNewAccount =
      !accountId || !/^acct_[A-Za-z0-9]+$/.test(accountId);
    debug.needsNewAccountInitially = needsNewAccount;

    if (!needsNewAccount && accountId) {
      phase = "verify_existing_account";
      try {
        await stripe.accounts.retrieve(accountId);
        debug.existingAccountValid = true;
      } catch (error) {
        const message = String(error?.message || "").toLowerCase();
        const code = String(error?.code || "").toLowerCase();
        const type = String(error?.type || "").toLowerCase();
        const noAccess = message.includes("does not have access to account");
        const isMissing =
          code === "resource_missing" || message.includes("no such account");
        const isAccountInvalid =
          code === "account_invalid" || noAccess || type === "stripepermissionerror";
        if (isMissing || isAccountInvalid) {
          needsNewAccount = true;
          debug.existingAccountValid = false;
          debug.existingAccountMissing = true;
          debug.existingAccountInvalid = isAccountInvalid;
          debug.existingAccountErrorCode = error?.code || null;
          debug.existingAccountErrorType = error?.type || null;
          debug.existingAccountErrorMessage = error?.message || null;
        } else {
          throw error;
        }
      }
    }

    if (needsNewAccount) {
      phase = "create_account";
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
      debug.createdNewAccount = true;
      debug.createdAccountId = maskStripeId(accountId);
      phase = "persist_account";
      await supabaseAdmin
        .from("businesses")
        .update({ stripe_account_id: accountId })
        .eq("id", businessId);
    } else {
      debug.createdNewAccount = false;
    }

    phase = "create_onboarding_link";
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });
    debug.finalAccountId = maskStripeId(accountId);

    return new Response(
      JSON.stringify({ url: accountLink.url, accountId, debug }),
      { status: 200 },
    );
  } catch (error) {
    console.error("stripe-create-account-link failed", error);
    return new Response(
      JSON.stringify({
        error: error?.message || "Server error",
        type: error?.type,
        code: error?.code,
        phase,
        debug,
      }),
      { status: 500 },
    );
  }
});
