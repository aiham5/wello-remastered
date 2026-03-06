import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  authenticateRequest,
  createAdminSupabase,
  HttpError,
  json,
} from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import {
  createWithdrawalRequestSecure,
  getUserBankAccountSecure,
  normalizeName,
} from "../_shared/manualWithdrawal.ts";

export const config = { verify_jwt: false };

const MIN_WITHDRAWAL_CENTS = 1000;
const MAX_WITHDRAWAL_CENTS = 50_000;
const RATE_LIMIT_WINDOW_HOURS = 24;
const RESEND_API_KEY = String(Deno.env.get("RESEND_API_KEY") || "").trim();
const RESEND_FROM = String(
  Deno.env.get("RESEND_FROM_EMAIL") || "Wello <no-reply@wellopartners.com>",
).trim();
const WITHDRAWAL_ADMIN_EMAIL = String(
  Deno.env.get("WITHDRAWAL_ADMIN_EMAIL") || "admin@wellopartners.com",
).trim();
const WITHDRAWAL_REQUIRE_EMAIL_ALERTS = /^(1|true|yes|on)$/i.test(
  String(Deno.env.get("WITHDRAWAL_REQUIRE_EMAIL_ALERTS") || "").trim(),
);

const parseAmountCents = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round(value);
    return rounded > 0 ? rounded : null;
  }
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const dollars = Number(raw);
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  return Math.round(dollars * 100);
};

const centsToUsd = (amountCents: number) => {
  const normalized = Math.max(0, Number(amountCents) || 0);
  return Math.round(normalized) / 100;
};

const formatUsd = (amountCents: number) =>
  (Math.max(0, Number(amountCents) || 0) / 100).toFixed(2);

