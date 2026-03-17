import { enforceAdminRateLimit, getAdminContext, json, logAuthEvent } from "../../_lib/auth.js";

const ALLOWED_TABLES = new Set([
  "account_deletion_requests",
  "admin_action_logs",
  "admin_auth_events",
  "business_review_audit_log",
  "businesses",
  "cashback_events",
  "cashout_payouts",
  "cashout_recipients",
  "checkbook_webhook_events",
  "commission_events",
  "offers",
  "plaid_event_logs",
  "plaid_webhook_events",
  "profiles",
  "promo_codes",
  "purchase_verifications",
  "receipt_reports",
  "receipt_uploads",
  "redemptions",
  "stripe_webhook_events",
]);

const ALLOWED_MUTATION_TABLES = new Set([
  "businesses",
  "offers",
  "profiles",
  "promo_codes",
  "receipt_reports",
  "receipt_uploads",
  "account_deletion_requests",
]);

const ALLOWED_RPCS = new Set([
  "admin_review_receipt",
  "admin_preview_receipt_outcome",
  "admin_update_receipt_decision",
  "admin_update_receipt_report",
  "admin_review_business",
  "admin_review_offer",
  "admin_update_user_role",
]);

const ALLOWED_FUNCTIONS = new Set([
  "admin-run-monthly-invoices",
  "admin-add-commission-to-stripe",
  "admin-get-plaid-transaction",
  "admin-send-promo-push",
  "cashout-bank-decision",
]);

const parseJson = async (request) => {
  try {
    return await request.json();
  } catch {
    return {};
  }
};

const parseCount = (response) => {
  const header = String(response.headers.get("content-range") || "");
  const countPart = header.split("/")[1] || "";
  const count = Number(countPart);
  return Number.isFinite(count) ? count : 0;
};

const parseResponseBody = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUSINESS_RATE_PRESET_OPTIONS = [
  { key: "10", commissionRateCents: 100, defaultCashbackRateBps: 600 },
  { key: "15", commissionRateCents: 150, defaultCashbackRateBps: 1000 },
  { key: "20", commissionRateCents: 200, defaultCashbackRateBps: 1500 },
];
const BUSINESS_RATE_PRESET_BY_COMMISSION = new Map(
  BUSINESS_RATE_PRESET_OPTIONS.map((option) => [
    option.commissionRateCents,
    option.defaultCashbackRateBps,
  ]),
);
const TRADE_CASHBACK_CAP_CENTS = 100000;
const TRADE_RECEIPT_COMMISSION_RATE_CENTS = 100;
const TRADE_RECEIPT_COMMISSION_RATE_BPS = 1000;
const TRADE_RECEIPT_CASHBACK_RATE_BPS = 600;
const NON_TRADE_CATEGORY_KEYS = new Set(["activity", "restaurant", "drink", "cafe"]);
const NON_TRADE_CATEGORY_TERMS = new Set([
  "activity",
  "activities",
  "activities-entertainment",
  "entertainment",
  "restaurant",
  "restaurants",
  "restaurant-food",
  "food",
  "drinks",
  "drink",
  "cafe",
  "cafes",
]);
const normalizeCategoryForTradeCheck = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const isTradeBusinessCategory = (categoryKey, categoryLabel) => {
  const key = normalizeCategoryForTradeCheck(categoryKey);
  const label = normalizeCategoryForTradeCheck(categoryLabel);
  if (key) {
    if (NON_TRADE_CATEGORY_KEYS.has(key) || NON_TRADE_CATEGORY_TERMS.has(key)) {
      return false;
    }
    return true;
  }
  if (label) {
    if (NON_TRADE_CATEGORY_KEYS.has(label) || NON_TRADE_CATEGORY_TERMS.has(label)) {
      return false;
    }
    return true;
  }
  return false;
};
const normalizeBusinessCommissionRateCents = (value, fallback = 150) => {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.max(10, Math.min(1000, Math.round(numeric)));
  }
  return Math.max(10, Math.min(1000, Math.round(Number(fallback) || 150)));
};
const resolveBusinessReceiptChargeRateCents = (value) =>
  normalizeBusinessCommissionRateCents(value);
const deriveDefaultCashbackRateBpsFromCommission = (value) => {
  const normalizedCommission = normalizeBusinessCommissionRateCents(value);
  const preset = BUSINESS_RATE_PRESET_BY_COMMISSION.get(normalizedCommission);
  if (preset != null) return preset;
  return Math.max(
    0,
    Math.min(normalizedCommission * 10, (normalizedCommission - 50) * 10),
  );
};
const normalizeBusinessDefaultCashbackRateBps = (
  cashbackRateBps,
  commissionRateCents,
) => {
  const maxCashbackRateBps =
    normalizeBusinessCommissionRateCents(commissionRateCents) * 10;
  const numeric = Number(cashbackRateBps);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.min(maxCashbackRateBps, Math.round(numeric)));
  }
  return deriveDefaultCashbackRateBpsFromCommission(commissionRateCents);
};
const resolveBusinessDefaultCashbackRateBps = (
  commissionRateCents,
  explicitCashbackRateBps = null,
) =>
  normalizeBusinessDefaultCashbackRateBps(
    explicitCashbackRateBps,
    commissionRateCents,
  );

const BUSINESS_SELECT_FIELDS = [
  "id",
  "owner_id",
  "name",
  "address",
  "city",
  "state",
  "postal_code",
  "phone",
  "category_key",
  "category_label",
  "offer_highlight",
  "hours",
  "tags",
  "latitude",
  "longitude",
  "qr_code",
  "is_open",
  "approval_status",
  "status",
  "stripe_account_id",
  "stripe_customer_id",
  "stripe_payment_method_id",
  "stripe_payment_method_brand",
  "stripe_payment_method_last4",
  "stripe_charges_enabled",
  "stripe_payouts_enabled",
  "stripe_onboarded_at",
  "commission_enabled",
  "commission_rate_cents",
  "default_cashback_rate_bps",
  "offer_honor_policy_accepted",
  "offer_honor_policy_version",
  "offer_honor_policy_accepted_at",
  "offer_honor_policy_accepted_by",
  "merchant_descriptor_aliases",
  "created_at",
  "updated_at",
].join(",");

const OFFER_SELECT_FIELDS = [
  "id",
  "business_id",
  "title",
  "description",
  "offer_type",
  "image_url",
  "active",
  "approval_status",
  "redemption_limit_period",
  "redemption_limit_count",
  "approved_at",
  "offer_honor_commitment_accepted",
  "offer_honor_commitment_version",
  "offer_honor_commitment_accepted_at",
  "offer_honor_commitment_accepted_by",
  "created_at",
  "updated_at",
].join(",");

const OFFER_SELECT_FIELDS_WITH_BUSINESS = `${OFFER_SELECT_FIELDS},business:businesses(id,name)`;

const toNullableString = (value, maxLength = 2000) => {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, Math.max(1, maxLength));
};

const toNullableUuid = (value) => {
  const text = toNullableString(value, 80);
  if (!text) return null;
  return UUID_RE.test(text) ? text : "__invalid_uuid__";
};

const toNullableBoolean = (value) => {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return "__invalid_boolean__";
};

const toNullableInteger = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "__invalid_number__";
  return Math.trunc(numeric);
};

const toNullableFloat = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "__invalid_number__";
  return numeric;
};

const toNullableIso = (value) => {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "__invalid_date__";
  return date.toISOString();
};

const toTextArray = (value, { maxItems = 30, maxItemLength = 120 } = {}) => {
  if (value == null || value === "") return [];
  const source = Array.isArray(value)
    ? value
    : String(value)
        .split(",")
        .map((item) => item.trim());
  const seen = new Set();
  const normalized = [];
  for (const raw of source) {
    const item = String(raw || "").trim();
    if (!item) continue;
    const safe = item.slice(0, maxItemLength);
    const key = safe.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(safe);
    if (normalized.length >= maxItems) break;
  }
  return normalized;
};

const sanitizeBusinessUpdates = (payload) => {
  const body = payload && typeof payload === "object" ? payload : {};
  const updates = {};
  const fields = [];
  const errors = [];

  const optionalStringFields = {
    name: 160,
    address: 240,
    city: 120,
    state: 80,
    postal_code: 24,
    phone: 40,
    category_key: 80,
    category_label: 120,
    offer_highlight: 300,
    hours: 260,
    qr_code: 140,
    stripe_account_id: 140,
    stripe_customer_id: 140,
    stripe_payment_method_id: 140,
    stripe_payment_method_brand: 64,
    stripe_payment_method_last4: 8,
    offer_honor_policy_version: 40,
  };

  for (const [field, maxLength] of Object.entries(optionalStringFields)) {
    if (!(field in body)) continue;
    const value = toNullableString(body[field], maxLength);
    if (field === "name" && !value) {
      errors.push("Business name is required.");
      continue;
    }
    updates[field] = value;
    fields.push(field);
  }

  if ("owner_id" in body) {
    const value = toNullableUuid(body.owner_id);
    if (value === "__invalid_uuid__") errors.push("owner_id must be a valid UUID.");
    else {
      updates.owner_id = value;
      fields.push("owner_id");
    }
  }

  if ("offer_honor_policy_accepted_by" in body) {
    const value = toNullableUuid(body.offer_honor_policy_accepted_by);
    if (value === "__invalid_uuid__") {
      errors.push("offer_honor_policy_accepted_by must be a valid UUID.");
    } else {
      updates.offer_honor_policy_accepted_by = value;
      fields.push("offer_honor_policy_accepted_by");
    }
  }

  const booleanFields = [
    "is_open",
    "stripe_charges_enabled",
    "stripe_payouts_enabled",
    "commission_enabled",
    "offer_honor_policy_accepted",
  ];
  for (const field of booleanFields) {
    if (!(field in body)) continue;
    const value = toNullableBoolean(body[field]);
    if (value === "__invalid_boolean__") {
      errors.push(`${field} must be true or false.`);
      continue;
    }
    updates[field] = value;
    fields.push(field);
  }

  if ("commission_rate_cents" in body) {
    const value = toNullableInteger(body.commission_rate_cents);
    if (
      value === "__invalid_number__" ||
      (value != null && (value < 10 || value > 1000))
    ) {
      errors.push("commission_rate_cents must be between 10 and 1000.");
    } else {
      updates.commission_rate_cents = value;
      fields.push("commission_rate_cents");
    }
  }

  if ("default_cashback_rate_bps" in body) {
    const value = toNullableInteger(body.default_cashback_rate_bps);
    const normalizedCommission =
      "commission_rate_cents" in updates
        ? updates.commission_rate_cents
        : body.commission_rate_cents;
    const maxCashbackRateBps =
      normalizeBusinessCommissionRateCents(normalizedCommission) * 10;
    if (
      value === "__invalid_number__" ||
      (value != null && (value < 0 || value > maxCashbackRateBps))
    ) {
      errors.push(
        `default_cashback_rate_bps must be between 0 and ${maxCashbackRateBps}.`,
      );
    } else {
      updates.default_cashback_rate_bps = value;
      fields.push("default_cashback_rate_bps");
    }
  }

  if ("latitude" in body) {
    const value = toNullableFloat(body.latitude);
    if (value === "__invalid_number__" || (value != null && (value < -90 || value > 90))) {
      errors.push("latitude must be a number between -90 and 90.");
    } else {
      updates.latitude = value;
      fields.push("latitude");
    }
  }

  if ("longitude" in body) {
    const value = toNullableFloat(body.longitude);
    if (value === "__invalid_number__" || (value != null && (value < -180 || value > 180))) {
      errors.push("longitude must be a number between -180 and 180.");
    } else {
      updates.longitude = value;
      fields.push("longitude");
    }
  }

  if ("approval_status" in body) {
    const value = toNullableString(body.approval_status, 24);
    if (value && !["pending", "approved", "rejected"].includes(value.toLowerCase())) {
      errors.push("approval_status must be pending, approved, or rejected.");
    } else {
      updates.approval_status = value;
      fields.push("approval_status");
    }
  }

  if ("status" in body) {
    const value = toNullableString(body.status, 24);
    if (value && !["active", "inactive", "archived", "pending"].includes(value.toLowerCase())) {
      errors.push("status must be active, inactive, archived, or pending.");
    } else {
      updates.status = value;
      fields.push("status");
    }
  }

  if ("stripe_onboarded_at" in body) {
    const value = toNullableIso(body.stripe_onboarded_at);
    if (value === "__invalid_date__") {
      errors.push("stripe_onboarded_at must be a valid date.");
    } else {
      updates.stripe_onboarded_at = value;
      fields.push("stripe_onboarded_at");
    }
  }

  if ("offer_honor_policy_accepted_at" in body) {
    const value = toNullableIso(body.offer_honor_policy_accepted_at);
    if (value === "__invalid_date__") {
      errors.push("offer_honor_policy_accepted_at must be a valid date.");
    } else {
      updates.offer_honor_policy_accepted_at = value;
      fields.push("offer_honor_policy_accepted_at");
    }
  }

  if ("tags" in body) {
    updates.tags = toTextArray(body.tags, { maxItems: 30, maxItemLength: 80 });
    fields.push("tags");
  }

  if ("merchant_descriptor_aliases" in body) {
    updates.merchant_descriptor_aliases = toTextArray(body.merchant_descriptor_aliases, {
      maxItems: 30,
      maxItemLength: 120,
    });
    fields.push("merchant_descriptor_aliases");
  }

  return { updates, fields, errors };
};

