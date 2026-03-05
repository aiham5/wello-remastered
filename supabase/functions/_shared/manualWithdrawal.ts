import { HttpError, createAdminSupabase } from "./auth.ts";

const MANUAL_BANK_ENCRYPTION_KEY = String(
  Deno.env.get("MANUAL_BANK_ENCRYPTION_KEY") ||
    Deno.env.get("BANK_DATA_ENCRYPTION_KEY") ||
    "",
).trim();

export const normalizeDigits = (value: unknown) =>
  String(value || "").replace(/\D+/g, "");

export const normalizeName = (value: unknown) =>
  String(value || "").trim().replace(/\s+/g, " ");

export const getManualBankEncryptionKey = () => {
  if (MANUAL_BANK_ENCRYPTION_KEY.length < 16) {
    throw new HttpError("Missing server configuration.", 500, {
      reason: "bank_encryption_key_missing",
    });
  }
  return MANUAL_BANK_ENCRYPTION_KEY;
};

export const upsertUserBankAccountSecure = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  input: {
    userId: string;
    routingNumber: string;
    accountNumber: string;
    bankName: string | null;
    accountHolderName: string;
  },
) => {
  const routingNumber = normalizeDigits(input.routingNumber);
  const accountNumber = normalizeDigits(input.accountNumber);
  const accountHolderName = normalizeName(input.accountHolderName);
  const bankName = String(input.bankName || "").trim() || null;

  if (routingNumber.length < 4 || accountNumber.length < 4) {
    throw new HttpError("Invalid bank account details.", 400, {
      reason: "invalid_bank_account_details",
    });
  }
  if (!accountHolderName) {
    throw new HttpError("Invalid bank account holder name.", 400, {
      reason: "invalid_account_holder_name",
    });
  }

  const { data, error } = await supabase.rpc("upsert_user_bank_account_secure", {
    p_user_id: input.userId,
    p_routing_number: routingNumber,
    p_account_number: accountNumber,
    p_bank_name: bankName,
    p_account_holder_name: accountHolderName,
    p_encryption_key: getManualBankEncryptionKey(),
  });
  if (error) {
    const message = String(error.message || "").trim();
    if (/column reference \"user_id\" is ambiguous/i.test(message)) {
      throw new HttpError(
        "Bank account save is temporarily unavailable. Please try again in a moment.",
        500,
        { reason: "bank_account_upsert_user_id_ambiguous" },
      );
    }
    if (
      /could not find the function/i.test(message) ||
      /function .* does not exist/i.test(message)
    ) {
      throw new HttpError(
        "Withdrawal system setup is still syncing. Please try again in a minute.",
        500,
        { reason: "manual_withdrawal_schema_cache_stale" },
      );
    }
    throw new HttpError(
      message || "Unable to save bank account details.",
      500,
      { reason: "bank_account_upsert_failed" },
    );
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    id: String(row?.id || "").trim() || null,
    userId: String(row?.user_id || "").trim() || input.userId,
    bankName: String(row?.bank_name || "").trim() || bankName,
    accountHolderName:
      String(row?.account_holder_name || "").trim() || accountHolderName,
    routingLast4: String(row?.routing_last4 || "").trim() || routingNumber.slice(-4),
    accountLast4: String(row?.account_last4 || "").trim() || accountNumber.slice(-4),
    updatedAt: String(row?.updated_at || "").trim() || null,
  };
};

export const getUserBankAccountSecure = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
) => {
  const { data, error } = await supabase.rpc("get_user_bank_account_secure", {
    p_user_id: userId,
    p_encryption_key: getManualBankEncryptionKey(),
  });
  if (error) {
    const message = String(error.message || "").trim();
    if (
      /could not find the function/i.test(message) ||
      /function .* does not exist/i.test(message)
    ) {
      throw new HttpError(
        "Withdrawal system setup is still syncing. Please try again in a minute.",
        500,
        { reason: "manual_withdrawal_schema_cache_stale" },
      );
    }
    throw new HttpError(
      message || "Unable to load linked bank account.",
      500,
      { reason: "bank_account_read_failed" },
    );
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return null;
  }
  const routingNumber = normalizeDigits(row.routing_number);
  const accountNumber = normalizeDigits(row.account_number);
  const accountHolderName = normalizeName(row.account_holder_name);
  if (routingNumber.length < 4 || accountNumber.length < 4 || !accountHolderName) {
    throw new HttpError("Linked bank account is invalid.", 400, {
      reason: "linked_bank_account_invalid",
    });
  }
  return {
    id: String(row.id || "").trim() || null,
    userId: String(row.user_id || "").trim() || userId,
    routingNumber,
    accountNumber,
    routingLast4: String(row.routing_last4 || "").trim() || routingNumber.slice(-4),
    accountLast4: String(row.account_last4 || "").trim() || accountNumber.slice(-4),
    bankName: String(row.bank_name || "").trim() || null,
    accountHolderName,
    createdAt: String(row.created_at || "").trim() || null,
    updatedAt: String(row.updated_at || "").trim() || null,
  };
};

export const createWithdrawalRequestSecure = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  input: {
    userId: string;
    payoutId: string;
    amountUsd: number;
    routingNumber: string;
    accountNumber: string;
    bankName: string | null;
    accountHolderName: string;
    adminNotes: string | null;
  },
) => {
  const { data, error } = await supabase.rpc("create_withdrawal_request_secure", {
    p_user_id: input.userId,
    p_payout_id: input.payoutId,
    p_amount: input.amountUsd,
    p_routing_number: normalizeDigits(input.routingNumber),
    p_account_number: normalizeDigits(input.accountNumber),
    p_bank_name: String(input.bankName || "").trim() || null,
    p_account_holder_name: normalizeName(input.accountHolderName),
    p_admin_notes: String(input.adminNotes || "").trim() || null,
    p_encryption_key: getManualBankEncryptionKey(),
  });
  if (error) {
    const message = String(error.message || "").trim();
    if (
      /could not find the function/i.test(message) ||
      /function .* does not exist/i.test(message)
    ) {
      throw new HttpError(
        "Withdrawal system setup is still syncing. Please try again in a minute.",
        500,
        { reason: "manual_withdrawal_schema_cache_stale" },
      );
    }
    throw new HttpError(
      message || "Unable to create withdrawal request.",
      500,
      { reason: "withdrawal_request_insert_failed" },
    );
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    id: String(row?.id || "").trim() || null,
    userId: String(row?.user_id || "").trim() || input.userId,
    payoutId: String(row?.payout_id || "").trim() || input.payoutId,
    amount: Number(row?.amount) || input.amountUsd,
    status: String(row?.status || "").trim().toLowerCase() || "pending",
    createdAt: String(row?.created_at || "").trim() || null,
  };
};
