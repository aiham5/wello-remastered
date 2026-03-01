import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  authenticateRequest,
  createAdminSupabase,
  HttpError,
  json,
} from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";

export const config = { verify_jwt: false };

const RELOADLY_API_KEY = String(Deno.env.get("RELOADLY_API_KEY") || "").trim();
const RELOADLY_CLIENT_ID = String(Deno.env.get("RELOADLY_CLIENT_ID") || "")
  .trim();
const RELOADLY_CLIENT_SECRET = String(
  Deno.env.get("RELOADLY_CLIENT_SECRET") || "",
).trim();
const RELOADLY_AUTH_URL = String(
  Deno.env.get("RELOADLY_AUTH_URL") || "https://auth.reloadly.com/oauth/token",
)
  .trim()
  .replace(/\/+$/, "");
const RELOADLY_AUDIENCE = String(
  Deno.env.get("RELOADLY_AUDIENCE") || "https://giftcards-sandbox.reloadly.com",
)
  .trim();
const RELOADLY_BASE_URL = String(
  Deno.env.get("RELOADLY_BASE_URL") || "https://giftcards-sandbox.reloadly.com",
)
  .trim()
  .replace(/\/+$/, "");
const RELOADLY_ACCEPT_HEADER = String(
  Deno.env.get("RELOADLY_ACCEPT_HEADER") ||
    "application/com.reloadly.giftcards-v1+json",
)
  .trim() || "application/com.reloadly.giftcards-v1+json";
const RELOADLY_CASHOUT_COUNTRY_CODE = String(
  Deno.env.get("RELOADLY_CASHOUT_COUNTRY_CODE") || "US",
)
  .trim()
  .toUpperCase()
  .slice(0, 2) || "US";
const RELOADLY_CASHOUT_CURRENCY_CODE = String(
  Deno.env.get("RELOADLY_CASHOUT_CURRENCY_CODE") || "USD",
)
  .trim()
  .toUpperCase()
  .slice(0, 3) || "USD";
const parseCuratedCode = (value: unknown) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  const normalized = raw.startsWith("product:")
    ? raw.slice("product:".length)
    : raw;
  const parsed = Math.trunc(Number(normalized));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const RELOADLY_CURATED_ITEM_CODES = String(
  Deno.env.get("RELOADLY_CURATED_ITEM_CODES") || "",
)
  .split(",")
  .map(parseCuratedCode)
  .filter((value): value is number => Number.isFinite(value));

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const textEncoder = new TextEncoder();

let tokenCache: { token: string; expiresAtMs: number } | null = null;
let productsCache: { rows: Array<Record<string, unknown>>; expiresAtMs: number } | null = null;

const toNumberList = (value: unknown) =>
  Array.isArray(value)
    ? value
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry) && entry > 0)
    : [];

const extractProducts = (payload: Record<string, unknown>) => {
  if (Array.isArray(payload)) {
    return payload.filter((item) =>
      item && typeof item === "object" && !Array.isArray(item)
    ) as Array<Record<string, unknown>>;
  }
  for (const key of ["content", "products", "data", "items"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter((item) =>
        item && typeof item === "object" && !Array.isArray(item)
      ) as Array<Record<string, unknown>>;
    }
  }
  return [];
};

const centsFromMajor = (value: unknown) =>
  Math.max(0, Math.round(Number(value || 0) * 100));

