import {
  authenticateRequest,
  createAdminSupabase,
  HttpError,
  json,
  SUPABASE_SERVICE_ROLE_KEY,
} from "./auth.ts";
import {
  plaidCreateLinkToken,
  plaidCreateProcessorToken,
  plaidExchangePublicToken,
  plaidGetAccounts,
  plaidGetAuthNumbers,
  plaidGetInstitutionById,
  plaidGetItem,
} from "./plaid.ts";

type CreateOptions = { endpointName: string; requireIdempotencyKey: boolean };
type BasicOptions = { endpointName: string };

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
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
const CASHOUT_WEEKLY_LIMIT_ENABLED = envFlag(
  "CASHOUT_WEEKLY_LIMIT_ENABLED",
  true,
);
const CASHOUT_WEEKLY_LIMIT_MAX = Math.max(
  Math.trunc(envNumber("CASHOUT_WEEKLY_LIMIT_MAX", 2)),
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
const splitFullName = (value: string) => {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "Wello", lastName: "User" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "User" };
  return {
    firstName: parts.slice(0, -1).join(" ").slice(0, 80),
    lastName: parts.slice(-1).join(" ").slice(0, 80),
  };
};
const normalizePlaidAccountSubtype = (value: unknown) =>
  String(value || "").trim().toLowerCase();
const mapCheckbookAccountType = (subtype: string) =>
  subtype === "savings" ? "SAVINGS" : "CHECKING";