const sanitizeOfferUpdates = (payload) => {
  const body = payload && typeof payload === "object" ? payload : {};
  const updates = {};
  const fields = [];
  const errors = [];

  const optionalStringFields = {
    title: 160,
    description: 1600,
    offer_type: 80,
    image_url: 2048,
    offer_honor_commitment_version: 40,
  };
  for (const [field, maxLength] of Object.entries(optionalStringFields)) {
    if (!(field in body)) continue;
    const value = toNullableString(body[field], maxLength);
    if (field === "title" && !value) {
      errors.push("Offer title is required.");
      continue;
    }
    updates[field] = value;
    fields.push(field);
  }

  if ("business_id" in body) {
    const value = toNullableUuid(body.business_id);
    if (value === "__invalid_uuid__") errors.push("business_id must be a valid UUID.");
    else {
      updates.business_id = value;
      fields.push("business_id");
    }
  }

  if ("offer_honor_commitment_accepted_by" in body) {
    const value = toNullableUuid(body.offer_honor_commitment_accepted_by);
    if (value === "__invalid_uuid__") {
      errors.push("offer_honor_commitment_accepted_by must be a valid UUID.");
    } else {
      updates.offer_honor_commitment_accepted_by = value;
      fields.push("offer_honor_commitment_accepted_by");
    }
  }

  const booleanFields = ["active", "offer_honor_commitment_accepted"];
  for (const field of booleanFields) {
    if (!(field in body)) continue;
    const value = toNullableBoolean(body[field]);
    if (value === "__invalid_boolean__") {
      errors.push(`${field} must be true or false.`);
      continue;
    }
    updates[field] = value;
    fields.push(field);
  }

  if ("approval_status" in body) {
    const value = toNullableString(body.approval_status, 24);
    if (value && !["pending", "approved", "rejected"].includes(value.toLowerCase())) {
      errors.push("approval_status must be pending, approved, or rejected.");
    } else {
      updates.approval_status = value;
      fields.push("approval_status");
    }
  }

  if ("redemption_limit_period" in body) {
    const value = toNullableString(body.redemption_limit_period, 24);
    if (value && !["day", "week", "month", "year", "lifetime"].includes(value.toLowerCase())) {
      errors.push("redemption_limit_period must be day, week, month, year, or lifetime.");
    } else {
      updates.redemption_limit_period = value;
      fields.push("redemption_limit_period");
    }
  }

  if ("redemption_limit_count" in body) {
    const value = toNullableInteger(body.redemption_limit_count);
    if (value === "__invalid_number__" || (value != null && (value < 1 || value > 1000))) {
      errors.push("redemption_limit_count must be between 1 and 1000.");
    } else {
      updates.redemption_limit_count = value;
      fields.push("redemption_limit_count");
    }
  }

  if ("approved_at" in body) {
    const value = toNullableIso(body.approved_at);
    if (value === "__invalid_date__") errors.push("approved_at must be a valid date.");
    else {
      updates.approved_at = value;
      fields.push("approved_at");
    }
  }

  if ("offer_honor_commitment_accepted_at" in body) {
    const value = toNullableIso(body.offer_honor_commitment_accepted_at);
    if (value === "__invalid_date__") {
      errors.push("offer_honor_commitment_accepted_at must be a valid date.");
    } else {
      updates.offer_honor_commitment_accepted_at = value;
      fields.push("offer_honor_commitment_accepted_at");
    }
  }

  return { updates, fields, errors };
};

const r2EncodeRfc3986 = (value) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const r2EncodePath = (path) =>
  String(path || "")
    .split("/")
    .map((segment) => r2EncodeRfc3986(segment))
    .join("/");

const toHex = (buffer) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const hmacRaw = async (key, value) => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(value),
  );
  return new Uint8Array(signature);
};

const getSigningKey = async (secret, dateStamp, region, service) => {
  const encoder = new TextEncoder();
  const kDate = await hmacRaw(encoder.encode(`AWS4${secret}`), dateStamp);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, service);
  return hmacRaw(kService, "aws4_request");
};

const sha256Hex = async (value) =>
  toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

const buildQueryString = (params) => {
  const keys = Object.keys(params).sort();
  return keys
    .map((key) => `${r2EncodeRfc3986(key)}=${r2EncodeRfc3986(params[key])}`)
    .join("&");
};

const createR2PresignedUrl = async ({ endpoint, bucket, accessKeyId, secretAccessKey, key, expiresIn }) => {
  const cleanEndpoint = String(endpoint || "").replace(/\/+$/, "");
  const url = new URL(cleanEndpoint);
  const host = url.host;
  const basePath =
    url.pathname && url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : "";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const credential = `${accessKeyId}/${credentialScope}`;
  const canonicalUri = basePath
    ? `${basePath}/${r2EncodePath(key)}`
    : `/${r2EncodePath(`${bucket}/${key}`)}`;
  const payloadHash = "UNSIGNED-PAYLOAD";

  const queryParams = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  };

  const canonicalQueryString = buildQueryString(queryParams);
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    "host",
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await getSigningKey(secretAccessKey, dateStamp, "auto", "s3");
  const signature = toHex(await hmacRaw(signingKey, stringToSign));
  const finalQuery = `${canonicalQueryString}&X-Amz-Signature=${signature}`;

  return `${cleanEndpoint}${canonicalUri}?${finalQuery}`;
};

const signR2DownloadUrl = async (env, key, expiresIn) => {
  const endpoint = String(env.R2_ENDPOINT || env.ADMIN_R2_ENDPOINT || "").trim();
  const bucket = String(env.R2_BUCKET || env.ADMIN_R2_BUCKET || "").trim();
  const accessKeyId = String(env.R2_ACCESS_KEY_ID || env.ADMIN_R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(
    env.R2_SECRET_ACCESS_KEY || env.ADMIN_R2_SECRET_ACCESS_KEY || "",
  ).trim();

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 is not configured on admin runtime.");
  }

  return createR2PresignedUrl({
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    key,
    expiresIn,
  });
};

const applyQuerySpec = ({ url, spec, toPostgrestFilter }) => {
  if (spec.select) url.searchParams.set("select", String(spec.select));

  if (Array.isArray(spec.filters)) {
    spec.filters.forEach((entry) => {
      const item = toPostgrestFilter(entry?.column, entry?.op, entry?.value);
      if (!item) return;
      const [key, value] = item;
      if (key === "or") {
        url.searchParams.set("or", String(value));
      } else {
        url.searchParams.append(key, String(value));
      }
    });
  }

  if (Array.isArray(spec.order) && spec.order.length > 0) {
    const orderValue = spec.order
      .map((entry) => {
        const column = String(entry?.column || "").trim();
        if (!column) return null;
        const direction = entry?.ascending === false ? "desc" : "asc";
        const nulls = entry?.nullsFirst === true ? "nullsfirst" : "nullslast";
        return `${column}.${direction}.${nulls}`;
      })
      .filter(Boolean)
      .join(",");
    if (orderValue) url.searchParams.set("order", orderValue);
  }

  if (Number.isFinite(Number(spec.limit)) && Number(spec.limit) > 0) {
    url.searchParams.set("limit", String(Math.trunc(Number(spec.limit))));
  }
};

const handleQuery = async (ctx, spec) => {
  const table = String(spec?.table || "").trim();
  const action = String(spec?.action || "select").trim().toLowerCase();
  if (!ALLOWED_TABLES.has(table)) {
    return json({ ok: false, error: { code: "table_not_allowed", message: "Table is not allowed." } }, 403);
  }

  const url = new URL(`/rest/v1/${table}`, "https://supabase.local");
  applyQuerySpec({ url, spec, toPostgrestFilter: ctx.toPostgrestFilter });

  const headers = {};
  let method = "GET";
  let body = undefined;

  if (action === "select") {
    if (spec?.selectOptions?.count) {
      headers.Prefer = `count=${spec.selectOptions.count}`;
    }
    if (spec?.selectOptions?.head === true) {
      method = "HEAD";
      headers.Prefer = headers.Prefer ? `${headers.Prefer},count=exact` : "count=exact";
    }
  } else if (action === "insert") {
    if (!ALLOWED_MUTATION_TABLES.has(table)) {
      return json(
        {
          ok: false,
          error: {
            code: "table_write_not_allowed",
            message: "Write access is not allowed on this table.",
          },
        },
        403,
      );
    }
    method = "POST";
    headers.Prefer = "return=representation";
    body = JSON.stringify(spec?.body ?? {});
  } else if (action === "update") {
    if (!ALLOWED_MUTATION_TABLES.has(table)) {
      return json(
        {
          ok: false,
          error: {
            code: "table_write_not_allowed",
            message: "Write access is not allowed on this table.",
          },
        },
        403,
      );
    }
    if (!Array.isArray(spec?.filters) || spec.filters.length === 0) {
      return json(
        {
          ok: false,
          error: {
            code: "unsafe_update_blocked",
            message: "Update requests require explicit filters.",
          },
        },
        400,
      );
    }
    method = "PATCH";
    headers.Prefer = "return=representation";
    body = JSON.stringify(spec?.body ?? {});
  } else {
    return json({ ok: false, error: { code: "action_not_allowed", message: "Action is not allowed." } }, 400);
  }

  if (spec?.range && Number.isFinite(Number(spec.range.from)) && Number.isFinite(Number(spec.range.to))) {
    headers.Range = `${Math.max(0, Math.trunc(Number(spec.range.from)))}-${Math.max(0, Math.trunc(Number(spec.range.to)))}`;
  }

  const response = await ctx.supabaseRequest(`${url.pathname}${url.search}`, {
    method,
    headers,
    body,
  });

  const parsedBody = await parseResponseBody(response);
  if (!response.ok) {
    return json(
      {
        ok: false,
        error: {
          code: "supabase_query_failed",
          message: String(parsedBody?.message || parsedBody?.error_description || parsedBody?.error || "Supabase query failed."),
          status: response.status,
        },
      },
      response.status,
    );
  }

  let data = parsedBody;
  if (method === "HEAD") data = [];

  if (spec.single === "maybe") {
    const rows = Array.isArray(data) ? data : [];
    data = rows[0] || null;
  }

  if (spec.single === "single") {
    const rows = Array.isArray(data) ? data : [];
    if (rows.length !== 1) {
      return json({ ok: false, error: { code: "single_row_expected", message: "Expected single row." } }, 409);
    }
    data = rows[0];
  }

  const normalizedData =
    spec.single === "single" || spec.single === "maybe"
      ? data ?? null
      : Array.isArray(data)
        ? data
        : data == null
          ? []
          : [data];

  return json({ ok: true, data: normalizedData, count: parseCount(response) }, 200);
};