const toCatalogItem = (row: Record<string, unknown>) => {
  const productId = Math.trunc(Number(row.productId || row.product_id || 0));
  if (!Number.isFinite(productId) || productId <= 0) return null;
  const name = String(
    row.productName ||
      row.name ||
      row.brandName ||
      row.operatorName ||
      `Gift card ${productId}`,
  )
    .trim()
    .slice(0, 120);
  const logo = String(
    row.logoUrls?.[0] ||
      row.logoUrl ||
      row.logo ||
      row.image ||
      row.imageUrl ||
      "",
  ).trim() || null;
  const fixedDenominations = [
    ...toNumberList(row.fixedRecipientDenominations),
    ...toNumberList(row.fixedSenderDenominations),
    ...toNumberList(row.recipientDenominations),
  ];
  let minCents = 0;
  let maxCents = 0;
  if (fixedDenominations.length > 0) {
    minCents = centsFromMajor(Math.min(...fixedDenominations));
    maxCents = centsFromMajor(Math.max(...fixedDenominations));
  } else {
    minCents = centsFromMajor(
      row.minRecipientDenomination ?? row.minSenderDenomination ?? 0,
    );
    maxCents = centsFromMajor(
      row.maxRecipientDenomination ?? row.maxSenderDenomination ?? 0,
    );
  }
  const normalizedMinCents = Math.max(1000, minCents > 0 ? minCents : 100);
  const normalizedMaxCents = maxCents > 0
    ? Math.max(maxCents, normalizedMinCents)
    : Math.max(normalizedMinCents, 100000);
  return {
    code: `product:${productId}`,
    name: name || `Gift card ${productId}`,
    imageUrl: logo,
    minCents: normalizedMinCents,
    maxCents: normalizedMaxCents,
    currencyCode: String(
      row.recipientCurrencyCode || row.senderCurrencyCode ||
        RELOADLY_CASHOUT_CURRENCY_CODE,
    )
      .trim()
      .toUpperCase()
      .slice(0, 3) || RELOADLY_CASHOUT_CURRENCY_CODE,
  };
};

const ensureReloadlyCredentials = () => {
  if (RELOADLY_API_KEY) return;
  if (!RELOADLY_CLIENT_ID || !RELOADLY_CLIENT_SECRET || !RELOADLY_AUDIENCE) {
    throw new HttpError("Missing Reloadly configuration.", 500, {
      reason: "reloadly_credentials_missing",
    });
  }
};

const getReloadlyAccessToken = async () => {
  ensureReloadlyCredentials();
  if (RELOADLY_API_KEY) return RELOADLY_API_KEY;
  const now = Date.now();
  if (tokenCache?.token && tokenCache.expiresAtMs > now + 15000) {
    return tokenCache.token;
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
  const tokenPayload = tokenText ? JSON.parse(tokenText) : {};
  if (!tokenRes.ok) {
    throw new HttpError("Unable to authorize Reloadly catalog request.", 502, {
      reason: "reloadly_auth_failed",
      upstreamStatus: tokenRes.status || null,
    });
  }
  const accessToken = String(tokenPayload?.access_token || "").trim();
  if (!accessToken) {
    throw new HttpError("Reloadly auth returned no access token.", 502, {
      reason: "reloadly_auth_missing_token",
    });
  }
  const expiresInSec = Math.max(
    Math.trunc(Number(tokenPayload?.expires_in || 300)),
    60,
  );
  tokenCache = { token: accessToken, expiresAtMs: now + expiresInSec * 1000 };
  return accessToken;
};

const getReloadlyHeaders = async () => ({
  "content-type": "application/json",
  accept: RELOADLY_ACCEPT_HEADER,
  authorization: `Bearer ${await getReloadlyAccessToken()}`,
});

const fetchReloadlyProducts = async () => {
  const now = Date.now();
  if (productsCache?.rows?.length && productsCache.expiresAtMs > now) {
    return productsCache.rows;
  }
  let response = await fetch(
    `${RELOADLY_BASE_URL}/countries/${encodeURIComponent(RELOADLY_CASHOUT_COUNTRY_CODE)}/products`,
    { method: "GET", headers: await getReloadlyHeaders() },
  );
  if (!response.ok && [404, 406].includes(response.status || 0)) {
    response = await fetch(
      `${RELOADLY_BASE_URL}/products?countryCode=${encodeURIComponent(RELOADLY_CASHOUT_COUNTRY_CODE)}`,
      { method: "GET", headers: await getReloadlyHeaders() },
    );
  }
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new HttpError("Unable to load gift-card catalog right now.", 502, {
      reason: "reloadly_products_lookup_failed",
      upstreamStatus: response.status || null,
    });
  }
  const rows = extractProducts(parsed);
  productsCache = { rows, expiresAtMs: now + CACHE_TTL_MS };
  return rows;
};

