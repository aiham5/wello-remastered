import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "npm:stripe@14.25.0";
import {
  HttpError,
  authenticateRequest,
  createAdminSupabase,
  json,
} from "../_shared/auth.ts";
import {
  PlaidTransaction,
  plaidGetIdentity,
  plaidGetTransactions,
} from "../_shared/plaid.ts";
import { syncStripeCustomerIdentity } from "../_shared/stripeCustomer.ts";

export const config = { verify_jwt: false };

const FALLBACK_COPY =
  "Some cards or banks may require receipt upload for verification.";
const PENDING_COPY =
  "Cashback may appear as pending while verification completes.";
const AUTO_COPY =
  "Cashback is automatically verified when purchases are visible through your linked bank.";
const PLAID_ENV = (Deno.env.get("PLAID_ENV") ?? "sandbox").toLowerCase();
const IDENTITY_ENFORCED = PLAID_ENV !== "sandbox";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" })
  : null;

type Candidate = {
  plaidItemId: string;
  plaidAccessToken: string;
  transactionId: string;
  accountId: string;
  merchant: string;
  amountCents: number;
  postedOn: string;
  pending: boolean;
  score: number;
  merchantScore: number;
  amountDiff: number | null;
  daysDiff: number | null;
  requestId: string | null;
};

const normalizeText = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value: unknown) =>
  normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const merchantSimilarity = (expected: string, actual: string) => {
  const a = normalizeText(expected);
  const b = normalizeText(actual);
  if (!a || !b) return 0;
  if (a === b) return 30;
  if (a.includes(b) || b.includes(a)) return 24;
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) return 0;
  let shared = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) shared += 1;
  }
  if (!shared) return 0;
  const denominator = Math.max(aTokens.size, bTokens.size);
  return Math.round((shared / denominator) * 24);
};

const toDateOnly = (value: unknown) => {
  if (!value) return null;
  const raw = String(value);
  const direct = raw.match(/^\d{4}-\d{2}-\d{2}$/);
  if (direct) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const daysBetween = (a: string | null, b: string | null) => {
  if (!a || !b) return null;
  const first = Date.parse(`${a}T00:00:00.000Z`);
  const second = Date.parse(`${b}T00:00:00.000Z`);
  if (Number.isNaN(first) || Number.isNaN(second)) return null;
  return Math.abs(Math.round((first - second) / (1000 * 60 * 60 * 24)));
};

const addDays = (dateOnly: string, delta: number) => {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateOnly;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
};

const reasonMessage = (reasonCode: string) => {
  switch (reasonCode) {
    case "bank_not_linked":
      return "Link a bank account to use automatic verification. You can upload a receipt now.";
    case "no_active_linked_account":
      return "Linked bank access is no longer active. Re-link a bank or upload a receipt.";
    case "transaction_pending":
      return "Matching transaction found but still pending. You can wait or upload a receipt now.";
    case "transaction_delayed":
      return "Transaction data is not available yet. You can upload a receipt now.";
    case "merchant_mismatch":
      return "A transaction with similar timing was found, but merchant details did not match confidently.";
    case "amount_mismatch":
      return "A transaction with similar timing was found, but amount did not match confidently.";
    case "identity_mismatch":
      return "Transaction account ownership could not be confirmed with linked identity data.";
    case "transaction_not_found":
      return "No matching transaction was found in linked bank data.";
    default:
      return "Automatic bank verification was not completed.";
  }
};

type StripeDraftSyncResult = {
  ok: boolean;
  invoiceId: string | null;
  skippedReason: string | null;
  error: string | null;
};

const getPeriodForDate = (value?: string | null) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  return { start, end };
};