const handleRpc = async (ctx, body) => {
  const name = String(body?.name || "").trim();
  const args = body?.args && typeof body.args === "object" ? body.args : {};
  if (!ALLOWED_RPCS.has(name)) {
    return json({ ok: false, error: { code: "rpc_not_allowed", message: "RPC is not allowed." } }, 403);
  }

  const toIsoOrNull = (value) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  };

  const normalizeStatus = (value) => String(value || "").trim().toLowerCase();

  const selectRows = async ({ table, select = "*", filters = [], limit = 100 }) => {
    const url = new URL(`/rest/v1/${table}`, "https://supabase.local");
    url.searchParams.set("select", select);
    if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
      url.searchParams.set("limit", String(Math.trunc(Number(limit))));
    }

    for (const filter of filters) {
      const item = ctx.toPostgrestFilter(filter.column, filter.op, filter.value);
      if (!item) continue;
      const [key, value] = item;
      if (key === "or") url.searchParams.set("or", String(value));
      else url.searchParams.append(key, String(value));
    }

    const response = await ctx.supabaseRequest(`${url.pathname}${url.search}`);
    const parsed = await parseResponseBody(response);
    if (!response.ok) {
      return {
        rows: [],
        error: {
          status: response.status,
          message: String(parsed?.message || "Select failed."),
        },
      };
    }

    return {
      rows: Array.isArray(parsed) ? parsed : [],
      error: null,
    };
  };

  const selectOne = async (spec) => {
    const result = await selectRows({ ...spec, limit: 1 });
    return {
      row: result.rows[0] || null,
      error: result.error,
    };
  };

  const insertOne = async ({ table, payload, select = "id" }) => {
    const url = new URL(`/rest/v1/${table}`, "https://supabase.local");
    url.searchParams.set("select", select);
    const response = await ctx.supabaseRequest(`${url.pathname}${url.search}`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    const parsed = await parseResponseBody(response);
    if (!response.ok) {
      return {
        row: null,
        error: {
          status: response.status,
          message: String(parsed?.message || "Insert failed."),
        },
      };
    }
    return {
      row: Array.isArray(parsed) ? parsed[0] || null : null,
      error: null,
    };
  };

  const logAction = async ({ action, entity, entityId, status = "success", before = null, after = null, meta = {} }) => {
    const payload = {
      actor_id: String(ctx.profile?.id || ""),
      actor_role: String(ctx.profile?.role || ""),
      action: String(action || "unknown"),
      entity: String(entity || "unknown"),
      entity_id: entityId || null,
      status: status === "failed" ? "failed" : "success",
      before_state: before,
      after_state: after,
      meta: meta && typeof meta === "object" ? meta : {},
    };
    await insertOne({
      table: "admin_action_logs",
      payload,
      select: "id",
    });
  };

  const updateOne = async ({ table, updates, filters, select = "*" }) => {
    const url = new URL(`/rest/v1/${table}`, "https://supabase.local");
    url.searchParams.set("select", select);
    for (const filter of filters) {
      const item = ctx.toPostgrestFilter(filter.column, filter.op, filter.value);
      if (!item) continue;
      const [key, value] = item;
      if (key === "or") {
        url.searchParams.set("or", String(value));
      } else {
        url.searchParams.append(key, String(value));
      }
    }
    const response = await ctx.supabaseRequest(`${url.pathname}${url.search}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify(updates),
    });
    const parsed = await parseResponseBody(response);
    if (!response.ok) {
      return {
        row: null,
        error: {
          status: response.status,
          message: String(parsed?.message || "RPC emulation update failed."),
        },
      };
    }
    const row = Array.isArray(parsed) ? parsed[0] || null : null;
    return { row, error: null };
  };

  if (name === "admin_preview_receipt_outcome") {
    const receiptId = String(args.p_receipt_id || "").trim();
    const totalCents = Number(args.p_receipt_total_cents || 0);
    if (!receiptId) {
      return json({ ok: false, error: { code: "invalid_receipt_id", message: "Receipt id is required." } }, 400);
    }
    if (!Number.isFinite(totalCents) || totalCents <= 0) {
      return json({ ok: false, error: { code: "invalid_receipt_total", message: "Receipt total must be greater than 0." } }, 400);
    }

    const receiptRes = await selectOne({
      table: "receipt_uploads",
      select: "id,business_id,promo_code_id",
      filters: [{ column: "id", op: "eq", value: receiptId }],
    });
    if (receiptRes.error) {
      return json({ ok: false, error: { code: "rpc_failed", message: receiptRes.error.message, status: receiptRes.error.status } }, receiptRes.error.status);
    }
    if (!receiptRes.row?.id) {
      return json({ ok: false, error: { code: "receipt_not_found", message: "Receipt not found." } }, 404);
    }

    let businessCommissionRateCents = 150;
    let businessDefaultCashbackRateBps = 1000;
    let isTradeBusiness = false;
    const businessId = String(receiptRes.row.business_id || "").trim();
    if (businessId) {
      const businessRes = await selectOne({
        table: "businesses",
        select:
          "id,commission_rate_cents,default_cashback_rate_bps,category_key,category_label",
        filters: [{ column: "id", op: "eq", value: businessId }],
      });
      if (!businessRes.error && businessRes.row?.id) {
        businessCommissionRateCents = normalizeBusinessCommissionRateCents(
          businessRes.row.commission_rate_cents,
        );
        businessDefaultCashbackRateBps = resolveBusinessDefaultCashbackRateBps(
          businessCommissionRateCents,
          businessRes.row.default_cashback_rate_bps,
        );
        isTradeBusiness = isTradeBusinessCategory(
          businessRes.row.category_key,
          businessRes.row.category_label,
        );
      }
    }
    const eligibleTotalCents = totalCents;
    const commissionRateCents = isTradeBusiness
      ? TRADE_RECEIPT_COMMISSION_RATE_CENTS
      : resolveBusinessReceiptChargeRateCents(businessCommissionRateCents);
    const commissionRateBps = isTradeBusiness
      ? TRADE_RECEIPT_COMMISSION_RATE_BPS
      : commissionRateCents * 10;
    const defaultCashbackRateBps = isTradeBusiness
      ? TRADE_RECEIPT_CASHBACK_RATE_BPS
      : businessDefaultCashbackRateBps;

    const commissionCents = Math.floor(
      (eligibleTotalCents * commissionRateBps) / 10000,
    );

    const promoCodeId = receiptRes.row.promo_code_id || null;
    let appliedPromoRateBps = null;
    let appliedPromoCode = null;
    if (promoCodeId && !isTradeBusiness) {
      const promoRes = await selectOne({
        table: "promo_codes",
        select: "id,code,cashback_rate_bps",
        filters: [{ column: "id", op: "eq", value: promoCodeId }],
      });
      if (!promoRes.error && promoRes.row?.id) {
        const rate = Number(promoRes.row.cashback_rate_bps || 0);
        if (rate > 0) {
          appliedPromoRateBps = rate;
          appliedPromoCode = String(promoRes.row.code || "").trim() || null;
        }
      }
    }

    const effectiveCashbackRateBps = appliedPromoRateBps || defaultCashbackRateBps;
    const rawCashbackCents = Math.floor(
      (eligibleTotalCents * effectiveCashbackRateBps) / 10000,
    );
    const cashbackCents = isTradeBusiness
      ? Math.min(rawCashbackCents, TRADE_CASHBACK_CAP_CENTS)
      : rawCashbackCents;
    const platformSubsidyCents = Math.max(cashbackCents - commissionCents, 0);

    return json({
      ok: true,
      data: {
        receipt_id: receiptRes.row.id,
        commission_rate_cents: commissionRateCents,
        commission_rate_bps: commissionRateBps,
        commission_cents: commissionCents,
        default_cashback_rate_bps: defaultCashbackRateBps,
        applied_promo_code_id: appliedPromoRateBps ? promoCodeId : null,
        applied_promo_code: appliedPromoCode,
        applied_promo_rate_bps: appliedPromoRateBps,
        effective_cashback_rate_bps: effectiveCashbackRateBps,
        cashback_basis:
          isTradeBusiness && cashbackCents < rawCashbackCents
            ? "cashback_amount_capped"
            : "receipt_total",
        cashback_cents: cashbackCents,
        platform_subsidy_cents: platformSubsidyCents,
      },
    });
  }

  if (name === "admin_update_receipt_decision") {
    const receiptId = String(args.p_receipt_id || "").trim();
    const action = normalizeStatus(args.p_action);
    const expectedStatus = normalizeStatus(args.p_expected_status);
    const expectedReviewedAtIso = toIsoOrNull(args.p_expected_reviewed_at);
    const totalCentsRaw = args.p_receipt_total_cents;
    const totalCents = totalCentsRaw == null ? null : Number(totalCentsRaw);
    const notes = args.p_review_notes == null ? null : String(args.p_review_notes);
    const retryAllowedParsed = toNullableBoolean(args.p_retry_allowed);
    const retryAllowed =
      retryAllowedParsed === "__invalid_boolean__"
        ? "__invalid_boolean__"
        : Boolean(retryAllowedParsed);

    if (!receiptId) {
      return json({ ok: false, error: { code: "invalid_receipt_id", message: "Receipt id is required." } }, 400);
    }
    if (!["verify", "reject", "undo", "edit"].includes(action)) {
      return json({ ok: false, error: { code: "invalid_action", message: "Invalid receipt action." } }, 400);
    }
    if (action === "reject" && retryAllowed === "__invalid_boolean__") {
      return json({ ok: false, error: { code: "invalid_retry_allowed", message: "Retry allowed must be true or false." } }, 400);
    }
    if (!["pending", "verified", "rejected"].includes(expectedStatus)) {
      return json({ ok: false, error: { code: "missing_expected_status", message: "Expected status is required." } }, 400);
    }
    if (["verify", "edit"].includes(action) && (!Number.isFinite(totalCents) || totalCents <= 0)) {
      return json({ ok: false, error: { code: "invalid_receipt_total", message: "Receipt total must be greater than 0." } }, 400);
    }

    const currentRes = await selectOne({
      table: "receipt_uploads",
      select: "id,review_status,review_notes,reviewed_by,reviewed_at,receipt_total_cents,redemption_id,retry_allowed,retry_decided_by,retry_decided_at",
      filters: [{ column: "id", op: "eq", value: receiptId }],
    });
    if (currentRes.error) {
      return json({ ok: false, error: { code: "rpc_failed", message: currentRes.error.message, status: currentRes.error.status } }, currentRes.error.status);
    }
    const current = currentRes.row;
    if (!current?.id) {
      return json({ ok: false, error: { code: "receipt_not_found", message: "Receipt not found." } }, 404);
    }

    const currentStatus = normalizeStatus(current.review_status);
    const currentReviewedAtIso = toIsoOrNull(current.reviewed_at);
    if (currentStatus !== expectedStatus) {
      return json({ ok: false, error: { code: "concurrency_conflict", reason: "status_mismatch", message: "Receipt changed. Refresh and retry." } }, 409);
    }
    if ((currentReviewedAtIso || null) !== (expectedReviewedAtIso || null)) {
      return json({ ok: false, error: { code: "concurrency_conflict", reason: "reviewed_at_mismatch", message: "Receipt changed. Refresh and retry." } }, 409);
    }

    if ((action === "verify" || action === "reject") && currentStatus !== "pending") {
      return json({ ok: false, error: { code: "invalid_transition", message: "Only pending receipts can be reviewed." } }, 409);
    }
    if (action === "undo" && !["verified", "rejected"].includes(currentStatus)) {
      return json({ ok: false, error: { code: "invalid_transition", message: "Only verified/rejected receipts can be undone." } }, 409);
    }
    if (action === "edit" && currentStatus !== "verified") {
      return json({ ok: false, error: { code: "invalid_transition", message: "Only verified receipts can be edited." } }, 409);
    }

    if (action === "undo" || action === "edit") {
      const [commissionLockRes, cashbackLockRes] = await Promise.all([
        selectOne({
          table: "commission_events",
          select: "id,status",
          filters: [
            { column: "redemption_id", op: "eq", value: current.redemption_id },
            { column: "status", op: "in", value: "(invoiced,paid)" },
          ],
        }),
        selectOne({
          table: "cashback_events",
          select: "id,status",
          filters: [
            { column: "receipt_upload_id", op: "eq", value: current.id },
            { column: "status", op: "eq", value: "paid" },
          ],
        }),
      ]);

      if (commissionLockRes.error) {
        return json({ ok: false, error: { code: "rpc_failed", message: commissionLockRes.error.message, status: commissionLockRes.error.status } }, commissionLockRes.error.status);
      }
      if (cashbackLockRes.error) {
        return json({ ok: false, error: { code: "rpc_failed", message: cashbackLockRes.error.message, status: cashbackLockRes.error.status } }, cashbackLockRes.error.status);
      }
      if (commissionLockRes.row?.id || cashbackLockRes.row?.id) {
        return json({
          ok: false,
          error: {
            code: "receipt_locked",
            reason: "accounting_progressed",
            message: "This receipt is locked because invoicing/payout has already progressed.",
          },
        }, 409);
      }
    }

    const nowIso = new Date().toISOString();
    const updates = {};
    if (action === "verify") {
      updates.review_status = "verified";
      updates.receipt_total_cents = Math.trunc(totalCents);
      updates.review_notes = notes;
      updates.reviewed_by = ctx.profile.id;
      updates.reviewed_at = nowIso;
      updates.retry_allowed = false;
      updates.retry_decided_by = null;
      updates.retry_decided_at = null;
    } else if (action === "reject") {
      updates.review_status = "rejected";
      updates.review_notes = notes;
      updates.reviewed_by = ctx.profile.id;
      updates.reviewed_at = nowIso;
      updates.retry_allowed = Boolean(retryAllowed);
      updates.retry_decided_by = ctx.profile.id;
      updates.retry_decided_at = nowIso;
    } else if (action === "undo") {
      updates.review_status = "pending";
      updates.review_notes = notes;
      updates.reviewed_by = null;
      updates.reviewed_at = null;
      updates.retry_allowed = false;
      updates.retry_decided_by = null;
      updates.retry_decided_at = null;
    } else {
      updates.receipt_total_cents = Math.trunc(totalCents);
      updates.review_notes = notes;
      updates.reviewed_by = ctx.profile.id;
      updates.reviewed_at = nowIso;
    }

    const filters = [
      { column: "id", op: "eq", value: receiptId },
      { column: "review_status", op: "eq", value: expectedStatus },
    ];
    if (expectedReviewedAtIso) {
      filters.push({ column: "reviewed_at", op: "eq", value: expectedReviewedAtIso });
    } else {
      filters.push({ column: "reviewed_at", op: "is", value: null });
    }

    const result = await updateOne({
      table: "receipt_uploads",
      updates,
      filters,
      select: "id,review_status,review_notes,reviewed_by,reviewed_at,receipt_total_cents,business_id,redemption_id,user_id,uploaded_at,storage_path,promo_code_id,retry_allowed,retry_decided_by,retry_decided_at",
    });
    if (result.error) {
      return json({ ok: false, error: { code: "rpc_failed", message: result.error.message, status: result.error.status } }, result.error.status);
    }
    if (!result.row?.id) {
      return json({ ok: false, error: { code: "concurrency_conflict", reason: "stale_update", message: "Receipt changed. Refresh and retry." } }, 409);
    }

    await logAction({
      action:
        action === "verify"
          ? "receipt_verified"
          : action === "reject"
            ? "receipt_rejected"
            : action === "undo"
              ? "receipt_undone"
              : "receipt_edited",
      entity: "receipt_uploads",
      entityId: receiptId,
      before: {
        review_status: current.review_status,
        receipt_total_cents: current.receipt_total_cents,
        review_notes: current.review_notes,
        reviewed_by: current.reviewed_by,
        reviewed_at: current.reviewed_at,
        retry_allowed: current.retry_allowed,
        retry_decided_by: current.retry_decided_by,
        retry_decided_at: current.retry_decided_at,
      },
      after: {
        review_status: result.row.review_status,
        receipt_total_cents: result.row.receipt_total_cents,
        review_notes: result.row.review_notes,
        reviewed_by: result.row.reviewed_by,
        reviewed_at: result.row.reviewed_at,
        retry_allowed: result.row.retry_allowed,
        retry_decided_by: result.row.retry_decided_by,
        retry_decided_at: result.row.retry_decided_at,
      },
      meta: { action, retryAllowed: action === "reject" ? Boolean(retryAllowed) : null },
    });

    return json({ ok: true, data: result.row }, 200);
  }

  if (name === "admin_review_receipt") {
    const receiptId = String(args.p_receipt_id || "").trim();
    const nextStatus = String(args.p_review_status || "").trim();
    const totalCents = Number(args.p_receipt_total_cents || 0);
    if (!receiptId) {
      return json({ ok: false, error: { code: "invalid_receipt_id", message: "Receipt id is required." } }, 400);
    }
    if (!["verified", "rejected"].includes(nextStatus)) {
      return json({ ok: false, error: { code: "invalid_review_status", message: "Invalid review status." } }, 400);
    }
    if (nextStatus === "verified" && (!Number.isFinite(totalCents) || totalCents <= 0)) {
      return json({ ok: false, error: { code: "invalid_receipt_total", message: "Invalid receipt total." } }, 400);
    }
    const updates = {
      review_status: nextStatus,
      review_notes: args.p_review_notes ?? null,
      reviewed_by: args.p_reviewed_by || ctx.profile.id,
      reviewed_at: new Date().toISOString(),
    };
    if (nextStatus === "verified") {
      updates.receipt_total_cents = Math.trunc(totalCents);
    }
    const result = await updateOne({
      table: "receipt_uploads",
      updates,
      filters: [
        { column: "id", op: "eq", value: receiptId },
        { column: "review_status", op: "eq", value: "pending" },
      ],
    });
    if (result.error) {
      return json({ ok: false, error: { code: "rpc_failed", message: result.error.message, status: result.error.status } }, result.error.status);
    }
    return json({ ok: true, data: result.row }, 200);
  }

  if (name === "admin_update_receipt_report") {
    const reportId = String(args.p_report_id || "").trim();
    const nextStatus = String(args.p_status || "").trim();
    if (!reportId) {
      return json({ ok: false, error: { code: "invalid_report_id", message: "Report id is required." } }, 400);
    }
    if (!["reviewing", "resolved", "dismissed"].includes(nextStatus)) {
      return json({ ok: false, error: { code: "invalid_report_status", message: "Invalid report status." } }, 400);
    }
    const resolved = nextStatus === "resolved" || nextStatus === "dismissed";
    const result = await updateOne({
      table: "receipt_reports",
      updates: {
        status: nextStatus,
        resolution_notes: args.p_resolution_notes ?? null,
        resolved_by: resolved ? args.p_resolved_by || ctx.profile.id : null,
        resolved_at: resolved ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      filters: [
        { column: "id", op: "eq", value: reportId },
        { column: "status", op: "in", value: "(open,reviewing)" },
      ],
    });
    if (result.error) {
      return json({ ok: false, error: { code: "rpc_failed", message: result.error.message, status: result.error.status } }, result.error.status);
    }
    return json({ ok: true, data: result.row }, 200);
  }

  if (name === "admin_review_business") {
    const businessId = String(args.p_business_id || "").trim();
    const nextStatus = String(args.p_next_approval_status || "").trim();
    const requestedCommissionRateCents =
      args.p_commission_rate_cents == null
        ? null
        : toNullableInteger(args.p_commission_rate_cents);
    const requestedDefaultCashbackRateBps =
      args.p_default_cashback_rate_bps == null
        ? null
        : toNullableInteger(args.p_default_cashback_rate_bps);
    if (!businessId) {
      return json({ ok: false, error: { code: "invalid_business_id", message: "Business id is required." } }, 400);
    }
    if (!["approved", "rejected"].includes(nextStatus)) {
      return json({ ok: false, error: { code: "invalid_business_status", message: "Invalid business status." } }, 400);
    }
    if (
      requestedCommissionRateCents === "__invalid_number__" ||
      (requestedCommissionRateCents != null &&
        (requestedCommissionRateCents < 10 ||
          requestedCommissionRateCents > 1000))
    ) {
      return json({ ok: false, error: { code: "invalid_commission_rate", message: "commission_rate_cents must be between 10 and 1000." } }, 400);
    }
    if (
      requestedDefaultCashbackRateBps === "__invalid_number__" ||
      (requestedDefaultCashbackRateBps != null &&
        (requestedDefaultCashbackRateBps < 0 ||
          requestedDefaultCashbackRateBps >
            normalizeBusinessCommissionRateCents(
              requestedCommissionRateCents,
            ) *
              10))
    ) {
      return json({ ok: false, error: { code: "invalid_cashback_rate", message: "default_cashback_rate_bps must not exceed the commission rate." } }, 400);
    }
    const normalizedCommissionRateCents = normalizeBusinessCommissionRateCents(
      requestedCommissionRateCents,
    );
    const normalizedDefaultCashbackRateBps =
      resolveBusinessDefaultCashbackRateBps(
        normalizedCommissionRateCents,
        requestedDefaultCashbackRateBps,
      );
    const result = await updateOne({
      table: "businesses",
      updates: {
        approval_status: nextStatus,
        status: nextStatus === "approved" ? "active" : "inactive",
        ...(nextStatus === "approved"
          ? {
              commission_rate_cents: normalizedCommissionRateCents,
              default_cashback_rate_bps: normalizedDefaultCashbackRateBps,
            }
          : {}),
        updated_at: new Date().toISOString(),
      },
      filters: [
        { column: "id", op: "eq", value: businessId },
        { column: "approval_status", op: "eq", value: "pending" },
      ],
    });
    if (result.error) {
      return json({ ok: false, error: { code: "rpc_failed", message: result.error.message, status: result.error.status } }, result.error.status);
    }
    return json({ ok: true, data: result.row }, 200);
  }

  if (name === "admin_review_offer") {
    const offerId = String(args.p_offer_id || "").trim();
    const nextStatus = String(args.p_next_approval_status || "").trim();
    if (!offerId) {
      return json({ ok: false, error: { code: "invalid_offer_id", message: "Offer id is required." } }, 400);
    }
    if (!["approved", "rejected"].includes(nextStatus)) {
      return json({ ok: false, error: { code: "invalid_offer_status", message: "Invalid offer status." } }, 400);
    }
    const result = await updateOne({
      table: "offers",
      updates: {
        approval_status: nextStatus,
        active: nextStatus === "approved",
        updated_at: new Date().toISOString(),
      },
      filters: [
        { column: "id", op: "eq", value: offerId },
        { column: "approval_status", op: "eq", value: "pending" },
      ],
    });
    if (result.error) {
      return json({ ok: false, error: { code: "rpc_failed", message: result.error.message, status: result.error.status } }, result.error.status);
    }
    return json({ ok: true, data: result.row }, 200);
  }

  if (name === "admin_update_user_role") {
    const profileId = String(args.p_profile_id || "").trim();
    const expectedRole = String(args.p_expected_role || "").trim();
    const nextRole = String(args.p_next_role || "").trim();
    if (!profileId) {
      return json({ ok: false, error: { code: "invalid_profile_id", message: "Profile id is required." } }, 400);
    }
    if (!["consumer", "business_owner", "supervisor", "admin"].includes(nextRole)) {
      return json({ ok: false, error: { code: "invalid_role", message: "Invalid role." } }, 400);
    }
    if (profileId === String(ctx.profile.id || "")) {
      return json({ ok: false, error: { code: "self_role_change_blocked", message: "Self-role changes are blocked." } }, 400);
    }
    const filters = [{ column: "id", op: "eq", value: profileId }];
    if (expectedRole) {
      filters.push({ column: "role", op: "eq", value: expectedRole });
    }
    const result = await updateOne({
      table: "profiles",
      updates: {
        role: nextRole,
        updated_at: new Date().toISOString(),
      },
      filters,
    });
    if (result.error) {
      return json({ ok: false, error: { code: "rpc_failed", message: result.error.message, status: result.error.status } }, result.error.status);
    }
    return json({ ok: true, data: result.row }, 200);
  }

  return json({ ok: false, error: { code: "rpc_not_implemented", message: "RPC is not implemented." } }, 400);
};

const handleStorageSign = async (ctx, body) => {
  const bucket = String(body?.bucket || "").trim();
  const path = String(body?.path || "").trim().replace(/^\/+/, "");
  const expiresIn = Math.max(60, Math.min(24 * 60 * 60, Math.trunc(Number(body?.expiresIn || 1800))));

  if (!bucket || !path) {
    return json({ ok: false, error: { code: "invalid_storage_input", message: "Bucket and path are required." } }, 400);
  }

  if (bucket === "__r2__" || path.startsWith("receipts/")) {
    if (!path.startsWith("receipts/")) {
      return json(
        {
          ok: false,
          error: {
            code: "invalid_r2_key",
            message: "R2 receipt keys must start with 'receipts/'.",
          },
        },
        400,
      );
    }
    try {
      const signedUrl = await signR2DownloadUrl(ctx.env, path, expiresIn);
      return json({ ok: true, data: { signedUrl, signedURL: signedUrl, provider: "r2" } }, 200);
    } catch (error) {
      return json(
        {
          ok: false,
          error: {
            code: "r2_sign_failed",
            message: String(error?.message || "Unable to sign R2 URL."),
          },
        },
        500,
      );
    }
  }

  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const response = await ctx.supabaseRequest(
    `/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodedPath}`,
    {
      method: "POST",
      body: JSON.stringify({ expiresIn }),
    },
  );

  const parsed = await parseResponseBody(response);
  if (!response.ok) {
    return json({ ok: false, error: { code: "storage_sign_failed", message: String(parsed?.message || "Unable to sign storage URL."), status: response.status } }, response.status);
  }

  const supabaseUrl = String(ctx.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const signedPath = String(parsed?.signedURL || parsed?.signedUrl || "");
  const signedUrl = signedPath.startsWith("http") ? signedPath : `${supabaseUrl}/storage/v1${signedPath}`;

  return json({ ok: true, data: { signedUrl, signedURL: signedUrl } }, 200);
};

const handleInvokeFunction = async (ctx, fnName, body) => {
  if (!ALLOWED_FUNCTIONS.has(fnName)) {
    return json({ ok: false, error: { code: "function_not_allowed", message: "Function is not allowed." } }, 403);
  }

  const supabaseUrl = String(ctx.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(
    ctx.env.ADMIN_SUPABASE_SECRET_KEY ||
      ctx.env.SUPABASE_SECRET_KEY ||
      ctx.env.SUPABASE_SERVICE_ROLE_KEY ||
      "",
  ).trim();
  if (!key) {
    return json(
      {
        ok: false,
        error: {
          code: "missing_server_secret",
          message: "Server secret is not configured.",
        },
      },
      500,
    );
  }
  const response = await fetch(`${supabaseUrl}/functions/v1/${encodeURIComponent(fnName)}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(ctx?.profile?.id
        ? {
          "x-admin-actor-id": String(ctx.profile.id),
          "x-admin-actor-role": String(ctx.profile.role || ""),
        }
        : {}),
      ...(fnName === "cashout-bank-decision" && ctx.env.CASHOUT_ADMIN_DECISION_SECRET
        ? {
          "x-admin-decision-secret": String(
            ctx.env.CASHOUT_ADMIN_DECISION_SECRET,
          ).trim(),
        }
        : {}),
    },
    body: JSON.stringify(body || {}),
  });

  const parsed = await parseResponseBody(response);
  if (!response.ok) {
    return json({ ok: false, error: { code: "edge_function_failed", message: String(parsed?.message || parsed?.error || `Function ${fnName} failed.`), status: response.status } }, response.status);
  }

  return json({ ok: true, data: parsed ?? null }, 200);
};