const redactSecrets = (value: string) =>
  String(value || "")
    .replace(/Basic\s+[A-Za-z0-9+/=._*\-]+/gi, "Basic [REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9+/=._*\-]+/gi, "Bearer [REDACTED]");

const buildFallbackCatalogItems = () =>
  RELOADLY_CURATED_ITEM_CODES.map((productId) => ({
    code: `product:${productId}`,
    name: `Gift card ${productId}`,
    imageUrl: null,
    minCents: 1000,
    maxCents: 100000,
    currencyCode: RELOADLY_CASHOUT_CURRENCY_CODE,
  }));

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  try {
    const { userId, body } = await authenticateRequest(req);
    const supabase = createAdminSupabase();
    await enforceRateLimit({
      req,
      scope: "cashout:catalog",
      userId,
      maxRequests: 120,
      windowSeconds: 5 * 60,
      supabase,
    });
    const page = Math.max(0, Math.trunc(Number(body?.page ?? 0) || 0));
    const pageSize = Math.max(
      1,
      Math.min(60, Math.trunc(Number(body?.pageSize ?? 20) || 20)),
    );
    const [{ data: recipient }, { data: linkedPlaidAccounts }] = await Promise.all([
      supabase
        .from("cashout_recipients")
        .select("recipient_provider_id, recipient_status, bank_summary")
        .eq("user_id", userId)
        .eq("provider", "checkbook")
        .maybeSingle(),
      supabase
        .from("plaid_linked_accounts")
        .select("plaid_account_id")
        .eq("user_id", userId)
        .eq("status", "active")
        .limit(1),
    ]);
    const hasActivePlaidBank = Array.isArray(linkedPlaidAccounts) &&
      linkedPlaidAccounts.length > 0;
    const recipientStatus = String(recipient?.recipient_status || "")
      .trim()
      .toLowerCase();
    const recipientLinked = Boolean(recipient?.recipient_provider_id) &&
      ["linked", "verified", "active"].includes(recipientStatus);
    const bankTileStatus = recipientLinked && hasActivePlaidBank
      ? "linked"
      : "needs_onboarding";

    let rows: Array<Record<string, unknown>> = [];
    let usingFallbackCatalog = false;
    try {
      rows = await fetchReloadlyProducts();
    } catch (catalogError) {
      console.warn(
        "cashout-catalog reloadly lookup failed",
        redactSecrets(String(catalogError || "")),
      );
      usingFallbackCatalog = true;
    }
    const currency = RELOADLY_CASHOUT_CURRENCY_CODE;
    const activeRows = rows.filter((row) => {
      const status = String(row?.status || row?.state || "ACTIVE")
        .trim()
        .toUpperCase();
      if (!(status === "ACTIVE" || status === "AVAILABLE")) return false;
      const recipientCurrency = String(
        row?.recipientCurrencyCode || row?.senderCurrencyCode || currency,
      )
        .trim()
        .toUpperCase();
      return !currency || recipientCurrency === currency;
    });
    let items = activeRows
      .map(toCatalogItem)
      .filter(Boolean) as Array<{
      code: string;
      name: string;
      imageUrl: string | null;
      minCents: number;
      maxCents: number;
      currencyCode: string;
    }>;

    if (!items.length && usingFallbackCatalog) {
      items = buildFallbackCatalogItems();
    }
    const curatedByCode = new Map(items.map((item) => [item.code, item]));
    const curated =
      RELOADLY_CURATED_ITEM_CODES.length > 0
        ? RELOADLY_CURATED_ITEM_CODES
          .map((id) => curatedByCode.get(`product:${id}`))
          .filter(Boolean)
        : items.slice(0, 8);

    const start = page * pageSize;
    const pageRows = items.slice(start, start + pageSize);
    const hasMore = start + pageSize < items.length;

    return json(
      {
        ok: true,
        curated,
        all: pageRows,
        page,
        pageSize,
        hasMore,
        total: items.length,
        fallbackCatalog: usingFallbackCatalog,
        bankTile: {
          code: "bank_transfer",
          name: "Your bank account",
          icon: "business-outline",
          status: bankTileStatus,
          bankSummary: String(recipient?.bank_summary || "").trim() || null,
        },
      },
      200,
    );
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message, ...(error.details || {}) }, error.status);
    }
    console.error("cashout-catalog failed", redactSecrets(String(error || "")));
    return json(
      { error: "Unable to load cashout options right now." },
      500,
    );
  }
});
