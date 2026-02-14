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
const STRIPE_ACCOUNT_RETRIEVE_TIMEOUT_MS = Math.max(
  Number(Deno.env.get("STRIPE_ACCOUNT_RETRIEVE_TIMEOUT_MS") || 4500) || 4500,
  1500,
);
const AUTH_GET_USER_TIMEOUT_MS = Math.max(
  Number(Deno.env.get("AUTH_GET_USER_TIMEOUT_MS") || 6000) || 6000,
  2000,
);
const PROFILE_QUERY_TIMEOUT_MS = Math.max(
  Number(Deno.env.get("PROFILE_QUERY_TIMEOUT_MS") || 5000) || 5000,
  2000,
);
const PROFILE_UPDATE_TIMEOUT_MS = Math.max(
  Number(Deno.env.get("PROFILE_UPDATE_TIMEOUT_MS") || 4000) || 4000,
  1500,
);

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
  timeout: 10000,
  maxNetworkRetries: 0,
});

const isRecoverableCashoutAccountError = (error: unknown): boolean => {
  const code = String((error as { code?: string })?.code || "").trim();
  return (
    code === "oauth_not_supported" ||
    code === "resource_missing" ||
    code === "account_invalid"
  );
};

const retrieveAccountWithTimeout = async (
  accountId: string,
  timeoutMs = STRIPE_ACCOUNT_RETRIEVE_TIMEOUT_MS,
) => {
  let timer: number | null = null;
  try {
    return await Promise.race([
      stripe.accounts.retrieve(accountId),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
};

const promiseWithTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> => {
  let timer: number | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
};

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

type ExternalBankSnapshot = {
  externalAccountId: string | null;
  label: string | null;
  hasBank: boolean;
};

const getExternalBankSnapshot = (account: Stripe.Account): ExternalBankSnapshot => {
  const accountWithExternals = account as Stripe.Account & {
    default_external_account?: string | null;
    external_accounts?: { data?: Array<Record<string, unknown>> };
  };
  const externalAccounts = Array.isArray(accountWithExternals.external_accounts?.data)
    ? accountWithExternals.external_accounts?.data || []
    : [];
  const bankAccounts = externalAccounts.filter((item) =>
    String(item?.object || "").trim().toLowerCase() === "bank_account"
  );
  const defaultExternalId = String(
    accountWithExternals.default_external_account || "",
  ).trim();
  const selectedBank = (defaultExternalId
    ? bankAccounts.find((item) => String(item?.id || "").trim() === defaultExternalId)
    : null) || bankAccounts[0] || null;
  const externalAccountId = String(
    selectedBank?.id || defaultExternalId || "",
  ).trim() || null;
  const bankName = String(selectedBank?.bank_name || "Bank account").trim();
  const last4 = String(selectedBank?.last4 || "").trim();
  const label = externalAccountId
    ? `${bankName}${last4 ? ` ••••${last4}` : ""}`
    : null;
  return {
    externalAccountId,
    label,
    hasBank: Boolean(externalAccountId),
  };
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !STRIPE_SECRET_KEY
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
    const { data: authData, error: authError } = await promiseWithTimeout(
      authClient.auth.getUser(token),
      AUTH_GET_USER_TIMEOUT_MS,
      "auth_get_user_timeout",
    );
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

    const { data: profile, error: profileError } = await promiseWithTimeout(
      (async () =>
        await supabase
          .from("profiles")
          .select(
            [
              "stripe_cashout_account_id",
              "stripe_cashout_payouts_enabled",
              "stripe_cashout_onboarded_at",
              "stripe_cashout_external_account_id",
              "stripe_cashout_account_label",
              "stripe_cashout_bank_synced_at",
            ].join(","),
          )
          .eq("id", userId)
          .maybeSingle())(),
      PROFILE_QUERY_TIMEOUT_MS,
      "profile_query_timeout",
    );

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "Profile not found." }), {
        status: 404,
      });
    }

    const profileRow = (profile || {}) as Record<string, unknown>;
    const accountId = String(profileRow.stripe_cashout_account_id || "").trim();
    const cachedExternalAccountId = String(
      profileRow.stripe_cashout_external_account_id || "",
    ).trim();
    const selectedPayoutLabel = String(
      profileRow.stripe_cashout_account_label || "",
    ).trim();
    if (!accountId) {
      return new Response(
        JSON.stringify({
          connected: false,
          bankSelected: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
          accountId: null,
          selectedPayoutAccountId: null,
          selectedPayoutLabel: null,
          selectedPayoutSyncedAt: null,
        }),
        { status: 200 },
      );
    }

    let account: Stripe.Account | null = null;
    try {
      account = await retrieveAccountWithTimeout(accountId);
    } catch (accountError) {
      if (isRecoverableCashoutAccountError(accountError)) {
        await supabase
          .from("profiles")
          .update({
            stripe_cashout_account_id: null,
            stripe_cashout_external_account_id: null,
            stripe_cashout_payouts_enabled: false,
            stripe_cashout_onboarded_at: null,
          })
          .eq("id", userId);
        return new Response(
          JSON.stringify({
            connected: false,
            bankSelected: false,
            payoutsEnabled: false,
            detailsSubmitted: false,
            accountId: null,
            selectedPayoutAccountId: null,
            selectedPayoutLabel: null,
            selectedPayoutSyncedAt:
              profileRow.stripe_cashout_bank_synced_at || null,
            requirementsDue: [],
            disabledReason: null,
            reason: "cashout_account_reset",
          }),
          { status: 200 },
        );
      }
      throw accountError;
    }

    if (!account) {
      const cachedPayoutsEnabled = Boolean(
        profileRow.stripe_cashout_payouts_enabled,
      );
      return new Response(
        JSON.stringify({
          connected: true,
          bankSelected: Boolean(cachedExternalAccountId),
          payoutsEnabled: cachedPayoutsEnabled,
          detailsSubmitted:
            Boolean(profileRow.stripe_cashout_onboarded_at) || cachedPayoutsEnabled,
          accountId,
          selectedPayoutAccountId: cachedExternalAccountId || null,
          selectedPayoutLabel: selectedPayoutLabel || null,
          selectedPayoutSyncedAt: profileRow.stripe_cashout_bank_synced_at || null,
          requirementsDue: [],
          disabledReason: null,
          statusLagging: true,
        }),
        { status: 200 },
      );
    }

    const payoutsEnabled = account.payouts_enabled ?? false;
    const detailsSubmitted = account.details_submitted ?? false;
    const bankSnapshot = getExternalBankSnapshot(account);
    const syncedAt = new Date().toISOString();

    await promiseWithTimeout(
      (async () =>
        await supabase
          .from("profiles")
          .update({
            stripe_cashout_external_account_id: bankSnapshot.externalAccountId,
            stripe_cashout_account_label:
              bankSnapshot.label || selectedPayoutLabel || null,
            stripe_cashout_bank_synced_at: syncedAt,
            stripe_cashout_payouts_enabled: payoutsEnabled,
            stripe_cashout_onboarded_at: payoutsEnabled
              ? new Date().toISOString()
              : null,
          })
          .eq("id", userId))(),
      PROFILE_UPDATE_TIMEOUT_MS,
      "profile_update_timeout",
    );

    return new Response(
      JSON.stringify({
        connected: true,
        bankSelected: bankSnapshot.hasBank,
        payoutsEnabled,
        detailsSubmitted,
        accountId,
        selectedPayoutAccountId: bankSnapshot.externalAccountId,
        selectedPayoutLabel: bankSnapshot.label || selectedPayoutLabel || null,
        selectedPayoutSyncedAt: syncedAt,
        requirementsDue: account.requirements?.currently_due ?? [],
        disabledReason: account.requirements?.disabled_reason ?? null,
      }),
      { status: 200 },
    );
  } catch (error) {
    if (String(error?.message || "").includes("timeout")) {
      return new Response(
        JSON.stringify({
          error:
            "Cashout status is taking longer than expected. Please retry in a moment.",
          reason: "status_timeout",
        }),
        { status: 503 },
      );
    }
    console.error("stripe-get-cashout-status failed", error);
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
