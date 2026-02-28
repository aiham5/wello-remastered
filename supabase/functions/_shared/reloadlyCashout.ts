import {
  authenticateRequest,
  createAdminSupabase,
  HttpError,
  json,
} from "./auth.ts";

type ReloadlyCashoutHandlerOptions = {
  endpointName: string;
  requireIdempotencyKey: boolean;
  enableDeprecationLog?: boolean;
};

const normalizeSecretValue = (rawValue: string) => {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";
  if (/^Bearer\s+/i.test(raw)) return raw.replace(/^Bearer\s+/i, "").trim();
  if (/^Basic\s+/i.test(raw)) {
    const encoded = raw.replace(/^Basic\s+/i, "").trim();
    try {
      const decoded = atob(encoded);
      return String(decoded.split(":").slice(1).join(":") || "").trim() ||
        encoded;
    } catch {
      return encoded;
    }
  }
  return raw;
};

const envFlag = (primary: string, fallback: string, defaultValue: boolean) => {
  const raw = String(
    Deno.env.get(primary) ?? Deno.env.get(fallback) ??
      (defaultValue ? "true" : "false"),
  )
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

const envString = (primary: string, fallback: string, defaultValue = "") =>
  String(Deno.env.get(primary) ?? Deno.env.get(fallback) ?? defaultValue)
    .trim();

const envNumber = (primary: string, fallback: string, defaultValue: number) => {
  const parsed = Number(
    Deno.env.get(primary) ?? Deno.env.get(fallback) ?? defaultValue,
  );
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

const RELOADLY_API_KEY = normalizeSecretValue(
  String(Deno.env.get("RELOADLY_API_KEY") || ""),
);
const RELOADLY_CLIENT_ID = envString("RELOADLY_CLIENT_ID", "RELOADLY_CLIENT_ID");
const RELOADLY_CLIENT_SECRET = normalizeSecretValue(
  String(Deno.env.get("RELOADLY_CLIENT_SECRET") || ""),
);
const RELOADLY_BASE_URL = envString(
  "RELOADLY_BASE_URL",
  "RELOADLY_BASE_URL",
  "https://giftcards-sandbox.reloadly.com",
).replace(/\/+$/, "");
const RELOADLY_AUTH_URL = envString(
  "RELOADLY_AUTH_URL",
  "RELOADLY_AUTH_URL",
  "https://auth.reloadly.com/oauth/token",
).replace(/\/+$/, "");
const RELOADLY_AUDIENCE = envString(
  "RELOADLY_AUDIENCE",
  "RELOADLY_AUDIENCE",
  "https://giftcards-sandbox.reloadly.com",
).replace(/\/+$/, "");
const RELOADLY_ACCEPT_HEADER = envString(
  "RELOADLY_ACCEPT_HEADER",
  "RELOADLY_ACCEPT_HEADER",
  "application/com.reloadly.giftcards-v1+json",
).trim() || "application/com.reloadly.giftcards-v1+json";
const RELOADLY_CASHOUT_ENABLED = envFlag(
  "RELOADLY_CASHOUT_ENABLED",
  "RELOADLY_CASHOUT_ENABLED",
  true,
);
const RELOADLY_CASHOUT_PRODUCT_ID = Math.trunc(
  envNumber("RELOADLY_CASHOUT_PRODUCT_ID", "RELOADLY_CASHOUT_PRODUCT_ID", 0),
);
const RELOADLY_CASHOUT_COUNTRY_CODE = envString(
  "RELOADLY_CASHOUT_COUNTRY_CODE",
  "RELOADLY_CASHOUT_COUNTRY_CODE",
  "US",
)
  .trim()
  .toUpperCase()
  .slice(0, 2) || "US";
const RELOADLY_CASHOUT_CURRENCY_CODE = envString(
  "RELOADLY_CASHOUT_CURRENCY_CODE",
  "RELOADLY_CASHOUT_CURRENCY_CODE",
  "USD",
)
  .trim()
  .toUpperCase()
  .slice(0, 3) || "USD";
const RELOADLY_CASHOUT_SENDER_NAME = envString(
  "RELOADLY_CASHOUT_SENDER_NAME",
  "RELOADLY_CASHOUT_SENDER_NAME",
  "Wello",
).slice(0, 80);
const RELOADLY_CASHOUT_MIN_CENTS = Math.max(
  Math.trunc(
    envNumber("RELOADLY_CASHOUT_MIN_CENTS", "DOTS_CASHOUT_MIN_CENTS", 1000),
  ),
  100,
);
const RELOADLY_CASHOUT_MAX_CENTS = Math.max(
  Math.trunc(
    envNumber("RELOADLY_CASHOUT_MAX_CENTS", "DOTS_CASHOUT_MAX_CENTS", 100000),
  ),
  RELOADLY_CASHOUT_MIN_CENTS,
);

const CASHOUT_WEEKLY_LIMIT_ENABLED = (() => {
  const raw = String(Deno.env.get("CASHOUT_WEEKLY_LIMIT_ENABLED") || "")
    .trim()
    .toLowerCase();
  if (!raw) return true;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
})();
const CASHOUT_WEEKLY_LIMIT_MAX = (() => {
  const raw = Math.trunc(
    Number(Deno.env.get("CASHOUT_WEEKLY_LIMIT_MAX") || "2"),
  );
  if (!Number.isFinite(raw) || raw < 1) return 2;
  return raw;
})();

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const redactSecrets = (value: string) =>
  String(value || "")
    .replace(/Basic\s+[A-Za-z0-9+/=._*\-]+/gi, "Basic [REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9+/=._*\-]+/gi, "Bearer [REDACTED]")
    .replace(/\bwhsec_[A-Za-z0-9+/=._*\-]+\b/gi, "whsec_[REDACTED]");

const normalizeEmail = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || "").trim());

const sha256Hex = async (value: string) => {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const deriveUuidFromKey = async (value: string) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (isUuid(normalized)) return normalized;
  const hash = await sha256Hex(normalized);
  const base = hash.slice(0, 32).split("");
  base[12] = "4";
  const variantNibble = parseInt(base[16], 16);
  base[16] = ((variantNibble & 0x3) | 0x8).toString(16);
  return [
    base.slice(0, 8).join(""),
    base.slice(8, 12).join(""),
    base.slice(12, 16).join(""),
    base.slice(16, 20).join(""),
    base.slice(20, 32).join(""),
  ].join("-");
};

const isLikelyValidEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

const splitFullName = (value: string) => {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { firstName: "Wello", lastName: "User" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "User" };
  return {
    firstName: parts.slice(0, -1).join(" ").slice(0, 80),
    lastName: parts.slice(-1).join(" ").slice(0, 80),
  };
};

const parseReloadlyErrorMessage = (
  payload: unknown,
  rawBody = "",
  status: number | null = null,
) => {
  const asRecord = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  const errors = Array.isArray(asRecord?.errors) ? asRecord.errors : [];
  const firstError = errors.length > 0 ? errors[0] : null;
  const firstErrorRecord = firstError && typeof firstError === "object"
    ? firstError as Record<string, unknown>
    : {};
  const nestedError = asRecord?.error && typeof asRecord.error === "object"
    ? asRecord.error as Record<string, unknown>
    : {};
  const candidate = String(
    firstErrorRecord?.message ||
      firstErrorRecord?.detail ||
      firstErrorRecord?.reason ||
      nestedError?.message ||
      nestedError?.code ||
      asRecord?.message ||
      asRecord?.error ||
      "",
  ).trim();
  const compactRaw = redactSecrets(String(rawBody || ""))
    .replace(/\s+/g, " ")
    .trim();
  const rawSnippet = compactRaw ? compactRaw.slice(0, 220) : "";
  const statusPart = Number.isFinite(Number(status)) && Number(status) > 0
    ? ` (${Number(status)})`
    : "";
  if (candidate) {
    return `Reloadly API error${statusPart}: ${redactSecrets(candidate)}`;
  }
  if (rawSnippet) return `Reloadly API error${statusPart}: ${rawSnippet}`;
  return `Reloadly API error${statusPart}.`;
};

let reloadlyTokenCache: { token: string; expiresAtMs: number } | null = null;

const getReloadlyAccessToken = async () => {
  if (RELOADLY_API_KEY) return RELOADLY_API_KEY;
  if (!RELOADLY_CLIENT_ID || !RELOADLY_CLIENT_SECRET || !RELOADLY_AUDIENCE) {
    throw new HttpError("Missing Reloadly configuration.", 500, {
      reason: "reloadly_credentials_missing",
      missing: {
        RELOADLY_API_KEY: !RELOADLY_API_KEY,
        RELOADLY_CLIENT_ID: !RELOADLY_CLIENT_ID,
        RELOADLY_CLIENT_SECRET: !RELOADLY_CLIENT_SECRET,
        RELOADLY_AUDIENCE: !RELOADLY_AUDIENCE,
      },
    });
  }
  const now = Date.now();
  if (reloadlyTokenCache?.token && reloadlyTokenCache.expiresAtMs > now + 15000) {
    return reloadlyTokenCache.token;
  }
  const tokenRes = await fetch(RELOADLY_AUTH_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      client_id: RELOADLY_CLIENT_ID,
      client_secret: RELOADLY_CLIENT_SECRET,
      grant_type: "client_credentials",
      audience: RELOADLY_AUDIENCE,
    }),
  });
  const tokenText = await tokenRes.text();
  let tokenPayload: Record<string, unknown> = {};
  try {
    tokenPayload = tokenText ? JSON.parse(tokenText) : {};
  } catch {
    tokenPayload = {};
  }
  if (!tokenRes.ok) {
    throw new HttpError(
      parseReloadlyErrorMessage(tokenPayload, tokenText, tokenRes.status || null),
      tokenRes.status || 502,
      {
        reason: "reloadly_auth_failed",
        upstreamStatus: tokenRes.status || null,
      },
    );
  }
  const accessToken = String(
    tokenPayload?.access_token || tokenPayload?.token || "",
  ).trim();
  if (!accessToken) {
    throw new HttpError("Reloadly auth succeeded without access token.", 502, {
      reason: "reloadly_auth_missing_token",
    });
  }
  const expiresInSec = Math.max(
    Math.trunc(Number(tokenPayload?.expires_in || 300)),
    60,
  );
  reloadlyTokenCache = {
    token: accessToken,
    expiresAtMs: now + (expiresInSec * 1000),
  };
  return accessToken;
};

