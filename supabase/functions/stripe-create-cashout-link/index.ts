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
const CONNECT_REFRESH_URL = Deno.env.get("STRIPE_CONNECT_REFRESH_URL") ?? "";
const CONNECT_RETURN_URL = Deno.env.get("STRIPE_CONNECT_RETURN_URL") ?? "";
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

const normalizeSpace = (value: unknown) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ");

const buildIndividualPrefill = (fullName: unknown, email?: unknown) => {
  const normalized = normalizeSpace(fullName);
  const emailValue = normalizeSpace(email);
  const parts = normalized ? normalized.split(" ").filter(Boolean) : [];
  const firstName = parts[0] || "";
  const lastName = parts.slice(1).join(" ").trim();
  const individual: { first_name?: string; last_name?: string; email?: string } =
    {};
  if (firstName) individual.first_name = firstName;
  if (lastName) individual.last_name = lastName;
  if (emailValue) individual.email = emailValue;
  return Object.keys(individual).length ? individual : null;
};

const buildConnectPrefill = (profile: {
  full_name?: string | null;
  email?: string | null;
  auth_full_name?: string | null;
  auth_email?: string | null;
}) => {
  const email = normalizeSpace(profile?.email || profile?.auth_email);
  const fullName = normalizeSpace(profile?.full_name || profile?.auth_full_name);
  const individual = buildIndividualPrefill(fullName, email);
  const prefill: {
    email?: string;
    individual?: { first_name?: string; last_name?: string; email?: string };
  } = {};
  if (email) prefill.email = email;
  if (individual) prefill.individual = individual;
  return prefill;
};

const requiresConsumerCashoutAccountReplacement = async (accountId: string) => {
  try {
    await stripe.accounts.retrieve(accountId);
    // Temporary testing mode: keep existing account regardless of card_payments
    // capability state.
    return false;
  } catch {
    // If retrieval fails, keep the existing account path to avoid hard failure.
    return false;
  }
};

const createConsumerCashoutAccount = async (
  userId: string,
  connectPrefill: ReturnType<typeof buildConnectPrefill>,
) => {
  return await stripe.accounts.create({
    type: "express",
    country: "US",
    default_currency: "usd",
    business_type: "individual",
    ...(connectPrefill.email ? { email: connectPrefill.email } : {}),
    ...(connectPrefill.individual
      ? { individual: connectPrefill.individual }
      : {}),
    metadata: {
      purpose: "consumer_cashout",
      user_id: userId,
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
  });
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
      req.headers.get("Authorization") ??
      req.headers.get("authorization") ??
      "";
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
    const authEmail = normalizeSpace(authData.user.email);
    const authMetadata = (authData.user.user_metadata || {}) as Record<
      string,
      unknown
    >;
    const authFullName = normalizeSpace(
      authMetadata.full_name || authMetadata.name || "",
    );
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

    const connectPrefill = buildConnectPrefill({
      full_name: profile.full_name,
      email: profile.email,
      auth_full_name: authFullName || null,
      auth_email: authEmail || null,
    });
    let accountId = profile.stripe_cashout_account_id;
    if (!accountId) {
      const account = await createConsumerCashoutAccount(userId, connectPrefill);
      accountId = account.id;
      await supabase
        .from("profiles")
        .update({ stripe_cashout_account_id: accountId })
        .eq("id", userId);
    } else {
      const shouldReplaceAccount = await requiresConsumerCashoutAccountReplacement(
        accountId,
      );
      if (shouldReplaceAccount) {
        const replacement = await createConsumerCashoutAccount(
          userId,
          connectPrefill,
        );
        accountId = replacement.id;
        await supabase
          .from("profiles")
          .update({ stripe_cashout_account_id: accountId })
          .eq("id", userId);
      }

      const accountUpdates: Stripe.AccountUpdateParams = {};
      accountUpdates.capabilities = {
        card_payments: { requested: true },
        transfers: { requested: true },
      };
      if (connectPrefill.email) accountUpdates.email = connectPrefill.email;
      if (connectPrefill.individual) {
        accountUpdates.individual = connectPrefill.individual;
      }
      if (Object.keys(accountUpdates).length > 0) {
        try {
          await stripe.accounts.update(accountId, accountUpdates);
        } catch (updateError) {
          // Non-blocking: onboarding can still proceed even if prefill update fails.
          console.warn(
            "stripe-create-cashout-link prefill update skipped",
            updateError,
          );
        }
      }
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
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
