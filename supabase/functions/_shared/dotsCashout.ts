import {
  authenticateRequest,
  createAdminSupabase,
  HttpError,
  json,
} from "./auth.ts";

type DotsCashoutHandlerOptions = {
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

const DOTS_CLIENT_ID = envString("DOTS_CLIENT_ID", "DOTS_CLIENT_ID");
const DOTS_API_KEY = normalizeSecretValue(
  String(Deno.env.get("DOTS_API_KEY") || ""),
);
const DOTS_APP_ID = envString("DOTS_APP_ID", "DOTS_APP_ID");
const DOTS_BASE_URL = envString(
  "DOTS_BASE_URL",
  "DOTS_BASE_URL",
  "https://pls.senddotssandbox.com/api",
).replace(/\/+$/, "");
const DOTS_CASHOUT_ENABLED = envFlag(
  "DOTS_CASHOUT_ENABLED",
  "DOTS_CASHOUT_ENABLED",
  true,
);
const DOTS_CASHOUT_SOURCE_NAME = envString(
  "DOTS_CASHOUT_SOURCE_NAME",
  "DOTS_CASHOUT_SOURCE_NAME",
  "Wello",
).slice(0, 80);
const DOTS_CASHOUT_MEMO = envString(
  "DOTS_CASHOUT_MEMO",
  "DOTS_CASHOUT_MEMO",
  "Wello cashback payout",
).slice(0, 120);
const DOTS_CASHOUT_COUNTRY_CODE = envString(
  "DOTS_CASHOUT_COUNTRY_CODE",
  "DOTS_CASHOUT_COUNTRY_CODE",
  "1",
)
  .trim()
  .replace(/^\+/, "") || "1";
const DOTS_CASHOUT_PAYOUT_FEE_PARTY = envString(
  "DOTS_CASHOUT_PAYOUT_FEE_PARTY",
  "DOTS_CASHOUT_PAYOUT_FEE_PARTY",
  "platform",
)
  .toLowerCase()
  .trim();
const DOTS_CASHOUT_MIN_CENTS = Math.max(
  Math.trunc(
    envNumber("DOTS_CASHOUT_MIN_CENTS", "TREMENDOUS_CASHOUT_MIN_CENTS", 1000),
  ),
  100,
);
const DOTS_CASHOUT_MAX_CENTS = Math.max(
  Math.trunc(
    envNumber("DOTS_CASHOUT_MAX_CENTS", "TREMENDOUS_CASHOUT_MAX_CENTS", 100000),
  ),
  DOTS_CASHOUT_MIN_CENTS,
);
const DOTS_FORCE_COLLECT_COMPLIANCE_INFORMATION = envFlag(
  "DOTS_FORCE_COLLECT_COMPLIANCE_INFORMATION",
  "DOTS_FORCE_COLLECT_COMPLIANCE_INFORMATION",
  true,
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

const toBasicAuthHeader = (clientId: string, apiKey: string) =>
  `Basic ${btoa(`${clientId}:${apiKey}`)}`;

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

const normalizePhoneNumber = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  if (cleaned.startsWith("+")) {
    const digits = `+${cleaned.slice(1).replace(/\D/g, "")}`;
    return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : "";
  }
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : "";
};

const toDotsPhone = (
  normalizedPhone: string,
  fallbackCountryCode: string,
): { countryCode: string; phoneNumber: string } | null => {
  const normalized = String(normalizedPhone || "").trim();
  const fallback = String(fallbackCountryCode || "1").replace(/\D/g, "") || "1";
  if (!normalized) return null;

  const digitsOnly = normalized.replace(/\D/g, "");
  if (!digitsOnly) return null;

  if (digitsOnly.length === 10) {
    return {
      countryCode: fallback,
      phoneNumber: digitsOnly,
    };
  }

  if (
    fallback === "1" && digitsOnly.length === 11 && digitsOnly.startsWith("1")
  ) {
    return {
      countryCode: "1",
      phoneNumber: digitsOnly.slice(1),
    };
  }

  if (
    normalized.startsWith("+") && digitsOnly.length > fallback.length + 6 &&
    digitsOnly.startsWith(fallback)
  ) {
    return {
      countryCode: fallback,
      phoneNumber: digitsOnly.slice(fallback.length),
    };
  }

  if (digitsOnly.length >= 8 && digitsOnly.length <= 15) {
    return {
      countryCode: fallback,
      phoneNumber: digitsOnly,
    };
  }

  return null;
};

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

const parseDotsErrorMessage = (
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
  const candidate = String(
    firstErrorRecord?.message ||
      firstErrorRecord?.detail ||
      firstErrorRecord?.reason ||
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
    return `Dots API error${statusPart}: ${redactSecrets(candidate)}`;
  }
  if (rawSnippet) return `Dots API error${statusPart}: ${rawSnippet}`;
  return `Dots API error${statusPart}.`;
};

const getDotsHeaders = () => {
  if (!DOTS_CLIENT_ID || !DOTS_API_KEY) {
    throw new HttpError("Missing Dots configuration.", 500, {
      reason: "dots_credentials_missing",
    });
  }
  return {
    "content-type": "application/json",
    authorization: toBasicAuthHeader(DOTS_CLIENT_ID, DOTS_API_KEY),
    ...(DOTS_APP_ID ? { "Api-App-Id": DOTS_APP_ID } : {}),
  };
};

const callDotsApi = async (
  path: string,
  init: RequestInit,
) => {
  const response = await fetch(`${DOTS_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...getDotsHeaders(),
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

const extractDotsPayoutObject = (payload: Record<string, unknown>) => {
  const nestedKeys = ["payout_link", "payoutLink", "payout", "data"];
  for (const key of nestedKeys) {
    const value = payload?.[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return payload;
};

const toPayoutResponse = (row: Record<string, unknown>) => ({
  success: true,
  provider: "dots",
  payoutId: String(row.id || "").trim(),
  orderId: String(row.provider_order_id || "").trim() || null,
  rewardId: String(row.provider_reward_id || "").trim() || null,
  claimUrl: String(row.provider_claim_url || "").trim() || null,
  amountCents: Math.max(0, Number(row.amount_cents) || 0),
  status: String(row.status || "pending").toLowerCase(),
  duplicate: true,
});

const buildIdempotencyKey = () => `legacy_${crypto.randomUUID()}`;

export const createDotsCashoutHandler = (
  options: DotsCashoutHandlerOptions,
) =>
async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = createAdminSupabase();
  let payoutId: string | null = null;
  let userId: string | null = null;
  let dotsPayoutId: string | null = null;
  let splitEventId: string | null = null;
  let splitOverage = 0;
  let adjustmentId: string | null = null;

  try {
    if (!DOTS_CASHOUT_ENABLED) {
      throw new HttpError("Cashout is currently unavailable.", 403, {
        reason: "dots_cashout_disabled",
      });
    }
    if (!DOTS_CLIENT_ID || !DOTS_API_KEY) {
      throw new HttpError("Missing Dots configuration.", 500, {
        reason: "dots_credentials_missing",
      });
    }

    if (options.enableDeprecationLog) {
      console.warn(
        `[${options.endpointName}] deprecated endpoint invoked; route clients to dots-create-cashout`,
      );
    }

    const { userId: authedUserId, body } = await authenticateRequest(req);
    userId = authedUserId;

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
    const dotsIdempotencyKey = await deriveUuidFromKey(
      `${userId}:${idempotencyKey}`,
    );

    const { data: existingPayout, error: existingPayoutError } = await supabase
      .from("cashout_payouts")
      .select(
        "id, amount_cents, status, provider_order_id, provider_reward_id, provider_claim_url",
      )
      .eq("user_id", userId)
      .eq("provider", "dots")
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
      .select("id, full_name, email, phone")
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

    const authMetadata = authUserRecord?.user_metadata &&
        typeof authUserRecord.user_metadata === "object"
      ? authUserRecord.user_metadata as Record<string, unknown>
      : {};
    const profilePhone = normalizePhoneNumber(profile?.phone);
    const authPhone = normalizePhoneNumber(authUserRecord?.phone);
    const authMetadataPhone = normalizePhoneNumber(
      authMetadata.phone_number || authMetadata.phone,
    );
    const recipientPhone = profilePhone || authPhone || authMetadataPhone;
    const dotsPhone = toDotsPhone(recipientPhone, DOTS_CASHOUT_COUNTRY_CODE);
    if (!dotsPhone) {
      throw new HttpError(
        "Add a valid phone number to your profile before cashing out.",
        400,
        {
          reason: "invalid_profile_phone",
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
    if (payoutAmountCents < DOTS_CASHOUT_MIN_CENTS) {
      throw new HttpError(
        `Minimum cashout is $${(DOTS_CASHOUT_MIN_CENTS / 100).toFixed(2)}.`,
        400,
        {
          reason: "minimum_cashout_not_met",
          minimumCashoutCents: DOTS_CASHOUT_MIN_CENTS,
        },
      );
    }
    if (payoutAmountCents > DOTS_CASHOUT_MAX_CENTS) {
      throw new HttpError(
        `Maximum cashout is $${(DOTS_CASHOUT_MAX_CENTS / 100).toFixed(2)}.`,
        400,
        {
          reason: "maximum_cashout_exceeded",
          maximumCashoutCents: DOTS_CASHOUT_MAX_CENTS,
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
        stripe_account_id: "dots_cashout",
        provider: "dots",
        amount_cents: payoutAmountCents,
        status: "pending",
        idempotency_key: idempotencyKey,
        provider_status: "payout_create_pending",
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
          .eq("provider", "dots")
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

    const payload = {
      amount: payoutAmountCents,
      payee: {
        first_name: firstName,
        last_name: lastName,
        email: recipientEmail,
        country_code: dotsPhone.countryCode,
        phone_number: dotsPhone.phoneNumber,
      },
      delivery: {
        method: "link",
        email: recipientEmail,
      },
      force_collect_compliance_information:
        DOTS_FORCE_COLLECT_COMPLIANCE_INFORMATION,
      metadata: JSON.stringify({
        wello_user_id: userId,
        payout_id: payoutId,
      }),
      memo: DOTS_CASHOUT_MEMO,
      idempotency_key: dotsIdempotencyKey,
      payout_fee_party: DOTS_CASHOUT_PAYOUT_FEE_PARTY,
      source_name: DOTS_CASHOUT_SOURCE_NAME,
    };

    const { response: upstream, text, parsed } = await callDotsApi(
      "/v2/payouts/send-payout",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
    if (!upstream.ok) {
      throw new HttpError(
        parseDotsErrorMessage(parsed, text, upstream.status || null),
        upstream.status || 502,
        {
          reason: "dots_api_error",
          upstreamStatus: upstream.status || null,
        },
      );
    }

    const payoutObject = extractDotsPayoutObject(parsed);
    dotsPayoutId = String(payoutObject?.id || "").trim() || null;
    const claimUrl = String(payoutObject?.link || "").trim() || null;
    const transferId = String(
      payoutObject?.transfer_id || payoutObject?.transferId || "",
    ).trim() || null;
    const flowId =
      String(payoutObject?.flow_id || payoutObject?.flowId || "").trim() ||
      null;
    const providerStatus = String(payoutObject?.status || "").trim()
      .toLowerCase();

    if (!dotsPayoutId) {
      throw new HttpError("Dots did not return a payout id.", 502, {
        reason: "missing_payout_id",
      });
    }

    const updatePayload = {
      provider_order_id: dotsPayoutId,
      provider_reward_id: transferId || flowId,
      provider_claim_url: claimUrl,
      provider_status: providerStatus || "payout_created",
      failure_reason: null,
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

    return json({
      success: true,
      provider: "dots",
      payoutId,
      orderId: dotsPayoutId,
      rewardId: transferId || flowId,
      claimUrl,
      amountCents: payoutAmountCents,
      availableCents,
      status: "pending",
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
    if (payoutId && !dotsPayoutId) {
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