const invokeEdgeFunctionData = async (ctx, fnName, body) => {
  if (!ALLOWED_FUNCTIONS.has(fnName)) {
    return { ok: false, status: 403, error: "Function is not allowed." };
  }

  const supabaseUrl = String(ctx.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(
    ctx.env.ADMIN_SUPABASE_SECRET_KEY ||
      ctx.env.SUPABASE_SECRET_KEY ||
      ctx.env.SUPABASE_SERVICE_ROLE_KEY ||
      "",
  ).trim();
  if (!key) {
    return { ok: false, status: 500, error: "Server secret is not configured." };
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/${encodeURIComponent(fnName)}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(ctx?.profile?.id
        ? {
          "x-admin-actor-id": String(ctx.profile.id),
          "x-admin-actor-role": String(ctx.profile.role || ""),
        }
        : {}),
    },
    body: JSON.stringify(body || {}),
  });

  const parsed = await parseResponseBody(response);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: String(parsed?.message || parsed?.error || `Function ${fnName} failed.`),
    };
  }

  return { ok: true, status: response.status, data: parsed?.data ?? parsed ?? null };
};

const handleLogAction = async (ctx, body) => {
  const payload = {
    actor_id: String(ctx.profile?.id || ""),
    actor_role: String(ctx.profile?.role || ""),
    action: String(body?.action || "unknown"),
    entity: String(body?.entity || "unknown"),
    entity_id: body?.entityId || null,
    status: String(body?.status || "success") === "failed" ? "failed" : "success",
    before_state: body?.before ?? null,
    after_state: body?.after ?? null,
    meta: body?.meta && typeof body.meta === "object" ? body.meta : {},
  };

  const response = await ctx.supabaseRequest(`/rest/v1/admin_action_logs`, {
    method: "POST",
    headers: {
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const parsed = await parseResponseBody(response);
    return json({ ok: false, error: { code: "log_action_failed", message: String(parsed?.message || "Unable to log admin action."), status: response.status } }, response.status);
  }

  const rows = await parseResponseBody(response);
  const row = Array.isArray(rows) ? rows[0] || null : rows;
  return json({ ok: true, data: { logged: Boolean(row?.id), id: row?.id || null } }, 200);
};

const logAdminActionInternal = async (ctx, body) => {
  const payload = {
    actor_id: String(ctx.profile?.id || ""),
    actor_role: String(ctx.profile?.role || ""),
    action: String(body?.action || "unknown"),
    entity: String(body?.entity || "unknown"),
    entity_id: body?.entityId || null,
    status: String(body?.status || "success") === "failed" ? "failed" : "success",
    before_state: body?.before ?? null,
    after_state: body?.after ?? null,
    meta: body?.meta && typeof body.meta === "object" ? body.meta : {},
  };

  await ctx.supabaseRequest(`/rest/v1/admin_action_logs`, {
    method: "POST",
    headers: {
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });
};

const handleOverview = async (ctx) => {
  const queries = [
    { key: "pendingReceipts", table: "receipt_uploads", filter: ["review_status", "eq.pending"] },
    { key: "openReports", table: "receipt_reports", filter: ["status", "in.(open,reviewing)"] },
    { key: "pendingBusinesses", table: "businesses", filter: ["approval_status", "eq.pending"] },
    { key: "pendingOffers", table: "offers", filter: ["approval_status", "eq.pending"] },
    { key: "pendingCashouts", table: "cashout_payouts", filter: ["status", "eq.pending"] },
  ];

  const counts = {};
  for (const item of queries) {
    const response = await ctx.supabaseRequest(`/rest/v1/${item.table}?select=id&${item.filter[0]}=${encodeURIComponent(item.filter[1])}`, {
      method: "HEAD",
      headers: {
        Prefer: "count=exact",
      },
    });
    counts[item.key] = response.ok ? parseCount(response) : 0;
  }

  return json({ ok: true, data: counts }, 200);
};

const routeExplicit = async (ctx, request, segments) => {
  const method = request.method.toUpperCase();
  const body = method === "GET" ? {} : await parseJson(request);
  const runQuery = async (spec) => {
    const response = await handleQuery(ctx, spec);
    const payload = await response.json();
    return {
      status: response.status,
      ok: payload?.ok === true,
      payload,
    };
  };

  if (segments.length === 1 && segments[0] === "me" && method === "GET") {
    return json({ ok: true, data: { user: { id: ctx.profile.id, email: ctx.profile.email }, profile: ctx.profile } }, 200);
  }

  if (segments.length === 1 && segments[0] === "overview" && method === "GET") {
    return handleOverview(ctx);
  }

  if (segments.length === 1 && segments[0] === "query" && method === "POST") {
    const action = String(body?.action || "select").trim().toLowerCase();
    if (action !== "select") {
      return json(
        {
          ok: false,
          error: {
            code: "query_mutation_disabled",
            message: "Mutations through /api/admin/query are disabled. Use explicit admin endpoints.",
          },
        },
        403,
      );
    }
    return handleQuery(ctx, body || {});
  }

  if (segments.length === 1 && segments[0] === "rpc" && method === "POST") {
    return handleRpc(ctx, body || {});
  }

  if (segments.length === 2 && segments[0] === "storage" && segments[1] === "sign" && method === "POST") {
    return handleStorageSign(ctx, body || {});
  }

  if (segments.length === 2 && segments[0] === "functions" && method === "POST") {
    const fnName = decodeURIComponent(segments[1]);
    return handleInvokeFunction(ctx, fnName, body || {});
  }

  if (segments.length === 1 && segments[0] === "log-action" && method === "POST") {
    return handleLogAction(ctx, body || {});
  }

  if (segments.length === 1 && segments[0] === "receipts" && method === "GET") {
    const searchParams = new URL(request.url).searchParams;
    const status = String(searchParams.get("status") || "pending").trim().toLowerCase();
    const businessId = String(searchParams.get("businessId") || "all").trim();
    const search = String(searchParams.get("search") || "").trim();
    const startDate = String(searchParams.get("startDate") || "").trim();
    const endDate = String(searchParams.get("endDate") || "").trim();
    const page = Math.max(0, Number(searchParams.get("page") || 0) || 0);
    const pageSize = Math.max(1, Math.min(100, Number(searchParams.get("pageSize") || 30) || 30));
    const filters = [];

    if (["pending", "verified", "rejected"].includes(status)) {
      filters.push({ column: "review_status", op: "eq", value: status });
    }
    if (businessId && businessId !== "all") {
      filters.push({ column: "business_id", op: "eq", value: businessId });
    }
    if (startDate) {
      filters.push({ column: "uploaded_at", op: "gte", value: `${startDate}T00:00:00.000Z` });
    }
    if (endDate) {
      filters.push({ column: "uploaded_at", op: "lte", value: `${endDate}T23:59:59.999Z` });
    }
    if (search) {
      const safe = search.replace(/,/g, " ");
      filters.push({ column: "or", op: "or", value: `id.ilike.%${safe}%,review_notes.ilike.%${safe}%` });
    }

    return handleQuery(ctx, {
      table: "receipt_uploads",
      action: "select",
      select:
        "id,uploaded_at,storage_path,receipt_total_cents,commission_due_cents,review_status,review_notes,reviewed_at,reviewed_by,business_id,redemption_id,user_id,promo_code_id,retry_allowed,retry_decided_by,retry_decided_at,promo_code:promo_codes(id,code,cashback_rate_bps),business:businesses(id,name,commission_rate_cents,category_key,category_label),redemption:redemptions(id,offer:offers(id,title)),trade_receipt_owner_responses(id,response,dispute_reason,updated_at)",
      order: [{ column: "uploaded_at", ascending: false }],
      limit: pageSize,
      range: {
        from: page * pageSize,
        to: page * pageSize + pageSize - 1,
      },
      single: "none",
      filters,
    });
  }

  if (segments.length === 3 && segments[0] === "receipts" && segments[2] === "detail" && method === "GET") {
    return handleQuery(ctx, {
      table: "receipt_uploads",
      action: "select",
      select:
        "id,uploaded_at,storage_path,receipt_total_cents,commission_due_cents,review_status,review_notes,reviewed_at,reviewed_by,business_id,redemption_id,user_id,promo_code_id,retry_allowed,retry_decided_by,retry_decided_at,business:businesses(id,name,commission_rate_cents,category_key,category_label),redemption:redemptions(id,offer:offers(id,title),commission_events(id,amount_cents,status)),promo_code:promo_codes(id,code,cashback_rate_bps),cashback_events(id,amount_cents,status,cashback_rate_bps,cashback_basis,platform_subsidy_cents,promo_code_id,promo_code:promo_codes(code,cashback_rate_bps)),trade_receipt_owner_responses(id,response,dispute_reason,updated_at)",
      filters: [{ column: "id", op: "eq", value: segments[1] }],
      single: "maybe",
    });
  }

  if (segments.length === 3 && segments[0] === "receipts" && segments[2] === "preview" && method === "POST") {
    return handleRpc(ctx, {
      name: "admin_preview_receipt_outcome",
      args: {
        p_receipt_id: segments[1],
        p_receipt_total_cents: body?.receiptTotalCents,
      },
    });
  }

  if (segments.length === 3 && segments[0] === "receipts" && segments[2] === "decision" && method === "POST") {
    return handleRpc(ctx, {
      name: "admin_update_receipt_decision",
      args: {
        p_receipt_id: segments[1],
        p_action: body?.action,
        p_receipt_total_cents: body?.receiptTotalCents,
        p_review_notes: body?.reviewNotes ?? null,
        p_expected_status: body?.expectedStatus,
        p_expected_reviewed_at: body?.expectedReviewedAt ?? null,
        p_retry_allowed: body?.retryAllowed ?? false,
      },
    });
  }

  if (segments.length === 3 && segments[0] === "receipts" && segments[2] === "review" && method === "POST") {
    return handleRpc(ctx, {
      name: "admin_review_receipt",
      args: {
        p_receipt_id: segments[1],
        p_receipt_total_cents: body?.receiptTotalCents,
        p_review_status: body?.reviewStatus,
        p_review_notes: body?.reviewNotes || null,
        p_reviewed_by: body?.reviewedBy || ctx.profile.id,
      },
    });
  }

  if (segments.length === 1 && segments[0] === "receipt-reports" && method === "GET") {
    return handleQuery(ctx, {
      table: "receipt_reports",
      action: "select",
      select:
        "id,receipt_upload_id,business_id,reporter_id,reason,details,metadata,status,resolution_notes,resolved_by,resolved_at,created_at,updated_at,business:businesses(id,name),receipt:receipt_uploads(id,review_status,uploaded_at,receipt_total_cents,image_hash,redemption_id,user_id)",
      order: [{ column: "created_at", ascending: false }],
      limit: Math.max(1, Math.min(200, Number(new URL(request.url).searchParams.get("limit") || 30) || 30)),
      filters: [],
    });
  }

  if (segments.length === 3 && segments[0] === "receipt-reports" && segments[2] === "status" && method === "POST") {
    return handleRpc(ctx, {
      name: "admin_update_receipt_report",
      args: {
        p_report_id: segments[1],
        p_status: body?.status,
        p_resolution_notes: body?.resolutionNotes || null,
        p_resolved_by: body?.resolvedBy || ctx.profile.id,
      },
    });
  }

  if (segments.length === 3 && segments[0] === "receipt-reports" && segments[2] === "evidence" && method === "GET") {
    const reportId = String(segments[1] || "").trim();
    if (!reportId) {
      return json(
        { ok: false, error: { code: "invalid_report_id", message: "Report id is required." } },
        400,
      );
    }

    const reportRes = await runQuery({
      table: "receipt_reports",
      action: "select",
      select:
        "id,receipt_upload_id,business_id,reporter_id,reason,details,metadata,status,resolution_notes,resolved_by,resolved_at,created_at,updated_at,business:businesses(id,name)",
      filters: [{ column: "id", op: "eq", value: reportId }],
      single: "maybe",
      limit: 1,
    });
    if (!reportRes.ok) return json(reportRes.payload, reportRes.status || 500);

    const report = reportRes.payload?.data || null;
    if (!report?.id) {
      return json(
        { ok: false, error: { code: "report_not_found", message: "Report not found." } },
        404,
      );
    }

    let receipt = null;
    let verification = null;
    let redemption = null;
    let cashbackEvent = null;
    let userProfile = null;

    const receiptId = String(report.receipt_upload_id || "").trim();
    if (receiptId) {
      const receiptRes = await runQuery({
        table: "receipt_uploads",
        action: "select",
        select:
          "id,review_status,uploaded_at,receipt_total_cents,image_hash,storage_path,redemption_id,user_id,business_id",
        filters: [{ column: "id", op: "eq", value: receiptId }],
        single: "maybe",
        limit: 1,
      });
      if (receiptRes.ok) {
        receipt = receiptRes.payload?.data || null;
      }
    }

    const redemptionId = String(receipt?.redemption_id || "").trim();
    if (redemptionId) {
      const verificationRes = await runQuery({
        table: "purchase_verifications",
        action: "select",
        select:
          "id,status,source,reason_code,reason_detail,expected_amount_cents,matched_amount_cents,expected_merchant,matched_merchant,expected_posted_on,matched_posted_on,matched_plaid_item_id,matched_plaid_transaction_id,chargeback_flagged,chargeback_flagged_at,last_checked_at,confirmed_at,rejected_at",
        filters: [{ column: "redemption_id", op: "eq", value: redemptionId }],
        order: [{ column: "updated_at", ascending: false }],
        single: "maybe",
        limit: 1,
      });
      if (verificationRes.ok) {
        verification = verificationRes.payload?.data || null;
      }

      const redemptionRes = await runQuery({
        table: "redemptions",
        action: "select",
        select: "id,cashback_status,created_at,scanned_by,offer:offers(id,title)",
        filters: [{ column: "id", op: "eq", value: redemptionId }],
        single: "maybe",
        limit: 1,
      });
      if (redemptionRes.ok) {
        redemption = redemptionRes.payload?.data || null;
      }

      const cashbackRes = await runQuery({
        table: "cashback_events",
        action: "select",
        select: "id,amount_cents,status,created_at",
        filters: [{ column: "redemption_id", op: "eq", value: redemptionId }],
        order: [{ column: "created_at", ascending: false }],
        single: "maybe",
        limit: 1,
      });
      if (cashbackRes.ok) {
        cashbackEvent = cashbackRes.payload?.data || null;
      }
    }

    const profileId = String(
      receipt?.user_id || redemption?.scanned_by || report.reporter_id || "",
    ).trim();
    if (profileId) {
      const profileRes = await runQuery({
        table: "profiles",
        action: "select",
        select: "id,full_name,fraud_score,fraud_flagged,first_redemption_bonus_paid",
        filters: [{ column: "id", op: "eq", value: profileId }],
        single: "maybe",
        limit: 1,
      });
      if (profileRes.ok) {
        userProfile = profileRes.payload?.data || null;
      }
    }

    let plaidTransaction = null;
    if (String(verification?.matched_plaid_transaction_id || "").trim()) {
      const plaidRes = await invokeEdgeFunctionData(ctx, "admin-get-plaid-transaction", {
        reportId,
      });
      if (plaidRes.ok) {
        plaidTransaction = plaidRes.data || null;
      }
    }

    return json(
      {
        ok: true,
        data: {
          report,
          receipt,
          verification,
          plaidTransaction,
          redemption,
          cashbackEvent,
          userProfile,
        },
      },
      200,
    );
  }

  if (segments.length === 3 && segments[0] === "receipt-reports" && segments[2] === "dispute" && method === "POST") {
    const reportId = String(segments[1] || "").trim();
    const action = String(body?.action || "").trim().toLowerCase();
    if (!reportId) {
      return json(
        { ok: false, error: { code: "invalid_report_id", message: "Report id is required." } },
        400,
      );
    }
    if (!["approve", "reject"].includes(action)) {
      return json(
        { ok: false, error: { code: "invalid_dispute_action", message: "Invalid dispute action." } },
        400,
      );
    }

    const reportRes = await runQuery({
      table: "receipt_reports",
      action: "select",
      select: "id,status,receipt_upload_id,reporter_id,resolution_notes",
      filters: [{ column: "id", op: "eq", value: reportId }],
      single: "maybe",
      limit: 1,
    });
    if (!reportRes.ok) return json(reportRes.payload, reportRes.status || 500);
    const report = reportRes.payload?.data || null;
    if (!report?.id) {
      return json(
        { ok: false, error: { code: "report_not_found", message: "Report not found." } },
        404,
      );
    }

    let redemptionId = null;
    let profileId = String(report.reporter_id || "").trim() || null;
    const receiptId = String(report.receipt_upload_id || "").trim();
    if (receiptId) {
      const receiptRes = await runQuery({
        table: "receipt_uploads",
        action: "select",
        select: "id,redemption_id,user_id",
        filters: [{ column: "id", op: "eq", value: receiptId }],
        single: "maybe",
        limit: 1,
      });
      if (receiptRes.ok) {
        const receipt = receiptRes.payload?.data || null;
        redemptionId = String(receipt?.redemption_id || "").trim() || null;
        profileId = String(receipt?.user_id || profileId || "").trim() || null;
      }
    }

    const nowIso = new Date().toISOString();
    if (action === "approve" && redemptionId) {
      await runQuery({
        table: "redemptions",
        action: "update",
        body: { cashback_status: "frozen" },
        select: "id,cashback_status",
        filters: [
          { column: "id", op: "eq", value: redemptionId },
          { column: "cashback_status", op: "neq", value: "withdrawn" },
        ],
        single: "maybe",
        limit: 1,
      });
    }

    if (action === "approve" && profileId) {
      const rpcResponse = await ctx.supabaseRequest("/rest/v1/rpc/increment_fraud_score", {
        method: "POST",
        body: JSON.stringify({
          p_user_id: profileId,
          p_increment: 20,
          p_reason: "merchant_dispute_upheld",
        }),
      });
      if (!rpcResponse.ok) {
        const parsed = await parseResponseBody(rpcResponse);
        return json(
          {
            ok: false,
            error: {
              code: "fraud_score_update_failed",
              message: String(parsed?.message || "Unable to update fraud score."),
              status: rpcResponse.status,
            },
          },
          rpcResponse.status,
        );
      }
    }

    const baseNote = action === "approve"
      ? "Merchant dispute approved. Cashback was frozen and fraud score increased."
      : "Merchant dispute rejected after admin review.";
    const resolutionNotes = [
      String(body?.resolutionNotes || "").trim(),
      baseNote,
    ].filter(Boolean).join("\n");

    const reportUpdate = await runQuery({
      table: "receipt_reports",
      action: "update",
      body: {
        status: action === "approve" ? "disputed" : "resolved",
        resolution_notes: resolutionNotes,
        resolved_by: ctx.profile.id,
        resolved_at: nowIso,
        updated_at: nowIso,
      },
      select: "id,status,resolution_notes,resolved_by,resolved_at,updated_at",
      filters: [{ column: "id", op: "eq", value: reportId }],
      single: "maybe",
      limit: 1,
    });
    if (!reportUpdate.ok) return json(reportUpdate.payload, reportUpdate.status || 500);

    if (action === "reject") {
      await ctx.supabaseRequest("/rest/v1/system_logs", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          event_type: "dispute_rejected",
          details: {
            report_id: reportId,
            reviewed_by: ctx.profile.id,
            reviewed_at: nowIso,
          },
        }),
      });
    }

    await logAdminActionInternal(ctx, {
      action: action === "approve" ? "dispute_approved" : "dispute_rejected",
      entity: "receipt_report",
      entityId: reportId,
      status: "success",
      meta: {
        redemptionId,
        profileId,
      },
    });

    return json({ ok: true, data: reportUpdate.payload?.data || null }, 200);
  }

  if (segments.length === 1 && segments[0] === "account-deletion-requests" && method === "GET") {
    const searchParams = new URL(request.url).searchParams;
    const requestStatus = String(searchParams.get("requestStatus") || "all").trim().toLowerCase();
    const search = String(searchParams.get("search") || "").trim();
    const page = Math.max(0, Number(searchParams.get("page") || 0) || 0);
    const limit = Math.max(1, Math.min(100, Number(searchParams.get("limit") || 50) || 50));
    const filters = [];

    if (requestStatus !== "all") {
      filters.push({ column: "request_status", op: "eq", value: requestStatus });
    }
    if (search) {
      const safe = search.replace(/,/g, " ");
      filters.push({
        column: "or",
        op: "or",
        value: `id.ilike.%${safe}%,user_id.ilike.%${safe}%,review_notes.ilike.%${safe}%`,
      });
    }

    return handleQuery(ctx, {
      table: "account_deletion_requests",
      action: "select",
      select:
        "id,user_id,request_status,confirm_forfeit_cashback,forfeited_cashback_cents,forfeited_at,reviewed_by,reviewed_at,review_notes,created_at,updated_at",
      order: [{ column: "created_at", ascending: false }],
      limit,
      range: {
        from: page * limit,
        to: page * limit + limit - 1,
      },
      filters,
    });
  }

  if (
    segments.length === 3 &&
    segments[0] === "account-deletion-requests" &&
    segments[2] === "decision" &&
    method === "POST"
  ) {
    const requestId = String(segments[1] || "").trim();
    const action = String(body?.action || "").trim().toLowerCase();
    const expectedStatus = String(body?.expectedStatus || "pending").trim().toLowerCase();
    const reviewNotes = toNullableString(body?.reviewNotes, 1600);

    if (!requestId) {
      return json({ ok: false, error: { code: "invalid_request_id", message: "Request id is required." } }, 400);
    }
    if (!UUID_RE.test(requestId)) {
      return json({ ok: false, error: { code: "invalid_request_id", message: "Request id must be a UUID." } }, 400);
    }
    if (!["approve", "reject"].includes(action)) {
      return json({ ok: false, error: { code: "invalid_action", message: "Action must be approve or reject." } }, 400);
    }

    const requestRow = await runQuery({
      table: "account_deletion_requests",
      action: "select",
      select: "id,request_status,reviewed_by,reviewed_at",
      filters: [{ column: "id", op: "eq", value: requestId }],
      single: "maybe",
    });
    if (!requestRow.ok || !requestRow.payload?.data?.id) {
      return json({ ok: false, error: { code: "request_not_found", message: "Account deletion request not found." } }, 404);
    }

    const currentStatus = String(requestRow.payload.data.request_status || "").toLowerCase();
    if (currentStatus !== expectedStatus || currentStatus !== "pending") {
      return json(
        {
          ok: false,
          error: {
            code: "invalid_transition",
            message: "Request status changed. Refresh and try again.",
          },
        },
        409,
      );
    }

    const nextStatus = action === "approve" ? "approved" : "rejected";
    const updated = await runQuery({
      table: "account_deletion_requests",
      action: "update",
      body: {
        request_status: nextStatus,
        reviewed_by: ctx.profile.id,
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes,
      },
      select:
        "id,user_id,request_status,confirm_forfeit_cashback,forfeited_cashback_cents,forfeited_at,reviewed_by,reviewed_at,review_notes,created_at,updated_at",
      filters: [
        { column: "id", op: "eq", value: requestId },
        { column: "request_status", op: "eq", value: "pending" },
      ],
      single: "maybe",
    });
    if (!updated.ok || !updated.payload?.data?.id) {
      return json(
        {
          ok: false,
          error: {
            code: "request_not_updated",
            message: "Request is no longer pending. Please refresh and retry.",
          },
        },
        409,
      );
    }

    await logAdminActionInternal(ctx, {
      action: `account_deletion_${action}`,
      entity: "account_deletion_requests",
      entityId: requestId,
      status: "success",
      before: requestRow.payload.data,
      after: updated.payload.data,
      meta: {
        action,
        expectedStatus,
      },
    });

    return json({ ok: true, data: updated.payload.data }, 200);
  }

  if (segments.length === 1 && segments[0] === "businesses" && method === "GET") {
    return handleQuery(ctx, {
      table: "businesses",
      action: "select",
      select: BUSINESS_SELECT_FIELDS,
      order: [{ column: "created_at", ascending: true }],
      limit: Math.max(1, Math.min(300, Number(new URL(request.url).searchParams.get("limit") || 30) || 30)),
      filters: [],
    });
  }

  if (segments.length === 3 && segments[0] === "businesses" && segments[2] === "update" && method === "POST") {
    const businessId = String(segments[1] || "").trim();
    if (!businessId) {
      return json({ ok: false, error: { code: "invalid_business_id", message: "Business id is required." } }, 400);
    }
    const beforeResult = await runQuery({
      table: "businesses",
      action: "select",
      select: BUSINESS_SELECT_FIELDS,
      filters: [{ column: "id", op: "eq", value: businessId }],
      single: "maybe",
    });
    if (!beforeResult.ok) {
      return json(beforeResult.payload, beforeResult.status || 400);
    }
    if (!beforeResult.payload?.data?.id) {
      return json({ ok: false, error: { code: "business_not_found", message: "Business not found." } }, 404);
    }

    const normalizedBody = {
      ...body,
      category_label: body?.category_label ?? body?.categoryLabel,
      category_key: body?.category_key ?? body?.categoryKey,
      offer_highlight: body?.offer_highlight ?? body?.offerHighlight,
      postal_code: body?.postal_code ?? body?.postalCode,
      qr_code: body?.qr_code ?? body?.qrCode,
      owner_id: body?.owner_id ?? body?.ownerId,
      commission_rate_cents: body?.commission_rate_cents ?? body?.commissionRateCents,
      default_cashback_rate_bps:
        body?.default_cashback_rate_bps ?? body?.defaultCashbackRateBps,
      commission_enabled: body?.commission_enabled ?? body?.commissionEnabled,
      stripe_onboarded_at: body?.stripe_onboarded_at ?? body?.stripeOnboardedAt,
      offer_honor_policy_accepted: body?.offer_honor_policy_accepted ?? body?.offerHonorPolicyAccepted,
      offer_honor_policy_version: body?.offer_honor_policy_version ?? body?.offerHonorPolicyVersion,
      offer_honor_policy_accepted_at: body?.offer_honor_policy_accepted_at ?? body?.offerHonorPolicyAcceptedAt,
      offer_honor_policy_accepted_by: body?.offer_honor_policy_accepted_by ?? body?.offerHonorPolicyAcceptedBy,
      merchant_descriptor_aliases: body?.merchant_descriptor_aliases ?? body?.merchantDescriptorAliases,
      stripe_account_id: body?.stripe_account_id ?? body?.stripeAccountId,
      stripe_customer_id: body?.stripe_customer_id ?? body?.stripeCustomerId,
      stripe_payment_method_id: body?.stripe_payment_method_id ?? body?.stripePaymentMethodId,
      stripe_payment_method_brand: body?.stripe_payment_method_brand ?? body?.stripePaymentMethodBrand,
      stripe_payment_method_last4: body?.stripe_payment_method_last4 ?? body?.stripePaymentMethodLast4,
      stripe_charges_enabled: body?.stripe_charges_enabled ?? body?.stripeChargesEnabled,
      stripe_payouts_enabled: body?.stripe_payouts_enabled ?? body?.stripePayoutsEnabled,
      approval_status: body?.approval_status ?? body?.approvalStatus,
    };
    const { updates, fields, errors } = sanitizeBusinessUpdates(normalizedBody);
    if (errors.length) {
      return json({ ok: false, error: { code: "invalid_business_update", message: errors.join(" ") } }, 400);
    }
    if (!fields.length) {
      return json({ ok: false, error: { code: "empty_update", message: "No editable business fields were provided." } }, 400);
    }
    updates.updated_at = new Date().toISOString();

    const updateResult = await runQuery({
      table: "businesses",
      action: "update",
      body: updates,
      select: BUSINESS_SELECT_FIELDS,
      filters: [{ column: "id", op: "eq", value: businessId }],
      single: "maybe",
    });
    if (!updateResult.ok) {
      return json(updateResult.payload, updateResult.status || 400);
    }
    if (!updateResult.payload?.data) {
      return json({ ok: false, error: { code: "business_not_found", message: "Business not found." } }, 404);
    }
    await logAdminActionInternal(ctx, {
      action: "business_updated",
      entity: "businesses",
      entityId: businessId,
      status: "success",
      before: beforeResult.payload.data,
      after: updateResult.payload.data,
      meta: { fields },
    });
    return json({ ok: true, data: updateResult.payload.data }, 200);
  }

  if (segments.length === 3 && segments[0] === "businesses" && segments[2] === "archive" && method === "POST") {
    const businessId = String(segments[1] || "").trim();
    if (!businessId) {
      return json({ ok: false, error: { code: "invalid_business_id", message: "Business id is required." } }, 400);
    }
    const beforeResult = await runQuery({
      table: "businesses",
      action: "select",
      select: BUSINESS_SELECT_FIELDS,
      filters: [{ column: "id", op: "eq", value: businessId }],
      single: "maybe",
    });
    if (!beforeResult.ok) {
      return json(beforeResult.payload, beforeResult.status || 400);
    }
    if (!beforeResult.payload?.data) {
      return json({ ok: false, error: { code: "business_not_found", message: "Business not found." } }, 404);
    }
    const currentStatus = String(beforeResult.payload.data.status || "").toLowerCase();
    if (["inactive", "archived"].includes(currentStatus)) {
      return json({ ok: false, error: { code: "already_archived", message: "Business already archived." } }, 409);
    }
    const archiveResult = await runQuery({
      table: "businesses",
      action: "update",
      body: {
        status: "inactive",
        updated_at: new Date().toISOString(),
      },
      select: BUSINESS_SELECT_FIELDS,
      filters: [{ column: "id", op: "eq", value: businessId }],
      single: "maybe",
    });
    if (!archiveResult.ok) {
      return json(archiveResult.payload, archiveResult.status || 400);
    }
    await logAdminActionInternal(ctx, {
      action: "business_archived",
      entity: "businesses",
      entityId: businessId,
      status: "success",
      before: beforeResult.payload.data,
      after: archiveResult.payload.data,
    });
    return json({ ok: true, data: archiveResult.payload.data }, 200);
  }

  if (segments.length === 3 && segments[0] === "businesses" && segments[2] === "review" && method === "POST") {
    return handleRpc(ctx, {
      name: "admin_review_business",
      args: {
        p_business_id: segments[1],
        p_next_approval_status: body?.nextApprovalStatus,
        p_commission_rate_cents: body?.commissionRateCents ?? body?.commission_rate_cents,
        p_default_cashback_rate_bps:
          body?.defaultCashbackRateBps ?? body?.default_cashback_rate_bps,
      },
    });
  }

  if (segments.length === 1 && segments[0] === "offers" && method === "GET") {
    return handleQuery(ctx, {
      table: "offers",
      action: "select",
      select: OFFER_SELECT_FIELDS_WITH_BUSINESS,
      order: [{ column: "created_at", ascending: true }],
      limit: Math.max(1, Math.min(300, Number(new URL(request.url).searchParams.get("limit") || 30) || 30)),
      filters: [],
    });
  }

  if (segments.length === 2 && segments[0] === "offers" && segments[1] === "create" && method === "POST") {
    const businessId = String(body?.businessId || body?.business_id || "").trim();
    const title = String(body?.title || "").trim();
    const description = body?.description == null ? null : String(body.description || "").trim() || null;
    const offerType = String(body?.offerType || body?.offer_type || "cashback").trim() || "cashback";
    const imageUrl = toNullableString(body?.imageUrl ?? body?.image_url, 2048);
    const redemptionLimitPeriod = toNullableString(
      body?.redemptionLimitPeriod ?? body?.redemption_limit_period,
      24,
    );
    const redemptionLimitCount = toNullableInteger(
      body?.redemptionLimitCount ?? body?.redemption_limit_count,
    );

    if (!businessId) {
      return json({ ok: false, error: { code: "invalid_business_id", message: "Business ID is required." } }, 400);
    }
    if (!title) {
      return json({ ok: false, error: { code: "invalid_title", message: "Offer title is required." } }, 400);
    }
    if (
      redemptionLimitPeriod &&
      !["day", "week", "month", "year", "lifetime"].includes(redemptionLimitPeriod.toLowerCase())
    ) {
      return json({ ok: false, error: { code: "invalid_redemption_period", message: "Invalid redemption limit period." } }, 400);
    }
    if (
      redemptionLimitCount === "__invalid_number__" ||
      (redemptionLimitCount != null && (redemptionLimitCount < 1 || redemptionLimitCount > 1000))
    ) {
      return json({ ok: false, error: { code: "invalid_redemption_limit", message: "redemption_limit_count must be between 1 and 1000." } }, 400);
    }

    const businessLookup = await runQuery({
      table: "businesses",
      action: "select",
      select: "id,name",
      filters: [{ column: "id", op: "eq", value: businessId }],
      single: "maybe",
    });
    if (!businessLookup.ok) {
      return json(businessLookup.payload, businessLookup.status || 400);
    }
    if (!businessLookup.payload?.data?.id) {
      return json({ ok: false, error: { code: "business_not_found", message: "Business not found." } }, 404);
    }

    const createResult = await runQuery({
      table: "offers",
      action: "insert",
      body: {
        business_id: businessId,
        title,
        description,
        offer_type: offerType,
        image_url: imageUrl,
        redemption_limit_period: redemptionLimitPeriod,
        redemption_limit_count: redemptionLimitCount,
        active: false,
        approval_status: "pending",
      },
      select: OFFER_SELECT_FIELDS,
      single: "maybe",
    });
    if (!createResult.ok || !createResult.payload?.data) {
      return json(createResult.payload, createResult.status || 400);
    }
    const data = {
      ...createResult.payload.data,
      business: businessLookup.payload.data,
    };
    await logAdminActionInternal(ctx, {
      action: "offer_created",
      entity: "offers",
      entityId: createResult.payload.data.id,
      status: "success",
      after: data,
    });
    return json({ ok: true, data }, 200);
  }

  if (segments.length === 3 && segments[0] === "offers" && segments[2] === "review" && method === "POST") {
    return handleRpc(ctx, {
      name: "admin_review_offer",
      args: {
        p_offer_id: segments[1],
        p_next_approval_status: body?.nextApprovalStatus,
      },
    });
  }

  if (segments.length === 3 && segments[0] === "offers" && segments[2] === "update" && method === "POST") {
    const offerId = String(segments[1] || "").trim();
    if (!offerId) {
      return json({ ok: false, error: { code: "invalid_offer_id", message: "Offer id is required." } }, 400);
    }
    const beforeResult = await runQuery({
      table: "offers",
      action: "select",
      select: OFFER_SELECT_FIELDS,
      filters: [{ column: "id", op: "eq", value: offerId }],
      single: "maybe",
    });
    if (!beforeResult.ok) {
      return json(beforeResult.payload, beforeResult.status || 400);
    }
    if (!beforeResult.payload?.data?.id) {
      return json({ ok: false, error: { code: "offer_not_found", message: "Offer not found." } }, 404);
    }

    const normalizedBody = {
      ...body,
      business_id: body?.business_id ?? body?.businessId,
      offer_type: body?.offer_type ?? body?.offerType,
      image_url: body?.image_url ?? body?.imageUrl,
      approval_status: body?.approval_status ?? body?.approvalStatus,
      redemption_limit_period: body?.redemption_limit_period ?? body?.redemptionLimitPeriod,
      redemption_limit_count: body?.redemption_limit_count ?? body?.redemptionLimitCount,
      approved_at: body?.approved_at ?? body?.approvedAt,
      offer_honor_commitment_accepted:
        body?.offer_honor_commitment_accepted ?? body?.offerHonorCommitmentAccepted,
      offer_honor_commitment_version:
        body?.offer_honor_commitment_version ?? body?.offerHonorCommitmentVersion,
      offer_honor_commitment_accepted_at:
        body?.offer_honor_commitment_accepted_at ?? body?.offerHonorCommitmentAcceptedAt,
      offer_honor_commitment_accepted_by:
        body?.offer_honor_commitment_accepted_by ?? body?.offerHonorCommitmentAcceptedBy,
    };
    const { updates, fields, errors } = sanitizeOfferUpdates(normalizedBody);
    if (errors.length) {
      return json({ ok: false, error: { code: "invalid_offer_update", message: errors.join(" ") } }, 400);
    }
    if (!fields.length) {
      return json({ ok: false, error: { code: "empty_update", message: "No editable offer fields were provided." } }, 400);
    }

    if (updates.business_id) {
      const businessLookup = await runQuery({
        table: "businesses",
        action: "select",
        select: "id,name",
        filters: [{ column: "id", op: "eq", value: updates.business_id }],
        single: "maybe",
      });
      if (!businessLookup.ok) {
        return json(businessLookup.payload, businessLookup.status || 400);
      }
      if (!businessLookup.payload?.data?.id) {
        return json({ ok: false, error: { code: "business_not_found", message: "Business not found." } }, 404);
      }
    }

    updates.updated_at = new Date().toISOString();
    const updateResult = await runQuery({
      table: "offers",
      action: "update",
      body: updates,
      select: OFFER_SELECT_FIELDS_WITH_BUSINESS,
      filters: [{ column: "id", op: "eq", value: offerId }],
      single: "maybe",
    });
    if (!updateResult.ok) {
      return json(updateResult.payload, updateResult.status || 400);
    }
    await logAdminActionInternal(ctx, {
      action: "offer_updated",
      entity: "offers",
      entityId: offerId,
      status: "success",
      before: beforeResult.payload.data,
      after: updateResult.payload.data,
      meta: { fields },
    });
    return json({ ok: true, data: updateResult.payload.data }, 200);
  }

  if (
    segments.length === 3 &&
    segments[0] === "offers" &&
    ["pause", "resume"].includes(String(segments[2] || "").toLowerCase()) &&
    method === "POST"
  ) {
    const offerId = String(segments[1] || "").trim();
    const action = String(segments[2] || "").toLowerCase();
    const nextActive = action === "resume";
    if (!offerId) {
      return json({ ok: false, error: { code: "invalid_offer_id", message: "Offer id is required." } }, 400);
    }
    const beforeResult = await runQuery({
      table: "offers",
      action: "select",
      select: OFFER_SELECT_FIELDS,
      filters: [{ column: "id", op: "eq", value: offerId }],
      single: "maybe",
    });
    if (!beforeResult.ok) {
      return json(beforeResult.payload, beforeResult.status || 400);
    }
    if (!beforeResult.payload?.data?.id) {
      return json({ ok: false, error: { code: "offer_not_found", message: "Offer not found." } }, 404);
    }
    const updateResult = await runQuery({
      table: "offers",
      action: "update",
      body: {
        active: nextActive,
        updated_at: new Date().toISOString(),
      },
      select: OFFER_SELECT_FIELDS_WITH_BUSINESS,
      filters: [{ column: "id", op: "eq", value: offerId }],
      single: "maybe",
    });
    if (!updateResult.ok) {
      return json(updateResult.payload, updateResult.status || 400);
    }
    await logAdminActionInternal(ctx, {
      action: action === "pause" ? "offer_paused" : "offer_resumed",
      entity: "offers",
      entityId: offerId,
      status: "success",
      before: beforeResult.payload.data,
      after: updateResult.payload.data,
    });
    return json({ ok: true, data: updateResult.payload.data }, 200);
  }

  if (segments.length === 2 && segments[0] === "offers" && segments[1] === "review-bulk" && method === "POST") {
    const ids = Array.isArray(body?.offerIds) ? body.offerIds.map(String) : [];
    const nextApprovalStatus = String(body?.nextApprovalStatus || "").trim();
    const results = [];
    for (const offerId of ids) {
      const result = await handleRpc(ctx, {
        name: "admin_review_offer",
        args: { p_offer_id: offerId, p_next_approval_status: nextApprovalStatus },
      });
      const parsed = await result.json();
      results.push({ offerId, ok: parsed?.ok === true, data: parsed?.data || null, error: parsed?.error || null });
    }
    return json({ ok: true, data: { results } }, 200);
  }

  if (segments.length === 1 && segments[0] === "cashouts" && method === "GET") {
    const searchParams = new URL(request.url).searchParams;
    const status = String(searchParams.get("status") || "all").trim().toLowerCase();
    const provider = String(searchParams.get("provider") || "all").trim().toLowerCase();
    const approvalStatus = String(searchParams.get("approvalStatus") || "all").trim().toLowerCase();
    const search = String(searchParams.get("search") || "").trim();
    const page = Math.max(0, Number(searchParams.get("page") || 0) || 0);
    const limit = Math.max(1, Math.min(100, Number(searchParams.get("limit") || 30) || 30));
    const filters = [];
    if (status !== "all") filters.push({ column: "status", op: "eq", value: status });
    if (provider !== "all") filters.push({ column: "provider", op: "eq", value: provider });
    if (approvalStatus !== "all") filters.push({ column: "approval_status", op: "eq", value: approvalStatus });
    if (search) {
      const safe = search.replace(/,/g, " ");
      filters.push({
        column: "or",
        op: "or",
        value: `id.ilike.%${safe}%,user_id.ilike.%${safe}%,provider_order_id.ilike.%${safe}%,provider_reward_id.ilike.%${safe}%`,
      });
    }

    return handleQuery(ctx, {
      table: "cashout_payouts",
      action: "select",
      select:
        "id,user_id,amount_cents,status,provider,method_type,approval_status,catalog_item_code,catalog_item_name,catalog_image_url,recipient_provider_id,bank_summary,provider_status,provider_order_id,provider_reward_id,provider_claim_url,stripe_transfer_id,released_by,released_at,created_at,updated_at",
      order: [{ column: "created_at", ascending: false }],
      limit,
      range: {
        from: page * limit,
        to: page * limit + limit - 1,
      },
      filters,
    });
  }

  if (
    segments.length === 3 &&
    segments[0] === "cashouts" &&
    segments[1] === "batch" &&
    segments[2] === "decision" &&
    method === "POST"
  ) {
    const action = String(body?.action || "").trim().toLowerCase();
    const payoutIds = Array.isArray(body?.payoutIds)
      ? Array.from(new Set(body.payoutIds.map((value) => String(value || "").trim()).filter(Boolean)))
      : [];
    if (!["approve", "reject"].includes(action)) {
      return json({ ok: false, error: { code: "invalid_action", message: "Action must be approve or reject." } }, 400);
    }
    if (!payoutIds.length) {
      return json({ ok: false, error: { code: "invalid_batch", message: "At least one payout id is required." } }, 400);
    }
    const results = [];
    for (const payoutId of payoutIds.slice(0, 100)) {
      const payoutLookup = await runQuery({
        table: "cashout_payouts",
        action: "select",
        select: "id,status,approval_status,provider,method_type",
        filters: [{ column: "id", op: "eq", value: payoutId }],
        single: "maybe",
      });
      if (!payoutLookup.ok || !payoutLookup.payload?.data?.id) {
        results.push({
          id: payoutId,
          ok: false,
          errorCode: "payout_not_found",
          message: "Payout not found.",
        });
        continue;
      }
      const row = payoutLookup.payload.data;
      const provider = String(row.provider || "").toLowerCase();
      const methodType = String(row.method_type || "").toLowerCase();
      const status = String(row.status || "").toLowerCase();
      const approvalStatus = String(row.approval_status || "").toLowerCase();
      const eligible =
        provider === "checkbook" &&
        methodType === "bank_transfer" &&
        status === "pending" &&
        approvalStatus === "pending";
      if (!eligible) {
        results.push({
          id: payoutId,
          ok: false,
          errorCode: "not_eligible",
          message: "Only pending bank-transfer payouts are eligible.",
        });
        continue;
      }
      const decisionResponse = await handleInvokeFunction(ctx, "cashout-bank-decision", {
        action,
        payoutId,
        actorId: ctx.profile.id,
        expectedStatus: status,
        expectedApprovalStatus: approvalStatus,
      });
      const decisionPayload = await decisionResponse.json();
      if (decisionResponse.status >= 400 || decisionPayload?.ok === false) {
        results.push({
          id: payoutId,
          ok: false,
          errorCode: decisionPayload?.error?.code || decisionPayload?.reason || "decision_failed",
          message:
            decisionPayload?.error?.message ||
            decisionPayload?.message ||
            decisionPayload?.error ||
            "Unable to process payout decision.",
        });
        continue;
      }

      const refreshed = await runQuery({
        table: "cashout_payouts",
        action: "select",
        select: "id,status,approval_status,provider_status,updated_at",
        filters: [{ column: "id", op: "eq", value: payoutId }],
        single: "maybe",
      });
      results.push({
        id: payoutId,
        ok: true,
        status: refreshed.payload?.data?.status || null,
        message: `${action} applied`,
      });
    }
    const successCount = results.filter((item) => item.ok).length;
    const failureCount = results.length - successCount;
    await logAdminActionInternal(ctx, {
      action: "cashout_batch_decision",
      entity: "cashout_payouts",
      status: failureCount > 0 ? "failed" : "success",
      meta: {
        action,
        total: results.length,
        successCount,
        failureCount,
      },
    });
    return json({ ok: true, data: { results } }, 200);
  }

  if (segments.length === 3 && segments[0] === "cashouts" && segments[2] === "retry" && method === "POST") {
    const payoutId = String(segments[1] || "").trim();
    if (!payoutId) {
      return json({ ok: false, error: { code: "invalid_payout_id", message: "Payout id is required." } }, 400);
    }
    const beforeResult = await runQuery({
      table: "cashout_payouts",
      action: "select",
      select: "id,status,approval_status,provider,method_type,failure_reason,provider_status",
      filters: [{ column: "id", op: "eq", value: payoutId }],
      single: "maybe",
    });
    if (!beforeResult.ok || !beforeResult.payload?.data?.id) {
      return json({ ok: false, error: { code: "payout_not_found", message: "Payout not found." } }, 404);
    }
    const row = beforeResult.payload.data;
    const provider = String(row.provider || "").toLowerCase();
    const methodType = String(row.method_type || "").toLowerCase();
    const status = String(row.status || "").toLowerCase();
    const approvalStatus = String(row.approval_status || "").toLowerCase();
    if (status !== "failed" || methodType !== "bank_transfer" || provider !== "checkbook") {
      return json(
        {
          ok: false,
          error: {
            code: "not_retryable",
            message: "Only failed Checkbook bank-transfer payouts can be retried.",
          },
        },
        400,
      );
    }
    if (provider !== "checkbook") {
      return json(
        {
          ok: false,
          error: {
            code: "provider_not_supported",
            message: "Retry is currently supported for Checkbook payouts.",
          },
        },
        400,
      );
    }

    const resetResult = await runQuery({
      table: "cashout_payouts",
      action: "update",
      body: {
        status: "pending",
        approval_status: "pending",
        failure_reason: null,
        provider_status: "admin_retry_requested",
        updated_at: new Date().toISOString(),
      },
      select: "id,status,approval_status,provider,method_type,provider_status,updated_at",
      filters: [
        { column: "id", op: "eq", value: payoutId },
        { column: "status", op: "eq", value: "failed" },
      ],
      single: "maybe",
    });
    if (!resetResult.ok || !resetResult.payload?.data?.id) {
      return json(
        {
          ok: false,
          error: {
            code: "concurrency_conflict",
            message: "Payout state changed. Refresh and retry.",
          },
        },
        409,
      );
    }

    const decisionResponse = await handleInvokeFunction(ctx, "cashout-bank-decision", {
      action: "approve",
      payoutId,
      actorId: ctx.profile.id,
      expectedStatus: "pending",
      expectedApprovalStatus: "pending",
    });
    const decisionPayload = await decisionResponse.json();
    if (decisionResponse.status >= 400 || decisionPayload?.ok === false) {
      await runQuery({
        table: "cashout_payouts",
        action: "update",
        body: {
          status: "failed",
          approval_status: approvalStatus === "approved" ? "approved" : "rejected",
          failure_reason:
            decisionPayload?.error?.message ||
            decisionPayload?.message ||
            "Retry attempt failed.",
          provider_status: "retry_failed",
          updated_at: new Date().toISOString(),
        },
        select: "id",
        filters: [{ column: "id", op: "eq", value: payoutId }],
        single: "maybe",
      });
      return json(
        {
          ok: false,
          error: {
            code: decisionPayload?.error?.code || decisionPayload?.reason || "retry_failed",
            message:
              decisionPayload?.error?.message ||
              decisionPayload?.message ||
              decisionPayload?.error ||
              "Retry failed.",
          },
        },
        decisionResponse.status || 400,
      );
    }

    const refreshed = await runQuery({
      table: "cashout_payouts",
      action: "select",
      select: "id,user_id,amount_cents,status,provider,method_type,approval_status,bank_summary,provider_claim_url,provider_status,created_at,updated_at",
      filters: [{ column: "id", op: "eq", value: payoutId }],
      single: "maybe",
    });
    await logAdminActionInternal(ctx, {
      action: "cashout_retry",
      entity: "cashout_payouts",
      entityId: payoutId,
      status: "success",
      before: beforeResult.payload.data,
      after: refreshed.payload?.data || null,
      meta: { provider },
    });
    return json({ ok: true, data: refreshed.payload?.data || null }, 200);
  }

  if (segments.length === 3 && segments[0] === "cashouts" && segments[2] === "approve" && method === "POST") {
    return handleInvokeFunction(ctx, "cashout-bank-decision", {
      action: "approve",
      payoutId: segments[1],
      actorId: ctx.profile.id,
      expectedStatus: body?.expectedStatus || "pending",
      expectedApprovalStatus: body?.expectedApprovalStatus || "pending",
    });
  }

  if (segments.length === 3 && segments[0] === "cashouts" && segments[2] === "reject" && method === "POST") {
    return handleInvokeFunction(ctx, "cashout-bank-decision", {
      action: "reject",
      payoutId: segments[1],
      actorId: ctx.profile.id,
      expectedStatus: body?.expectedStatus || "pending",
      expectedApprovalStatus: body?.expectedApprovalStatus || "pending",
    });
  }

  if (segments.length === 1 && segments[0] === "users" && method === "GET") {
    return handleQuery(ctx, {
      table: "profiles",
      action: "select",
      select: "id,email,full_name,role,created_at,updated_at",
      order: [{ column: "created_at", ascending: false }],
      limit: Number(new URL(request.url).searchParams.get("limit") || 30),
      filters: [],
    });
  }

  if (segments.length === 3 && segments[0] === "users" && segments[2] === "role" && method === "POST") {
    return handleRpc(ctx, {
      name: "admin_update_user_role",
      args: {
        p_profile_id: segments[1],
        p_expected_role: body?.expectedRole,
        p_next_role: body?.nextRole,
      },
    });
  }

  if (segments.length === 1 && segments[0] === "events" && method === "GET") {
    const [adminActionsRes, adminAuthRes, auditRes, stripeRes, plaidRes, checkbookRes, plaidEventsRes] = await Promise.all([
      handleQuery(ctx, { table: "admin_action_logs", action: "select", select: "id,action,entity,status,entity_id,meta,created_at", order: [{ column: "created_at", ascending: false }], limit: 100, filters: [] }),
      handleQuery(ctx, { table: "admin_auth_events", action: "select", select: "id,event_name,endpoint,actor_email,actor_role,outcome,reason,status_code,created_at,metadata", order: [{ column: "created_at", ascending: false }], limit: 100, filters: [] }),
      handleQuery(ctx, { table: "business_review_audit_log", action: "select", select: "id,previous_approval_status,next_approval_status,business_id,changed_at", order: [{ column: "changed_at", ascending: false }], limit: 100, filters: [] }),
      handleQuery(ctx, { table: "stripe_webhook_events", action: "select", select: "id,stripe_event_id,event_type,processed,processed_at,created_at", order: [{ column: "created_at", ascending: false }], limit: 100, filters: [] }),
      handleQuery(ctx, { table: "plaid_webhook_events", action: "select", select: "id,webhook_type,webhook_code,plaid_item_id,created_at", order: [{ column: "created_at", ascending: false }], limit: 100, filters: [] }),
      handleQuery(ctx, { table: "checkbook_webhook_events", action: "select", select: "id,delivery_id,event_type,processed,processed_at,created_at", order: [{ column: "created_at", ascending: false }], limit: 100, filters: [] }),
      handleQuery(ctx, { table: "plaid_event_logs", action: "select", select: "id,source_function,event_name,severity,user_id,plaid_item_id,created_at,metadata", order: [{ column: "created_at", ascending: false }], limit: 100, filters: [] }),
    ]);

    const parse = async (res) => {
      const payload = await res.json();
      return payload?.ok ? payload.data || [] : [];
    };

    return json(
      {
        ok: true,
        data: {
          adminActions: await parse(adminActionsRes),
          adminAuthEvents: await parse(adminAuthRes),
          businessAudit: await parse(auditRes),
          stripeHooks: await parse(stripeRes),
          plaidHooks: await parse(plaidRes),
          checkbookHooks: await parse(checkbookRes),
          plaidEvents: await parse(plaidEventsRes),
        },
      },
      200,
    );
  }

  if (segments.length === 1 && segments[0] === "promotions" && method === "GET") {
    return handleQuery(ctx, {
      table: "promo_codes",
      action: "select",
      select: "id,code,cashback_rate_bps,max_uses_per_user,active,starts_at,ends_at,created_at,updated_at",
      order: [{ column: "created_at", ascending: false }],
      limit: 200,
      filters: [],
    });
  }

  if (segments.length === 1 && segments[0] === "promotions" && method === "POST") {
    return handleQuery(ctx, {
      table: "promo_codes",
      action: "insert",
      body: body || {},
      select: "id",
      filters: [],
      single: "maybe",
    });
  }

  if (segments.length === 3 && segments[0] === "promotions" && segments[2] === "status" && method === "POST") {
    return handleQuery(ctx, {
      table: "promo_codes",
      action: "update",
      body: {
        active: Boolean(body?.active),
        updated_at: new Date().toISOString(),
      },
      select: "id",
      filters: [{ op: "eq", column: "id", value: segments[1] }],
      single: "maybe",
    });
  }

  if (segments.length === 2 && segments[0] === "promotions" && segments[1] === "push" && method === "POST") {
    return handleInvokeFunction(ctx, "admin-send-promo-push", body || {});
  }

  if (
    segments.length === 2 &&
    segments[0] === "billing" &&
    (segments[1] === "run-monthly" || segments[1] === "run-biweekly") &&
    method === "POST"
  ) {
    return handleInvokeFunction(ctx, "admin-run-monthly-invoices", body || {});
  }

  if (segments.length === 2 && segments[0] === "billing" && segments[1] === "add-commission" && method === "POST") {
    return handleInvokeFunction(ctx, "admin-add-commission-to-stripe", body || {});
  }

  return json({ ok: false, error: { code: "not_found", message: "Endpoint not found." } }, 404);
};