const pickPreferredPlaidAccount = (
  accounts: Array<Record<string, unknown>>,
  requestedAccountId: string,
) => {
  const normalizedRequested = String(requestedAccountId || "").trim();
  if (normalizedRequested) {
    const direct = accounts.find((account) =>
      String(account?.account_id || "").trim() === normalizedRequested
    );
    if (direct) return direct;
  }
  const preferred = accounts.find((account) => {
    const subtype = normalizePlaidAccountSubtype(account?.subtype);
    return subtype === "checking" || subtype === "savings";
  });
  return preferred || accounts[0] || null;
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

const getPath = (payload: Record<string, unknown>, keys: string[]) => {
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

const callCheckbookApi = async (path: string, init: RequestInit = {}) => {
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

const extractRecipientId = (parsed: Record<string, unknown>) =>
  String(
    parsed?.id ||
      getPath(parsed, ["recipient", "id"]) ||
      getPath(parsed, ["data", "id"]) ||
      "",
  ).trim() || null;

const extractOnboardingUrl = (parsed: Record<string, unknown>) =>
  String(
    parsed?.url ||
      getPath(parsed, ["link", "url"]) ||
      getPath(parsed, ["data", "url"]) ||
      getPath(parsed, ["onboarding", "url"]) ||
      "",
  ).trim() || null;

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

const ensureWeeklyLimit = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
) => {
  if (!CASHOUT_WEEKLY_LIMIT_ENABLED) {
    return {
      payoutsRemainingInWindow: null,
      payoutsUsedInWindow: null,
      nextEligibleAt: null,
      weeklyLimit: null,
    };
  }
  const windowStartIso = new Date(Date.now() - ONE_WEEK_MS).toISOString();
  const { data, error } = await supabase
    .from("cashout_payouts")
    .select("id, created_at")
    .eq("user_id", userId)
    .in("status", ["pending", "paid"])
    .gte("created_at", windowStartIso)
    .order("created_at", { ascending: true });
  if (error) throw new HttpError(error.message || "Unable to load cashout history.", 500);
  const rows = Array.isArray(data) ? data : [];
  if (rows.length >= CASHOUT_WEEKLY_LIMIT_MAX) {
    const oldestAt = Date.parse(String(rows[0]?.created_at || ""));
    const nextEligibleAt = Number.isFinite(oldestAt)
      ? new Date(oldestAt + ONE_WEEK_MS).toISOString()
      : new Date(Date.now() + ONE_WEEK_MS).toISOString();
    throw new HttpError(
      `Cashout is limited to ${CASHOUT_WEEKLY_LIMIT_MAX} times per 7 days.`,
      429,
      {
        reason: "weekly_cashout_limit",
        nextEligibleAt,
        payoutsUsedInWindow: rows.length,
        payoutsRemainingInWindow: 0,
        weeklyLimit: CASHOUT_WEEKLY_LIMIT_MAX,
      },
    );
  }
  return {
    payoutsRemainingInWindow: Math.max(CASHOUT_WEEKLY_LIMIT_MAX - (rows.length + 1), 0),
    payoutsUsedInWindow: rows.length + 1,
    nextEligibleAt: null,
    weeklyLimit: CASHOUT_WEEKLY_LIMIT_MAX,
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
        .eq("status", "active"),
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

const upsertLinkedPlaidData = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
  itemId: string,
  accessToken: string,
  institutionId: string | null,
  institutionName: string | null,
  accounts: Array<Record<string, unknown>>,
) => {
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

const linkCheckbookRecipientFromPlaid = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
  profile: { email: string; fullName: string },
  payload: { publicToken: string; plaidAccountId: string | null },
) => {
  const exchange = await plaidExchangePublicToken(payload.publicToken);
  const item = await plaidGetItem(exchange.access_token);
  const accountsRes = await plaidGetAccounts(exchange.access_token);
  const accounts = (Array.isArray(accountsRes.accounts)
    ? accountsRes.accounts
    : []) as Array<Record<string, unknown>>;
  if (!accounts.length) {
    throw new HttpError("No bank account was shared from Plaid.", 400, {
      reason: "plaid_no_accounts",
    });
  }
  const selectedAccount = pickPreferredPlaidAccount(
    accounts,
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
    exchange.item_id,
    exchange.access_token,
    institutionId,
    institutionName,
    accounts,
  );

  const processor = await plaidCreateProcessorToken(
    exchange.access_token,
    plaidAccountId,
    CHECKBOOK_PLAID_PROCESSOR || "checkbook",
  );
  const processorToken = String(processor?.processor_token || "").trim();
  if (!processorToken) {
    throw new HttpError("Unable to prepare bank account for transfer.", 502, {
      reason: "plaid_processor_token_missing",
    });
  }

  const auth = await plaidGetAuthNumbers(exchange.access_token, plaidAccountId);
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

  const recipientId = String(
    iavResponse.parsed?.id ||
      getPath(iavResponse.parsed, ["bank_account", "id"]) ||
      getPath(iavResponse.parsed, ["account", "id"]) ||
      getPath(iavResponse.parsed, ["data", "id"]) ||
      "",
  ).trim() || await deriveUuidFromKey(`checkbook:${userId}:${plaidAccountId}`);

  await supabase
    .from("cashout_recipients")
    .upsert(
      {
        user_id: userId,
        provider: "checkbook",
        recipient_provider_id: recipientId,
        recipient_status: "linked",
        bank_summary: bankSummary || "Linked via Plaid",
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  await supabase
    .from("profiles")
    .update({
      stripe_cashout_plaid_item_id: exchange.item_id,
      stripe_cashout_plaid_account_id: plaidAccountId,
      stripe_cashout_account_label: bankSummary || "Linked via Plaid",
      stripe_cashout_bank_synced_at: new Date().toISOString(),
    })
    .eq("id", userId);

  return {
    recipientId,
    bankSummary: bankSummary || "Linked via Plaid",
  };
};

export const createCheckbookBankLinkHandler =
  (_options: BasicOptions) => async (req: Request) => {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    try {
      ensureCheckbookCredentials();
      const { userId, body } = await authenticateRequest(req);
      const supabase = createAdminSupabase();
      const profile = await resolveProfile(supabase, userId);
      const existing = await getExistingRecipient(supabase, userId);
      const plaidState = await getPlaidCashoutLinkState(supabase, userId);
      const publicToken = String(
        body?.publicToken || body?.public_token || "",
      ).trim();
      const plaidAccountId = String(
        body?.plaidAccountId || body?.plaid_account_id || body?.accountId || "",
      ).trim() || null;
      const forceRelink = /^(1|true|yes|on)$/i.test(
        String(body?.forceRelink || body?.force_relink || "").trim(),
      );

      if (
        !publicToken &&
        !forceRelink &&
        existing.recipientId &&
        ["linked", "verified", "active"].includes(existing.recipientStatus) &&
        plaidState.hasActivePlaidAccount
      ) {
        return json({
          ok: true,
          status: "linked",
          linkToken: null,
          recipientId: existing.recipientId,
          bankSummary: existing.bankSummary,
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
      const recipient = await supabase
        .from("cashout_recipients")
        .select("recipient_provider_id, recipient_status, bank_summary")
        .eq("user_id", userId)
        .eq("provider", "checkbook")
        .maybeSingle();
      if (!recipient.data?.recipient_provider_id) {
        throw new HttpError("Link a bank account before requesting bank transfer cashout.", 400, {
          reason: "bank_not_linked",
        });
      }
      const recipientStatus = String(recipient.data?.recipient_status || "")
        .trim()
        .toLowerCase();
      if (!["linked", "verified", "active"].includes(recipientStatus)) {
        throw new HttpError("Complete bank setup before requesting bank transfer cashout.", 400, {
          reason: "bank_setup_incomplete",
        });
      }
      const plaidState = await getPlaidCashoutLinkState(supabase, userId);
      if (!plaidState.hasActivePlaidAccount) {
        throw new HttpError("Link a bank account with Plaid before requesting bank transfer cashout.", 400, {
          reason: "bank_not_linked",
        });
      }
      if (
        plaidState.selectedPlaidAccountId &&
        !plaidState.selectedPlaidAccountActive
      ) {
        throw new HttpError("Complete bank setup before requesting bank transfer cashout.", 400, {
          reason: "bank_setup_incomplete",
        });
      }
      const windowInfo = await ensureWeeklyLimit(supabase, userId);
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
          recipient_provider_id: String(recipient.data?.recipient_provider_id || ""),
          bank_summary: String(recipient.data?.bank_summary || "").trim() || null,
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

      const recipientId = String(row.recipient_provider_id || "").trim();
      if (!recipientId) {
        throw new HttpError("Missing linked recipient for this payout.", 400, {
          reason: "missing_recipient",
        });
      }
      const profile = await resolveProfile(supabase, String(row.user_id || "").trim());
      const reqId = await deriveUuidFromKey(`checkbook:approve:${payoutId}:${Date.now()}`);
      const amountDollars = Number(
        (Math.max(0, Number(row.amount_cents) || 0) / 100).toFixed(2),
      );
      const upstream = await callCheckbookApi("/v3/check/digital", {
        method: "POST",
        headers: {
          "Idempotency-Key": reqId,
        },
        body: JSON.stringify({
          name: profile.fullName,
          recipient: profile.email,
          amount: amountDollars,
          description: "Wello cashback transfer",
          metadata: {
            payoutId,
            userId: row.user_id,
            recipientId,
          },
        }),
      });
      if (!upstream.response.ok) {
        throw new HttpError(
          parseCheckbookError(upstream.parsed, upstream.text, upstream.response.status || null),
          upstream.response.status || 502,
          { reason: "checkbook_payout_release_failed" },
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
