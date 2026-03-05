import {
  authenticateRequest,
  createAdminSupabase,
  HttpError,
  json,
  SUPABASE_SERVICE_ROLE_KEY,
} from "./auth.ts";
import { enforceRateLimit } from "./rateLimit.ts";
import {
  plaidCreateLinkToken,
  plaidCreateProcessorToken,
  plaidExchangePublicToken,
  plaidGetAccounts,
  plaidGetAuthNumbers,
  plaidGetInstitutionById,
  plaidGetItem,
} from "./plaid.ts";
import { mergePlaidLinkPurposes } from "./plaidLinkPurposes.ts";

type CreateOptions = { endpointName: string; requireIdempotencyKey: boolean };
type BasicOptions = { endpointName: string };

const textEncoder = new TextEncoder();

const envString = (name: string, fallback = "") =>
  String(Deno.env.get(name) ?? fallback).trim();
const envNumber = (name: string, fallback: number) => {
  const parsed = Number(Deno.env.get(name) ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const envFlag = (name: string, fallback: boolean) => {
  const raw = String(Deno.env.get(name) ?? (fallback ? "true" : "false"))
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

const CHECKBOOK_API_BASE = envString(
  "CHECKBOOK_API_BASE",
  "https://sandbox.checkbook.io",
).replace(/\/+$/, "");
const CHECKBOOK_PUBLISHABLE_KEY = envString(
  "CHECKBOOK_PUBLISHABLE_KEY",
  envString("CHECKBOOK_ACCESS_KEY"),
);
const CHECKBOOK_SECRET_KEY = envString("CHECKBOOK_SECRET_KEY");
const CHECKBOOK_PLAID_PROCESSOR = envString("CHECKBOOK_PLAID_PROCESSOR", "checkbook")
  .toLowerCase();
const CHECKBOOK_WEBHOOK_KEY = envString(
  "CHECKBOOK_WEBHOOK_KEY",
  envString("CHECKBOOK_WEBHOOK_SECRET"),
);
const CHECKBOOK_WEBHOOK_MAX_AGE_SECONDS = Math.max(
  Math.trunc(envNumber("CHECKBOOK_WEBHOOK_MAX_AGE_SECONDS", 300)),
  30,
);
const CHECKBOOK_CASHOUT_MIN_CENTS = Math.max(
  Math.trunc(envNumber("CHECKBOOK_CASHOUT_MIN_CENTS", 1000)),
  100,
);
const CHECKBOOK_CASHOUT_MAX_CENTS = Math.max(
  Math.trunc(envNumber("CHECKBOOK_CASHOUT_MAX_CENTS", 100000)),
  CHECKBOOK_CASHOUT_MIN_CENTS,
);
const CASHOUT_MONTHLY_LIMIT_ENABLED = envFlag(
  "CASHOUT_MONTHLY_LIMIT_ENABLED",
  envFlag("CASHOUT_WEEKLY_LIMIT_ENABLED", true),
);
const CASHOUT_MONTHLY_LIMIT_MAX = Math.max(
  Math.trunc(
    envNumber(
      "CASHOUT_MONTHLY_LIMIT_MAX",
      envNumber("CASHOUT_WEEKLY_LIMIT_MAX", 4),
    ),
  ),
  1,
);
const CASHOUT_ADMIN_DECISION_SECRET = envString("CASHOUT_ADMIN_DECISION_SECRET");
const ADMIN_DECISION_BEARER_KEY = envString(
  "ADMIN_SUPABASE_SECRET_KEY",
  envString("SUPABASE_SECRET_KEY", SUPABASE_SERVICE_ROLE_KEY),
);

const normalizeEmail = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
const isLikelyValidEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
const sanitizeError = (value: unknown) =>
  String(value || "")
    .replace(/Basic\s+[A-Za-z0-9+/=._*\-]+/gi, "Basic [REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9+/=._*\-]+/gi, "Bearer [REDACTED]")
    .trim();
const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
const constantTimeEqual = (a: string, b: string) => {
  const left = String(a || "");
  const right = String(b || "");
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
};
const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(String(value || "")),
  );
  return toHex(digest);
};
const normalizePlaidAccountSubtype = (value: unknown) =>
  String(value || "").trim().toLowerCase();
const normalizePlaidAccountType = (value: unknown) =>
  String(value || "").trim().toLowerCase();
const isPlaidPayoutEligibleAccount = (account: Record<string, unknown>) => {
  const subtype = normalizePlaidAccountSubtype(account?.subtype);
  const type = normalizePlaidAccountType(account?.type);
  return (
    subtype === "checking" ||
    subtype === "savings" ||
    type === "depository"
  );
};
const mapCheckbookAccountType = (subtype: string) =>
  subtype === "savings" ? "SAVINGS" : "CHECKING";
const formatPlaidBankSummary = (
  institutionName: string | null | undefined,
  accountName: string | null | undefined,
  accountMask: string | null | undefined,
) => {
  const parts = [
    String(institutionName || "").trim() || "Linked bank",
    String(accountName || "").trim() || "Account",
    String(accountMask || "").trim()
      ? `****${String(accountMask || "").trim()}`
      : null,
  ].filter(Boolean);
  return parts.join(" - ").slice(0, 180);
};
const pickPreferredPlaidAccount = (
  accounts: Array<Record<string, unknown>>,
  requestedAccountId: string,
) => {
  const eligibleAccounts = accounts.filter((account) =>
    isPlaidPayoutEligibleAccount(account)
  );
  const accountPool = eligibleAccounts.length > 0 ? eligibleAccounts : accounts;
  const normalizedRequested = String(requestedAccountId || "").trim();
  if (normalizedRequested) {
    const direct = accountPool.find((account) =>
      String(account?.account_id || "").trim() === normalizedRequested
    );
    if (direct) return direct;
  }
  const preferred = accountPool.find((account) => {
    const subtype = normalizePlaidAccountSubtype(account?.subtype);
    return subtype === "checking" || subtype === "savings";
  });
  return preferred || accountPool[0] || null;
};
const deriveUuidFromKey = async (value: string) => {
  const hash = await sha256Hex(String(value || "").trim().toLowerCase());
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
const buildIdempotencyKey = () => crypto.randomUUID();

const getPath = (payload: unknown, keys: string[]) => {
  let cursor: unknown = payload;
  for (const key of keys) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor ?? null;
};

const ensureCheckbookCredentials = () => {
  if (!CHECKBOOK_API_BASE || !CHECKBOOK_PUBLISHABLE_KEY || !CHECKBOOK_SECRET_KEY) {
    throw new HttpError("Missing Checkbook configuration.", 500, {
      reason: "checkbook_credentials_missing",
      missing: {
        CHECKBOOK_API_BASE: !CHECKBOOK_API_BASE,
        CHECKBOOK_PUBLISHABLE_KEY: !CHECKBOOK_PUBLISHABLE_KEY,
        CHECKBOOK_SECRET_KEY: !CHECKBOOK_SECRET_KEY,
      },
    });
  }
};

const buildAuthHeaders = () => {
  return {
    authorization: `${CHECKBOOK_PUBLISHABLE_KEY}:${CHECKBOOK_SECRET_KEY}`,
  };
};

const callCheckbookApi = async (
  path: string,
  init: RequestInit = {},
) => {
  ensureCheckbookCredentials();
  const body = typeof init.body === "string"
    ? init.body
    : init.body
      ? JSON.stringify(init.body)
      : "";
  const authHeaders = buildAuthHeaders();
  const response = await fetch(`${CHECKBOOK_API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...authHeaders,
      ...(init.headers || {}),
    },
    body: body || undefined,
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

const parseCheckbookError = (
  parsed: Record<string, unknown>,
  text: string,
  status: number | null,
) => {
  const candidate = String(
    parsed?.message ||
      parsed?.error ||
      (Array.isArray(parsed?.errors) ? parsed.errors[0]?.message : "") ||
      "",
  ).trim();
  const statusPart = status ? ` (${status})` : "";
  if (candidate) return `Checkbook API error${statusPart}: ${sanitizeError(candidate)}`;
  const compact = sanitizeError(text).replace(/\s+/g, " ").slice(0, 220);
  if (compact) return `Checkbook API error${statusPart}: ${compact}`;
  return `Checkbook API error${statusPart}.`;
};

const walkTextNodes = (
  value: unknown,
  maxDepth = 6,
): string[] => {
  const collected: string[] = [];
  const visit = (node: unknown, depth = 0) => {
    if (depth > maxDepth || node === null || node === undefined) return;
    if (typeof node === "string") {
      const text = node.trim();
      if (text) collected.push(text);
      return;
    }
    if (typeof node === "number" || typeof node === "boolean") {
      collected.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node === "object") {
      for (const [key, nested] of Object.entries(node as Record<string, unknown>)) {
        if (!key) continue;
        const normalizedKey = key.toLowerCase();
        if (normalizedKey.includes("authorization")) continue;
        if (
          typeof nested === "string" ||
          typeof nested === "number" ||
          typeof nested === "boolean" ||
          Array.isArray(nested) ||
          typeof nested === "object"
        ) {
          visit(nested, depth + 1);
        }
      }
    }
  };
  visit(value);
  return collected;
};

const classifyCheckbookDestinationIssue = (parsed: Record<string, unknown>, text: string) => {
  const messageSources = [
    parsed?.message,
    parsed?.error,
    parsed?.reason,
    parsed?.code,
    parsed?.status,
    parsed?.detail,
    text,
  ];
  const rawText = [
    ...messageSources.map((entry) => String(entry || "").trim()),
    ...walkTextNodes(parsed),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    rawText.includes("direct deposit") &&
    (rawText.includes("limit") || rawText.includes("amount") || rawText.includes("maximum"))
  ) {
    return {
      code: "checkbook_direct_deposit_limit_issue",
      message:
        "This bank account cannot be used for direct deposit right now due a transfer limit. Please choose a different account or contact Checkbook support.",
    };
  }

  if (
    rawText.includes("direct deposit") &&
    (
      rawText.includes("not") ||
      rawText.includes("cannot") ||
      rawText.includes("can't") ||
      rawText.includes("disabled") ||
      rawText.includes("unsupported")
    )
  ) {
    return {
      code: "checkbook_direct_deposit_not_supported",
      message:
        "This bank account is not configured for direct deposit. Please choose a different bank account.",
    };
  }

  if (
    rawText.includes("recipient") &&
    (rawText.includes("not found") || rawText.includes("invalid recipient"))
  ) {
    return {
      code: "checkbook_recipient_invalid",
      message:
        "Bank recipient record is not available. Re-link this bank account and try again.",
    };
  }

  if (
    rawText.includes("invalid destination") ||
    rawText.includes("destination not found")
  ) {
    return {
      code: "checkbook_destination_missing",
      message:
        "No valid direct-deposit destination was returned for this bank. Please try another account.",
    };
  }

  return null;
};

const isLikelyCheckbookDestinationId = (value: string) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  if (/^[a-f0-9-]{36}$/i.test(normalized)) return false;
  if (/^[a-f0-9]{32}$/i.test(normalized)) return false;
  return normalized.startsWith("ba_") ||
    normalized.startsWith("acct_") ||
    normalized.startsWith("account_") ||
    normalized.startsWith("bank_") ||
    normalized.startsWith("dest_") ||
    normalized.startsWith("destination_") ||
    normalized.startsWith("destination:");
};

const isLikelyCheckbookRecipientId = (value: string) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  return normalized.startsWith("r_") || normalized.startsWith("recipient_");
};

const coerceToDestinationId = (value: unknown) => {
  const id = toCleanId(value);
  if (!id) return null;
  return isLikelyCheckbookDestinationId(id) ? id : null;
};

const coerceToRecipientId = (value: unknown) => {
  const id = toCleanId(value);
  if (!id) return null;
  const normalized = String(id).trim().toLowerCase();
  return normalized.startsWith("r_") || normalized.startsWith("recipient_")
    ? id
    : null;
};

const coerceToRecipientOrDestinationId = (value: unknown) => {
  const id = toCleanId(value);
  if (!id) return null;
  if (isLikelyCheckbookDestinationId(id)) return id;
  const normalized = String(id || "").trim().toLowerCase();
  if (normalized.startsWith("r_") || normalized.startsWith("recipient_")) return id;
  return null;
};

const hasCheckbookId = (value: unknown) =>
  coerceToDestinationId(value) || coerceToRecipientId(value);

const extractCheckbookRecipientFromParsed = (parsed: unknown) => {
  const root = parsed as Record<string, unknown> | null;
  if (!root || typeof root !== "object") return null;

  const direct = coerceToRecipientOrDestinationId((root as Record<string, unknown>).recipient);
  if (direct && coerceToRecipientId(direct)) return direct;

  const directById = coerceToRecipientOrDestinationId(root.id);
  if (directById && coerceToRecipientId(directById)) return directById;

  const candidatePaths: Array<string[]> = [
    ["recipient", "id"],
    ["recipient", "recipient_id"],
    ["recipient", "recipientId"],
    ["recipient", "recipient", "id"],
    ["data", "recipient", "id"],
    ["data", "recipient", "recipient_id"],
    ["data", "recipient", "recipientId"],
    ["result", "recipient", "id"],
    ["result", "recipient", "recipient_id"],
    ["result", "recipient", "recipientId"],
  ];
  for (const path of candidatePaths) {
    const value = getPath(root, path);
    const extracted = coerceToRecipientOrDestinationId(value);
    if (extracted && coerceToRecipientId(extracted)) return extracted;
  }

  const candidateRecordCollections = [
    getPath(root, ["recipient"]),
    getPath(root, ["data", "recipient"]),
    getPath(root, ["result", "recipient"]),
  ];
  for (const candidate of candidateRecordCollections) {
    const record = candidate;
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    const recipientRecord = record as Record<string, unknown>;
    const recipientRecordCandidate = coerceToRecipientOrDestinationId(
      recipientRecord.id || recipientRecord.recipient_id || recipientRecord.recipientId,
    );
    if (recipientRecordCandidate && coerceToRecipientId(recipientRecordCandidate)) {
      return recipientRecordCandidate;
    }
  }
  return null;
};

const pickFirstCheckbookDestinationFromRecipientPayload = (
  parsed: Record<string, unknown>,
  fallbackEmail: string,
) => {
  const recipientPayload = extractDestinationIdFromObjectDeep(parsed, 0, true);
  const parsedDestination = coerceToDestinationId(recipientPayload);
  if (parsedDestination) return parsedDestination;
  const explicitRecipientDestination = coerceToDestinationId(
    extractCheckbookDestinationId(parsed),
  );
  if (explicitRecipientDestination) return explicitRecipientDestination;

  const recipientId = extractCheckbookRecipientFromParsed(parsed);
  if (!recipientId) {
    return null;
  }
  const resolvedFromRecipient = coerceToDestinationId(recipientId);
  if (resolvedFromRecipient) return resolvedFromRecipient;

  return resolveCheckbookRecipientDestinationByEmail(fallbackEmail);
};

const resolveCheckbookDestinationByIdentifier = async (identifier: string) => {
  const normalized = String(identifier || "").trim();
  if (!normalized) return null;
  if (isLikelyCheckbookDestinationId(normalized)) return normalized;
  const recipientLookup = await callCheckbookApi(
    `/v3/recipient/${encodeURIComponent(normalized)}`,
  );
  if (!recipientLookup.response.ok) return null;
  const recipientParsed = recipientLookup.parsed as unknown;
  const direct = coerceToDestinationId(extractCheckbookDestinationId(recipientParsed));
  if (direct) return direct;
  const deepDestinationId = extractDestinationIdFromObjectDeep(
    recipientParsed,
    0,
    true,
  );
  return coerceToDestinationId(deepDestinationId);
};

const resolveCheckbookDestinationByIdentifierWithMeta = async (identifier: string) => {
  const normalized = String(identifier || "").trim();
  if (!normalized) {
    return { destinationId: null as string | null, issueCode: null as string | null };
  }
  if (isLikelyCheckbookDestinationId(normalized)) return { destinationId: normalized, issueCode: null };
  const recipientLookup = await callCheckbookApi(
    `/v3/recipient/${encodeURIComponent(normalized)}`,
  );
  if (!recipientLookup.response.ok) {
    const issue = classifyCheckbookDestinationIssue(recipientLookup.parsed, recipientLookup.text);
    return {
      destinationId: null,
      issueCode: issue ? issue.code : "checkbook_recipient_lookup_failed",
    };
  }
  const recipientParsed = recipientLookup.parsed as unknown;
  const direct = coerceToDestinationId(extractCheckbookDestinationId(recipientParsed));
  if (direct) return { destinationId: direct, issueCode: null };
  const deepDestinationId = extractDestinationIdFromObjectDeep(
    recipientParsed,
    0,
    true,
  );
  const resolved = coerceToDestinationId(deepDestinationId);
  if (resolved) return { destinationId: resolved, issueCode: null };
  return {
    destinationId: null,
    issueCode: "checkbook_destination_not_found",
  };
};

const isInvalidRecipientError = (
  parsed: Record<string, unknown>,
  text: string,
) => {
  const candidate = String(
    parsed?.message ||
      parsed?.error ||
      (Array.isArray(parsed?.errors) ? parsed.errors[0]?.message : "") ||
      text ||
      "",
  )
    .trim()
    .toLowerCase();
  if (!candidate) return false;
  return candidate.includes("invalid recipient") ||
    candidate.includes("recipient not found") ||
    candidate.includes("invalid destination") ||
    candidate.includes("destination not found") ||
    candidate.includes("invalid account");
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object" && !Array.isArray(value);
};

const toCleanId = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return null;
  const text = String(value).trim();
  if (!text || text === "null" || text === "undefined" || text === "[object Object]") {
    return null;
  }
  return text.length > 0 ? text : null;
};

const extractDestinationIdFromStringValue = (value: unknown): string | null => {
  const candidate = toCleanId(value);
  if (!candidate) return null;
  return coerceToDestinationId(candidate) || coerceToDestinationId(candidate.toLowerCase());
};

const extractDestinationLikeIdFromNodeValue = (
  value: unknown,
  allowRecipient = false,
): string | null => {
  const direct = extractDestinationIdFromStringValue(value);
  if (direct) return direct;

  if (allowRecipient && typeof value === "string") {
    const recipient = coerceToRecipientOrDestinationId(value);
    if (recipient) return recipient;
  }

  return null;
};

const extractIdFromRecord = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const id = toCleanId(getPath(record, [key]));
    if (id) return id;
  }
  return null;
};

const extractIdFromCollection = (
  candidates: unknown,
  keys: Array<string[]>,
) => {
  if (!Array.isArray(candidates)) return null;
  for (const item of candidates) {
    if (!isPlainObject(item)) continue;
    for (const keyPath of keys) {
      const value = keyPath.length === 1 ? item[keyPath[0]] : getPath(item, keyPath);
      const id = toCleanId(value);
      const destinationLikeId = coerceToDestinationId(id);
      if (destinationLikeId) return destinationLikeId;
    }
    const nestedDestination = coerceToDestinationId(
      toCleanId(getPath(item, ["destination", "id"])),
    );
    if (nestedDestination) return nestedDestination;
    const nestedRecipient = coerceToDestinationId(
      toCleanId(getPath(item, ["recipient", "id"])),
    );
    if (nestedRecipient) return nestedRecipient;
  }
  return null;
};

const extractDestinationIdFromObjectDeep = (
  node: unknown,
  depth = 0,
  allowRecipient = false,
): string | null => {
  if (depth > 6 || !node || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  const directCandidate = (
    candidate: unknown,
    allowRecipientValue = false,
  ): string | null => {
    if (allowRecipientValue) {
      const recipientId = coerceToRecipientOrDestinationId(candidate);
      if (recipientId) return recipientId;
    }
    return coerceToDestinationId(candidate);
  };
  const topPriority = extractIdFromRecord(record, [
    "id",
    "destination_id",
    "destinationId",
    "default_destination_id",
    "defaultDestinationId",
    "default_bank_account_id",
    "defaultBankAccountId",
    "default_bank_account",
    "defaultBankAccount",
    "bank_account_id",
    "bankAccountId",
    "account_id",
    "accountId",
    "bank_account",
    "bankAccount",
    "account",
    "accountId",
    "destination",
    "destinationId",
    "external_account_id",
    "externalAccountId",
    "default_account_id",
    "defaultAccountId",
  ]);
  const topPriorityDestination = coerceToDestinationId(topPriority);
  if (topPriorityDestination) return topPriorityDestination;

  const recipientPriority = allowRecipient ? extractIdFromRecord(record, [
    "recipient_id",
    "recipientId",
    "id",
  ]) : extractIdFromRecord(record, ["recipient_id", "recipientId"]);
  if (recipientPriority) {
    const destinationLikeRecipientId = directCandidate(recipientPriority, true);
    if (destinationLikeRecipientId) return destinationLikeRecipientId;
  }

  const nestedSearchKeys = [
    "recipient",
    "destinations",
    "default_destination",
    "defaultDestination",
    "banks",
    "defaultBankAccounts",
    "default_bank_accounts",
    "default_bank_account",
    "defaultBankAccount",
    "bank_accounts",
    "accounts",
    "destination",
    "bank_account",
    "account",
    "data",
    "result",
  ];
  for (const key of nestedSearchKeys) {
    const nested = record[key];
    if (nested === undefined || nested === null) continue;
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const itemId = extractDestinationIdFromObjectDeep(
          item,
          depth + 1,
          true,
        );
        if (itemId) return itemId;
      }
    } else if (isPlainObject(nested) || Array.isArray(nested)) {
      const nestedId = extractDestinationIdFromObjectDeep(
        nested,
        depth + 1,
        true,
      );
      if (nestedId) return nestedId;
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === null) continue;
    const normalizedKey = String(key || "").toLowerCase();
    if (
      normalizedKey === "metadata" ||
      normalizedKey === "status" ||
      normalizedKey === "message" ||
      normalizedKey === "error" ||
      normalizedKey === "errors" ||
      normalizedKey === "created" ||
      normalizedKey === "updated" ||
      normalizedKey === "name" ||
      normalizedKey === "email"
    ) continue;
    const nestedId = directCandidate(value, allowRecipient);
    if (nestedId) return nestedId;
    if (isPlainObject(value) || Array.isArray(value)) {
      const nested = extractDestinationIdFromObjectDeep(
        value,
        depth + 1,
        allowRecipient,
      );
      if (nested) return nested;
    }
  }

  return null;
};

const extractCheckbookDestinationFromIavPayloadWithMeta = async (
  iavParsed: unknown,
  fallbackRecipientEmail: string,
) => {
  const payload = iavParsed || {};
  const directId = extractCheckbookDestinationId(payload);
  if (directId) {
    const directLookup = await resolveCheckbookDestinationByIdentifierWithMeta(directId);
    if (directLookup.destinationId) return {
      destinationId: directLookup.destinationId,
      issueCode: null,
    };
    if (directLookup.issueCode && directLookup.issueCode !== "checkbook_destination_not_found") {
      return { destinationId: null, issueCode: directLookup.issueCode };
    }
  }

  const rawRecipient = toCleanId((payload as Record<string, unknown>).recipient);
  if (rawRecipient) {
    const directRawRecipientDestination = await resolveCheckbookDestinationByIdentifierWithMeta(
      rawRecipient,
    );
    if (directRawRecipientDestination.destinationId) {
      return {
        destinationId: directRawRecipientDestination.destinationId,
        issueCode: null,
      };
    }
    if (!directRawRecipientDestination.issueCode) {
      const directRawId = coerceToDestinationId(rawRecipient);
      if (directRawId) return { destinationId: directRawId, issueCode: null };
      const rawRecipientIdentifier = coerceToRecipientOrDestinationId(rawRecipient);
      if (rawRecipientIdentifier) {
        return {
          destinationId: rawRecipientIdentifier,
          issueCode: null,
        };
      }
    } else if (
      directRawRecipientDestination.issueCode !== "checkbook_destination_not_found"
    ) {
      return {
        destinationId: null,
        issueCode: directRawRecipientDestination.issueCode,
      };
    }
  }

  const fallbackDestination = await resolveCheckbookRecipientDestinationByEmail(
    fallbackRecipientEmail,
  );
  if (fallbackDestination) return { destinationId: fallbackDestination, issueCode: null };

  const fallbackPaths: string[][] = [
    ["recipient", "id"],
    ["recipient", "bank_account_id"],
    ["recipient", "bankAccountId"],
    ["recipient", "default_destination_id"],
    ["recipient", "defaultDestinationId"],
    ["recipient", "default_bank_account_id"],
    ["recipient", "defaultBankAccountId"],
    ["recipient", "default_bank_account"],
    ["recipient", "defaultBankAccount"],
    ["recipient", "destination_id"],
    ["recipient", "destinationId"],
    ["recipient", "bank_account", "id"],
    ["recipient", "bankAccount", "id"],
    ["recipient", "account", "id"],
    ["recipient", "accountId"],
    ["recipient", "destination", "id"],
    ["recipient", "destinationId"],
    ["data", "recipient", "id"],
    ["data", "recipient", "bank_account_id"],
    ["data", "recipient", "bankAccountId"],
    ["data", "recipient", "default_destination_id"],
    ["data", "recipient", "defaultDestinationId"],
    ["data", "recipient", "destination_id"],
    ["data", "recipient", "destinationId"],
    ["data", "recipient", "bank_account", "id"],
    ["data", "recipient", "bankAccount", "id"],
    ["result", "recipient", "id"],
    ["result", "recipient", "bank_account_id"],
    ["result", "recipient", "bankAccountId"],
    ["result", "recipient", "default_destination_id"],
    ["result", "recipient", "defaultDestinationId"],
    ["result", "recipient", "destination_id"],
    ["result", "recipient", "destinationId"],
    ["result", "recipient", "bank_account", "id"],
    ["result", "recipient", "bankAccount", "id"],
    ["result", "recipient", "default_bank_account_id"],
    ["result", "recipient", "defaultBankAccountId"],
    ["result", "recipient", "default_bank_account"],
    ["result", "recipient", "defaultBankAccount"],
  ];
  for (const path of fallbackPaths) {
    const id = toCleanId(getPath(payload, path));
    if (!id) continue;
    const destinationFromId = await resolveCheckbookDestinationByIdentifierWithMeta(id);
    if (destinationFromId.destinationId) {
      return {
        destinationId: destinationFromId.destinationId,
        issueCode: null,
      };
    }
    if (
      destinationFromId.issueCode &&
      destinationFromId.issueCode !== "checkbook_destination_not_found" &&
      destinationFromId.issueCode !== "checkbook_recipient_lookup_failed"
    ) {
      return { destinationId: null, issueCode: destinationFromId.issueCode };
    }
  }

  const collectionKeys = [
    ["id"],
    ["destinationId"],
    ["defaultDestinationId"],
    ["default_destination_id"],
    ["recipient_id"],
    ["recipientId"],
    ["recipient", "id"],
    ["recipient", "recipientId"],
    ["recipient", "destination_id"],
    ["recipient", "destinationId"],
    ["bank_account_id"],
    ["bankAccountId"],
    ["account_id"],
    ["accountId"],
    ["destination_id"],
    ["destinationId"],
    ["destination", "id"],
    ["destination", "destinationId"],
    ["bank_account", "id"],
    ["bankAccount", "id"],
    ["account", "id"],
    ["accountId"],
    ["destination", "account", "id"],
    ["default_bank_account_id"],
    ["defaultBankAccountId"],
    ["default_bank_account", "id"],
    ["defaultBankAccount", "id"],
  ];
  const collections = [
    getPath(payload, ["destinations"]),
    getPath(payload, ["recipient"]),
    getPath(payload, ["bank_accounts"]),
    getPath(payload, ["accounts"]),
    getPath(payload, ["data", "destinations"]),
    getPath(payload, ["data", "recipients"]),
    getPath(payload, ["data", "bank_accounts"]),
    getPath(payload, ["data", "accounts"]),
    getPath(payload, ["result", "destinations"]),
    getPath(payload, ["result", "recipients"]),
    getPath(payload, ["result", "bank_accounts"]),
    getPath(payload, ["result", "accounts"]),
    getPath(payload, ["result", "banks"]),
  ];
  for (const collection of collections) {
    const id = extractIdFromCollection(collection, collectionKeys);
    if (!id) continue;
    const destinationFromCollection = await resolveCheckbookDestinationByIdentifierWithMeta(id);
    if (destinationFromCollection.destinationId) {
      return {
        destinationId: destinationFromCollection.destinationId,
        issueCode: null,
      };
    }
    if (
      destinationFromCollection.issueCode &&
      destinationFromCollection.issueCode !== "checkbook_destination_not_found" &&
      destinationFromCollection.issueCode !== "checkbook_recipient_lookup_failed"
    ) {
      return { destinationId: null, issueCode: destinationFromCollection.issueCode };
    }
  }

  const normalizedEmail = String(fallbackRecipientEmail || "").trim();
  if (!normalizedEmail) {
    return {
      destinationId: null,
      issueCode: "checkbook_recipient_lookup_failed",
    };
  }
  const recipientLookup = await callCheckbookApi(
    `/v3/recipient/${encodeURIComponent(normalizedEmail)}`,
  );
  if (!recipientLookup.response.ok) {
    const issue = classifyCheckbookDestinationIssue(recipientLookup.parsed, recipientLookup.text);
    return {
      destinationId: null,
      issueCode: issue ? issue.code : "checkbook_recipient_lookup_failed",
    };
  }
  const emailParsedDestination = coerceToDestinationId(
    extractCheckbookDestinationId(recipientLookup.parsed as Record<string, unknown>),
  );
  return {
    destinationId: emailParsedDestination,
    issueCode: emailParsedDestination ? null : "checkbook_destination_not_found",
  };
};

const extractCheckbookDestinationFromIavPayload = async (
  iavParsed: unknown,
  fallbackRecipientEmail: string,
) => {
  const result = await extractCheckbookDestinationFromIavPayloadWithMeta(
    iavParsed,
    fallbackRecipientEmail,
  );
  return result.destinationId;
};

const issueAwareResolve = async (
  identifier: string,
): Promise<{ destinationId: string | null; issueCode: string | null }> => {
  const resolved = await resolveCheckbookDestinationByIdentifierWithMeta(identifier);
  if (resolved.destinationId) return resolved;
  return {
    destinationId: null,
    issueCode: resolved.issueCode || "checkbook_destination_missing",
  };
};

const formatIssueMessage = (
  issueCode: string | null,
  fallback: string,
) => {
  if (!issueCode) return fallback;
  const normalized = String(issueCode || "").toLowerCase();
  if (normalized === "checkbook_direct_deposit_limit_issue") {
    return "This bank account cannot be linked for direct deposit right now because direct-deposit transfer limits are not available. Please choose another account.";
  }
  if (normalized === "checkbook_direct_deposit_not_supported") {
    return "This bank account is not configured for direct deposit. Please choose another bank account.";
  }
  if (normalized === "checkbook_recipient_invalid" || normalized === "checkbook_recipient_lookup_failed") {
    return "Bank recipient information is not available in Checkbook. Please re-link your bank account.";
  }
  if (normalized === "checkbook_recipient_id_returned") {
    return "No valid direct-deposit destination is available for the linked bank. Please re-link it.";
  }
  return fallback;
};

const extractCheckbookDestinationId = (parsed: unknown) => {
  const candidatePaths: Array<string[]> = [
    ["id"],
    ["destination_id"],
    ["destinationId"],
    ["default_destination_id"],
    ["defaultDestinationId"],
    ["default_bank_account_id"],
    ["defaultBankAccountId"],
    ["bank_account_id"],
    ["bankAccountId"],
    ["account_id"],
    ["accountId"],
    ["destinationType"],
    ["external_account_id"],
    ["externalAccountId"],
    ["default_account_id"],
    ["defaultAccountId"],
    ["default_bank_account"],
    ["defaultBankAccount"],
    ["default_bank"],
    ["defaultBank"],
    ["bank_account", "id"],
    ["bankAccount", "id"],
    ["account", "id"],
    ["accountId"],
    ["destination", "id"],
    ["destinationId"],
    ["destination", "destination_id"],
    ["destination", "destinationId"],
    ["data", "id"],
    ["data", "recipient_id"],
    ["data", "recipientId"],
    ["data", "destination_id"],
    ["data", "destinationId"],
    ["data", "bank_account_id"],
    ["data", "bankAccountId"],
    ["data", "account_id"],
    ["data", "accountId"],
    ["data", "default_destination_id"],
    ["data", "defaultDestinationId"],
    ["data", "default_bank_account_id"],
    ["data", "defaultBankAccountId"],
    ["data", "destination"],
    ["data", "recipient"],
    ["data", "bank_account", "id"],
    ["data", "bankAccount", "id"],
    ["data", "account", "id"],
    ["data", "accountId"],
    ["data", "destination", "id"],
    ["data", "destination", "destination_id"],
    ["data", "destination", "destinationId"],
    ["data", "recipient", "id"],
    ["data", "recipient", "recipientId"],
    ["recipient", "id"],
    ["recipient", "recipientId"],
    ["destination", "id"],
    ["destination", "destinationId"],
    ["destination", "default_destination_id"],
    ["destination", "defaultDestinationId"],
    ["recipient", "bank_account", "id"],
    ["recipient", "bankAccount", "id"],
    ["recipient", "account", "id"],
    ["recipient", "accountId"],
    ["recipient", "default_destination_id"],
    ["recipient", "defaultDestinationId"],
    ["recipient", "default_bank_account_id"],
    ["recipient", "defaultBankAccountId"],
    ["recipient", "default_bank_account"],
    ["recipient", "defaultBankAccount"],
    ["recipient", "default_bank", "id"],
    ["recipient", "defaultBank", "id"],
    ["result", "destination_id"],
    ["result", "destinationId"],
    ["result", "defaultDestinationId"],
    ["result", "default_destination_id"],
    ["result", "recipient_id"],
    ["result", "recipientId"],
    ["result", "bank_account_id"],
    ["result", "bankAccountId"],
    ["result", "account_id"],
    ["result", "accountId"],
    ["result", "destination", "id"],
    ["result", "destination", "destination_id"],
    ["result", "destination", "destinationId"],
    ["result", "recipient", "id"],
    ["result", "recipient", "recipientId"],
    ["result", "recipient", "default_destination_id"],
    ["result", "recipient", "defaultDestinationId"],
    ["result", "recipient", "default_bank_account_id"],
    ["result", "recipient", "defaultBankAccountId"],
    ["result", "recipient", "default_bank_account"],
    ["result", "recipient", "defaultBankAccount"],
    ["result", "id"],
  ];

  for (const path of candidatePaths) {
    const direct = toCleanId(getPath(parsed, path));
    const directDestination = coerceToDestinationId(direct);
    if (directDestination) return directDestination;
  }

  const collectionCandidates = [
    getPath(parsed, ["destinations"]),
    getPath(parsed, ["recipients"]),
    getPath(parsed, ["bank_accounts"]),
    getPath(parsed, ["accounts"]),
    getPath(parsed, ["banks"]),
    getPath(parsed, ["data", "destinations"]),
    getPath(parsed, ["data", "recipients"]),
    getPath(parsed, ["data", "bank_accounts"]),
    getPath(parsed, ["data", "accounts"]),
    getPath(parsed, ["data", "banks"]),
  ];
  for (const candidate of collectionCandidates) {
    if (!Array.isArray(candidate) || candidate.length === 0) continue;
    for (const first of candidate) {
      if (!first || typeof first !== "object" || Array.isArray(first)) continue;
      const row = first as Record<string, unknown>;
      const id = toCleanId(row?.id);
      const idDestination = coerceToDestinationId(id);
      if (idDestination) return idDestination;
      const nestedDestinationId = toCleanId(getPath(row, ["destination", "id"]));
      const nestedDestination = coerceToDestinationId(nestedDestinationId);
      if (nestedDestination) return nestedDestination;
      const nestedRecipientId = toCleanId(getPath(row, ["recipient", "id"]));
      const nestedRecipient = coerceToDestinationId(nestedRecipientId);
      if (nestedRecipient) return nestedRecipient;
      const nestedDefaultDestinationId = coerceToDestinationId(
        toCleanId(getPath(row, ["default_destination_id"])),
      );
      if (nestedDefaultDestinationId) return nestedDefaultDestinationId;
      const nestedDefaultDestinationId2 = coerceToDestinationId(
        toCleanId(getPath(row, ["defaultDestinationId"])),
      );
      if (nestedDefaultDestinationId2) return nestedDefaultDestinationId2;
      const nestedDefaultBankId = coerceToDestinationId(
        toCleanId(getPath(row, ["default_bank_account_id"])),
      );
      if (nestedDefaultBankId) return nestedDefaultBankId;
      const nestedDefaultBankId2 = coerceToDestinationId(
        toCleanId(getPath(row, ["defaultBankAccountId"])),
      );
      if (nestedDefaultBankId2) return nestedDefaultBankId2;
      const nestedDefaultBankObjId = coerceToDestinationId(
        toCleanId(getPath(row, ["default_bank_account", "id"])),
      );
      if (nestedDefaultBankObjId) return nestedDefaultBankObjId;
      const nestedDefaultBankObjId2 = coerceToDestinationId(
        toCleanId(getPath(row, ["defaultBankAccount", "id"])),
      );
      if (nestedDefaultBankObjId2) return nestedDefaultBankObjId2;
      const nestedBankId = coerceToDestinationId(
        toCleanId(getPath(row, ["bank_account_id"])),
      );
      if (nestedBankId) return nestedBankId;
      const nestedBankId2 = coerceToDestinationId(
        toCleanId(getPath(row, ["bankAccountId"])),
      );
      if (nestedBankId2) return nestedBankId2;
      const nestedBankObjId = coerceToDestinationId(
        toCleanId(getPath(row, ["bank_account", "id"])),
      );
      if (nestedBankObjId) return nestedBankObjId;
      const nestedBankObjId2 = coerceToDestinationId(
        toCleanId(getPath(row, ["bankAccount", "id"])),
      );
      if (nestedBankObjId2) return nestedBankObjId2;
      const nestedAccountId = coerceToDestinationId(
        toCleanId(getPath(row, ["account_id"])),
      );
      if (nestedAccountId) return nestedAccountId;
      const nestedAccountId2 = coerceToDestinationId(
        toCleanId(getPath(row, ["accountId"])),
      );
      if (nestedAccountId2) return nestedAccountId2;
      const nestedAccountObjId = coerceToDestinationId(
        toCleanId(getPath(row, ["account", "id"])),
      );
      if (nestedAccountObjId) return nestedAccountObjId;
      const nestedFromRecord = extractDestinationIdFromObjectDeep(row, 0, false);
      if (nestedFromRecord) return nestedFromRecord;
    }
  }
  const deepDestinationId = extractDestinationIdFromObjectDeep(parsed, 0, false);
  if (deepDestinationId) return deepDestinationId;
  return null;
};

const resolveCheckbookRecipientDestinationByEmail = async (
  email: string,
) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  return resolveCheckbookDestinationByIdentifier(normalizedEmail);
};

const resolveCheckbookRecipientDestinationForTransfer = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
  recipientId: string | null,
  preferredPlaidAccountId: string | null,
  profile: { email: string; fullName: string },
) => {
  const resolveDestinationByRecipientId = async (candidate: string | null) => {
    const normalized = String(candidate || "").trim();
    if (!normalized) return null;
    const directDestination = coerceToDestinationId(normalized);
    if (directDestination) return directDestination;
    return resolveCheckbookDestinationByIdentifier(normalized);
  };

  const directCandidate = String(recipientId || "").trim() || null;
  if (directCandidate) {
    const directRecipientDestination = await resolveDestinationByRecipientId(directCandidate);
    if (directRecipientDestination) return directRecipientDestination;
  }

  const cachedByPreferredAccount = await resolveCachedCheckbookIdsForPlaidAccount(
    supabase,
    userId,
    preferredPlaidAccountId,
  );
  if (cachedByPreferredAccount.destinationId) return cachedByPreferredAccount.destinationId;
  if (cachedByPreferredAccount.recipientId && !directCandidate) {
    const cachedDestination = await resolveDestinationByRecipientId(
      cachedByPreferredAccount.recipientId,
    );
    if (cachedDestination) return cachedDestination;
  }

  const cachedByRecipient = await resolveCachedCheckbookIdsFromRecipient(
    supabase,
    userId,
  );
  if (cachedByRecipient.destinationId) return cachedByRecipient.destinationId;
  if (cachedByRecipient.recipientId) {
    const cachedRecipientDestination = await resolveDestinationByRecipientId(
      cachedByRecipient.recipientId,
    );
    if (cachedRecipientDestination) return cachedRecipientDestination;
  }

  const emailFallback = await resolveCheckbookRecipientDestinationByEmail(profile.email);
  if (emailFallback) {
    if (!directCandidate || directCandidate !== emailFallback) {
      await supabase
        .from("cashout_recipients")
        .upsert(
          {
            user_id: userId,
            provider: "checkbook",
            recipient_provider_id: emailFallback,
            recipient_status: "linked",
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
    }
    return emailFallback;
  }

  const activeAccountsResult = await supabase
    .from("plaid_linked_accounts")
    .select("plaid_account_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("updated_at", { ascending: false });

  if (!activeAccountsResult.error) {
    const activeAccounts = Array.isArray(activeAccountsResult.data) ? activeAccountsResult.data : [];
    const accountIds = new Set<string>();
    const preferred = String(preferredPlaidAccountId || "").trim();
    if (preferred) {
      accountIds.add(preferred);
    }
    for (const row of activeAccounts) {
      const plaidAccountId = String(row?.plaid_account_id || "").trim();
      if (plaidAccountId) {
        accountIds.add(plaidAccountId);
      }
    }

    for (const plaidAccountId of accountIds) {
      const cachedByFallbackAccount = await resolveCachedCheckbookIdsForPlaidAccount(
        supabase,
        userId,
        plaidAccountId,
      );
      if (cachedByFallbackAccount.destinationId) return cachedByFallbackAccount.destinationId;
      if (cachedByFallbackAccount.recipientId && !directCandidate) {
        const fallbackRecipientDestination = await resolveDestinationByRecipientId(
          cachedByFallbackAccount.recipientId,
        );
        if (fallbackRecipientDestination) return fallbackRecipientDestination;
      }
    }
  }

  if (preferredPlaidAccountId) {
    try {
      const refreshed = await refreshCheckbookRecipientFromStoredPlaid(
        supabase,
        userId,
        profile,
        preferredPlaidAccountId,
      );
      const refreshedRecipient = String(refreshed.recipientId || "").trim();
      if (refreshedRecipient) {
        const refreshedDestination = await resolveDestinationByRecipientId(refreshedRecipient);
        if (refreshedDestination) return refreshedDestination;
      }
    } catch {
      // Keep behavior deterministic: caller handles missing destination.
    }
  }

  try {
    const refreshed = await refreshCheckbookRecipientFromStoredPlaid(
      supabase,
      userId,
      profile,
    );
    const refreshedRecipient = String(refreshed.recipientId || "").trim();
    if (refreshedRecipient) {
      const refreshedDestination = await resolveDestinationByRecipientId(refreshedRecipient);
      if (refreshedDestination) return refreshedDestination;
    }
  } catch {
    // Keep behavior deterministic: caller handles missing destination.
  }

  return null;
};

const extractCheckObject = (parsed: Record<string, unknown>) => {
  const object = getPath(parsed, ["check"]) ||
    getPath(parsed, ["data"]) ||
    parsed;
  if (!object || typeof object !== "object" || Array.isArray(object)) return {};
  return object as Record<string, unknown>;
};

const extractFirstCheckObject = (parsed: Record<string, unknown>) => {
  const candidates = [
    parsed?.checks,
    getPath(parsed, ["data", "checks"]),
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate) || candidate.length === 0) continue;
    const first = candidate[0];
    if (!first || typeof first !== "object" || Array.isArray(first)) continue;
    return first as Record<string, unknown>;
  }
  return {};
};

const isSuccessLike = (value: string) =>
  ["paid", "processed", "succeeded", "completed", "settled", "success"]
    .includes(String(value || "").trim().toLowerCase());
const isFailureLike = (value: string) =>
  ["failed", "rejected", "canceled", "cancelled", "returned", "expired", "error"]
    .includes(String(value || "").trim().toLowerCase());

const getCashoutMonthWindowBounds = (nowDate = new Date()) => {
  const year = nowDate.getUTCFullYear();
  const month = nowDate.getUTCMonth();
  const windowStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const nextWindowStart = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
  return {
    windowStartIso: windowStart.toISOString(),
    nextWindowStartIso: nextWindowStart.toISOString(),
  };
};

const ensureMonthlyLimit = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
) => {
  if (!CASHOUT_MONTHLY_LIMIT_ENABLED) {
    return {
      payoutsRemainingInWindow: null,
      payoutsUsedInWindow: null,
      nextEligibleAt: null,
      monthlyLimit: null,
      weeklyLimit: null,
      limitWindow: null,
    };
  }
  const { windowStartIso, nextWindowStartIso } = getCashoutMonthWindowBounds();
  const { data, error } = await supabase
    .from("cashout_payouts")
    .select("id, created_at")
    .eq("user_id", userId)
    .in("status", ["pending", "paid"])
    .gte("created_at", windowStartIso)
    .lt("created_at", nextWindowStartIso)
    .order("created_at", { ascending: true });
  if (error) throw new HttpError(error.message || "Unable to load cashout history.", 500);
  const rows = Array.isArray(data) ? data : [];
  if (rows.length >= CASHOUT_MONTHLY_LIMIT_MAX) {
    const nextEligibleAt = nextWindowStartIso;
    throw new HttpError(
      `Cashout is limited to ${CASHOUT_MONTHLY_LIMIT_MAX} times per month.`,
      429,
      {
        reason: "monthly_cashout_limit",
        nextEligibleAt,
        payoutsUsedInWindow: rows.length,
        payoutsRemainingInWindow: 0,
        monthlyLimit: CASHOUT_MONTHLY_LIMIT_MAX,
        weeklyLimit: CASHOUT_MONTHLY_LIMIT_MAX,
        limitWindow: "month",
      },
    );
  }
  return {
    payoutsRemainingInWindow: Math.max(CASHOUT_MONTHLY_LIMIT_MAX - (rows.length + 1), 0),
    payoutsUsedInWindow: rows.length + 1,
    nextEligibleAt: null,
    monthlyLimit: CASHOUT_MONTHLY_LIMIT_MAX,
    weeklyLimit: CASHOUT_MONTHLY_LIMIT_MAX,
    limitWindow: "month",
  };
};

const releaseReservedCashback = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  payoutId: string,
) => {
  await supabase
    .from("cashback_events")
    .update({ status: "available", payout_id: null })
    .eq("payout_id", payoutId)
    .eq("status", "reserved");
};

const markPaidCashback = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  payoutId: string,
) => {
  await supabase
    .from("cashback_events")
    .update({ status: "paid" })
    .eq("payout_id", payoutId)
    .eq("status", "reserved");
};

const reserveCashbackForPayout = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
  payoutId: string,
  amountCents: number,
) => {
  const { data, error } = await supabase
    .from("cashback_events")
    .select("id, amount_cents, business_id, created_at")
    .eq("user_id", userId)
    .eq("status", "available")
    .is("payout_id", null);
  if (error) throw new HttpError(error.message || "Unable to load cashback balance.", 500);
  const rows = Array.isArray(data) ? data : [];
  const availableCents = rows.reduce(
    (sum, row) => sum + (Number(row.amount_cents) || 0),
    0,
  );
  if (availableCents <= 0) {
    throw new HttpError("No cashback balance available.", 400, {
      reason: "no_cashback_balance",
    });
  }
  if (amountCents > availableCents) {
    throw new HttpError("Requested amount exceeds available cashback balance.", 400, {
      reason: "amount_exceeds_available",
      availableCents,
    });
  }
  const selected: Array<{ id: string; amount: number; businessId: string | null }> = [];
  let selectedSum = 0;
  const sorted = [...rows].sort((a, b) => {
    const aMs = Date.parse(String(a?.created_at || "")) || 0;
    const bMs = Date.parse(String(b?.created_at || "")) || 0;
    return aMs - bMs;
  });
  for (const row of sorted) {
    if (selectedSum >= amountCents) break;
    const eventId = String(row?.id || "").trim();
    const eventAmount = Number(row?.amount_cents) || 0;
    if (!eventId || eventAmount <= 0) continue;
    selected.push({
      id: eventId,
      amount: eventAmount,
      businessId: String(row?.business_id || "").trim() || null,
    });
    selectedSum += eventAmount;
  }
  await supabase
    .from("cashback_events")
    .update({ status: "reserved", payout_id: payoutId })
    .in("id", selected.map((row) => row.id))
    .eq("user_id", userId)
    .eq("status", "available");

  const overage = Math.max(0, selectedSum - amountCents);
  if (overage > 0) {
    const last = selected[selected.length - 1];
    const newAmount = Math.max(0, last.amount - overage);
    if (newAmount <= 0) throw new HttpError("Unable to split cashback rows.", 500);
    await supabase
      .from("cashback_events")
      .update({ amount_cents: newAmount })
      .eq("id", last.id)
      .eq("user_id", userId)
      .eq("status", "reserved")
      .eq("payout_id", payoutId);
    await supabase.from("cashback_events").insert({
      receipt_upload_id: null,
      redemption_id: null,
      business_id: last.businessId,
      user_id: userId,
      amount_cents: overage,
      status: "available",
      payout_id: null,
      source: "adjustment",
      parent_event_id: last.id,
    });
  }
  return availableCents;
};

const resolveProfile = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
) => {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("id", userId)
    .maybeSingle();
  if (profileError || !profile?.id) throw new HttpError(profileError?.message || "Profile not found.", 404);
  const auth = await supabase.auth.admin.getUserById(userId);
  const profileEmail = normalizeEmail(profile.email);
  const authEmail = normalizeEmail(auth?.data?.user?.email);
  const email = isLikelyValidEmail(profileEmail)
    ? profileEmail
    : isLikelyValidEmail(authEmail)
      ? authEmail
      : "";
  if (!email) throw new HttpError("Add a valid email to your profile before cashing out.", 400, { reason: "invalid_profile_email" });
  const fullName = String(profile.full_name || "Wello User").trim() || "Wello User";
  return { email, fullName };
};

const getExistingRecipient = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
) => {
  const { data: existing } = await supabase
    .from("cashout_recipients")
    .select("recipient_provider_id, recipient_status, bank_summary")
    .eq("user_id", userId)
    .eq("provider", "checkbook")
    .maybeSingle();
  return {
    recipientId: String(existing?.recipient_provider_id || "").trim() || null,
    recipientStatus: String(existing?.recipient_status || "").trim().toLowerCase() ||
      "needs_onboarding",
    bankSummary: String(existing?.bank_summary || "").trim() || null,
  };
};

const getPlaidCashoutLinkState = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
) => {
  const [{ data: profile }, { data: accounts, error: accountsError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("stripe_cashout_plaid_account_id")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("plaid_linked_accounts")
        .select("plaid_account_id")
        .eq("user_id", userId)
        .eq("status", "active")
        .contains("link_purposes", ["cashout"]),
    ]);
  if (accountsError) {
    throw new HttpError(
      accountsError.message || "Unable to validate linked bank account.",
      500,
      { reason: "plaid_account_state_lookup_failed" },
    );
  }
  const activeAccountIds = new Set(
    (Array.isArray(accounts) ? accounts : [])
      .map((row) => String(row?.plaid_account_id || "").trim())
      .filter(Boolean),
  );
  const selectedAccountId = String(
    profile?.stripe_cashout_plaid_account_id || "",
  ).trim() || null;
  const selectedActive = selectedAccountId
    ? activeAccountIds.has(selectedAccountId)
    : false;
  return {
    hasActivePlaidAccount: activeAccountIds.size > 0,
    linkedAccountCount: activeAccountIds.size,
    selectedPlaidAccountId: selectedAccountId,
    selectedPlaidAccountActive: selectedActive,
  };
};

const resolveCachedCheckbookIdsForPlaidAccount = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
  plaidAccountId: string | null,
) => {
  const normalizedAccountId = String(plaidAccountId || "").trim();
  if (!normalizedAccountId) return { recipientId: null, destinationId: null };
  const { data, error } = await supabase
    .from("plaid_linked_accounts")
    .select("checkbook_recipient_id, checkbook_destination_id")
    .eq("user_id", userId)
    .eq("plaid_account_id", normalizedAccountId)
    .eq("status", "active")
    .maybeSingle();
  if (error) return { recipientId: null, destinationId: null };
  const row = (data as Record<string, unknown>) || {};
  return {
    recipientId: coerceToRecipientOrDestinationId(row?.checkbook_recipient_id),
    destinationId: coerceToDestinationId(row?.checkbook_destination_id),
  };
};

const resolveCachedCheckbookIdsFromRecipient = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
) => {
  const { data, error } = await supabase
    .from("cashout_recipients")
    .select("checkbook_recipient_id, checkbook_destination_id")
    .eq("user_id", userId)
    .eq("provider", "checkbook")
    .maybeSingle();
  if (error || !data) return { recipientId: null, destinationId: null };
  const row = (data as Record<string, unknown>) || {};
  return {
    recipientId: coerceToRecipientOrDestinationId(row?.checkbook_recipient_id),
    destinationId: coerceToDestinationId(row?.checkbook_destination_id),
  };
};

const persistCheckbookRecipientCache = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
  options: {
    recipientProviderId?: string | null;
    recipientId?: string | null;
    destinationId?: string | null;
    bankSummary?: string | null;
    recipientStatus?: string | null;
  },
) => {
  const record = {
    user_id: userId,
    provider: "checkbook" as const,
    recipient_provider_id: String(
      options.recipientProviderId || options.recipientId || options.destinationId || "",
    ).trim(),
    recipient_status: String(options.recipientStatus || "linked").trim() || "linked",
    bank_summary: options.bankSummary || null,
    last_synced_at: new Date().toISOString(),
    checkbook_recipient_id: options.recipientId || null,
    checkbook_destination_id: options.destinationId || null,
  };
  if (!record.recipient_provider_id) return;
  await supabase
    .from("cashout_recipients")
    .upsert(record, { onConflict: "user_id" });
};

const upsertLinkedPlaidData = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
  itemId: string,
  accessToken: string,
  institutionId: string | null,
  institutionName: string | null,
  accounts: Array<Record<string, unknown>>,
  purpose: "cashout" | "receipt_verification",
) => {
  const { data: existingItem } = await supabase
    .from("plaid_linked_items")
    .select("link_purposes")
    .eq("plaid_item_id", itemId)
    .maybeSingle();
  const mergedItemPurposes = mergePlaidLinkPurposes(
    existingItem?.link_purposes,
    [purpose],
  );
  const { error: upsertItemError } = await supabase
    .from("plaid_linked_items")
    .upsert(
      {
        user_id: userId,
        plaid_item_id: itemId,
        plaid_access_token: accessToken,
        institution_id: institutionId,
        institution_name: institutionName,
        status: "active",
        available_products: [],
        billed_products: [],
        last_sync_at: new Date().toISOString(),
        link_purposes: mergedItemPurposes,
        update_mode_required: false,
        update_mode_reason: null,
        update_mode_detected_at: null,
        new_accounts_available: false,
        last_webhook_code: "LINK_SUCCESS",
      },
      { onConflict: "plaid_item_id" },
    );
  if (upsertItemError) {
    throw new HttpError(
      upsertItemError.message || "Unable to save linked bank item.",
      500,
      { reason: "plaid_item_upsert_failed" },
    );
  }

  const { data: existingAccounts } = await supabase
    .from("plaid_linked_accounts")
    .select("plaid_account_id, link_purposes")
    .eq("user_id", userId)
    .eq("plaid_item_id", itemId);
  const purposeByAccountId = new Map<string, string[]>();
  (Array.isArray(existingAccounts) ? existingAccounts : []).forEach((row) => {
    const accountId = String(row?.plaid_account_id || "").trim();
    if (!accountId) return;
    purposeByAccountId.set(
      accountId,
      mergePlaidLinkPurposes(row?.link_purposes, [purpose]),
    );
  });

  const mappedAccounts = accounts
    .filter((account) => String(account?.account_id || "").trim().length > 0)
    .map((account) => ({
      user_id: userId,
      plaid_item_id: itemId,
      plaid_account_id: String(account?.account_id || "").trim(),
      account_name: String(
        account?.official_name || account?.name || account?.subtype ||
          "Bank account",
      ).trim(),
      account_mask: String(account?.mask || "").trim() || null,
      account_subtype: String(account?.subtype || "").trim() || null,
      account_type: String(account?.type || "").trim() || null,
      status: "active",
      link_purposes:
        purposeByAccountId.get(String(account?.account_id || "").trim()) || [purpose],
    }));

  if (mappedAccounts.length > 0) {
    const { error: accountUpsertError } = await supabase
      .from("plaid_linked_accounts")
      .upsert(mappedAccounts, {
        onConflict: "plaid_item_id,plaid_account_id",
      });
    if (accountUpsertError) {
      throw new HttpError(
        accountUpsertError.message || "Unable to save linked bank accounts.",
        500,
        { reason: "plaid_accounts_upsert_failed" },
      );
    }
    const keepAccountIds = new Set(
      mappedAccounts.map((account) => account.plaid_account_id),
    );
    const { data: activeRows } = await supabase
      .from("plaid_linked_accounts")
      .select("id, plaid_account_id")
      .eq("user_id", userId)
      .eq("plaid_item_id", itemId)
      .eq("status", "active");
    const staleIds = (Array.isArray(activeRows) ? activeRows : [])
      .filter((row) =>
        !keepAccountIds.has(String(row?.plaid_account_id || "").trim())
      )
      .map((row) => row.id)
      .filter(Boolean);
    if (staleIds.length > 0) {
      await supabase
        .from("plaid_linked_accounts")
        .update({ status: "revoked" })
        .in("id", staleIds);
    }
  }
};

const linkCheckbookRecipientFromPlaidAccess = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
  profile: { email: string; fullName: string },
  payload: { itemId: string; accessToken: string; plaidAccountId: string | null },
) => {
  const itemId = String(payload.itemId || "").trim();
  const accessToken = String(payload.accessToken || "").trim();
  if (!itemId || !accessToken) {
    throw new HttpError("Unable to prepare bank account for transfer.", 400, {
      reason: "plaid_link_data_missing",
    });
  }
  const item = await plaidGetItem(accessToken);
  const accountsRes = await plaidGetAccounts(accessToken);
  const accounts = (Array.isArray(accountsRes.accounts)
    ? accountsRes.accounts
    : []) as Array<Record<string, unknown>>;
  const eligibleAccounts = accounts.filter((account) =>
    isPlaidPayoutEligibleAccount(account)
  );
  if (!eligibleAccounts.length) {
    throw new HttpError("No bank account was shared from Plaid.", 400, {
      reason: "plaid_no_accounts",
    });
  }
  const selectedAccount = pickPreferredPlaidAccount(
    eligibleAccounts,
    payload.plaidAccountId || "",
  );
  if (!selectedAccount) {
    throw new HttpError("No eligible bank account selected.", 400, {
      reason: "plaid_account_not_selected",
    });
  }
  const plaidAccountId = String(selectedAccount?.account_id || "").trim();
  if (!plaidAccountId) {
    throw new HttpError("No eligible bank account selected.", 400, {
      reason: "plaid_account_not_selected",
    });
  }
  const institutionId = String(item?.item?.institution_id || "").trim() || null;
  let institutionName: string | null = null;
  if (institutionId) {
    try {
      const institution = await plaidGetInstitutionById(institutionId, ["US"]);
      institutionName = String(institution?.institution?.name || "").trim() || null;
    } catch {
      institutionName = null;
    }
  }
  await upsertLinkedPlaidData(
    supabase,
    userId,
    itemId,
    accessToken,
    institutionId,
    institutionName,
    accounts,
    "cashout",
  );

  const processor = await plaidCreateProcessorToken(
    accessToken,
    plaidAccountId,
    CHECKBOOK_PLAID_PROCESSOR || "checkbook",
  );
  const processorToken = String(processor?.processor_token || "").trim();
  if (!processorToken) {
    throw new HttpError("Unable to prepare bank account for transfer.", 502, {
      reason: "plaid_processor_token_missing",
    });
  }

  const auth = await plaidGetAuthNumbers(accessToken, plaidAccountId);
  const achRows = Array.isArray(auth?.numbers?.ach) ? auth.numbers.ach : [];
  const achRow = achRows.find((row) =>
    String(row?.account_id || "").trim() === plaidAccountId
  ) || achRows[0];
  const accountNumber = String(achRow?.account || "").replace(/\D+/g, "");
  const routingNumber = String(achRow?.routing || "").replace(/\D+/g, "");
  if (!accountNumber || !routingNumber) {
    throw new HttpError("Plaid did not return account/routing details.", 400, {
      reason: "plaid_auth_numbers_missing",
    });
  }

  const accountSubtype = normalizePlaidAccountSubtype(selectedAccount?.subtype);
  const accountMask = String(selectedAccount?.mask || "").trim();
  const summaryName = String(
    selectedAccount?.official_name || selectedAccount?.name || "Bank account",
  ).trim();
  const bankSummaryParts = [
    institutionName || "Linked bank",
    summaryName || "Account",
    accountMask ? `****${accountMask}` : null,
  ].filter(Boolean);
  const bankSummary = bankSummaryParts.join(" - ").slice(0, 180);

  const iavResponse = await callCheckbookApi("/v3/account/bank/iav/plaid", {
    method: "POST",
    body: JSON.stringify({
      processor_token: processorToken,
      plaid_processor_token: processorToken,
      account_id: plaidAccountId,
      account_type: mapCheckbookAccountType(accountSubtype),
      account: accountNumber,
      routing: routingNumber,
      name: profile.fullName,
      email: profile.email,
    }),
  });
  if (!iavResponse.response.ok) {
    throw new HttpError(
      parseCheckbookError(
        iavResponse.parsed,
        iavResponse.text,
        iavResponse.response.status || null,
      ),
      iavResponse.response.status || 502,
      { reason: "checkbook_plaid_link_failed" },
    );
  }

  const iavResolution = await extractCheckbookDestinationFromIavPayloadWithMeta(
    iavResponse.parsed,
    profile.email,
  );
  if (!iavResolution.destinationId) {
    const issueCode = iavResolution.issueCode || "checkbook_destination_missing";
    throw new HttpError(
      formatIssueMessage(
        issueCode,
        "This bank account cannot be linked for direct deposit right now. Try another account.",
      ),
      400,
      {
        reason: issueCode,
        checkbookResponseKeys: Object.keys(iavResponse.parsed || {}).slice(0, 20),
      },
    );
  }
  const recipientId = iavResolution.destinationId;

  const parsedIav = iavResponse.parsed as unknown;
  const parsedRecipientId = coerceToRecipientOrDestinationId(
    extractCheckbookRecipientFromParsed(parsedIav),
  );
  const iavRecipient = parsedRecipientId || null;
  const iavDestination = recipientId;

  let destinationId = iavDestination || null;
  let destinationFromRecipient: string | null = null;
  if (destinationId && !coerceToDestinationId(destinationId)) {
    destinationFromRecipient = await resolveCheckbookDestinationByIdentifier(
      destinationId,
    );
    if (!destinationFromRecipient) {
      throw new HttpError(
        "This bank account cannot be linked for direct deposit right now. Try another account.",
        400,
        {
          reason: "checkbook_destination_missing",
          checkbookResponseKeys: Object.keys(iavResponse.parsed || {}).slice(0, 20),
        },
      );
    }
    destinationId = destinationFromRecipient;
  }

  const resolvedRecipientId = coerceToRecipientOrDestinationId(iavRecipient) ||
    coerceToRecipientOrDestinationId(recipientId);
  const resolvedDestinationId = coerceToDestinationId(destinationId);

  if (!resolvedDestinationId) {
    throw new HttpError(
      "This bank account cannot be linked for direct deposit right now. Try another account.",
      400,
      {
        reason: "checkbook_destination_missing",
        checkbookResponseKeys: Object.keys(iavResponse.parsed || {}).slice(0, 20),
      },
    );
  }

  await persistCheckbookRecipientCache(
    supabase,
    userId,
    {
      recipientProviderId:
        profile.email ||
        recipientId ||
        iavRecipient ||
        String((iavResponse.parsed as Record<string, unknown>)?.recipient_provider_id || ""),
      recipientId: resolvedRecipientId || null,
      destinationId: resolvedDestinationId,
      recipientStatus: "linked",
      bankSummary,
    },
  );

  const { error: plaidAccountCacheUpdateError } = await supabase
    .from("plaid_linked_accounts")
    .update({
      checkbook_recipient_id: resolvedRecipientId || null,
      checkbook_destination_id: resolvedDestinationId || null,
    })
    .eq("user_id", userId)
    .eq("plaid_item_id", itemId)
    .eq("plaid_account_id", plaidAccountId)
    .eq("status", "active");
  if (plaidAccountCacheUpdateError) {
    // Keep payout behavior resilient if schema migration is not yet fully rolled out.
    // Best effort only, do not fail linking.
  }

  await supabase
    .from("cashout_recipients")
    .upsert(
      {
        user_id: userId,
        provider: "checkbook",
        recipient_provider_id: resolvedDestinationId || resolvedRecipientId || "",
        recipient_status: "linked",
        bank_summary: bankSummary || "Linked via Plaid",
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  await supabase
    .from("profiles")
    .update({
      stripe_cashout_plaid_item_id: itemId,
      stripe_cashout_plaid_account_id: plaidAccountId,
      stripe_cashout_account_label: bankSummary || "Linked via Plaid",
      stripe_cashout_bank_synced_at: new Date().toISOString(),
    })
    .eq("id", userId);

  return {
    recipientId,
    bankSummary: bankSummary || "Linked via Plaid",
    selectedPayoutAccountId: plaidAccountId,
    selectedPayoutLabel: bankSummary || "Linked via Plaid",
  };
};

const linkCheckbookRecipientFromPlaid = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
  profile: { email: string; fullName: string },
  payload: { publicToken: string; plaidAccountId: string | null },
) => {
  const exchange = await plaidExchangePublicToken(payload.publicToken);
  return linkCheckbookRecipientFromPlaidAccess(
    supabase,
    userId,
    profile,
    {
      itemId: String(exchange.item_id || "").trim(),
      accessToken: String(exchange.access_token || "").trim(),
      plaidAccountId: payload.plaidAccountId,
    },
  );
};

const refreshCheckbookRecipientFromStoredPlaid = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
  profile: { email: string; fullName: string },
  preferredPlaidAccountId?: string | null,
) => {
  const [{ data: profileRow }, { data: linkedAccounts, error: linkedAccountsError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("stripe_cashout_plaid_account_id")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("plaid_linked_accounts")
        .select(
          "id, plaid_item_id, plaid_account_id, account_subtype, account_type, link_purposes, updated_at",
        )
        .eq("user_id", userId)
        .eq("status", "active")
        .order("updated_at", { ascending: false }),
    ]);
  if (linkedAccountsError) {
    throw new HttpError(
      linkedAccountsError.message || "Unable to load linked bank accounts.",
      500,
      { reason: "plaid_account_state_lookup_failed" },
    );
  }
  const accounts = (Array.isArray(linkedAccounts) ? linkedAccounts : [])
    .filter((row) =>
      isPlaidPayoutEligibleAccount({
        subtype: row?.account_subtype,
        type: row?.account_type,
      })
    );
  if (!accounts.length) {
    throw new HttpError("Link a bank account before requesting bank transfer cashout.", 400, {
      reason: "bank_not_linked",
    });
  }
  const preferredAccountId = String(preferredPlaidAccountId || "").trim();
  const selectedAccountId = String(
    profileRow?.stripe_cashout_plaid_account_id || "",
  ).trim();
  const preferred = preferredAccountId
    ? accounts.find((row) => String(row?.plaid_account_id || "").trim() === preferredAccountId)
    : null;
  if (preferredAccountId && !preferred) {
    throw new HttpError("Selected payout bank is no longer linked.", 400, {
      reason: "plaid_account_not_found",
    });
  }
  const selectedOrFallback = preferred ||
    (selectedAccountId
      ? accounts.find((row) => String(row?.plaid_account_id || "").trim() === selectedAccountId)
      : null) ||
    accounts[0];
  if (selectedOrFallback?.id) {
    const mergedAccountPurposes = mergePlaidLinkPurposes(
      selectedOrFallback?.link_purposes,
      ["cashout"],
    );
    const { error: accountPurposeError } = await supabase
      .from("plaid_linked_accounts")
      .update({ link_purposes: mergedAccountPurposes })
      .eq("id", selectedOrFallback.id)
      .eq("user_id", userId);
    if (accountPurposeError) {
      throw new HttpError(
        accountPurposeError.message || "Unable to activate selected bank for cashout.",
        500,
        { reason: "plaid_account_purpose_update_failed" },
      );
    }
  }
  const plaidItemId = String(selectedOrFallback?.plaid_item_id || "").trim();
  const plaidAccountId = String(selectedOrFallback?.plaid_account_id || "").trim();
  if (!plaidItemId || !plaidAccountId) {
    throw new HttpError("Unable to load linked bank account details.", 400, {
      reason: "plaid_link_data_missing",
    });
  }
  const { data: itemRow, error: itemError } = await supabase
    .from("plaid_linked_items")
    .select("id, plaid_item_id, plaid_access_token, link_purposes")
    .eq("user_id", userId)
    .eq("plaid_item_id", plaidItemId)
    .eq("status", "active")
    .maybeSingle();
  if (itemError) {
    throw new HttpError(itemError.message || "Unable to load linked bank item.", 500, {
      reason: "plaid_item_lookup_failed",
    });
  }
  if (itemRow?.id) {
    const mergedItemPurposes = mergePlaidLinkPurposes(
      itemRow?.link_purposes,
      ["cashout"],
    );
    const { error: itemPurposeError } = await supabase
      .from("plaid_linked_items")
      .update({ link_purposes: mergedItemPurposes })
      .eq("id", itemRow.id)
      .eq("user_id", userId);
    if (itemPurposeError) {
      throw new HttpError(
        itemPurposeError.message || "Unable to activate selected institution for cashout.",
        500,
        { reason: "plaid_item_purpose_update_failed" },
      );
    }
  }
  const accessToken = String(itemRow?.plaid_access_token || "").trim();
  if (!accessToken) {
    throw new HttpError("Reconnect your bank account before requesting transfer.", 400, {
      reason: "plaid_access_token_missing",
    });
  }
  return linkCheckbookRecipientFromPlaidAccess(
    supabase,
    userId,
    profile,
    {
      itemId: plaidItemId,
      accessToken,
      plaidAccountId,
    },
  );
};

export const createCheckbookBankLinkHandler =
  (_options: BasicOptions) => async (req: Request) => {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    try {
      ensureCheckbookCredentials();
      const { userId, body } = await authenticateRequest(req);
      const supabase = createAdminSupabase();
      await enforceRateLimit({
        req,
        scope: "cashout:checkbook-bank-link",
        userId,
        maxRequests: 12,
        windowSeconds: 30 * 60,
        supabase,
      });
      const profile = await resolveProfile(supabase, userId);
      const existing = await getExistingRecipient(supabase, userId);
      const plaidState = await getPlaidCashoutLinkState(supabase, userId);
      const publicToken = String(
        body?.publicToken || body?.public_token || "",
      ).trim();
      const purpose = String(
        body?.purpose || body?.linkPurpose || body?.link_purpose || "",
      )
        .trim()
        .toLowerCase();
      if (purpose && purpose !== "cashout") {
        throw new HttpError("Invalid purpose.", 400, {
          reason: "invalid_link_purpose",
          allowedPurposes: ["cashout"],
        });
      }
      const plaidAccountId = String(
        body?.plaidAccountId || body?.plaid_account_id || body?.accountId || "",
      ).trim() || null;
      const forceRelink = /^(1|true|yes|on)$/i.test(
        String(body?.forceRelink || body?.force_relink || "").trim(),
      );
      const selectOnly = /^(1|true|yes|on)$/i.test(
        String(body?.selectOnly || body?.select_only || "").trim(),
      );

      if (
        !publicToken &&
        !forceRelink &&
        !plaidAccountId &&
        existing.recipientId &&
        ["linked", "verified", "active"].includes(existing.recipientStatus) &&
        plaidState.hasActivePlaidAccount &&
        plaidState.selectedPlaidAccountActive
      ) {
        return json({
          ok: true,
          status: "linked",
          linkToken: null,
          recipientId: existing.recipientId,
          bankSummary: existing.bankSummary,
          selectedPayoutAccountId: plaidState.selectedPlaidAccountId,
          selectedPayoutLabel: existing.bankSummary,
        }, 200);
      }

      if (!publicToken && selectOnly && plaidAccountId) {
        const { data: accountRows, error: accountLookupError } = await supabase
          .from("plaid_linked_accounts")
          .select(
            "id, plaid_item_id, plaid_account_id, account_name, account_mask, account_subtype, link_purposes, updated_at",
          )
          .eq("user_id", userId)
          .eq("plaid_account_id", plaidAccountId)
          .eq("status", "active")
          .order("updated_at", { ascending: false });
        if (accountLookupError) {
          throw new HttpError(
            accountLookupError.message || "Unable to load linked bank account.",
            500,
            { reason: "plaid_account_lookup_failed" },
          );
        }
        const accountCandidates = Array.isArray(accountRows) ? accountRows : [];
        const selectedAccount = accountCandidates.length > 0 ? accountCandidates[0] : null;
        if (!selectedAccount) {
          throw new HttpError("Selected payout bank is no longer linked.", 400, {
            reason: "plaid_account_not_found",
          });
        }

        const plaidItemId = String(selectedAccount?.plaid_item_id || "").trim();
        if (!plaidItemId) {
          throw new HttpError("Unable to load linked bank account details.", 400, {
            reason: "plaid_link_data_missing",
          });
        }
        const { data: itemRows, error: itemLookupError } = await supabase
          .from("plaid_linked_items")
          .select("id, institution_name, link_purposes, updated_at")
          .eq("user_id", userId)
          .eq("plaid_item_id", plaidItemId)
          .eq("status", "active")
          .order("updated_at", { ascending: false });
        if (itemLookupError) {
          throw new HttpError(
            itemLookupError.message || "Unable to load linked institution.",
            500,
            { reason: "plaid_item_lookup_failed" },
          );
        }
        const itemCandidates = Array.isArray(itemRows) ? itemRows : [];
        const selectedItem = itemCandidates.length > 0 ? itemCandidates[0] : null;
        if (!selectedItem) {
          throw new HttpError("Selected payout bank is no longer linked.", 400, {
            reason: "plaid_item_not_found",
          });
        }

        const mergedAccountPurposes = mergePlaidLinkPurposes(
          selectedAccount?.link_purposes,
          ["cashout"],
        );
        const mergedItemPurposes = mergePlaidLinkPurposes(
          selectedItem?.link_purposes,
          ["cashout"],
        );
        if (selectedAccount?.id) {
          const { error: accountPurposeError } = await supabase
            .from("plaid_linked_accounts")
            .update({ link_purposes: mergedAccountPurposes })
            .eq("id", selectedAccount.id)
            .eq("user_id", userId);
          if (accountPurposeError) {
            throw new HttpError(
              accountPurposeError.message || "Unable to update payout bank permissions.",
              500,
              { reason: "plaid_account_purpose_update_failed" },
            );
          }
        }
        if (selectedItem?.id) {
          const { error: itemPurposeError } = await supabase
            .from("plaid_linked_items")
            .update({ link_purposes: mergedItemPurposes })
            .eq("id", selectedItem.id)
            .eq("user_id", userId);
          if (itemPurposeError) {
            throw new HttpError(
              itemPurposeError.message || "Unable to update payout institution permissions.",
              500,
              { reason: "plaid_item_purpose_update_failed" },
            );
          }
        }

        const bankSummary = formatPlaidBankSummary(
          String(selectedItem?.institution_name || "").trim() || null,
          String(
            selectedAccount?.account_name ||
              selectedAccount?.account_subtype ||
              "Bank account",
          ).trim(),
          String(selectedAccount?.account_mask || "").trim() || null,
        );

        const nowIso = new Date().toISOString();
        const { error: profileUpdateError } = await supabase
          .from("profiles")
          .update({
            stripe_cashout_plaid_item_id: plaidItemId,
            stripe_cashout_plaid_account_id: plaidAccountId,
            stripe_cashout_account_label: bankSummary || null,
            stripe_cashout_bank_synced_at: nowIso,
          })
          .eq("id", userId);
        if (profileUpdateError) {
          throw new HttpError(
            profileUpdateError.message || "Unable to save selected payout bank.",
            500,
            { reason: "profile_payout_selection_update_failed" },
          );
        }

        if (existing.recipientId) {
          await supabase
            .from("cashout_recipients")
            .update({
              bank_summary: bankSummary || existing.bankSummary || "Linked via Plaid",
              last_synced_at: nowIso,
            })
            .eq("user_id", userId)
            .eq("provider", "checkbook");
        }

        return json({
          ok: true,
          status: existing.recipientId ? "linked" : "selected",
          mode: "selection_only",
          linkToken: null,
          recipientId: existing.recipientId,
          bankSummary: bankSummary || existing.bankSummary,
          selectedPayoutAccountId: plaidAccountId,
          selectedPayoutLabel: bankSummary || existing.bankSummary,
          copy: {
            primary: "Payout bank updated.",
            secondary: "Bank selection saved. You can request transfer when ready.",
          },
        }, 200);
      }

      if (!publicToken && (forceRelink || plaidAccountId)) {
        const linked = await refreshCheckbookRecipientFromStoredPlaid(
          supabase,
          userId,
          profile,
          plaidAccountId,
        );
        return json({
          ok: true,
          status: "linked",
          mode: "plaid_link",
          linkToken: null,
          recipientId: linked.recipientId,
          bankSummary: linked.bankSummary,
          selectedPayoutAccountId: linked.selectedPayoutAccountId || null,
          selectedPayoutLabel: linked.selectedPayoutLabel || linked.bankSummary,
        }, 200);
      }

      if (!publicToken) {
        const linkTokenPayload = await plaidCreateLinkToken({
          userId,
          email: profile.email,
          fullName: profile.fullName,
          platform: String(body?.platform || "").trim().toLowerCase() || null,
          androidPackageName: String(
            body?.androidPackageName || body?.android_package_name || "",
          ).trim() || null,
          products: ["auth"],
          optionalProducts: ["identity"],
        });
        return json({
          ok: true,
          status: "needs_onboarding",
          mode: "plaid_link",
          linkToken: String(linkTokenPayload?.link_token || "").trim() || null,
          expiration: String(linkTokenPayload?.expiration || "").trim() || null,
          requestId: String(linkTokenPayload?.request_id || "").trim() || null,
          recipientId: existing.recipientId,
          bankSummary: existing.bankSummary,
          selectedPayoutAccountId: plaidState.selectedPlaidAccountId,
          selectedPayoutLabel: existing.bankSummary,
        }, 200);
      }

      const linked = await linkCheckbookRecipientFromPlaid(
        supabase,
        userId,
        profile,
        { publicToken, plaidAccountId },
      );
      return json({
        ok: true,
        status: "linked",
        mode: "plaid_link",
        linkToken: null,
        recipientId: linked.recipientId,
        bankSummary: linked.bankSummary,
        selectedPayoutAccountId: linked.selectedPayoutAccountId || null,
        selectedPayoutLabel: linked.selectedPayoutLabel || linked.bankSummary,
      }, 200);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message, ...(error.details || {}) }, error.status);
      }
      return json({ error: "Unable to prepare bank transfer setup." }, 500);
    }
  };

export const createCheckbookCashoutHandler =
  (options: CreateOptions) => async (req: Request) => {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const supabase = createAdminSupabase();
    let payoutId: string | null = null;
    try {
      ensureCheckbookCredentials();
      const { userId, body } = await authenticateRequest(req);
      await enforceRateLimit({
        req,
        scope: "cashout:checkbook-create",
        userId,
        maxRequests: 18,
        windowSeconds: 60 * 60,
        supabase,
      });
      const methodType = String(body?.methodType || body?.method_type || "")
        .trim()
        .toLowerCase();
      if (methodType !== "bank_transfer") {
        throw new HttpError("Unsupported cashout method for this endpoint.", 400, {
          reason: "invalid_method_type",
        });
      }
      const rawAmount = body?.amountCents ?? body?.amount_cents ?? body?.amount;
      const amountCents = Math.trunc(Number(rawAmount));
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        throw new HttpError("Invalid amountCents.", 400, { reason: "invalid_amount" });
      }
      if (amountCents < CHECKBOOK_CASHOUT_MIN_CENTS) {
        throw new HttpError(
          `Minimum cashout is $${(CHECKBOOK_CASHOUT_MIN_CENTS / 100).toFixed(2)}.`,
          400,
          { reason: "minimum_cashout_not_met", minimumCashoutCents: CHECKBOOK_CASHOUT_MIN_CENTS },
        );
      }
      if (amountCents > CHECKBOOK_CASHOUT_MAX_CENTS) {
        throw new HttpError(
          `Maximum cashout is $${(CHECKBOOK_CASHOUT_MAX_CENTS / 100).toFixed(2)}.`,
          400,
          { reason: "maximum_cashout_exceeded", maximumCashoutCents: CHECKBOOK_CASHOUT_MAX_CENTS },
        );
      }
      const rawIdempotencyKey = String(
        body?.idempotencyKey ?? body?.idempotency_key ?? "",
      ).trim();
      if (!rawIdempotencyKey && options.requireIdempotencyKey) {
        throw new HttpError("Missing idempotencyKey.", 400, { reason: "missing_idempotency_key" });
      }
      const idempotencyKey = rawIdempotencyKey || buildIdempotencyKey();
      const { data: existing, error: existingError } = await supabase
        .from("cashout_payouts")
        .select(
          "id, amount_cents, status, approval_status, provider_order_id, provider_reward_id, provider_claim_url",
        )
        .eq("user_id", userId)
        .eq("provider", "checkbook")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existingError) throw new HttpError(existingError.message, 500);
      if (existing?.id) {
        return json({
          success: true,
          provider: "checkbook",
          methodType: "bank_transfer",
          payoutId: String(existing.id),
          orderId: String(existing.provider_order_id || "").trim() || null,
          rewardId: String(existing.provider_reward_id || "").trim() || null,
          claimUrl: String(existing.provider_claim_url || "").trim() || null,
          amountCents: Math.max(0, Number(existing.amount_cents) || 0),
          status: String(existing.status || "pending").toLowerCase(),
          approvalStatus: String(existing.approval_status || "pending").toLowerCase(),
          duplicate: true,
        }, 200);
      }
      const plaidState = await getPlaidCashoutLinkState(supabase, userId);
      const profile = await resolveProfile(supabase, userId);
      let recipientId: string | null = null;
      let recipientStatus = "";
      let recipientBankSummary: string | null = null;
      {
        const recipientRow = await supabase
          .from("cashout_recipients")
          .select("recipient_provider_id, recipient_status, bank_summary")
          .eq("user_id", userId)
          .eq("provider", "checkbook")
          .maybeSingle();
        recipientId = String(recipientRow.data?.recipient_provider_id || "").trim() || null;
        recipientStatus = String(recipientRow.data?.recipient_status || "")
          .trim()
          .toLowerCase() || "linked";
        recipientBankSummary = String(recipientRow.data?.bank_summary || "").trim() || null;
      }

      {
        const isRecipientUsable = Boolean(
          recipientId && ["linked", "verified", "active"].includes(recipientStatus),
        );
        const shouldRefreshRecipient = !isRecipientUsable;
        if (shouldRefreshRecipient) {
          const preferredAccountId = plaidState.selectedPlaidAccountActive
            ? plaidState.selectedPlaidAccountId || null
            : null;
          const linked = await refreshCheckbookRecipientFromStoredPlaid(
            supabase,
            userId,
            profile,
            preferredAccountId,
          );
          recipientId = String(linked.recipientId || "").trim() || null;
          recipientStatus = recipientId ? "linked" : recipientStatus;
          recipientBankSummary = String(linked.bankSummary || "").trim() || recipientBankSummary;
        }
      }

      const preferredAccountId = plaidState.selectedPlaidAccountActive
        ? plaidState.selectedPlaidAccountId || null
        : null;
      const resolvedRecipientId = await resolveCheckbookRecipientDestinationForTransfer(
        supabase,
        userId,
        recipientId,
        preferredAccountId,
        profile,
      );
      if (!resolvedRecipientId) {
        const fallbackResolution = await issueAwareResolve(recipientId || "");
        const issueCode = fallbackResolution.issueCode || "checkbook_destination_missing";
        throw new HttpError(
          formatIssueMessage(
            issueCode,
            "This bank account cannot be linked for direct deposit right now. Try another account.",
          ),
          400,
          {
            reason: issueCode,
          },
        );
      }
      recipientId = resolvedRecipientId;

      if (!recipientId) {
        throw new HttpError("Link a bank account before requesting bank transfer cashout.", 400, {
          reason: "bank_not_linked",
        });
      }
      if (!["linked", "verified", "active"].includes(recipientStatus)) {
        throw new HttpError("Complete bank setup before requesting bank transfer cashout.", 400, {
          reason: "bank_setup_incomplete",
        });
      }
      const windowInfo = await ensureMonthlyLimit(supabase, userId);
      const { data: inserted, error: insertError } = await supabase
        .from("cashout_payouts")
        .insert({
          user_id: userId,
          stripe_account_id: "checkbook_cashout",
          provider: "checkbook",
          method_type: "bank_transfer",
          approval_status: "pending",
          amount_cents: amountCents,
          status: "pending",
          idempotency_key: idempotencyKey,
          provider_status: "awaiting_admin_approval",
          recipient_provider_id: recipientId,
          bank_summary: recipientBankSummary,
        })
        .select("id")
        .maybeSingle();
      if (insertError || !inserted?.id) {
        throw new HttpError(insertError?.message || "Unable to create payout request.", 500);
      }
      payoutId = inserted.id;
      await reserveCashbackForPayout(supabase, userId, payoutId, amountCents);
      return json({
        success: true,
        provider: "checkbook",
        methodType: "bank_transfer",
        payoutId,
        orderId: null,
        rewardId: null,
        claimUrl: null,
        amountCents,
        status: "pending",
        approvalStatus: "pending",
        ...windowInfo,
      }, 200);
    } catch (error) {
      if (payoutId) {
        try {
          await releaseReservedCashback(supabase, payoutId);
          await supabase
            .from("cashout_payouts")
            .update({
              status: "failed",
              provider_status: "payout_create_failed",
              failure_reason: String((error as { message?: string })?.message || "Cashout failed"),
              processed_at: new Date().toISOString(),
            })
            .eq("id", payoutId);
        } catch {
          // best effort rollback
        }
      }
      if (error instanceof HttpError) {
        return json({ error: error.message, ...(error.details || {}) }, error.status);
      }
      return json({ error: "Unable to request bank transfer cashout." }, 500);
    }
  };

export const createCheckbookAdminDecisionHandler =
  (_options: BasicOptions) => async (req: Request) => {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    try {
      ensureCheckbookCredentials();
      const provided = String(req.headers.get("x-admin-decision-secret") || "").trim();
      const authHeader = String(
        req.headers.get("authorization") || req.headers.get("Authorization") || "",
      ).trim();
      const bearer = authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : "";
      const hasHeaderSecret =
        !!CASHOUT_ADMIN_DECISION_SECRET &&
        !!provided &&
        constantTimeEqual(provided, CASHOUT_ADMIN_DECISION_SECRET);
      const hasServerBearer =
        !!ADMIN_DECISION_BEARER_KEY &&
        !!bearer &&
        constantTimeEqual(bearer, ADMIN_DECISION_BEARER_KEY);
      if (!hasHeaderSecret && !hasServerBearer) {
        throw new HttpError("Unauthorized", 401, { reason: "invalid_admin_secret" });
      }
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const payoutId = String(body?.payoutId || "").trim();
      const action = String(body?.action || "").trim().toLowerCase();
      const actorId = String(body?.actorId || "").trim() || null;
      const expectedStatus = String(body?.expectedStatus || "pending").trim().toLowerCase();
      const expectedApprovalStatus = String(body?.expectedApprovalStatus || "pending").trim().toLowerCase();
      if (!payoutId) throw new HttpError("Missing payout id.", 400, { reason: "missing_payout_id" });
      if (!["approve", "reject"].includes(action)) {
        throw new HttpError("Invalid action.", 400, { reason: "invalid_action" });
      }
      if (!actorId) {
        throw new HttpError("Missing actor id.", 400, { reason: "missing_actor_id" });
      }
      const supabase = createAdminSupabase();
      await enforceRateLimit({
        req,
        scope: "cashout:bank-decision",
        identifier: `${actorId}|${action}`,
        maxRequests: 30,
        windowSeconds: 60,
        supabase,
      });
      const { data: actor, error: actorError } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("id", actorId)
        .maybeSingle();
      if (actorError || !actor?.id) {
        throw new HttpError(actorError?.message || "Actor not found.", 403, {
          reason: "actor_not_found",
        });
      }
      const actorRole = String(actor.role || "").trim().toLowerCase();
      if (!["admin", "supervisor"].includes(actorRole)) {
        throw new HttpError("Forbidden", 403, {
          reason: "actor_role_forbidden",
        });
      }
      const { data: row, error: rowError } = await supabase
        .from("cashout_payouts")
        .select("id, user_id, amount_cents, status, approval_status, recipient_provider_id")
        .eq("id", payoutId)
        .eq("provider", "checkbook")
        .maybeSingle();
      if (rowError || !row?.id) throw new HttpError(rowError?.message || "Payout not found.", 404);
      if (
        String(row.status || "").toLowerCase() !== expectedStatus ||
        String(row.approval_status || "").toLowerCase() !== expectedApprovalStatus
      ) {
        throw new HttpError("Payout state changed. Refresh and retry.", 409, {
          reason: "concurrency_conflict",
        });
      }

      if (action === "reject") {
        await releaseReservedCashback(supabase, payoutId);
        await supabase
          .from("cashout_payouts")
          .update({
            status: "failed",
            approval_status: "rejected",
            provider_status: "admin_rejected",
            failure_reason: "Rejected by admin",
            released_by: actorId,
            released_at: new Date().toISOString(),
            processed_at: new Date().toISOString(),
          })
          .eq("id", payoutId)
          .eq("status", expectedStatus)
          .eq("approval_status", expectedApprovalStatus);
        return json({ ok: true, action: "reject", payoutId, status: "failed" }, 200);
      }

      let recipientId = String(row.recipient_provider_id || "").trim();
      const profile = await resolveProfile(supabase, String(row.user_id || "").trim());
      const payoutUserId = String(row.user_id || "").trim();
      const plaidState = await getPlaidCashoutLinkState(supabase, payoutUserId);
      const preferredAccountId = plaidState.selectedPlaidAccountActive
        ? plaidState.selectedPlaidAccountId || null
        : null;
      const resolvedRecipientId = await resolveCheckbookRecipientDestinationForTransfer(
        supabase,
        payoutUserId,
        recipientId,
        preferredAccountId,
        profile,
      );
      if (resolvedRecipientId) {
        recipientId = resolvedRecipientId;
      }
      if (!recipientId) {
        const fallbackResolution = await issueAwareResolve(row.recipient_provider_id || "");
        const issueCode = fallbackResolution.issueCode || "checkbook_destination_missing";
        throw new HttpError(
          formatIssueMessage(
            issueCode,
            "Missing linked bank destination for this payout.",
          ),
          400,
          { reason: issueCode },
        );
      }
      const reqId = await deriveUuidFromKey(`checkbook:approve:${payoutId}:${Date.now()}`);
      const amountDollars = Number(
        (Math.max(0, Number(row.amount_cents) || 0) / 100).toFixed(2),
      );
      const basePayload = {
        name: profile.fullName,
        amount: amountDollars,
        description: "Wello cashback transfer",
        metadata: {
          payoutId,
          userId: row.user_id,
          destination: recipientId,
        },
      };
      const buildDirectPayload = (currentRecipientId: string) => ({
        ...basePayload,
        recipient: profile.email,
        destination: currentRecipientId,
      });

      let upstream = await callCheckbookApi("/v3/check/digital", {
        method: "POST",
        headers: {
          "Idempotency-Key": reqId,
        },
        body: JSON.stringify(buildDirectPayload(recipientId)),
      });

      if (
        !upstream.response.ok &&
        isInvalidRecipientError(upstream.parsed, upstream.text)
      ) {
        const refreshed = await resolveCheckbookRecipientDestinationForTransfer(
          supabase,
          payoutUserId,
          recipientId,
          preferredAccountId,
          profile,
        );
        if (refreshed) {
          recipientId = refreshed;
          upstream = await callCheckbookApi("/v3/check/digital", {
            method: "POST",
            headers: {
              "Idempotency-Key": reqId,
            },
            body: JSON.stringify(buildDirectPayload(recipientId)),
          });
        }
      }

      if (!upstream.response.ok) {
        throw new HttpError(
          parseCheckbookError(upstream.parsed, upstream.text, upstream.response.status || null),
          upstream.response.status || 502,
          {
            reason: "checkbook_direct_payout_release_failed",
          },
        );
      }
      const checkObject = extractCheckObject(upstream.parsed);
      const fallbackCheckObject = extractFirstCheckObject(upstream.parsed);
      const providerOrderId = String(
        checkObject?.id ||
          checkObject?.check_id ||
          fallbackCheckObject?.id ||
          upstream.parsed?.id ||
          reqId,
      ).trim() || reqId;
      const providerReferenceId = String(
        checkObject?.number ||
          checkObject?.check_number ||
          fallbackCheckObject?.number ||
          recipientId,
      ).trim() || payoutId;
      const providerClaimUrl = String(
        checkObject?.deposit_url ||
          checkObject?.claim_url ||
          checkObject?.url ||
          fallbackCheckObject?.deposit_url ||
          fallbackCheckObject?.url ||
          "",
      ).trim() || null;
      const providerStatus = String(
        checkObject?.status || fallbackCheckObject?.status || "unpaid",
      )
        .trim()
        .toLowerCase() || "unpaid";
      await supabase
        .from("cashout_payouts")
        .update({
          approval_status: "approved",
          provider_order_id: providerOrderId,
          provider_reward_id: providerReferenceId,
          provider_claim_url: providerClaimUrl,
          provider_status: providerStatus,
          recipient_provider_id: recipientId,
          released_by: actorId,
          released_at: new Date().toISOString(),
          failure_reason: null,
        })
        .eq("id", payoutId)
        .eq("status", expectedStatus)
        .eq("approval_status", expectedApprovalStatus);
      return json({
        ok: true,
        action: "approve",
        payoutId,
        providerOrderId,
        providerStatus,
        claimUrl: providerClaimUrl,
        status: "pending",
      }, 200);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message, ...(error.details || {}) }, error.status);
      }
      return json({ error: "Unable to process payout decision." }, 500);
    }
  };

export const createCheckbookWebhookHandler =
  (_options: BasicOptions) => async (req: Request) => {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    try {
      if (!CHECKBOOK_WEBHOOK_KEY) {
        throw new HttpError("Missing webhook configuration.", 500, {
          reason: "webhook_secret_missing",
        });
      }
      const rawBody = await req.text();
      let payload = {} as Record<string, unknown>;
      try {
        payload = (rawBody ? JSON.parse(rawBody) : {}) as Record<string, unknown>;
      } catch {
        throw new HttpError("Invalid webhook payload.", 400, {
          reason: "invalid_payload_json",
        });
      }
      const signatureHeader = String(
        req.headers.get("signature") ||
          req.headers.get("x-checkbook-signature") ||
          req.headers.get("x-signature") ||
          "",
      ).trim();
      const signatureFields = signatureHeader
        .split(",")
        .map((part) => String(part || "").trim())
        .reduce((acc, part) => {
          if (!part.includes("=") && !part.includes(":")) return acc;
          const separator = part.includes("=") ? "=" : ":";
          const [rawKey, ...rest] = part.split(separator);
          const key = String(rawKey || "").trim().toLowerCase();
          const value = String(rest.join(separator) || "").trim();
          if (key && value) acc[key] = value;
          return acc;
        }, {} as Record<string, string>);
      const nonce = String(
        signatureFields.nonce ||
          req.headers.get("x-checkbook-nonce") ||
          req.headers.get("x-nonce") ||
          "",
      ).trim();
      const signature = String(
        signatureFields.signature || signatureFields.sig || signatureFields.v1 || "",
      ).trim();
      if (!signature || !nonce) {
        throw new HttpError("Invalid webhook signature.", 401, {
          reason: "invalid_signature_headers",
        });
      }
      const nonceNumber = Math.trunc(Number(nonce));
      const timestamp = Number.isFinite(nonceNumber) ? nonceNumber : null;
      if (timestamp && timestamp > 0) {
        const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
        if (ageSeconds > CHECKBOOK_WEBHOOK_MAX_AGE_SECONDS) {
          throw new HttpError("Webhook signature expired.", 401, {
            reason: "stale_signature",
            ageSeconds,
          });
        }
      }

      const key = await crypto.subtle.importKey(
        "raw",
        textEncoder.encode(CHECKBOOK_WEBHOOK_KEY),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const signatureBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        textEncoder.encode(`${rawBody}${nonce}`),
      );
      const expectedHex = toHex(signatureBuffer).toLowerCase();
      const expectedBase64 = btoa(
        String.fromCharCode(...new Uint8Array(signatureBuffer)),
      );
      const normalizedSignature = signature.trim();
      const signatureOk =
        constantTimeEqual(normalizedSignature.toLowerCase(), expectedHex) ||
        constantTimeEqual(normalizedSignature, expectedBase64);
      if (!signatureOk) {
        throw new HttpError("Invalid webhook signature.", 401, {
          reason: "signature_verification_failed",
        });
      }

      const deliveryId = String(
        req.headers.get("x-webhook-id") ||
          req.headers.get("x-request-id") ||
          `${String(payload?.id || "event")}:${nonce}`,
      ).trim();
      if (!deliveryId) {
        throw new HttpError("Invalid webhook payload.", 400, {
          reason: "missing_delivery_id",
        });
      }
      const eventType = String(
        payload?.event ||
          payload?.type ||
          payload?.event_type ||
          payload?.status ||
          "check.updated",
      ).trim().toLowerCase();

      const supabase = createAdminSupabase();
      const requestBodySha256 = await sha256Hex(rawBody);
      const { error: insertError } = await supabase
        .from("checkbook_webhook_events")
        .insert({
          delivery_id: deliveryId,
          event_type: eventType,
          signature_timestamp: timestamp,
          request_body_sha256: requestBodySha256,
        });
      const insertCode = String((insertError as { code?: string })?.code || "");
      if (insertError && insertCode !== "23505") {
        throw new HttpError(insertError.message || "Unable to persist webhook event.", 500, {
          reason: "webhook_event_persist_failed",
        });
      }
      if (insertCode === "23505") return json({ received: true, duplicate: true }, 200);
      const dataObj = (payload?.data &&
          typeof payload.data === "object" &&
          !Array.isArray(payload.data)
        ? payload.data
        : payload?.body &&
            typeof payload.body === "object" &&
            !Array.isArray(payload.body)
          ? payload.body
          : null) as Record<string, unknown> | null;
      const providerOrderId = String(
        payload?.id ||
        dataObj?.id ||
          dataObj?.check_id ||
          payload?.check_id ||
          "",
      ).trim();
      const providerRewardId = String(
        dataObj?.number ||
          dataObj?.check_number ||
          payload?.number ||
          payload?.check_number ||
          "",
      ).trim();
      const providerStatus = String(
        payload?.status || dataObj?.status || "",
      ).trim().toLowerCase();
      let payoutId: string | null = null;
      if (providerOrderId) {
        const { data } = await supabase
          .from("cashout_payouts")
          .select("id")
          .eq("provider", "checkbook")
          .eq("provider_order_id", providerOrderId)
          .maybeSingle();
        payoutId = data?.id ? String(data.id) : null;
      }
      if (!payoutId && providerRewardId) {
        const { data } = await supabase
          .from("cashout_payouts")
          .select("id")
          .eq("provider", "checkbook")
          .eq("provider_reward_id", providerRewardId)
          .maybeSingle();
        payoutId = data?.id ? String(data.id) : null;
      }
      if (!payoutId) {
        await supabase
          .from("checkbook_webhook_events")
          .update({ processed: true, processed_at: new Date().toISOString() })
          .eq("delivery_id", deliveryId);
        return json({ received: true, processed: true, reason: "payout_not_found" }, 200);
      }
      if (isSuccessLike(providerStatus) || isSuccessLike(eventType)) {
        await supabase
          .from("cashout_payouts")
          .update({
            status: "paid",
            provider_status: providerStatus || eventType,
            failure_reason: null,
            processed_at: new Date().toISOString(),
          })
          .eq("id", payoutId);
        await markPaidCashback(supabase, payoutId);
      } else if (isFailureLike(providerStatus) || isFailureLike(eventType)) {
        await supabase
          .from("cashout_payouts")
          .update({
            status: "failed",
            provider_status: providerStatus || eventType,
            failure_reason: `Checkbook event: ${eventType}`,
            processed_at: new Date().toISOString(),
          })
          .eq("id", payoutId);
        await releaseReservedCashback(supabase, payoutId);
      } else {
        await supabase
          .from("cashout_payouts")
          .update({ provider_status: providerStatus || eventType })
          .eq("id", payoutId);
      }
      await supabase
        .from("checkbook_webhook_events")
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq("delivery_id", deliveryId);
      return json({ received: true, processed: true }, 200);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message, ...(error.details || {}) }, error.status);
      }
      return json({ error: "Unable to process webhook." }, 500);
    }
  };
