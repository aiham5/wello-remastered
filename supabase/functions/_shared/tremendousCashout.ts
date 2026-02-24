import {
  authenticateRequest,
  createAdminSupabase,
  HttpError,
  json,
} from "./auth.ts";

type TremendousCashoutHandlerOptions = {
  endpointName: string;
  requireIdempotencyKey: boolean;
  allowVirtualBalanceFallback: boolean;
  enableDeprecationLog?: boolean;
};

const normalizeTremendousApiKey = (rawValue: string) => {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";
  if (/^Bearer\s+/i.test(raw)) return raw.replace(/^Bearer\s+/i, "").trim();
  if (/^Basic\s+/i.test(raw)) {
    const encoded = raw.replace(/^Basic\s+/i, "").trim();
    try {
      const decoded = atob(encoded);
      return String(decoded.split(":")[0] || "").trim();
    } catch {
      return encoded;
    }
  }
  return raw;
};

const envFlag = (primary: string, fallback: string, defaultValue: boolean) => {
  const raw = String(
    Deno.env.get(primary) ?? Deno.env.get(fallback) ?? (defaultValue ? "true" : "false"),
  )
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

const envString = (primary: string, fallback: string, defaultValue = "") =>
  String(Deno.env.get(primary) ?? Deno.env.get(fallback) ?? defaultValue).trim();

const envNumber = (primary: string, fallback: string, defaultValue: number) => {
  const parsed = Number(Deno.env.get(primary) ?? Deno.env.get(fallback) ?? defaultValue);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

const TREMENDOUS_API_KEY = normalizeTremendousApiKey(
  String(Deno.env.get("TREMENDOUS_API_KEY") || ""),
);
const TREMENDOUS_BASE_URL = envString(
  "TREMENDOUS_BASE_URL",
  "TREMENDOUS_BASE_URL",
  "https://testflight.tremendous.com/api/v2",
).replace(/\/+$/, "");
const TREMENDOUS_CASHOUT_ENABLED = envFlag(
  "TREMENDOUS_CASHOUT_ENABLED",
  "TREMENDOUS_DEMO_ENABLED",
  true,
);
const TREMENDOUS_CASHOUT_FUNDING_SOURCE_ID = envString(
  "TREMENDOUS_CASHOUT_FUNDING_SOURCE_ID",
  "TREMENDOUS_DEMO_FUNDING_SOURCE_ID",
  "BALANCE",
);
const TREMENDOUS_CASHOUT_PRODUCT_ID = envString(
  "TREMENDOUS_CASHOUT_PRODUCT_ID",
  "TREMENDOUS_DEMO_PRODUCT_ID",
  "OKMHM2X2OHYV",
);
const TREMENDOUS_CASHOUT_CAMPAIGN_ID = envString(
  "TREMENDOUS_CASHOUT_CAMPAIGN_ID",
  "TREMENDOUS_DEMO_CAMPAIGN_ID",
);
const TREMENDOUS_CASHOUT_MESSAGE = envString(
  "TREMENDOUS_CASHOUT_MESSAGE",
  "TREMENDOUS_DEMO_MESSAGE",
  "Your Wello cashback is ready.",
).slice(0, 200);
const TREMENDOUS_CASHOUT_MIN_CENTS = Math.max(
  Math.trunc(envNumber("TREMENDOUS_CASHOUT_MIN_CENTS", "TREMENDOUS_DEMO_MIN_CENTS", 1000)),
  100,
);
const TREMENDOUS_CASHOUT_MAX_CENTS = Math.max(
  Math.trunc(envNumber("TREMENDOUS_CASHOUT_MAX_CENTS", "TREMENDOUS_DEMO_MAX_CENTS", 100000)),
  TREMENDOUS_CASHOUT_MIN_CENTS,
);
const TREMENDOUS_CASHOUT_VIRTUAL_BALANCE_CENTS = Math.max(
  Math.trunc(
    envNumber(
      "TREMENDOUS_CASHOUT_VIRTUAL_BALANCE_CENTS",
      "TREMENDOUS_DEMO_VIRTUAL_BALANCE_CENTS",
      5000,
    ),
  ),
  0,
);

const CASHOUT_WEEKLY_LIMIT_ENABLED = (() => {
  const raw = String(Deno.env.get("CASHOUT_WEEKLY_LIMIT_ENABLED") || "")
    .trim()
    .toLowerCase();
  if (!raw) return true;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
})();
const CASHOUT_WEEKLY_LIMIT_MAX = (() => {
  const raw = Math.trunc(Number(Deno.env.get("CASHOUT_WEEKLY_LIMIT_MAX") || "2"));
  if (!Number.isFinite(raw) || raw < 1) return 2;
  return raw;
})();

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const toBasicAuthHeader = (apiKey: string) => `Basic ${btoa(`${apiKey}:`)}`;
const toBearerAuthHeader = (apiKey: string) => `Bearer ${apiKey}`;

const redactSecrets = (value: string) =>
  String(value || "")
    .replace(/Basic\s+[A-Za-z0-9+/=._*\-]+/gi, "Basic [REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9+/=._*\-]+/gi, "Bearer [REDACTED]")
    .replace(/(sk_(?:test|live)_[A-Za-z0-9]+)/g, "sk_****")
    .replace(/(rk_(?:test|live)_[A-Za-z0-9]+)/g, "rk_****");

const normalizeEmail = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

const isLikelyValidEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

const parseTremendousErrorMessage = (
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
  const errorField = asRecord?.error;
  const errorFieldMessage =
    errorField && typeof errorField === "object"
      ? String((errorField as Record<string, unknown>)?.message || "").trim()
      : "";
  const candidate = String(
    firstErrorRecord?.message ||
      firstErrorRecord?.detail ||
      firstErrorRecord?.title ||
      asRecord?.message ||
      errorFieldMessage ||
      (typeof errorField === "string" ? errorField : ""),
  ).trim();
  const compactRaw = redactSecrets(String(rawBody || ""))
    .replace(/\s+/g, " ")
    .trim();
  const rawSnippet = compactRaw ? compactRaw.slice(0, 220) : "";
  const statusPart = Number.isFinite(Number(status)) && Number(status) > 0
    ? ` (${Number(status)})`
    : "";
  if (candidate) return `Tremendous API error${statusPart}: ${redactSecrets(candidate)}`;
  if (rawSnippet) return `Tremendous API error${statusPart}: ${rawSnippet}`;
  return `Tremendous API error${statusPart}.`;
};

const callTremendousOrdersApi = async (
  payload: Record<string, unknown>,
) => {
  const requestWithAuth = async (authorization: string) => {
    const response = await fetch(`${TREMENDOUS_BASE_URL}/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization,
      },
      body: JSON.stringify(payload),
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

  const bearer = await requestWithAuth(toBearerAuthHeader(TREMENDOUS_API_KEY));
  if (bearer.response.ok || bearer.response.status !== 401) return bearer;
  return await requestWithAuth(toBasicAuthHeader(TREMENDOUS_API_KEY));
};

const toPayoutResponse = (row: Record<string, unknown>) => ({
  success: true,
  provider: "tremendous",
  payoutId: String(row.id || "").trim(),
  orderId: String(row.provider_order_id || "").trim() || null,
  rewardId: String(row.provider_reward_id || "").trim() || null,
  claimUrl: String(row.provider_claim_url || "").trim() || null,
  amountCents: Math.max(0, Number(row.amount_cents) || 0),
  status: String(row.status || "pending").toLowerCase(),
  duplicate: true,
});

const buildIdempotencyKey = () => `legacy_${crypto.randomUUID()}`;

export const createTremendousCashoutHandler = (
  options: TremendousCashoutHandlerOptions,
) =>
  async (req: Request) => {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const supabase = createAdminSupabase();
    let payoutId: string | null = null;
    let userId: string | null = null;
    let tremendousOrderId: string | null = null;
    let splitEventId: string | null = null;
    let splitOverage = 0;
    let adjustmentId: string | null = null;
    let reserveIds: string[] = [];
    let usingVirtualBalance = false;

    try {
      if (!TREMENDOUS_CASHOUT_ENABLED) {
        throw new HttpError("Cashout is currently unavailable.", 403, {
          reason: "tremendous_cashout_disabled",
        });
      }
      if (!TREMENDOUS_API_KEY) {
        throw new HttpError("Missing Tremendous configuration.", 500, {
          reason: "tremendous_api_key_missing",
        });
      }
      if (!TREMENDOUS_CASHOUT_CAMPAIGN_ID && !TREMENDOUS_CASHOUT_PRODUCT_ID) {
        throw new HttpError("Missing Tremendous product configuration.", 500, {
          reason: "missing_product_or_campaign",
        });
      }

      if (options.enableDeprecationLog) {
        console.warn(
          `[${options.endpointName}] deprecated endpoint invoked; route clients to tremendous-create-cashout`,
        );
      }

      const { userId: authedUserId, body } = await authenticateRequest(req);
      userId = authedUserId;

      const requestedAmountCentsRaw =
        body?.amountCents ?? body?.amount_cents ?? body?.amount;
      const requestedAmountCents =
        requestedAmountCentsRaw == null || requestedAmountCentsRaw === ""
          ? null
          : Math.trunc(Number(requestedAmountCentsRaw));
      if (requestedAmountCents != null) {
        if (!Number.isFinite(requestedAmountCents) || requestedAmountCents <= 0) {
          throw new HttpError("Invalid amountCents.", 400, { reason: "invalid_amount" });
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

      const { data: existingPayout, error: existingPayoutError } = await supabase
        .from("cashout_payouts")
        .select(
          "id, amount_cents, status, provider_order_id, provider_reward_id, provider_claim_url",
        )
        .eq("user_id", userId)
        .eq("provider", "tremendous")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existingPayoutError) {
        throw new HttpError(
          existingPayoutError.message || "Unable to check existing payout request.",
          500,
        );
      }
      if (existingPayout?.id) {
        return json(toPayoutResponse(existingPayout as Record<string, unknown>), 200);
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("id", userId)
        .maybeSingle();
      if (profileError || !profile) {
        throw new HttpError(profileError?.message || "Profile not found.", 404);
      }

      const profileEmail = normalizeEmail(profile?.email);
      let recipientEmail = profileEmail;
      if (!isLikelyValidEmail(recipientEmail)) {
        const authUser = await supabase.auth.admin.getUserById(userId);
        const authEmail = normalizeEmail(authUser?.data?.user?.email);
        if (isLikelyValidEmail(authEmail)) recipientEmail = authEmail;
      }
      if (!isLikelyValidEmail(recipientEmail)) {
        throw new HttpError("Add a valid email to your profile before cashing out.", 400, {
          reason: "invalid_profile_email",
        });
      }
      const recipientName = String(profile?.full_name || "Wello User")
        .trim()
        .slice(0, 100) || "Wello User";

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
        if (payoutsRemainingInWindow <= 0) nextEligibleAtForWindow = computedNextEligibleAt;
      }

      const { data: availableEvents, error: eventsError } = await supabase
        .from("cashback_events")
        .select("id, amount_cents, business_id, created_at")
        .eq("user_id", userId)
        .eq("status", "available")
        .is("payout_id", null);
      if (eventsError) {
        throw new HttpError(eventsError.message || "Unable to load cashback balance.", 500);
      }

      const eventRows = Array.isArray(availableEvents) ? availableEvents : [];
      const realAvailableCents = eventRows.reduce(
        (sum, row) => sum + (Number(row.amount_cents) || 0),
        0,
      );
      const allowVirtualBalanceRequest = Boolean(
        body?.useVirtualBalance || body?.use_virtual_balance,
      );
      usingVirtualBalance =
        options.allowVirtualBalanceFallback &&
        allowVirtualBalanceRequest &&
        realAvailableCents <= 0 &&
        TREMENDOUS_CASHOUT_VIRTUAL_BALANCE_CENTS > 0;
      const availableCents = usingVirtualBalance
        ? TREMENDOUS_CASHOUT_VIRTUAL_BALANCE_CENTS
        : realAvailableCents;
      if (availableCents <= 0) {
        throw new HttpError("No cashback balance available.", 400, {
          reason: "no_cashback_balance",
        });
      }

      if (requestedAmountCents != null && requestedAmountCents > availableCents) {
        throw new HttpError("Requested amount exceeds available cashback balance.", 400, {
          reason: "amount_exceeds_available",
          availableCents,
        });
      }

      const payoutAmountCents =
        requestedAmountCents == null ? availableCents : requestedAmountCents;
      if (payoutAmountCents < TREMENDOUS_CASHOUT_MIN_CENTS) {
        throw new HttpError(
          `Minimum cashout is $${(TREMENDOUS_CASHOUT_MIN_CENTS / 100).toFixed(2)}.`,
          400,
          {
            reason: "minimum_cashout_not_met",
            minimumCashoutCents: TREMENDOUS_CASHOUT_MIN_CENTS,
          },
        );
      }
      if (payoutAmountCents > TREMENDOUS_CASHOUT_MAX_CENTS) {
        throw new HttpError(
          `Maximum cashout is $${(TREMENDOUS_CASHOUT_MAX_CENTS / 100).toFixed(2)}.`,
          400,
          {
            reason: "maximum_cashout_exceeded",
            maximumCashoutCents: TREMENDOUS_CASHOUT_MAX_CENTS,
          },
        );
      }

      const selected: Array<{ id: string; amount_cents: number; business_id: string | null }> =
        [];
      let selectedSum = payoutAmountCents;
      if (!usingVirtualBalance) {
        const sorted = [...eventRows].sort((a, b) => {
          const aMs = Date.parse(a?.created_at || "") || 0;
          const bMs = Date.parse(b?.created_at || "") || 0;
          return aMs - bMs;
        });

        selectedSum = 0;
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
      }

      const { data: payoutRow, error: payoutInsertError } = await supabase
        .from("cashout_payouts")
        .insert({
          user_id: userId,
          stripe_account_id: usingVirtualBalance
            ? "tremendous_cashout_virtual"
            : "tremendous_cashout",
          provider: "tremendous",
          amount_cents: payoutAmountCents,
          status: "pending",
          idempotency_key: idempotencyKey,
          provider_status: "order_create_pending",
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
            .eq("provider", "tremendous")
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();
          if (duplicatePayout?.id) {
            return json(toPayoutResponse(duplicatePayout as Record<string, unknown>), 200);
          }
        }
        throw new HttpError(payoutInsertError?.message || "Unable to create payout.", 500);
      }
      payoutId = payoutRow.id;

      reserveIds = selected.map((row) => row.id);
      if (!usingVirtualBalance && reserveIds.length) {
        const { error: reserveError } = await supabase
          .from("cashback_events")
          .update({ status: "reserved", payout_id: payoutId })
          .in("id", reserveIds)
          .eq("user_id", userId)
          .eq("status", "available");
        if (reserveError) {
          throw new HttpError(reserveError.message || "Unable to reserve cashback.", 500);
        }
      }

      const overage = Math.max(0, selectedSum - payoutAmountCents);
      if (!usingVirtualBalance && overage > 0) {
        const last = selected[selected.length - 1];
        const lastAmount = Number(last?.amount_cents) || 0;
        const newLastAmount = Math.max(0, lastAmount - overage);
        if (newLastAmount <= 0) {
          throw new HttpError("Unable to split cashback rows for this amount.", 500);
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
          throw new HttpError(splitError.message || "Unable to split cashback.", 500);
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
          throw new HttpError(adjustmentError?.message || "Unable to create adjustment.", 500);
        }
        adjustmentId = adjustment.id;
      }

      const reward: Record<string, unknown> = {
        value: {
          denomination: payoutAmountCents / 100,
          currency_code: "USD",
        },
        delivery: {
          method: "LINK",
        },
        recipient: {
          name: recipientName,
          email: recipientEmail,
        },
      };
      if (TREMENDOUS_CASHOUT_MESSAGE) reward.message = TREMENDOUS_CASHOUT_MESSAGE;
      if (TREMENDOUS_CASHOUT_CAMPAIGN_ID) {
        reward.campaign_id = TREMENDOUS_CASHOUT_CAMPAIGN_ID;
      } else {
        reward.products = [TREMENDOUS_CASHOUT_PRODUCT_ID];
      }

      const payload = {
        payment: {
          funding_source_id: TREMENDOUS_CASHOUT_FUNDING_SOURCE_ID,
        },
        rewards: [reward],
        external_id: `wello-cashout-${payoutId}`,
      };

      const { response: upstream, text, parsed } = await callTremendousOrdersApi(payload);
      if (!upstream.ok) {
        throw new HttpError(
          parseTremendousErrorMessage(parsed, text, upstream.status || null),
          upstream.status || 502,
          {
            reason: "tremendous_api_error",
            upstreamStatus: upstream.status || null,
          },
        );
      }

      const order = parsed?.order && typeof parsed.order === "object"
        ? parsed.order as Record<string, unknown>
        : null;
      const rewards = Array.isArray(order?.rewards)
        ? order.rewards as Array<Record<string, unknown>>
        : [];
      const firstReward = rewards.length > 0 ? rewards[0] : null;
      const delivery = firstReward?.delivery && typeof firstReward.delivery === "object"
        ? firstReward.delivery as Record<string, unknown>
        : {};
      const claimUrl = String(delivery?.link || delivery?.claim_url || "").trim() || null;
      const providerRewardStatus = String(firstReward?.status || "").trim().toLowerCase();
      tremendousOrderId = String(order?.id || "").trim() || null;
      if (!tremendousOrderId) {
        throw new HttpError("Tremendous did not return an order id.", 502, {
          reason: "missing_order_id",
        });
      }

      const rewardId = String(firstReward?.id || "").trim() || null;
      const updatePayload = {
        provider_order_id: tremendousOrderId,
        provider_reward_id: rewardId,
        provider_claim_url: claimUrl,
        provider_status: providerRewardStatus || "order_created",
        stripe_transfer_id: `trm_order_${tremendousOrderId}`,
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
        throw new HttpError(payoutUpdateError.message || "Unable to persist payout metadata.", 500, {
          reason: "payout_metadata_update_failed",
        });
      }

      return json({
        success: true,
        provider: "tremendous",
        payoutId,
        orderId: tremendousOrderId,
        rewardId,
        claimUrl,
        amountCents: payoutAmountCents,
        availableCents,
        status: "pending",
        usingVirtualBalance,
        overageCents: overage || 0,
        adjustmentId,
        nextEligibleAt:
          CASHOUT_WEEKLY_LIMIT_ENABLED && payoutsRemainingInWindow <= 0
            ? nextEligibleAtForWindow || new Date(Date.now() + ONE_WEEK_MS).toISOString()
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
      if (payoutId && !tremendousOrderId) {
        try {
          if (!usingVirtualBalance && adjustmentId) {
            await supabase
              .from("cashback_events")
              .delete()
              .eq("id", adjustmentId)
              .eq("user_id", userId || "");
          }
          if (!usingVirtualBalance && splitEventId && splitOverage > 0) {
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
          if (!usingVirtualBalance) {
            await supabase
              .from("cashback_events")
              .update({ status: "available", payout_id: null })
              .eq("user_id", userId || "")
              .eq("payout_id", payoutId)
              .eq("status", "reserved");
          }
        } catch {
          // Best effort rollback path.
        }
        await supabase
          .from("cashout_payouts")
          .update({
            status: "failed",
            provider_status: "order_create_failed",
            failure_reason: String((error as { message?: string })?.message || "Cashout failed"),
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
          error: String((error as { message?: string })?.message || "Unable to cash out right now."),
        },
        500,
      );
    }
  };
