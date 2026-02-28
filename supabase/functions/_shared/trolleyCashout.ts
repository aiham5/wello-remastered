import {
  authenticateRequest,
  createAdminSupabase,
  HttpError,
  json,
} from "./auth.ts";

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

const TROLLEY_API_BASE = envString("TROLLEY_API_BASE").replace(/\/+$/, "");
const TROLLEY_ACCESS_KEY = envString("TROLLEY_ACCESS_KEY");
const TROLLEY_SECRET_KEY = envString("TROLLEY_SECRET_KEY");
const TROLLEY_AUTH_MODE = envString("TROLLEY_AUTH_MODE", "prsign")
  .toLowerCase();
const TROLLEY_ONBOARDING_URL_TEMPLATE = envString(
  "TROLLEY_ONBOARDING_URL_TEMPLATE",
);
const TROLLEY_BANK_ONBOARDING_RETURN_URL = envString(
  "TROLLEY_BANK_ONBOARDING_RETURN_URL",
);
const TROLLEY_WEBHOOK_SECRET = envString("TROLLEY_WEBHOOK_SECRET");
const TROLLEY_WEBHOOK_MAX_AGE_SECONDS = Math.max(
  Math.trunc(envNumber("TROLLEY_WEBHOOK_MAX_AGE_SECONDS", 300)),
  30,
);
const TROLLEY_CASHOUT_MIN_CENTS = Math.max(
  Math.trunc(envNumber("TROLLEY_CASHOUT_MIN_CENTS", 1000)),
  100,
);
const TROLLEY_CASHOUT_MAX_CENTS = Math.max(
  Math.trunc(envNumber("TROLLEY_CASHOUT_MAX_CENTS", 100000)),
  TROLLEY_CASHOUT_MIN_CENTS,
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
const buildIdempotencyKey = () => `legacy_${crypto.randomUUID()}`;

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

const ensureTrolleyCredentials = () => {
  if (!TROLLEY_API_BASE || !TROLLEY_ACCESS_KEY || !TROLLEY_SECRET_KEY) {
    throw new HttpError("Missing Trolley configuration.", 500, {
      reason: "trolley_credentials_missing",
      missing: {
        TROLLEY_API_BASE: !TROLLEY_API_BASE,
        TROLLEY_ACCESS_KEY: !TROLLEY_ACCESS_KEY,
        TROLLEY_SECRET_KEY: !TROLLEY_SECRET_KEY,
      },
    });
  }
};

const buildAuthHeaders = async (method: string, path: string, body: string) => {
  if (TROLLEY_AUTH_MODE === "prsign") {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const canonical = `${timestamp}\n${method.toUpperCase()}\n${path}\n${body}`;
    const key = await crypto.subtle.importKey(
      "raw",
      textEncoder.encode(TROLLEY_SECRET_KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      textEncoder.encode(canonical),
    );
    const signature = toHex(signatureBuffer).toLowerCase();
    return {
      authorization: `prsign ${TROLLEY_ACCESS_KEY}:${signature}`,
      "x-pr-timestamp": timestamp,
    };
  }
  if (TROLLEY_AUTH_MODE === "bearer") {
    return {
      authorization: `Bearer ${TROLLEY_SECRET_KEY}`,
      "x-api-key": TROLLEY_ACCESS_KEY,
    };
  }
  return {
    authorization: `Basic ${btoa(`${TROLLEY_ACCESS_KEY}:${TROLLEY_SECRET_KEY}`)}`,
  };
};

const callTrolleyApi = async (path: string, init: RequestInit = {}) => {
  ensureTrolleyCredentials();
  const body = typeof init.body === "string"
    ? init.body
    : init.body
      ? JSON.stringify(init.body)
      : "";
  const authHeaders = await buildAuthHeaders(
    String(init.method || "GET"),
    path,
    body,
  );
  const response = await fetch(`${TROLLEY_API_BASE}${path}`, {
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

const parseTrolleyError = (
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
  if (candidate) return `Trolley API error${statusPart}: ${sanitizeError(candidate)}`;
  const compact = sanitizeError(text).replace(/\s+/g, " ").slice(0, 220);
  if (compact) return `Trolley API error${statusPart}: ${compact}`;
  return `Trolley API error${statusPart}.`;
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

const extractPayoutObject = (parsed: Record<string, unknown>) => {
  const object = getPath(parsed, ["payment"]) ||
    getPath(parsed, ["payout"]) ||
    getPath(parsed, ["batch"]) ||
    getPath(parsed, ["data"]) ||
    parsed;
  if (!object || typeof object !== "object" || Array.isArray(object)) return {};
  return object as Record<string, unknown>;
};

const extractFirstPaymentObject = (parsed: Record<string, unknown>) => {
  const candidates = [
    parsed?.payments,
    getPath(parsed, ["batch", "payments"]),
    getPath(parsed, ["data", "payments"]),
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

const getOrCreateRecipient = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
  email: string,
  fullName: string,
) => {
  const { data: existing } = await supabase
    .from("cashout_recipients")
    .select("recipient_provider_id, recipient_status, bank_summary")
    .eq("user_id", userId)
    .eq("provider", "trolley")
    .maybeSingle();
  if (existing?.recipient_provider_id) {
    return {
      recipientId: String(existing.recipient_provider_id),
      recipientStatus: String(existing.recipient_status || "").trim().toLowerCase() || "needs_onboarding",
      bankSummary: String(existing.bank_summary || "").trim() || null,
    };
  }
  const { firstName, lastName } = splitFullName(fullName);
  const createRes = await callTrolleyApi("/v1/recipients", {
    method: "POST",
    body: JSON.stringify({
      type: "individual",
      firstName,
      lastName,
      email,
      referenceId: userId,
    }),
  });
  if (!createRes.response.ok) {
    throw new HttpError(
      parseTrolleyError(createRes.parsed, createRes.text, createRes.response.status || null),
      createRes.response.status || 502,
      { reason: "trolley_recipient_create_failed" },
    );
  }
  const recipientId = extractRecipientId(createRes.parsed);
  if (!recipientId) {
    throw new HttpError("Trolley did not return a recipient id.", 502, {
      reason: "trolley_recipient_missing_id",
    });
  }
  await supabase.from("cashout_recipients").upsert(
    {
      user_id: userId,
      provider: "trolley",
      recipient_provider_id: recipientId,
      recipient_status: "needs_onboarding",
      bank_summary: null,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  return { recipientId, recipientStatus: "needs_onboarding", bankSummary: null };
};

const createOnboardingUrl = async (
  recipientId: string,
  userId: string,
  email: string,
) => {
  if (TROLLEY_ONBOARDING_URL_TEMPLATE) {
    return TROLLEY_ONBOARDING_URL_TEMPLATE
      .replaceAll("{recipientId}", encodeURIComponent(recipientId))
      .replaceAll("{userId}", encodeURIComponent(userId))
      .replaceAll("{email}", encodeURIComponent(email));
  }
  const payload: Record<string, unknown> = {};
  if (TROLLEY_BANK_ONBOARDING_RETURN_URL) {
    payload.returnUrl = TROLLEY_BANK_ONBOARDING_RETURN_URL;
    payload.redirectUrl = TROLLEY_BANK_ONBOARDING_RETURN_URL;
  }
  const linkRes = await callTrolleyApi(
    `/v1/recipients/${encodeURIComponent(recipientId)}/onboarding-links`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  if (!linkRes.response.ok) {
    throw new HttpError(
      parseTrolleyError(linkRes.parsed, linkRes.text, linkRes.response.status || null),
      linkRes.response.status || 502,
      { reason: "trolley_onboarding_link_failed" },
    );
  }
  const linkUrl = extractOnboardingUrl(linkRes.parsed);
  if (!linkUrl) {
    throw new HttpError("Trolley onboarding URL was not returned.", 502, {
      reason: "trolley_onboarding_link_missing",
    });
  }
  return linkUrl;
};

export const createTrolleyBankLinkHandler =
  (_options: BasicOptions) => async (req: Request) => {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    try {
      const { userId } = await authenticateRequest(req);
      const supabase = createAdminSupabase();
      const profile = await resolveProfile(supabase, userId);
      const recipient = await getOrCreateRecipient(
        supabase,
        userId,
        profile.email,
        profile.fullName,
      );
      if (recipient.recipientStatus === "linked" && recipient.bankSummary) {
        return json({
          ok: true,
          status: "linked",
          onboardingUrl: null,
          recipientId: recipient.recipientId,
          bankSummary: recipient.bankSummary,
        }, 200);
      }
      const onboardingUrl = await createOnboardingUrl(
        recipient.recipientId,
        userId,
        profile.email,
      );
      await supabase
        .from("cashout_recipients")
        .update({
          recipient_status: "needs_onboarding",
          last_synced_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("provider", "trolley");
      return json({
        ok: true,
        status: "needs_onboarding",
        onboardingUrl,
        recipientId: recipient.recipientId,
        bankSummary: recipient.bankSummary,
      }, 200);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message, ...(error.details || {}) }, error.status);
      }
      return json({ error: "Unable to prepare bank transfer setup." }, 500);
    }
  };

export const createTrolleyCashoutHandler =
  (options: CreateOptions) => async (req: Request) => {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const supabase = createAdminSupabase();
    let payoutId: string | null = null;
    try {
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
      if (amountCents < TROLLEY_CASHOUT_MIN_CENTS) {
        throw new HttpError(
          `Minimum cashout is $${(TROLLEY_CASHOUT_MIN_CENTS / 100).toFixed(2)}.`,
          400,
          { reason: "minimum_cashout_not_met", minimumCashoutCents: TROLLEY_CASHOUT_MIN_CENTS },
        );
      }
      if (amountCents > TROLLEY_CASHOUT_MAX_CENTS) {
        throw new HttpError(
          `Maximum cashout is $${(TROLLEY_CASHOUT_MAX_CENTS / 100).toFixed(2)}.`,
          400,
          { reason: "maximum_cashout_exceeded", maximumCashoutCents: TROLLEY_CASHOUT_MAX_CENTS },
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
        .eq("provider", "trolley")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existingError) throw new HttpError(existingError.message, 500);
      if (existing?.id) {
        return json({
          success: true,
          provider: "trolley",
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
        .eq("provider", "trolley")
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
      const windowInfo = await ensureWeeklyLimit(supabase, userId);
      const { data: inserted, error: insertError } = await supabase
        .from("cashout_payouts")
        .insert({
          user_id: userId,
          stripe_account_id: "trolley_cashout",
          provider: "trolley",
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
        provider: "trolley",
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

export const createTrolleyAdminDecisionHandler =
  (_options: BasicOptions) => async (req: Request) => {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    try {
      if (!CASHOUT_ADMIN_DECISION_SECRET) {
        throw new HttpError("Missing admin decision secret.", 500, {
          reason: "admin_secret_missing",
        });
      }
      const provided = String(req.headers.get("x-admin-decision-secret") || "").trim();
      if (!provided || !constantTimeEqual(provided, CASHOUT_ADMIN_DECISION_SECRET)) {
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
      const supabase = createAdminSupabase();
      const { data: row, error: rowError } = await supabase
        .from("cashout_payouts")
        .select("id, amount_cents, status, approval_status, recipient_provider_id")
        .eq("id", payoutId)
        .eq("provider", "trolley")
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
      const reqId = await deriveUuidFromKey(`approve:${payoutId}:${Date.now()}`);
      const sourceAmount = Number(
        (Math.max(0, Number(row.amount_cents) || 0) / 100).toFixed(2),
      );
      const upstream = await callTrolleyApi("/v1/batches", {
        method: "POST",
        body: JSON.stringify({
          sourceCurrency: "USD",
          description: "Wello cashback transfer",
          externalId: reqId,
          payments: [
            {
              recipient: { id: recipientId },
              sourceAmount,
              sourceCurrency: "USD",
              referenceId: payoutId,
              memo: "Wello cashback transfer",
            },
          ],
        }),
      });
      if (!upstream.response.ok) {
        throw new HttpError(
          parseTrolleyError(upstream.parsed, upstream.text, upstream.response.status || null),
          upstream.response.status || 502,
          { reason: "trolley_payout_release_failed" },
        );
      }
      const batchObject = extractPayoutObject(upstream.parsed);
      const paymentObject = extractFirstPaymentObject(upstream.parsed);
      const batchId = String(
        batchObject?.id || upstream.parsed?.id || "",
      ).trim();
      if (batchId) {
        const startProcessing = await callTrolleyApi(
          `/v1/batches/${encodeURIComponent(batchId)}/start-processing`,
          {
            method: "POST",
            body: JSON.stringify({}),
          },
        );
        if (!startProcessing.response.ok) {
          throw new HttpError(
            parseTrolleyError(
              startProcessing.parsed,
              startProcessing.text,
              startProcessing.response.status || null,
            ),
            startProcessing.response.status || 502,
            { reason: "trolley_batch_start_failed" },
          );
        }
      }
      const providerOrderId = String(
        paymentObject?.id ||
          paymentObject?.paymentId ||
          batchId ||
          reqId,
      ).trim() || reqId;
      const providerReferenceId = String(
        paymentObject?.referenceId ||
          paymentObject?.reference ||
          payoutId,
      ).trim() || payoutId;
      const providerStatus = String(
        paymentObject?.status || batchObject?.status || "submitted",
      )
        .trim()
        .toLowerCase() || "submitted";
      await supabase
        .from("cashout_payouts")
        .update({
          approval_status: "approved",
          provider_order_id: providerOrderId,
          provider_reward_id: providerReferenceId,
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
        status: "pending",
      }, 200);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message, ...(error.details || {}) }, error.status);
      }
      return json({ error: "Unable to process payout decision." }, 500);
    }
  };

export const createTrolleyWebhookHandler =
  (_options: BasicOptions) => async (req: Request) => {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    try {
      if (!TROLLEY_WEBHOOK_SECRET) {
        throw new HttpError("Missing webhook configuration.", 500, {
          reason: "webhook_secret_missing",
        });
      }
      const rawBody = await req.text();
      const payload = (rawBody ? JSON.parse(rawBody) : {}) as Record<
        string,
        unknown
      >;
      const signatureHeader = String(
        req.headers.get("x-paymentrails-signature") ||
          req.headers.get("x-trolley-signature") ||
          req.headers.get("webhook-signature") ||
          req.headers.get("x-signature") ||
          "",
      ).trim();
      const deliveryId = String(
        req.headers.get("x-paymentrails-delivery") ||
          req.headers.get("x-trolley-delivery-id") ||
          req.headers.get("x-webhook-id") ||
          req.headers.get("svix-id") ||
          payload?.id ||
          "",
      ).trim();
      const signatureFields = signatureHeader
        .split(",")
        .map((part) => String(part || "").trim())
        .reduce((acc, part) => {
          if (!part.includes("=")) return acc;
          const [rawKey, ...rest] = part.split("=");
          const key = String(rawKey || "").trim().toLowerCase();
          const value = String(rest.join("=") || "").trim();
          if (key && value) acc[key] = value;
          return acc;
        }, {} as Record<string, string>);
      const timestamp = Math.trunc(
        Number(
          signatureFields.t ||
            req.headers.get("x-paymentrails-timestamp") ||
            req.headers.get("x-trolley-timestamp") ||
            req.headers.get("webhook-timestamp") ||
            req.headers.get("x-timestamp") ||
            "0",
        ),
      );
      const signature = String(
        signatureFields.v1 || signatureFields.sig || signatureHeader,
      ).trim();
      const model = String(
        payload?.model || payload?.event || payload?.type || "event",
      )
        .trim()
        .toLowerCase();
      const action = String(
        payload?.action || payload?.event_type || payload?.status || "",
      )
        .trim()
        .toLowerCase();
      const eventType = [model, action].filter(Boolean).join(".") || "unknown";
      if (!deliveryId) throw new HttpError("Invalid webhook payload.", 400, { reason: "missing_delivery_id" });
      if (!signature || !Number.isFinite(timestamp) || timestamp <= 0) {
        throw new HttpError("Invalid webhook signature.", 401, {
          reason: "invalid_signature_headers",
        });
      }
      const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
      if (ageSeconds > TROLLEY_WEBHOOK_MAX_AGE_SECONDS) {
        throw new HttpError("Webhook signature expired.", 401, {
          reason: "stale_signature",
          ageSeconds,
        });
      }
      const key = await crypto.subtle.importKey(
        "raw",
        textEncoder.encode(TROLLEY_WEBHOOK_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const signatureBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        textEncoder.encode(`${timestamp}${rawBody}`),
      );
      const expected = toHex(signatureBuffer);
      if (!constantTimeEqual(signature.toLowerCase(), expected.toLowerCase())) {
        throw new HttpError("Invalid webhook signature.", 401, {
          reason: "signature_verification_failed",
        });
      }
      const supabase = createAdminSupabase();
      const requestBodySha256 = await sha256Hex(rawBody);
      const { error: insertError } = await supabase
        .from("trolley_webhook_events")
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
      const dataObj = (payload?.body && typeof payload.body === "object" &&
          !Array.isArray(payload.body)
        ? payload.body
        : getPath(payload, ["data"])) as Record<string, unknown> | null;
      const paymentObj = (dataObj?.payment &&
          typeof dataObj.payment === "object" &&
          !Array.isArray(dataObj.payment)
        ? dataObj.payment
        : null) as Record<string, unknown> | null;
      const providerOrderId = String(
        paymentObj?.id ||
          dataObj?.id ||
          dataObj?.paymentId ||
          payload?.paymentId ||
          payload?.id ||
          "",
      ).trim();
      const providerRewardId = String(
        paymentObj?.referenceId ||
          paymentObj?.externalId ||
          dataObj?.transferId ||
          dataObj?.referenceId ||
          payload?.referenceId ||
          "",
      ).trim();
      const providerStatus = String(
        paymentObj?.status || dataObj?.status || payload?.status || action || "",
      ).trim().toLowerCase();
      let payoutId: string | null = null;
      if (providerOrderId) {
        const { data } = await supabase
          .from("cashout_payouts")
          .select("id")
          .eq("provider", "trolley")
          .eq("provider_order_id", providerOrderId)
          .maybeSingle();
        payoutId = data?.id ? String(data.id) : null;
      }
      if (!payoutId && providerRewardId) {
        const { data } = await supabase
          .from("cashout_payouts")
          .select("id")
          .eq("provider", "trolley")
          .eq("provider_reward_id", providerRewardId)
          .maybeSingle();
        payoutId = data?.id ? String(data.id) : null;
      }
      if (!payoutId) {
        await supabase
          .from("trolley_webhook_events")
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
            failure_reason: `Trolley event: ${eventType}`,
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
        .from("trolley_webhook_events")
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
