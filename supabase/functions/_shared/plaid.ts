import { HttpError } from "./auth.ts";

const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID") ?? "";
const PLAID_SECRET = Deno.env.get("PLAID_SECRET") ?? "";
const PLAID_ENV = (Deno.env.get("PLAID_ENV") ?? "production").toLowerCase();
const PLAID_CLIENT_NAME = Deno.env.get("PLAID_CLIENT_NAME") ?? "Wello";
const PLAID_COUNTRY_CODES = Deno.env.get("PLAID_COUNTRY_CODES") ?? "US";
const PLAID_WEBHOOK_URL = Deno.env.get("PLAID_WEBHOOK_URL") ?? "";
const PLAID_REDIRECT_URI = Deno.env.get("PLAID_REDIRECT_URI") ?? "";
const PLAID_ANDROID_PACKAGE_NAME = Deno.env.get("PLAID_ANDROID_PACKAGE_NAME") ??
  "";
const PLAID_REQUEST_TIMEOUT_MS = Math.max(
  Number(Deno.env.get("PLAID_REQUEST_TIMEOUT_MS") || 15000) || 15000,
  5000,
);

const sanitizeWebhookUrl = (value: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    // Never put shared secrets in URL query params. They leak into logs.
    parsed.searchParams.delete("secret");
    return parsed.toString();
  } catch {
    return raw;
  }
};

const PLAID_BASE_URL = (() => {
  switch (PLAID_ENV) {
    case "development":
      return "https://development.plaid.com";
    case "production":
    default:
      return "https://production.plaid.com";
  }
})();

export const ensurePlaidEnv = () => {
  if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
    throw new HttpError("Missing Plaid configuration.", 500, {
      missing: {
        PLAID_CLIENT_ID: !PLAID_CLIENT_ID,
        PLAID_SECRET: !PLAID_SECRET,
      },
    });
  }
};