export const onRequest = async (context) => {
  const { request, env } = context;
  const corsOrigin = String(env.ADMIN_CORS_ORIGIN || "").trim() || "*";

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": corsOrigin,
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,Cf-Access-Jwt-Assertion",
        "cache-control": "no-store",
      },
    });
  }

  let ctx = null;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  const segments = url.pathname
    .replace(/^\/api\/admin\/?/, "")
    .split("/")
    .filter(Boolean);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (isMutation && Number.isFinite(contentLength) && contentLength > 256000) {
    return json(
      {
        ok: false,
        error: {
          code: "payload_too_large",
          message: "Request payload is too large.",
        },
      },
      413,
    );
  }

  try {
    await enforceAdminRateLimit(request, env, {
      route: url.pathname,
    });
    if (isMutation) {
      await enforceAdminRateLimit(request, env, {
        route: `${url.pathname}:mut`,
        ipMaxRequests: 60,
        ipWindowSeconds: 60,
      });
    }
    ctx = await getAdminContext(request, env);
    ctx.env = env;
    await enforceAdminRateLimit(request, env, {
      email: ctx.email,
      route: url.pathname,
    });
    if (isMutation) {
      await enforceAdminRateLimit(request, env, {
        email: ctx.email,
        route: `${url.pathname}:mut`,
        ipMaxRequests: 60,
        ipWindowSeconds: 60,
        staffMaxRequests: 240,
        staffWindowSeconds: 5 * 60,
      });
    }
    const response = await routeExplicit(ctx, request, segments);
    await logAuthEvent(ctx, {
      outcome: response.status >= 400 ? "failure" : "success",
      eventName: "api_request",
      endpoint: url.pathname,
      statusCode: response.status,
      metadata: { method: request.method },
    });
    return response;
  } catch (error) {
    const message = String(error?.message || "Unauthorized");
    const status = Number(error?.statusCode) ||
      (message.toLowerCase().includes("access denied") ? 403 : 401);
    const publicMessage = status === 403 ? "Access denied." : "Unauthorized.";

    if (ctx) {
      await logAuthEvent(ctx, {
        outcome: "failure",
        eventName: "api_request",
        endpoint: url.pathname,
        statusCode: status,
        reason: message,
        metadata: { method: request.method },
      });
    }

    const response = json(
      {
        ok: false,
        error: {
          code: status === 429
            ? "rate_limited"
            : status === 403
            ? "forbidden"
            : "unauthorized",
          message: status === 429 ? "Too many requests. Please try again shortly." : publicMessage,
        },
      },
      status,
    );
    if (status === 429 && Number(error?.retryAfter) > 0) {
      response.headers.set("Retry-After", String(Math.max(1, Number(error.retryAfter))));
    }
    return response;
  }
};