const syncCommissionEventToDraftInvoice = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  businessId: string,
  redemptionId: string,
  eventDate?: string | null,
): Promise<StripeDraftSyncResult> => {
  if (!stripe) {
    return {
      ok: false,
      invoiceId: null,
      skippedReason: "stripe_not_configured",
      error: null,
    };
  }

  const { data: event, error: eventError } = await supabase
    .from("commission_events")
    .select("id, amount_cents, status, created_at")
    .eq("business_id", businessId)
    .eq("redemption_id", redemptionId)
    .maybeSingle();
  if (eventError || !event) {
    return {
      ok: false,
      invoiceId: null,
      skippedReason: "commission_event_missing",
      error: eventError?.message || null,
    };
  }

  if (event.status === "paid" || event.status === "invoiced") {
    return {
      ok: true,
      invoiceId: null,
      skippedReason: "already_invoiced",
      error: null,
    };
  }

  const amountCents = Number(event.amount_cents) || 0;
  if (amountCents <= 0) {
    return {
      ok: false,
      invoiceId: null,
      skippedReason: "invalid_amount",
      error: null,
    };
  }

  const period = getPeriodForDate(eventDate || event.created_at || null);
  if (!period) {
    return {
      ok: false,
      invoiceId: null,
      skippedReason: "invalid_period",
      error: null,
    };
  }
  const periodStart = period.start.toISOString().slice(0, 10);
  const periodEnd = period.end.toISOString().slice(0, 10);

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("stripe_customer_id, name")
    .eq("id", businessId)
    .maybeSingle();
  if (businessError || !business?.stripe_customer_id) {
    return {
      ok: false,
      invoiceId: null,
      skippedReason: "missing_stripe_customer",
      error: businessError?.message || null,
    };
  }

  await syncStripeCustomerIdentity({
    stripe,
    customerId: business.stripe_customer_id,
    businessName: business.name,
    context: "plaid-verify-purchase",
    businessId,
  });

  const { data: existingInvoice } = await supabase
    .from("commission_invoices")
    .select("stripe_invoice_id, status")
    .eq("business_id", businessId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .in("status", ["draft", "open"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let invoiceId = String(existingInvoice?.stripe_invoice_id || "").trim();
  if (!invoiceId) {
    const invoice = await stripe.invoices.create({
      customer: business.stripe_customer_id,
      collection_method: "charge_automatically",
      auto_advance: false,
      metadata: {
        business_id: businessId,
        period_start: periodStart,
        period_end: periodEnd,
        mode: "auto_plaid",
      },
    });
    invoiceId = invoice.id;
    await supabase.from("commission_invoices").insert({
      business_id: businessId,
      stripe_invoice_id: invoiceId,
      period_start: periodStart,
      period_end: periodEnd,
      amount_cents: invoice.amount_due || invoice.total || 0,
      status: invoice.status || "draft",
    });
  }

  await stripe.invoiceItems.create(
    {
      customer: business.stripe_customer_id,
      amount: amountCents,
      currency: "usd",
      description: `Wello commission (${periodStart} to ${periodEnd})`,
      invoice: invoiceId,
      metadata: {
        business_id: businessId,
        redemption_id: redemptionId,
        commission_event_id: event.id,
      },
    },
    { idempotencyKey: `commission_${event.id}` },
  );

  const updatedInvoice = await stripe.invoices.retrieve(invoiceId);
  const invoiceTotal =
    updatedInvoice.amount_due || updatedInvoice.total || amountCents;

  await supabase
    .from("commission_invoices")
    .update({
      amount_cents: invoiceTotal,
      status: updatedInvoice.status || "draft",
    })
    .eq("stripe_invoice_id", invoiceId);

  await supabase
    .from("commission_events")
    .update({ status: "invoiced" })
    .eq("id", event.id)
    .eq("status", "pending");

  return {
    ok: true,
    invoiceId,
    skippedReason: null,
    error: null,
  };
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = createAdminSupabase();
  try {
    const { userId, body } = await authenticateRequest(req);
    const redemptionId = String(
      body?.redemptionId || body?.redemption_id || "",
    ).trim();
    if (!redemptionId) {
      throw new HttpError("Missing redemption id.", 400, {
        reason: "missing_redemption_id",
      });
    }

    const expectedAmountRaw = Number(body?.amountCents ?? body?.amount_cents);
    const expectedAmountCents =
      Number.isFinite(expectedAmountRaw) && expectedAmountRaw > 0
        ? Math.round(expectedAmountRaw)
        : null;
    const requestedPurchaseDate =
      toDateOnly(body?.purchaseDate) || toDateOnly(body?.purchase_date);
    const requestedMerchant = String(body?.merchantName || body?.merchant_name || "")
      .trim();

    const { data: redemption, error: redemptionError } = await supabase
      .from("redemptions")
      .select(
        "id, scanned_by, business_id, created_at, business:businesses(id, name), receipt_uploads(id, review_status, uploaded_at, receipt_total_cents)",
      )
      .eq("id", redemptionId)
      .maybeSingle();

    if (redemptionError || !redemption) {
      throw new HttpError("Redemption not found.", 404);
    }
    if (redemption.scanned_by !== userId) {
      throw new HttpError("Forbidden", 403, { reason: "redemption_not_owned" });
    }

    const businessId = String(redemption.business_id || "").trim();
    const businessRelation = Array.isArray(redemption.business)
      ? redemption.business[0]
      : redemption.business;
    const businessName = String(businessRelation?.name || "").trim();
    const expectedMerchant = requestedMerchant || businessName;
    const expectedDate =
      requestedPurchaseDate ||
      toDateOnly(redemption.created_at) ||
      toDateOnly(new Date().toISOString());

    const receipt = Array.isArray(redemption.receipt_uploads)
      ? redemption.receipt_uploads[0]
      : redemption.receipt_uploads;
    const existingReceiptStatus = String(receipt?.review_status || "").trim();
    const existingReceiptId = receipt?.id || null;

    const createOrUpdateVerification = async (payload: Record<string, unknown>) => {
      const { data, error } = await supabase
        .from("purchase_verifications")
        .upsert(
          {
            redemption_id: redemptionId,
            user_id: userId,
            business_id: businessId,
            ...payload,
          },
          { onConflict: "redemption_id" },
        )
        .select("id, status, reason_code")
        .maybeSingle();
      if (error) {
        throw new HttpError(
          error.message || "Unable to save verification status.",
          500,
        );
      }
      return data;
    };

    const insertAttempt = async (
      outcome: string,
      reasonCode: string | null,
      details: {
        verificationId?: string | null;
        candidateCount?: number;
        postedCandidateCount?: number;
        bestScore?: number | null;
        matched?: Candidate | null;
      } = {},
    ) => {
      await supabase.from("purchase_verification_attempts").insert({
        verification_id: details.verificationId || null,
        redemption_id: redemptionId,
        user_id: userId,
        business_id: businessId || null,
        attempt_source: "manual",
        outcome,
        reason_code: reasonCode,
        expected_amount_cents: expectedAmountCents,
        matched_amount_cents: details.matched?.amountCents || null,
        expected_merchant: expectedMerchant || null,
        matched_merchant: details.matched?.merchant || null,
        expected_posted_on: expectedDate || null,
        matched_posted_on: details.matched?.postedOn || null,
        matched_plaid_item_id: details.matched?.plaidItemId || null,
        matched_plaid_transaction_id: details.matched?.transactionId || null,
        candidate_count: details.candidateCount || 0,
        posted_candidate_count: details.postedCandidateCount || 0,
        best_score: Number.isFinite(Number(details.bestScore))
          ? Number(details.bestScore)
          : null,
        request_id: details.matched?.requestId || null,
      });
    };

    const { data: existingCashback } = await supabase
      .from("cashback_events")
      .select("id, status, amount_cents")
      .eq("redemption_id", redemptionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (
      existingCashback &&
      ["available", "reserved", "paid"].includes(existingCashback.status)
    ) {
      const verification = await createOrUpdateVerification({
        source: existingReceiptId ? "receipt" : "plaid",
        status: "confirmed",
        reason_code: "already_confirmed",
        reason_detail: "Cashback is already confirmed for this redemption.",
        receipt_upload_id: existingReceiptId,
        expected_amount_cents: expectedAmountCents,
        matched_amount_cents: Number(existingCashback.amount_cents) || null,
        expected_merchant: expectedMerchant || null,
        matched_merchant: expectedMerchant || null,
        expected_posted_on: expectedDate || null,
        matched_posted_on: expectedDate || null,
        last_checked_at: new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
      });
      await insertAttempt("already_confirmed", "already_confirmed", {
        verificationId: verification?.id || null,
      });
      return json({
        verificationStatus: "confirmed",
        reasonCode: "already_confirmed",
        message: "Cashback already confirmed for this redemption.",
        fallbackRequired: false,
      });
    }

    if (existingReceiptStatus === "pending") {
      const verification = await createOrUpdateVerification({
        source: "receipt",
        status: "pending",
        reason_code: "receipt_under_review",
        reason_detail: "Receipt uploaded and awaiting review.",
        receipt_upload_id: existingReceiptId,
        expected_amount_cents:
          expectedAmountCents || Number(receipt?.receipt_total_cents) || null,
        matched_amount_cents: Number(receipt?.receipt_total_cents) || null,
        expected_merchant: expectedMerchant || null,
        matched_merchant: expectedMerchant || null,
        expected_posted_on: expectedDate || null,
        matched_posted_on: toDateOnly(receipt?.uploaded_at) || expectedDate || null,
        last_checked_at: new Date().toISOString(),
      });
      await insertAttempt("no_match", "receipt_under_review", {
        verificationId: verification?.id || null,
      });
      return json({
        verificationStatus: "pending",
        reasonCode: "receipt_under_review",
        message: "Receipt is already under review.",
        fallbackRequired: false,
        copy: {
          primary: AUTO_COPY,
          secondary: PENDING_COPY,
        },
      });
    }

    if (existingReceiptStatus === "verified") {
      const verification = await createOrUpdateVerification({
        source: "receipt",
        status: "confirmed",
        reason_code: "receipt_approved",
        reason_detail: "Receipt approved.",
        receipt_upload_id: existingReceiptId,
        expected_amount_cents:
          expectedAmountCents || Number(receipt?.receipt_total_cents) || null,
        matched_amount_cents: Number(receipt?.receipt_total_cents) || null,
        expected_merchant: expectedMerchant || null,
        matched_merchant: expectedMerchant || null,
        expected_posted_on: expectedDate || null,
        matched_posted_on: toDateOnly(receipt?.uploaded_at) || expectedDate || null,
        last_checked_at: new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
      });
      await insertAttempt("already_confirmed", "receipt_approved", {
        verificationId: verification?.id || null,
      });
      return json({
        verificationStatus: "confirmed",
        reasonCode: "receipt_approved",
        message: "Receipt already approved.",
        fallbackRequired: false,
      });
    }

    const { data: linkedItems, error: linkedError } = await supabase
      .from("plaid_linked_items")
      .select(
        "id, plaid_item_id, plaid_access_token, institution_name, status, last_sync_at",
      )
      .eq("user_id", userId)
      .eq("status", "active");

    if (linkedError) {
      throw new HttpError(linkedError.message || "Unable to load linked banks.", 500);
    }

    const activeLinkedItems = (Array.isArray(linkedItems) ? linkedItems : []).filter(
      (item) => String(item?.plaid_access_token || "").trim().length > 0,
    );

    if (!activeLinkedItems.length) {
      const verification = await createOrUpdateVerification({
        source: "plaid",
        status: "rejected",
        reason_code: "bank_not_linked",
        reason_detail: reasonMessage("bank_not_linked"),
        receipt_upload_id: existingReceiptId,
        expected_amount_cents: expectedAmountCents,
        expected_merchant: expectedMerchant || null,
        expected_posted_on: expectedDate || null,
        last_checked_at: new Date().toISOString(),
        rejected_at: new Date().toISOString(),
      });
      await insertAttempt("no_match", "bank_not_linked", {
        verificationId: verification?.id || null,
      });
      return json({
        verificationStatus: "rejected",
        reasonCode: "bank_not_linked",
        message: reasonMessage("bank_not_linked"),
        fallbackRequired: true,
        fallbackMessage: FALLBACK_COPY,
      });
    }

    const startDate = addDays(expectedDate || toDateOnly(new Date().toISOString())!, -7);
    const endDate = addDays(expectedDate || toDateOnly(new Date().toISOString())!, 7);

    const allCandidates: Candidate[] = [];
    let lastRequestId: string | null = null;
    for (const item of activeLinkedItems) {
      const accessToken = String(item?.plaid_access_token || "").trim();
      try {
        const result = await plaidGetTransactions(accessToken, startDate, endDate);
        lastRequestId = result.requestId || lastRequestId;

        const rows = Array.isArray(result.transactions) ? result.transactions : [];
        rows.forEach((txn: PlaidTransaction) => {
          const amountCents = Math.round(Math.abs(Number(txn.amount || 0)) * 100);
          if (!txn.transaction_id || !amountCents) return;
          const merchant = String(txn.merchant_name || txn.name || "").trim();
          const merchantScore = merchantSimilarity(expectedMerchant, merchant);
          const amountDiff =
            expectedAmountCents !== null
              ? Math.abs(amountCents - expectedAmountCents)
              : null;
          const postedOn = toDateOnly(txn.date);
          const daysDiff = daysBetween(expectedDate, postedOn);

          let score = merchantScore;
          if (expectedAmountCents !== null) {
            if (amountDiff === 0) score += 55;
            else if (amountDiff !== null && amountDiff <= 100) score += 45;
            else if (amountDiff !== null && amountDiff <= 300) score += 28;
            else if (amountDiff !== null && amountDiff <= 1000) score += 10;
            else score -= 30;
          } else {
            score += 10;
          }

          if (daysDiff !== null) {
            if (daysDiff <= 1) score += 20;
            else if (daysDiff <= 3) score += 10;
            else if (daysDiff <= 7) score += 4;
            else score -= 10;
          }

          score += txn.pending ? -4 : 8;

          allCandidates.push({
            plaidItemId: item.plaid_item_id,
            plaidAccessToken: accessToken,
            transactionId: txn.transaction_id,
            accountId: txn.account_id,
            merchant,
            amountCents,
            postedOn: postedOn || expectedDate || "",
            pending: Boolean(txn.pending),
            score,
            merchantScore,
            amountDiff,
            daysDiff,
            requestId: result.requestId || null,
          });
        });

        await supabase
          .from("plaid_linked_items")
          .update({ last_sync_at: new Date().toISOString() })
          .eq("id", item.id);
      } catch (error) {
        await supabase
          .from("plaid_linked_items")
          .update({ status: "errored" })
          .eq("id", item.id);
        console.warn("plaid-verify-purchase item fetch failed", {
          userId,
          plaidItemId: item.plaid_item_id,
          error: error?.message,
        });
      }
    }

    const postedCandidates = allCandidates.filter((candidate) => !candidate.pending);
    const sorted = [...allCandidates].sort((a, b) => b.score - a.score);
    const best = sorted[0] || null;
    const second = sorted[1] || null;
    const postedSorted = [...postedCandidates].sort((a, b) => b.score - a.score);
    const bestPosted = postedSorted[0] || null;

    const selectBestCandidate = () => {
      if (!best) return null;
      const scoreGap = second ? best.score - second.score : 999;

      if (expectedAmountCents !== null) {
        if (best.score < 68) return null;
        return best;
      }

      const hasStrongMerchant = best.merchantScore >= 22;
      const nearDate = best.daysDiff !== null && best.daysDiff <= 2;
      const uniqueEnough = scoreGap >= 12;
      if (hasStrongMerchant && nearDate && uniqueEnough && best.score >= 52) {
        return best;
      }
      return null;
    };

    const selected = selectBestCandidate();

    if (!selected) {
      const hasPending = allCandidates.some((candidate) => candidate.pending);
      const hasMerchantish = allCandidates.some(
        (candidate) => candidate.merchantScore >= 20,
      );
      const hasAmountish =
        expectedAmountCents !== null
          ? allCandidates.some(
              (candidate) =>
                candidate.amountDiff !== null && candidate.amountDiff <= 300,
            )
          : false;
      const reasonCode = hasPending
        ? "transaction_pending"
        : hasMerchantish && !hasAmountish && expectedAmountCents !== null
          ? "amount_mismatch"
          : hasAmountish && !hasMerchantish
            ? "merchant_mismatch"
            : allCandidates.length === 0
              ? "transaction_delayed"
              : "transaction_not_found";

      const verification = await createOrUpdateVerification({
        source: "plaid",
        status: reasonCode === "transaction_pending" ? "pending" : "rejected",
        reason_code: reasonCode,
        reason_detail: reasonMessage(reasonCode),
        receipt_upload_id: existingReceiptId,
        expected_amount_cents: expectedAmountCents,
        expected_merchant: expectedMerchant || null,
        expected_posted_on: expectedDate || null,
        last_checked_at: new Date().toISOString(),
        rejected_at:
          reasonCode === "transaction_pending" ? null : new Date().toISOString(),
      });
      await insertAttempt(
        reasonCode === "transaction_pending" ? "matched_pending" : "no_match",
        reasonCode,
        {
          verificationId: verification?.id || null,
          candidateCount: allCandidates.length,
          postedCandidateCount: postedCandidates.length,
          bestScore: best?.score || null,
          matched: best || null,
        },
      );

      return json({
        verificationStatus:
          reasonCode === "transaction_pending" ? "pending" : "rejected",
        reasonCode,
        message: reasonMessage(reasonCode),
        fallbackRequired: true,
        fallbackMessage: FALLBACK_COPY,
        copy: {
          primary: AUTO_COPY,
          secondary: PENDING_COPY,
        },
      });
    }

    let identityCheckBypassedSandbox = false;
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();
    const fullName = String(profile?.full_name || "").trim();
    if (fullName && selected.accountId) {
      const names = await plaidGetIdentity(
        selected.plaidAccessToken,
        selected.accountId,
      );
      if (names.length > 0) {
        const normalizedUser = normalizeText(fullName);
        const hasNameOverlap = names.some((name) => {
          const normalizedOwner = normalizeText(name);
          if (!normalizedOwner) return false;
          return (
            normalizedOwner.includes(normalizedUser) ||
            normalizedUser.includes(normalizedOwner) ||
            tokenize(normalizedOwner).some((token) =>
              tokenize(normalizedUser).includes(token)
            )
          );
        });
        if (!hasNameOverlap && IDENTITY_ENFORCED) {
          const verification = await createOrUpdateVerification({
            source: "plaid",
            status: "rejected",
            reason_code: "identity_mismatch",
            reason_detail: reasonMessage("identity_mismatch"),
            receipt_upload_id: existingReceiptId,
            expected_amount_cents: expectedAmountCents,
            matched_amount_cents: selected.amountCents,
            expected_merchant: expectedMerchant || null,
            matched_merchant: selected.merchant || null,
            expected_posted_on: expectedDate || null,
            matched_posted_on: selected.postedOn || null,
            matched_plaid_item_id: selected.plaidItemId,
            matched_plaid_transaction_id: selected.transactionId,
            last_checked_at: new Date().toISOString(),
            rejected_at: new Date().toISOString(),
          });
          await insertAttempt("no_match", "identity_mismatch", {
            verificationId: verification?.id || null,
            candidateCount: allCandidates.length,
            postedCandidateCount: postedCandidates.length,
            bestScore: selected.score,
            matched: selected,
          });
          return json({
            verificationStatus: "rejected",
            reasonCode: "identity_mismatch",
            message: reasonMessage("identity_mismatch"),
            fallbackRequired: true,
            fallbackMessage: FALLBACK_COPY,
          });
        }
        if (!hasNameOverlap && !IDENTITY_ENFORCED) {
          identityCheckBypassedSandbox = true;
        }
      }
    }

    if (selected.pending || (bestPosted && bestPosted.score > selected.score + 6)) {
      const pendingCandidate = selected.pending ? selected : bestPosted || selected;
      const verification = await createOrUpdateVerification({
        source: "plaid",
        status: "pending",
        reason_code: "transaction_pending",
        reason_detail: reasonMessage("transaction_pending"),
        receipt_upload_id: existingReceiptId,
        expected_amount_cents: expectedAmountCents,
        matched_amount_cents: pendingCandidate.amountCents,
        expected_merchant: expectedMerchant || null,
        matched_merchant: pendingCandidate.merchant || null,
        expected_posted_on: expectedDate || null,
        matched_posted_on: pendingCandidate.postedOn || null,
        matched_plaid_item_id: pendingCandidate.plaidItemId,
        matched_plaid_transaction_id: pendingCandidate.transactionId,
        last_checked_at: new Date().toISOString(),
      });
      await insertAttempt("matched_pending", "transaction_pending", {
        verificationId: verification?.id || null,
        candidateCount: allCandidates.length,
        postedCandidateCount: postedCandidates.length,
        bestScore: pendingCandidate.score,
        matched: pendingCandidate,
      });
      return json({
        verificationStatus: "pending",
        reasonCode: "transaction_pending",
        message: reasonMessage("transaction_pending"),
        fallbackRequired: true,
        fallbackMessage: FALLBACK_COPY,
        copy: {
          primary: AUTO_COPY,
          secondary: PENDING_COPY,
        },
      });
    }

    const nowIso = new Date().toISOString();
    const { data: existingClaim, error: existingClaimError } = await supabase
      .from("purchase_verifications")
      .select("redemption_id")
      .eq("matched_plaid_transaction_id", selected.transactionId)
      .neq("redemption_id", redemptionId)
      .maybeSingle();
    if (existingClaimError) {
      throw new HttpError(
        existingClaimError.message || "Unable to check transaction eligibility.",
        500,
      );
    }
    if (existingClaim?.redemption_id) {
      const verification = await createOrUpdateVerification({
        source: "plaid",
        status: "rejected",
        reason_code: "transaction_not_found",
        reason_detail:
          "This transaction was already used for another redemption. Upload a receipt for review.",
        receipt_upload_id: existingReceiptId,
        expected_amount_cents: expectedAmountCents,
        matched_amount_cents: selected.amountCents,
        expected_merchant: expectedMerchant || null,
        matched_merchant: selected.merchant || null,
        expected_posted_on: expectedDate || null,
        matched_posted_on: selected.postedOn || null,
        matched_plaid_item_id: selected.plaidItemId,
        matched_plaid_transaction_id: null,
        last_checked_at: nowIso,
        rejected_at: nowIso,
      });
      await insertAttempt("no_match", "transaction_not_found", {
        verificationId: verification?.id || null,
        candidateCount: allCandidates.length,
        postedCandidateCount: postedCandidates.length,
        bestScore: selected.score,
        matched: selected,
      });
      return json({
        verificationStatus: "rejected",
        reasonCode: "transaction_not_found",
        message:
          "A matching bank transaction appears to be already claimed. Upload a receipt for review.",
        fallbackRequired: true,
        fallbackMessage: FALLBACK_COPY,
      });
    }

    const autoStoragePath = `plaid/verified/${businessId}/${redemptionId}/${selected.transactionId}.json`;
    const upsertReceiptPayload = {
      redemption_id: redemptionId,
      business_id: businessId,
      user_id: userId,
      storage_path: autoStoragePath,
      uploaded_at: nowIso,
      receipt_total_cents: selected.amountCents,
      review_status: "pending",
      review_notes:
        "Auto-verification started from Plaid transaction match.",
      verification_source: "plaid",
      verification_reference: selected.transactionId,
    };

    const { data: receiptUpsert, error: receiptUpsertError } = await supabase
      .from("receipt_uploads")
      .upsert(upsertReceiptPayload, { onConflict: "redemption_id" })
      .select("id, review_status")
      .maybeSingle();
    if (receiptUpsertError || !receiptUpsert?.id) {
      throw new HttpError(
        receiptUpsertError?.message || "Unable to create verification record.",
        500,
      );
    }

    await supabase
      .from("receipt_uploads")
      .update({
        review_status: "verified",
        reviewed_at: nowIso,
        review_notes: "Auto-verified from Plaid posted transaction.",
        receipt_total_cents: selected.amountCents,
        verification_source: "plaid",
        verification_reference: selected.transactionId,
      })
      .eq("id", receiptUpsert.id);

    let stripeDraftSync: StripeDraftSyncResult | null = null;
    try {
      stripeDraftSync = await syncCommissionEventToDraftInvoice(
        supabase,
        businessId,
        redemptionId,
        nowIso,
      );
    } catch (syncError) {
      console.warn("plaid-verify-purchase stripe draft sync failed", {
        businessId,
        redemptionId,
        error: syncError?.message || String(syncError),
      });
      stripeDraftSync = {
        ok: false,
        invoiceId: null,
        skippedReason: "sync_error",
        error: syncError?.message || "Stripe draft sync failed.",
      };
    }

    const verification = await createOrUpdateVerification({
      source: "plaid",
      status: "confirmed",
      reason_code: null,
      reason_detail: identityCheckBypassedSandbox
        ? "Matched posted transaction (sandbox identity mismatch bypassed)."
        : "Matched posted transaction.",
      receipt_upload_id: receiptUpsert.id,
      expected_amount_cents: expectedAmountCents,
      matched_amount_cents: selected.amountCents,
      expected_merchant: expectedMerchant || null,
      matched_merchant: selected.merchant || null,
      expected_posted_on: expectedDate || null,
      matched_posted_on: selected.postedOn || null,
      matched_plaid_item_id: selected.plaidItemId,
      matched_plaid_transaction_id: selected.transactionId,
      last_checked_at: nowIso,
      confirmed_at: nowIso,
    });
    await insertAttempt(
      "matched_posted",
      identityCheckBypassedSandbox ? "identity_check_bypassed_sandbox" : null,
      {
      verificationId: verification?.id || null,
      candidateCount: allCandidates.length,
      postedCandidateCount: postedCandidates.length,
      bestScore: selected.score,
      matched: selected,
      },
    );

    return json({
      verificationStatus: "confirmed",
      reasonCode: null,
      message: "Purchase verified from linked bank transaction.",
      fallbackRequired: false,
      receiptUploadId: receiptUpsert.id,
      requestId: selected.requestId || lastRequestId || null,
      stripeDraftSync,
      copy: {
        primary: AUTO_COPY,
        secondary: PENDING_COPY,
      },
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
    console.error("plaid-verify-purchase failed", error);
    return json(
      {
        error: error?.message || "Server error",
        reasonCode: "plaid_error",
        fallbackRequired: true,
        fallbackMessage: FALLBACK_COPY,
      },
      500,
    );
  }
});