const getReloadlyHeaders = async () => ({
  "content-type": "application/json",
  accept: RELOADLY_ACCEPT_HEADER,
  authorization: `Bearer ${await getReloadlyAccessToken()}`,
});

const callReloadlyApi = async (
  path: string,
  init: RequestInit,
) => {
  const response = await fetch(`${RELOADLY_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(await getReloadlyHeaders()),
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  return { response, text, parsed };
};

const toNumberList = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
};

const extractReloadlyProducts = (payload: Record<string, unknown>) => {
  if (Array.isArray(payload)) {
    return payload.filter((item) =>
      item && typeof item === "object" && !Array.isArray(item)
    ) as Array<Record<string, unknown>>;
  }
  const containers = ["content", "products", "data", "items"];
  for (const key of containers) {
    const value = payload?.[key];
    if (Array.isArray(value)) {
      return value.filter((item) =>
        item && typeof item === "object" && !Array.isArray(item)
      ) as Array<Record<string, unknown>>;
    }
  }
  return [];
};

const productMatchesAmount = (
  product: Record<string, unknown>,
  amountMajor: number,
) => {
  const fixed = [
    ...toNumberList(product?.fixedRecipientDenominations),
    ...toNumberList(product?.fixedSenderDenominations),
    ...toNumberList(product?.recipientDenominations),
  ];
  if (fixed.length > 0) {
    return fixed.some((value) => Math.abs(value - amountMajor) < 0.00001);
  }

  const min = Number(
    product?.minRecipientDenomination ?? product?.minSenderDenomination ?? 0,
  );
  const max = Number(
    product?.maxRecipientDenomination ?? product?.maxSenderDenomination ?? 0,
  );
  if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min) {
    return amountMajor >= min && amountMajor <= max;
  }

  const denominationType = String(
    product?.denominationType || product?.denomination_type || "",
  )
    .trim()
    .toUpperCase();
  if (denominationType === "RANGE") return true;
  return false;
};

const selectReloadlyProductId = async (
  payoutAmountCents: number,
) => {
  if (Number.isFinite(RELOADLY_CASHOUT_PRODUCT_ID) && RELOADLY_CASHOUT_PRODUCT_ID > 0) {
    return RELOADLY_CASHOUT_PRODUCT_ID;
  }

  const amountMajor = Number((payoutAmountCents / 100).toFixed(2));
  let lookup = await callReloadlyApi(
    `/countries/${encodeURIComponent(RELOADLY_CASHOUT_COUNTRY_CODE)}/products`,
    { method: "GET" },
  );
  if (!lookup.response.ok && [404, 406].includes(lookup.response.status || 0)) {
    lookup = await callReloadlyApi(
      `/products?countryCode=${encodeURIComponent(RELOADLY_CASHOUT_COUNTRY_CODE)}`,
      { method: "GET" },
    );
  }
    if (!lookup.response.ok) {
      throw new HttpError(
        parseReloadlyErrorMessage(
          lookup.parsed,
          lookup.text,
        lookup.response.status || null,
      ),
      lookup.response.status || 502,
      {
        reason: "reloadly_products_lookup_failed",
        upstreamStatus: lookup.response.status || null,
        upstreamBody: redactSecrets(String(lookup.text || "").slice(0, 400)),
      },
    );
  }

  const allProducts = extractReloadlyProducts(lookup.parsed);
  if (!allProducts.length) {
    throw new HttpError("No Reloadly products available for configured country.", 500, {
      reason: "reloadly_products_empty",
    });
  }

  const desiredCurrency = String(RELOADLY_CASHOUT_CURRENCY_CODE || "")
    .trim()
    .toUpperCase();
  const activeProducts = allProducts.filter((product) => {
    const status = String(product?.status || product?.state || "ACTIVE")
      .trim()
      .toUpperCase();
    return status === "ACTIVE" || status === "AVAILABLE";
  });
  const currencyProducts = activeProducts.filter((product) => {
    const recipientCurrency = String(
      product?.recipientCurrencyCode || product?.recipient_currency_code || "",
    )
      .trim()
      .toUpperCase();
    const senderCurrency = String(
      product?.senderCurrencyCode || product?.sender_currency_code || "",
    )
      .trim()
      .toUpperCase();
    return !desiredCurrency ||
      recipientCurrency === desiredCurrency ||
      senderCurrency === desiredCurrency;
  });
  const amountMatches = currencyProducts.filter((product) =>
    productMatchesAmount(product, amountMajor)
  );
  const candidates = amountMatches.length
    ? amountMatches
    : (currencyProducts.length ? currencyProducts : activeProducts);
  const chosen = candidates.find((product) =>
    Number.isFinite(Number(product?.productId || product?.product_id))
  ) || null;
  const resolved = Math.trunc(
    Number(chosen?.productId || chosen?.product_id || 0),
  );
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new HttpError("Unable to resolve a valid Reloadly product.", 500, {
      reason: "reloadly_product_unresolved",
    });
  }
  return resolved;
};

const extractReloadlyOrderObject = (payload: Record<string, unknown>) => {
  const nestedKeys = ["order", "data"];
  for (const key of nestedKeys) {
    const value = payload?.[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return payload;
};

const extractReloadlyClaimUrl = (payload: Record<string, unknown>) =>
  String(
    payload?.link ||
      payload?.shortlink ||
      payload?.short_link ||
      payload?.url ||
      payload?.claim_url ||
      payload?.redemptionUrl ||
      payload?.redemption_url ||
      "",
  ).trim() || null;

const extractReloadlyRewardId = (payload: Record<string, unknown>) =>
  String(
    payload?.transactionId ||
      payload?.transaction_id ||
      payload?.gift_uuid ||
      payload?.gift_id ||
      payload?.reward_id ||
      payload?.uuid ||
      payload?.id ||
      "",
  ).trim() || null;

const toPayoutResponse = (row: Record<string, unknown>) => ({
  success: true,
  provider: "reloadly",
  methodType: "gift_card",
  payoutId: String(row.id || "").trim(),
  orderId: String(row.provider_order_id || "").trim() || null,
  rewardId: String(row.provider_reward_id || "").trim() || null,
  claimUrl: String(row.provider_claim_url || "").trim() || null,
  amountCents: Math.max(0, Number(row.amount_cents) || 0),
  status: String(row.status || "pending").toLowerCase(),
  duplicate: true,
});

const buildIdempotencyKey = () => `legacy_${crypto.randomUUID()}`;

const normalizeMethodType = (value: unknown) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "gift_card") return "gift_card";
  return "";
};

const parseCatalogProductId = (value: unknown) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return 0;
  const direct = Math.trunc(Number(normalized));
  if (Number.isFinite(direct) && direct > 0) return direct;
  if (normalized.startsWith("product:")) {
    const parsed = Math.trunc(Number(normalized.slice(8)));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
};

export const createReloadlyCashoutHandler = (
  options: ReloadlyCashoutHandlerOptions,
) =>
async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = createAdminSupabase();
  let payoutId: string | null = null;
  let userId: string | null = null;
  let reloadlyCampaignId: string | null = null;
  let splitEventId: string | null = null;
  let splitOverage = 0;
  let adjustmentId: string | null = null;

  try {
    if (!RELOADLY_CASHOUT_ENABLED) {
      throw new HttpError("Cashout is currently unavailable.", 403, {
        reason: "reloadly_cashout_disabled",
      });
    }
    if (
      !RELOADLY_API_KEY &&
      (!RELOADLY_CLIENT_ID || !RELOADLY_CLIENT_SECRET || !RELOADLY_AUDIENCE)
    ) {
      throw new HttpError("Missing Reloadly configuration.", 500, {
        reason: "reloadly_credentials_missing",
      });
    }

    if (options.enableDeprecationLog) {
      console.warn(
        `[${options.endpointName}] deprecated endpoint invoked; route clients to reloadly-create-cashout`,
      );
    }

    const { userId: authedUserId, body } = await authenticateRequest(req);
    userId = authedUserId;

    const methodType = normalizeMethodType(
      body?.methodType ?? body?.method_type ?? "gift_card",
    );
    if (!methodType || methodType !== "gift_card") {
      throw new HttpError("Unsupported cashout method for this endpoint.", 400, {
        reason: "invalid_method_type",
      });
    }
    const catalogItemCode = String(
      body?.catalogItemCode ?? body?.catalog_item_code ?? "",
    ).trim();
    const catalogItemName = String(
      body?.catalogItemName ?? body?.catalog_item_name ?? "",
    )
      .trim()
      .slice(0, 120) || null;
    const catalogImageUrl = String(
      body?.catalogImageUrl ?? body?.catalog_image_url ?? "",
    )
      .trim()
      .slice(0, 1000) || null;
    if (!catalogItemCode) {
      throw new HttpError("Missing catalogItemCode.", 400, {
        reason: "missing_catalog_item_code",
      });
    }

    const requestedAmountCentsRaw = body?.amountCents ?? body?.amount_cents ??
      body?.amount;
    const requestedAmountCents =
      requestedAmountCentsRaw == null || requestedAmountCentsRaw === ""
        ? null
        : Math.trunc(Number(requestedAmountCentsRaw));
    if (requestedAmountCents != null) {
      if (!Number.isFinite(requestedAmountCents) || requestedAmountCents <= 0) {
        throw new HttpError("Invalid amountCents.", 400, {
          reason: "invalid_amount",
        });
      }
    }

    const rawIdempotencyKey = String(
      body?.idempotencyKey ?? body?.idempotency_key ?? "",
    ).trim();
    if (!rawIdempotencyKey && options.requireIdempotencyKey) {
      throw new HttpError("Missing idempotencyKey.", 400, {
        reason: "missing_idempotency_key",
      });
    }
    const idempotencyKey = rawIdempotencyKey || buildIdempotencyKey();
    if (idempotencyKey.length > 128) {
      throw new HttpError("idempotencyKey is too long.", 400, {
        reason: "invalid_idempotency_key",
      });
    }
    const reloadlyIdempotencyKey = await deriveUuidFromKey(
      `${userId}:${idempotencyKey}`,
    );
    const reloadlyRequestId = `wello_${reloadlyIdempotencyKey.replace(/-/g, "").slice(0, 24)}`;

    const { data: existingPayout, error: existingPayoutError } = await supabase
      .from("cashout_payouts")
      .select(
        "id, amount_cents, status, provider_order_id, provider_reward_id, provider_claim_url",
      )
      .eq("user_id", userId)
      .eq("provider", "reloadly")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingPayoutError) {
      throw new HttpError(
        existingPayoutError.message ||
          "Unable to check existing payout request.",
        500,
      );
    }
    if (existingPayout?.id) {
      return json(
        toPayoutResponse(existingPayout as Record<string, unknown>),
        200,
      );
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", userId)
      .maybeSingle();
    if (profileError || !profile) {
      throw new HttpError(profileError?.message || "Profile not found.", 404);
    }

    const authUser = await supabase.auth.admin.getUserById(userId);
    const authUserRecord = authUser?.data?.user || null;

    const profileEmail = normalizeEmail(profile?.email);
    let recipientEmail = profileEmail;
    if (!isLikelyValidEmail(recipientEmail)) {
      const authEmail = normalizeEmail(authUserRecord?.email);
      if (isLikelyValidEmail(authEmail)) recipientEmail = authEmail;
    }
    if (!isLikelyValidEmail(recipientEmail)) {
      throw new HttpError(
        "Add a valid email to your profile before cashing out.",
        400,
        {
          reason: "invalid_profile_email",
        },
      );
    }

    const recipientName = String(profile?.full_name || "Wello User")
      .trim()
      .slice(0, 120) || "Wello User";
    const { firstName, lastName } = splitFullName(recipientName);

    let payoutsUsedInWindowBefore = 0;
    let payoutsUsedInWindowAfter = 0;
    let payoutsRemainingInWindow = 0;
    let nextEligibleAtForWindow: string | null = null;

    if (CASHOUT_WEEKLY_LIMIT_ENABLED) {
      const weekWindowStartMs = Date.now() - ONE_WEEK_MS;
      const weekWindowStartIso = new Date(weekWindowStartMs).toISOString();
      const { data: recentPayouts, error: recentPayoutsError } = await supabase
        .from("cashout_payouts")
        .select("id, created_at")
        .eq("user_id", userId)
        .in("status", ["pending", "paid"])
        .gte("created_at", weekWindowStartIso)
        .order("created_at", { ascending: true });
      if (recentPayoutsError) {
        throw new HttpError(
          recentPayoutsError.message || "Unable to load cashout history.",
          500,
        );
      }

      const payoutRows = Array.isArray(recentPayouts) ? recentPayouts : [];
      payoutsUsedInWindowBefore = payoutRows.length;
      payoutsUsedInWindowAfter = payoutsUsedInWindowBefore + 1;
      payoutsRemainingInWindow = Math.max(
        CASHOUT_WEEKLY_LIMIT_MAX - payoutsUsedInWindowAfter,
        0,
      );
      const oldestInWindow = payoutRows[0]?.created_at
        ? Date.parse(payoutRows[0].created_at)
        : NaN;
      const computedNextEligibleAt = Number.isFinite(oldestInWindow)
        ? new Date(oldestInWindow + ONE_WEEK_MS).toISOString()
        : new Date(Date.now() + ONE_WEEK_MS).toISOString();
      if (payoutRows.length >= CASHOUT_WEEKLY_LIMIT_MAX) {
        throw new HttpError(
          `Cashout is limited to ${CASHOUT_WEEKLY_LIMIT_MAX} times per 7 days.`,
          429,
          {
            reason: "weekly_cashout_limit",
            nextEligibleAt: computedNextEligibleAt,
            payoutsUsedInWindow: payoutsUsedInWindowBefore,
            payoutsRemainingInWindow: 0,
            weeklyLimit: CASHOUT_WEEKLY_LIMIT_MAX,
          },
        );
      }
      if (payoutsRemainingInWindow <= 0) {
        nextEligibleAtForWindow = computedNextEligibleAt;
      }
    }

    const { data: availableEvents, error: eventsError } = await supabase
      .from("cashback_events")
      .select("id, amount_cents, business_id, created_at")
      .eq("user_id", userId)
      .eq("status", "available")
      .is("payout_id", null);
    if (eventsError) {
      throw new HttpError(
        eventsError.message || "Unable to load cashback balance.",
        500,
      );
    }

    const eventRows = Array.isArray(availableEvents) ? availableEvents : [];
    const availableCents = eventRows.reduce(
      (sum, row) => sum + (Number(row.amount_cents) || 0),
      0,
    );
    if (availableCents <= 0) {
      throw new HttpError("No cashback balance available.", 400, {
        reason: "no_cashback_balance",
      });
    }

    if (requestedAmountCents != null && requestedAmountCents > availableCents) {
      throw new HttpError(
        "Requested amount exceeds available cashback balance.",
        400,
        {
          reason: "amount_exceeds_available",
          availableCents,
        },
      );
    }

    const payoutAmountCents = requestedAmountCents == null
      ? availableCents
      : requestedAmountCents;
    if (payoutAmountCents < RELOADLY_CASHOUT_MIN_CENTS) {
      throw new HttpError(
        `Minimum cashout is $${(RELOADLY_CASHOUT_MIN_CENTS / 100).toFixed(2)}.`,
        400,
        {
          reason: "minimum_cashout_not_met",
          minimumCashoutCents: RELOADLY_CASHOUT_MIN_CENTS,
        },
      );
    }
    if (payoutAmountCents > RELOADLY_CASHOUT_MAX_CENTS) {
      throw new HttpError(
        `Maximum cashout is $${(RELOADLY_CASHOUT_MAX_CENTS / 100).toFixed(2)}.`,
        400,
        {
          reason: "maximum_cashout_exceeded",
          maximumCashoutCents: RELOADLY_CASHOUT_MAX_CENTS,
        },
      );
    }

    const selected: Array<
      { id: string; amount_cents: number; business_id: string | null }
    > = [];
    let selectedSum = 0;
    const sorted = [...eventRows].sort((a, b) => {
      const aMs = Date.parse(a?.created_at || "") || 0;
      const bMs = Date.parse(b?.created_at || "") || 0;
      return aMs - bMs;
    });

    for (const row of sorted) {
      if (selectedSum >= payoutAmountCents) break;
      const amount = Number(row?.amount_cents) || 0;
      const eventId = String(row?.id || "").trim();
      if (!eventId || amount <= 0) continue;
      selected.push({
        id: eventId,
        amount_cents: amount,
        business_id: String(row?.business_id || "").trim() || null,
      });
      selectedSum += amount;
    }
    if (!selected.length) {
      throw new HttpError("No cashback balance available.", 400, {
        reason: "no_cashback_balance",
      });
    }

    const { data: payoutRow, error: payoutInsertError } = await supabase
      .from("cashout_payouts")
      .insert({
        user_id: userId,
        stripe_account_id: "reloadly_cashout",
        provider: "reloadly",
        method_type: "gift_card",
        approval_status: "not_required",
        amount_cents: payoutAmountCents,
        status: "pending",
        idempotency_key: idempotencyKey,
        provider_status: "payout_create_pending",
        catalog_item_code: catalogItemCode || null,
        catalog_item_name: catalogItemName,
        catalog_image_url: catalogImageUrl,
      })
      .select("id")
      .maybeSingle();
    if (payoutInsertError || !payoutRow?.id) {
      const code = String((payoutInsertError as { code?: string })?.code || "");
      if (code === "23505") {
        const { data: duplicatePayout } = await supabase
          .from("cashout_payouts")
          .select(
            "id, amount_cents, status, provider_order_id, provider_reward_id, provider_claim_url",
          )
          .eq("user_id", userId)
          .eq("provider", "reloadly")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();
        if (duplicatePayout?.id) {
          return json(
            toPayoutResponse(duplicatePayout as Record<string, unknown>),
            200,
          );
        }
      }
      throw new HttpError(
        payoutInsertError?.message || "Unable to create payout.",
        500,
      );
    }
    payoutId = payoutRow.id;

    const reserveIds = selected.map((row) => row.id);
    if (reserveIds.length) {
      const { error: reserveError } = await supabase
        .from("cashback_events")
        .update({ status: "reserved", payout_id: payoutId })
        .in("id", reserveIds)
        .eq("user_id", userId)
        .eq("status", "available");
      if (reserveError) {
        throw new HttpError(
          reserveError.message || "Unable to reserve cashback.",
          500,
        );
      }
    }

    const overage = Math.max(0, selectedSum - payoutAmountCents);
    if (overage > 0) {
      const last = selected[selected.length - 1];
      const lastAmount = Number(last?.amount_cents) || 0;
      const newLastAmount = Math.max(0, lastAmount - overage);
      if (newLastAmount <= 0) {
        throw new HttpError(
          "Unable to split cashback rows for this amount.",
          500,
        );
      }
      splitEventId = String(last.id || "") || null;
      splitOverage = overage;
      const { error: splitError } = await supabase
        .from("cashback_events")
        .update({ amount_cents: newLastAmount })
        .eq("id", last.id)
        .eq("user_id", userId)
        .eq("status", "reserved")
        .eq("payout_id", payoutId);
      if (splitError) {
        throw new HttpError(
          splitError.message || "Unable to split cashback.",
          500,
        );
      }
      const { data: adjustment, error: adjustmentError } = await supabase
        .from("cashback_events")
        .insert({
          receipt_upload_id: null,
          redemption_id: null,
          business_id: last.business_id,
          user_id: userId,
          amount_cents: overage,
          status: "available",
          payout_id: null,
          source: "adjustment",
          parent_event_id: last.id,
        })
        .select("id")
        .maybeSingle();
      if (adjustmentError || !adjustment?.id) {
        throw new HttpError(
          adjustmentError?.message || "Unable to create adjustment.",
          500,
        );
      }
      adjustmentId = adjustment.id;
    }

    const requestedProductId = parseCatalogProductId(catalogItemCode);
    const reloadlyProductId = requestedProductId > 0
      ? requestedProductId
      : await selectReloadlyProductId(payoutAmountCents);

    const payload: Record<string, unknown> = {
      productId: reloadlyProductId,
      countryCode: RELOADLY_CASHOUT_COUNTRY_CODE,
      quantity: 1,
      unitPrice: Number((payoutAmountCents / 100).toFixed(2)),
      customIdentifier: reloadlyRequestId,
      senderName: RELOADLY_CASHOUT_SENDER_NAME,
      recipientEmail,
    };

    const { response: upstream, text, parsed } = await callReloadlyApi(
      "/orders",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );

    if (!upstream.ok) {
      throw new HttpError(
        parseReloadlyErrorMessage(parsed, text, upstream.status || null),
        upstream.status || 502,
        {
          reason: "reloadly_api_error",
          upstreamStatus: upstream.status || null,
          upstreamBody: redactSecrets(String(text || "").slice(0, 400)),
        },
      );
    }

    const orderObject = extractReloadlyOrderObject(parsed);
    const parsedOrderId = String(
      orderObject?.orderId ||
      orderObject?.id ||
      orderObject?.transactionId ||
      "",
    ).trim();
    reloadlyCampaignId = parsedOrderId || reloadlyRequestId;
    const claimUrl = extractReloadlyClaimUrl(orderObject);
    const providerRewardId = extractReloadlyRewardId(orderObject);

    const providerStatus = String(
      orderObject?.status || "order_created",
    )
      .trim()
      .toLowerCase() || "order_created";
    const statusSuccess = new Set(["successful", "success", "completed", "delivered", "processed"]);
    const statusFailure = new Set(["failed", "rejected", "cancelled", "canceled", "expired"]);
    const payoutStatus = statusSuccess.has(providerStatus)
      ? "paid"
      : statusFailure.has(providerStatus)
      ? "failed"
      : "pending";

    const updatePayload = {
      status: payoutStatus,
      provider_order_id: reloadlyCampaignId,
      provider_reward_id: providerRewardId,
      provider_claim_url: claimUrl,
      provider_status: providerStatus,
      failure_reason: payoutStatus === "failed"
        ? "Reloadly order failed"
        : null,
      processed_at: payoutStatus === "pending"
        ? null
        : new Date().toISOString(),
    };
    let { error: payoutUpdateError } = await supabase
      .from("cashout_payouts")
      .update(updatePayload)
      .eq("id", payoutId);
    if (payoutUpdateError) {
      ({ error: payoutUpdateError } = await supabase
        .from("cashout_payouts")
        .update(updatePayload)
        .eq("id", payoutId));
    }
    if (payoutUpdateError) {
      throw new HttpError(
        payoutUpdateError.message || "Unable to persist payout metadata.",
        500,
        { reason: "payout_metadata_update_failed" },
      );
    }
    if (payoutStatus === "paid") {
      await supabase
        .from("cashback_events")
        .update({ status: "paid" })
        .eq("payout_id", payoutId)
        .eq("status", "reserved");
    } else if (payoutStatus === "failed") {
      await supabase
        .from("cashback_events")
        .update({ status: "available", payout_id: null })
        .eq("payout_id", payoutId)
        .eq("status", "reserved");
    }

    return json({
      success: true,
      provider: "reloadly",
      methodType: "gift_card",
      payoutId,
      orderId: reloadlyCampaignId,
      rewardId: providerRewardId,
      claimUrl,
      amountCents: payoutAmountCents,
      availableCents,
      status: payoutStatus,
      overageCents: overage || 0,
      adjustmentId,
      nextEligibleAt:
        CASHOUT_WEEKLY_LIMIT_ENABLED && payoutsRemainingInWindow <= 0
          ? nextEligibleAtForWindow ||
            new Date(Date.now() + ONE_WEEK_MS).toISOString()
          : null,
      payoutsUsedInWindow: CASHOUT_WEEKLY_LIMIT_ENABLED
        ? payoutsUsedInWindowAfter
        : null,
      payoutsRemainingInWindow: CASHOUT_WEEKLY_LIMIT_ENABLED
        ? payoutsRemainingInWindow
        : null,
      weeklyLimit: CASHOUT_WEEKLY_LIMIT_ENABLED
        ? CASHOUT_WEEKLY_LIMIT_MAX
        : null,
    });
  } catch (error) {
    if (payoutId && !reloadlyCampaignId) {
      try {
        if (adjustmentId) {
          await supabase
            .from("cashback_events")
            .delete()
            .eq("id", adjustmentId)
            .eq("user_id", userId || "");
        }
        if (splitEventId && splitOverage > 0) {
          const { data: splitRow } = await supabase
            .from("cashback_events")
            .select("amount_cents")
            .eq("id", splitEventId)
            .eq("user_id", userId || "")
            .maybeSingle();
          const current = Number(splitRow?.amount_cents) || 0;
          if (current > 0) {
            await supabase
              .from("cashback_events")
              .update({ amount_cents: current + splitOverage })
              .eq("id", splitEventId)
              .eq("user_id", userId || "")
              .eq("status", "reserved")
              .eq("payout_id", payoutId);
          }
        }
        await supabase
          .from("cashback_events")
          .update({ status: "available", payout_id: null })
          .eq("user_id", userId || "")
          .eq("payout_id", payoutId)
          .eq("status", "reserved");
      } catch {
        // Best effort rollback path.
      }
      await supabase
        .from("cashout_payouts")
        .update({
          status: "failed",
          provider_status: "payout_create_failed",
          failure_reason: String(
            (error as { message?: string })?.message || "Cashout failed",
          ),
          processed_at: new Date().toISOString(),
        })
        .eq("id", payoutId);
    }

    if (error instanceof HttpError) {
      return json(
        {
          error: error.message,
          ...(error.details || {}),
        },
        error.status,
      );
    }
    console.error(`${options.endpointName} failed`, error);
    return json(
      {
        error: String(
          (error as { message?: string })?.message ||
            "Unable to cash out right now.",
        ),
      },
      500,
    );
  }
};