const normalizeBankNameMatch = (value: unknown) =>
  normalizeName(value).toLowerCase();

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
  if (error) {
    throw new HttpError(
      error.message || "Unable to load cashback balance.",
      500,
      {
        reason: "cashback_balance_load_failed",
      },
    );
  }

  const rows = Array.isArray(data) ? data : [];
  const availableCents = rows.reduce(
    (sum, row) => sum + (Number(row?.amount_cents) || 0),
    0,
  );
  if (availableCents <= 0) {
    throw new HttpError(
      "Your available balance is too low for this withdrawal.",
      400,
      {
        reason: "no_cashback_balance",
      },
    );
  }
  if (amountCents > availableCents) {
    throw new HttpError(
      "Your available balance is too low for this withdrawal.",
      400,
      {
        reason: "amount_exceeds_available",
        availableCents,
      },
    );
  }

  const selected: Array<
    { id: string; amount: number; businessId: string | null }
  > = [];
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

  if (!selected.length || selectedSum < amountCents) {
    throw new HttpError(
      "Your available balance is too low for this withdrawal.",
      400,
      {
        reason: "insufficient_cashback_events",
        availableCents,
      },
    );
  }

  const { data: reservedRows, error: reserveError } = await supabase
    .from("cashback_events")
    .update({ status: "reserved", payout_id: payoutId })
    .in("id", selected.map((row) => row.id))
    .eq("user_id", userId)
    .eq("status", "available")
    .select("id");
  if (reserveError) {
    throw new HttpError(
      reserveError.message || "Unable to reserve cashback for withdrawal.",
      500,
      { reason: "cashback_reserve_failed" },
    );
  }
  if (
    (Array.isArray(reservedRows) ? reservedRows.length : 0) !== selected.length
  ) {
    throw new HttpError(
      "Cashback balance changed. Please try again.",
      409,
      { reason: "cashback_reserve_conflict" },
    );
  }

  const overage = Math.max(0, selectedSum - amountCents);
  if (overage > 0) {
    const last = selected[selected.length - 1];
    const newAmount = Math.max(0, last.amount - overage);
    if (newAmount <= 0) {
      throw new HttpError("Unable to prepare withdrawal amount.", 500, {
        reason: "cashback_split_failed",
      });
    }
    const { error: updateLastError } = await supabase
      .from("cashback_events")
      .update({ amount_cents: newAmount })
      .eq("id", last.id)
      .eq("user_id", userId)
      .eq("status", "reserved")
      .eq("payout_id", payoutId);
    if (updateLastError) {
      throw new HttpError(
        updateLastError.message || "Unable to prepare withdrawal amount.",
        500,
        { reason: "cashback_split_update_failed" },
      );
    }

    const { error: insertRemainderError } = await supabase
      .from("cashback_events")
      .insert({
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
    if (insertRemainderError) {
      throw new HttpError(
        insertRemainderError.message || "Unable to prepare withdrawal amount.",
        500,
        { reason: "cashback_split_insert_failed" },
      );
    }
  }

  return { availableCents };
};

const sendAdminNotification = async (input: {
  userId: string;
  requestId: string;
  payoutId: string;
  amountCents: number;
  bankName: string | null;
  accountHolderName: string;
  routingNumber: string;
  accountNumber: string;
  createdAt: string | null;
}): Promise<{ delivered: boolean; reason: string | null }> => {
  if (!RESEND_API_KEY) {
    return { delivered: false, reason: "resend_key_missing" };
  }
  const amountLabel = `$${formatUsd(input.amountCents)}`;
  const submittedAt = input.createdAt || new Date().toISOString();
  const subject = `[Wello] New Withdrawal Request - ${amountLabel}`;
  const text = [
    `User ID:          ${input.userId}`,
    `Amount:           ${amountLabel}`,
    `Bank:             ${input.bankName || "Linked bank"}`,
    `Routing Number:   ${input.routingNumber}`,
    `Account Number:   ${input.accountNumber}`,
    `Account Holder:   ${input.accountHolderName}`,
    `Request ID:       ${input.requestId}`,
    `Payout ID:        ${input.payoutId}`,
    `Submitted:        ${submittedAt}`,
    "",
    "Log into Mercury and send ACH to the above routing/account number.",
    "Then update this request to 'paid' in the Supabase dashboard.",
  ].join("\n");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [WITHDRAWAL_ADMIN_EMAIL],
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    console.error("submit-withdrawal admin email failed", {
      status: response.status,
      responseText: responseText.slice(0, 500),
    });
    return { delivered: false, reason: "admin_notification_failed" };
  }
  return { delivered: true, reason: null };
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = createAdminSupabase();
  let payoutId: string | null = null;
  let userId: string | null = null;

  try {
    const auth = await authenticateRequest(req);
    userId = auth.userId;

    const { count: frozenCashbackCount, error: frozenCashbackError } =
      await supabase
        .from("redemptions")
        .select("id", { count: "exact", head: true })
        .eq("scanned_by", userId)
        .eq("cashback_status", "frozen");
    if (frozenCashbackError) {
      throw new HttpError(
        frozenCashbackError.message || "Unable to validate cashback status.",
        500,
        { reason: "cashback_frozen_check_failed" },
      );
    }
    if ((Number(frozenCashbackCount) || 0) > 0) {
      throw new HttpError(
        "Your cashback is temporarily on hold pending a review. Please contact support@wellopartners.com",
        400,
        {
          reason: "CASHBACK_FROZEN",
          code: "CASHBACK_FROZEN",
        },
      );
    }

    const { data: fraudProfile, error: fraudProfileError } = await supabase
      .from("profiles")
      .select("fraud_flagged")
      .eq("id", userId)
      .maybeSingle();
    if (fraudProfileError) {
      throw new HttpError(
        fraudProfileError.message || "Unable to validate account status.",
        500,
        { reason: "fraud_flag_check_failed" },
      );
    }
    if (fraudProfile?.fraud_flagged === true) {
      throw new HttpError(
        "Your account is under review. Please contact support@wellopartners.com",
        400,
        {
          reason: "ACCOUNT_FLAGGED",
          code: "ACCOUNT_FLAGGED",
        },
      );
    }

    await enforceRateLimit({
      req,
      scope: "cashout:submit-withdrawal",
      userId,
      maxRequests: 20,
      windowSeconds: 60 * 60,
      supabase,
    });

    const amountCents = parseAmountCents(
      auth.body?.amountCents ?? auth.body?.amount_cents ?? auth.body?.amount,
    );
    if (!amountCents) {
      throw new HttpError("Enter a valid withdrawal amount.", 400, {
        reason: "invalid_amount",
      });
    }
    if (amountCents < MIN_WITHDRAWAL_CENTS) {
      throw new HttpError("Minimum withdrawal is $10.00.", 400, {
        reason: "below_minimum",
      });
    }
    if (amountCents > MAX_WITHDRAWAL_CENTS) {
      throw new HttpError("Maximum withdrawal is $500.00 per request.", 400, {
        reason: "above_maximum",
      });
    }

    const idempotencyKey = String(
      auth.body?.idempotencyKey || auth.body?.idempotency_key || "",
    ).trim().slice(0, 128);

    if (idempotencyKey) {
      const { data: existingPayout } = await supabase
        .from("cashout_payouts")
        .select("id")
        .eq("user_id", userId)
        .eq("provider", "checkbook")
        .eq("method_type", "bank_transfer")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      const existingPayoutId = String(existingPayout?.id || "").trim();
      if (existingPayoutId) {
        const { data: existingRequest } = await supabase
          .from("withdrawal_requests")
          .select("id, status, created_at")
          .eq("user_id", userId)
          .eq("payout_id", existingPayoutId)
          .maybeSingle();
        if (existingRequest?.id) {
          return json({
            success: true,
            duplicate: true,
            requestId: existingRequest.id,
            payoutId: existingPayoutId,
            status: String(existingRequest.status || "pending")
              .trim()
              .toLowerCase(),
            createdAt: existingRequest.created_at || null,
          });
        }
      }
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select(
        "full_name, email, cashout_terms_accepted_at, stripe_cashout_plaid_account_id",
      )
      .eq("id", userId)
      .maybeSingle();
    if (profileError) {
      throw new HttpError(
        profileError.message || "Unable to load profile.",
        500,
        {
          reason: "profile_load_failed",
        },
      );
    }
    if (!profile?.cashout_terms_accepted_at) {
      throw new HttpError(
        "Accept cashout terms before requesting withdrawal.",
        400,
        {
          reason: "cashout_terms_not_accepted",
        },
      );
    }

    const profileName = normalizeName(profile?.full_name || "");
    const authUser = await supabase.auth.admin.getUserById(userId);
    const authEmail = String(authUser?.data?.user?.email || "").trim();
    const profileEmail = String(profile?.email || "").trim();
    const userEmail = profileEmail || authEmail || null;

    const cutoffIso = new Date(
      Date.now() - RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString();
    const { data: recentRequestRows, error: recentRequestError } =
      await supabase
        .from("withdrawal_requests")
        .select("id, created_at")
        .eq("user_id", userId)
        .gte("created_at", cutoffIso)
        .order("created_at", { ascending: false })
        .limit(1);
    if (recentRequestError) {
      throw new HttpError(
        recentRequestError.message || "Unable to validate withdrawal window.",
        500,
        { reason: "withdrawal_rate_limit_query_failed" },
      );
    }
    const latestRecent = Array.isArray(recentRequestRows)
      ? recentRequestRows[0]
      : null;
    if (latestRecent?.id) {
      const nextEligibleAt = new Date(
        new Date(String(latestRecent.created_at)).getTime() +
          RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000,
      ).toISOString();
      throw new HttpError(
        "You've already submitted a withdrawal today. Please try again tomorrow.",
        429,
        {
          reason: "withdrawal_rate_limited",
          nextEligibleAt,
        },
      );
    }

    const linkedBank = await getUserBankAccountSecure(supabase, userId);
    if (!linkedBank) {
      throw new HttpError(
        "Link your bank account before requesting a withdrawal.",
        400,
        {
          reason: "bank_account_not_linked",
        },
      );
    }

    if (profileName) {
      const bankHolderName = normalizeBankNameMatch(
        linkedBank.accountHolderName,
      );
      const profileNameNorm = normalizeBankNameMatch(profileName);
      if (
        bankHolderName && profileNameNorm && bankHolderName !== profileNameNorm
      ) {
        throw new HttpError(
          "Bank account holder name must match your profile name.",
          400,
          { reason: "bank_account_name_mismatch" },
        );
      }
    }

    const bankSummaryParts = [
      linkedBank.bankName || "Linked bank",
      linkedBank.accountLast4 ? `****${linkedBank.accountLast4}` : null,
    ].filter(Boolean);
    const bankSummary = bankSummaryParts.join(" - ").slice(0, 180);
    const legacyStripeAccountId = String(
      profile?.stripe_cashout_plaid_account_id || linkedBank.id ||
        "manual_bank_transfer",
    ).trim() || "manual_bank_transfer";

    const { data: payoutInsertRows, error: payoutInsertError } = await supabase
      .from("cashout_payouts")
      .insert({
        user_id: userId,
        stripe_account_id: legacyStripeAccountId,
        provider: "checkbook",
        method_type: "bank_transfer",
        amount_cents: amountCents,
        status: "pending",
        approval_status: "pending",
        bank_summary: bankSummary || null,
        recipient_provider_id: linkedBank.id,
        idempotency_key: idempotencyKey || null,
      })
      .select("id")
      .single();
    if (payoutInsertError || !payoutInsertRows?.id) {
      throw new HttpError(
        payoutInsertError?.message || "Unable to create withdrawal payout.",
        500,
        { reason: "payout_insert_failed" },
      );
    }
    payoutId = String(payoutInsertRows.id).trim();

    try {
      await reserveCashbackForPayout(supabase, userId, payoutId, amountCents);
    } catch (reserveError) {
      await supabase.from("cashout_payouts").delete().eq("id", payoutId);
      payoutId = null;
      throw reserveError;
    }

    const withdrawalRequest = await createWithdrawalRequestSecure(supabase, {
      userId,
      payoutId,
      amountUsd: centsToUsd(amountCents),
      routingNumber: linkedBank.routingNumber,
      accountNumber: linkedBank.accountNumber,
      bankName: linkedBank.bankName,
      accountHolderName: linkedBank.accountHolderName,
      adminNotes: null,
    });

    const notification = await sendAdminNotification({
      userId,
      requestId: withdrawalRequest.id || "",
      payoutId,
      amountCents,
      bankName: linkedBank.bankName,
      accountHolderName: linkedBank.accountHolderName,
      routingNumber: linkedBank.routingNumber,
      accountNumber: linkedBank.accountNumber,
      createdAt: withdrawalRequest.createdAt,
    });

    if (!notification.delivered) {
      console.warn("submit-withdrawal created request without email alert", {
        userId,
        payoutId,
        requestId: withdrawalRequest.id,
        reason: notification.reason,
      });
      if (WITHDRAWAL_REQUIRE_EMAIL_ALERTS) {
        await supabase
          .from("withdrawal_requests")
          .delete()
          .eq("id", withdrawalRequest.id);
        await supabase
          .from("cashout_payouts")
          .update({
            status: "failed",
            failure_reason: notification.reason || "admin_notification_failed",
            processed_at: new Date().toISOString(),
          })
          .eq("id", payoutId)
          .neq("status", "paid");
        await releaseReservedCashback(supabase, payoutId);
        throw new HttpError(
          "Unable to send admin withdrawal notification.",
          502,
          {
            reason: notification.reason || "admin_notification_failed",
          },
        );
      }

      const appendNote = notification.reason === "resend_key_missing"
        ? "[System] Admin email alert not configured."
        : "[System] Admin email alert failed.";
      await supabase
        .from("withdrawal_requests")
        .update({
          admin_notes: appendNote,
        })
        .eq("id", withdrawalRequest.id)
        .eq("user_id", userId);
    }

    return json({
      success: true,
      requestId: withdrawalRequest.id,
      payoutId,
      status: "pending",
      bankName: linkedBank.bankName,
      accountLast4: linkedBank.accountLast4,
      amountCents,
      copy: {
        primary: "Transfer Requested",
        secondary: "Verification processing typically takes 24-48 hours.",
      },
      adminNotificationSent: notification.delivered,
      userEmail,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return json(
        {
          error: error.message,
          ...(error.details || {}),
        },
        error.status,
      );
    }

    if (payoutId && userId) {
      await supabase
        .from("cashout_payouts")
        .update({
          status: "failed",
          failure_reason: "withdrawal_request_failed",
          processed_at: new Date().toISOString(),
        })
        .eq("id", payoutId)
        .eq("user_id", userId)
        .neq("status", "paid");
      await releaseReservedCashback(supabase, payoutId);
    }

    console.error("submit-withdrawal failed", {
      userId,
      payoutId,
      message: error instanceof Error ? error.message : String(error || ""),
    });
    return json(
      {
        error:
          "Something went wrong on our end. Please try again in a few minutes.",
      },
      500,
    );
  }
});