const plaidRequest = async <T>(
  path: string,
  payload: Record<string, unknown>,
): Promise<T> => {
  ensurePlaidEnv();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    PLAID_REQUEST_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await fetch(`${PLAID_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        ...payload,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (String((error as { name?: string })?.name || "") === "AbortError") {
      throw new HttpError(
        "Bank verification request timed out. Please try again.",
        504,
        { reason: "plaid_timeout" },
      );
    }
    throw new HttpError(
      "Unable to reach bank verification provider. Please try again.",
      502,
      {
        reason: "plaid_network_error",
        message: String((error as { message?: string })?.message || ""),
      },
    );
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }

  if (!response.ok) {
    throw new HttpError(
      String(
        parsed?.error_message || parsed?.message || "Plaid request failed.",
      ),
      response.status >= 400 && response.status < 600 ? response.status : 500,
      {
        plaid_error_type: parsed?.error_type || null,
        plaid_error_code: parsed?.error_code || null,
        plaid_request_id: parsed?.request_id || null,
      },
    );
  }

  return parsed as T;
};

export type PlaidTransaction = {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  datetime?: string | null;
  authorized_date?: string | null;
  authorized_datetime?: string | null;
  pending: boolean;
  merchant_name?: string | null;
  name?: string | null;
};

export type PlaidAccount = {
  account_id: string;
  name?: string | null;
  official_name?: string | null;
  mask?: string | null;
  type?: string | null;
  subtype?: string | null;
};

export const plaidCreateLinkToken = (payload: {
  userId: string;
  email?: string | null;
  fullName?: string | null;
  platform?: string | null;
  androidPackageName?: string | null;
  accessToken?: string | null;
  accountSelectionEnabled?: boolean;
  products?: string[] | null;
  optionalProducts?: string[] | null;
}) => {
  const countryCodes = PLAID_COUNTRY_CODES.split(",")
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);
  const accessToken = String(payload.accessToken || "").trim();
  const request: Record<string, unknown> = accessToken
    ? {
      client_name: PLAID_CLIENT_NAME,
      country_codes: countryCodes.length ? countryCodes : ["US"],
      language: "en",
      user: { client_user_id: payload.userId },
      access_token: accessToken,
    }
    : (() => {
      const products = Array.isArray(payload.products) && payload.products.length
        ? payload.products.map((value) => String(value || "").trim().toLowerCase())
          .filter(Boolean)
        : ["transactions"];
      const optionalProducts =
        Array.isArray(payload.optionalProducts) && payload.optionalProducts.length
          ? payload.optionalProducts
            .map((value) => String(value || "").trim().toLowerCase())
            .filter(Boolean)
          : ["identity"];

      const request: Record<string, unknown> = {
        client_name: PLAID_CLIENT_NAME,
        country_codes: countryCodes.length ? countryCodes : ["US"],
        language: "en",
        user: { client_user_id: payload.userId },
        products,
        optional_products: optionalProducts,
      };
      if (products.includes("transactions")) {
        request.transactions = {
          days_requested: 30,
        };
      }
      return request;
    })();

  if (accessToken && payload.accountSelectionEnabled) {
    request.update = { account_selection_enabled: true };
  }

  const platform = String(payload.platform || "").toLowerCase().trim();
  const androidPackageName = String(
    payload.androidPackageName || PLAID_ANDROID_PACKAGE_NAME || "",
  ).trim();

  if (!accessToken && PLAID_WEBHOOK_URL) {
    request.webhook = sanitizeWebhookUrl(PLAID_WEBHOOK_URL);
  }
  // For OAuth support:
  // - Android link tokens require `android_package_name` and NO `redirect_uri`.
  // - iOS link tokens use `redirect_uri` and should not include `android_package_name`.
  if (platform === "android" && androidPackageName) {
    request.android_package_name = androidPackageName;
  } else if (platform === "ios" && PLAID_REDIRECT_URI) {
    request.redirect_uri = PLAID_REDIRECT_URI;
  }

  return plaidRequest<{
    link_token: string;
    expiration: string;
    request_id: string;
  }>("/link/token/create", request);
};

export const plaidExchangePublicToken = (publicToken: string) =>
  plaidRequest<{
    access_token: string;
    item_id: string;
    request_id: string;
  }>("/item/public_token/exchange", { public_token: publicToken });

export const plaidGetItem = (accessToken: string) =>
  plaidRequest<{
    item: {
      item_id: string;
      institution_id?: string | null;
      available_products?: string[];
      billed_products?: string[];
      consent_expiration_time?: string | null;
    };
    request_id: string;
  }>("/item/get", { access_token: accessToken });

export const plaidGetInstitutionById = (
  institutionId: string,
  countryCodes = ["US"],
) =>
  plaidRequest<{
    institution: { institution_id: string; name?: string | null };
    request_id: string;
  }>("/institutions/get_by_id", {
    institution_id: institutionId,
    country_codes: countryCodes,
    options: { include_optional_metadata: true },
  });

export const plaidRemoveItem = (accessToken: string) =>
  plaidRequest<{ removed: boolean; request_id: string }>("/item/remove", {
    access_token: accessToken,
  });

export const plaidGetTransactions = async (
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<{ transactions: PlaidTransaction[]; requestId: string | null }> => {
  let offset = 0;
  const count = 200;
  const all: PlaidTransaction[] = [];
  let requestId: string | null = null;
  let total = 0;
  let guard = 0;

  do {
    const response = await plaidRequest<{
      transactions: PlaidTransaction[];
      total_transactions: number;
      request_id: string;
    }>("/transactions/get", {
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
      options: {
        count,
        offset,
      },
    });

    requestId = response.request_id || requestId;
    const nextTransactions = Array.isArray(response.transactions)
      ? response.transactions
      : [];
    total = Number(response.total_transactions) || 0;
    all.push(...nextTransactions);
    offset += nextTransactions.length;
    guard += 1;
    if (guard > 10) break;
  } while (offset < total);

  return { transactions: all, requestId };
};

export const plaidGetIdentity = async (
  accessToken: string,
  accountId: string,
): Promise<string[]> => {
  try {
    const response = await plaidRequest<{
      accounts?: Array<
        { account_id: string; owners?: Array<{ names?: string[] }> }
      >;
    }>("/identity/get", {
      access_token: accessToken,
      options: { account_ids: [accountId] },
    });
    const account = (response.accounts || []).find(
      (a) => a.account_id === accountId,
    );
    const names = (account?.owners || [])
      .flatMap((owner) => owner?.names || [])
      .map((name) => String(name || "").trim())
      .filter(Boolean);
    return Array.from(new Set(names));
  } catch {
    return [];
  }
};

export const plaidGetAccounts = async (
  accessToken: string,
): Promise<{ accounts: PlaidAccount[]; requestId: string | null }> => {
  const response = await plaidRequest<{
    accounts?: PlaidAccount[];
    request_id?: string;
  }>("/accounts/get", {
    access_token: accessToken,
  });

  return {
    accounts: Array.isArray(response?.accounts) ? response.accounts : [],
    requestId: response?.request_id || null,
  };
};

export const plaidCreateStripeBankAccountToken = (
  accessToken: string,
  accountId: string,
) =>
  plaidRequest<{
    stripe_bank_account_token: string;
    request_id: string;
  }>("/processor/stripe/bank_account_token/create", {
    access_token: accessToken,
    account_id: accountId,
  });

export const plaidCreateProcessorToken = (
  accessToken: string,
  accountId: string,
  processor: string,
) =>
  plaidRequest<{
    processor_token: string;
    request_id: string;
  }>("/processor/token/create", {
    access_token: accessToken,
    account_id: accountId,
    processor: String(processor || "").trim().toLowerCase() || "checkbook",
  });

export const plaidGetAuthNumbers = (
  accessToken: string,
  accountId: string,
) =>
  plaidRequest<{
    accounts?: Array<{ account_id?: string | null; subtype?: string | null; type?: string | null }>;
    numbers?: {
      ach?: Array<{
        account_id?: string | null;
        account?: string | null;
        routing?: string | null;
        wire_routing?: string | null;
      }>;
    };
    request_id?: string;
  }>("/auth/get", {
    access_token: accessToken,
    options: {
      account_ids: [accountId],
    },
  });

export const plaidGetWebhookVerificationKey = (keyId: string) =>
  plaidRequest<{
    key?: {
      alg?: string;
      crv?: string;
      kid?: string;
      kty?: string;
      use?: string;
      x?: string;
      y?: string;
      created_at?: number | string | null;
      expired_at?: number | string | null;
    } | null;
    request_id?: string;
  }>("/webhook_verification_key/get", {
    key_id: keyId,
  });
