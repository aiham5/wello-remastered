import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  authenticateRequest,
  createAdminSupabase,
  HttpError,
  json,
} from "../_shared/auth.ts";
import { hasPlaidLinkPurpose } from "../_shared/plaidLinkPurposes.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";

export const config = { verify_jwt: false };
const DEFAULT_MONTHLY_SWITCH_LIMIT = Math.max(
  Number(Deno.env.get("CASHOUT_BANK_SWITCH_MONTHLY_LIMIT") || 2) || 2,
  1,
);
const CASHOUT_SWITCH_LIMIT_DISABLED = /^(1|true|yes|on)$/i.test(
  String(Deno.env.get("CASHOUT_BANK_SWITCH_LIMIT_DISABLED") || "").trim(),
);
const TEST_UNLIMITED_SWITCH_LIMIT = 9999;

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { userId } = await authenticateRequest(req);
    const supabase = createAdminSupabase();
    await enforceRateLimit({
      req,
      scope: "plaid:get-link-status",
      userId,
      maxRequests: 120,
      windowSeconds: 5 * 60,
      supabase,
    });
    const { data, error } = await supabase
      .from("plaid_linked_items")
      .select(
        "plaid_item_id, institution_id, institution_name, status, consent_expires_at, last_sync_at, created_at, update_mode_required, update_mode_reason, update_mode_detected_at, new_accounts_available, link_purposes",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new HttpError(
        error.message || "Unable to load bank link status.",
        500,
      );
    }

    const rows = Array.isArray(data) ? data : [];
    const actionableRows = rows.filter((item) => item.status !== "revoked");
    const active = actionableRows.filter(
      (item) => item.status === "active",
    );
    const updateRequiredItem = actionableRows.find((item) =>
      Boolean(item?.update_mode_required)
    );
    const newAccountsItem = actionableRows.find((item) =>
      !item?.update_mode_required && Boolean(item?.new_accounts_available)
    );
    const attentionItem = updateRequiredItem || newAccountsItem || null;
    const updateModeReasonRaw = String(attentionItem?.update_mode_reason || "")
      .trim()
      .toLowerCase();
    const updateModeReasonLabel = (() => {
      switch (updateModeReasonRaw) {
        case "item_login_required":
          return "Bank login required";
        case "pending_expiration":
          return "Access expiring soon";
        case "pending_disconnect":
          return "Reconnect needed";
        default:
          return null;
      }
    })();

    const activeItemIds = active
      .map((item) => String(item?.plaid_item_id || "").trim())
      .filter(Boolean);

    let linkedAccounts: Array<Record<string, unknown>> = [];
    if (activeItemIds.length > 0) {
      const { data: accountsData, error: accountsError } = await supabase
        .from("plaid_linked_accounts")
        .select(
          "plaid_item_id, plaid_account_id, account_name, account_mask, account_subtype, account_type, status, created_at, link_purposes",
        )
        .eq("user_id", userId)
        .eq("status", "active")
        .in("plaid_item_id", activeItemIds)
        .order("created_at", { ascending: true });
      if (accountsError) {
        throw new HttpError(
          accountsError.message || "Unable to load linked bank accounts.",
          500,
        );
      }
      linkedAccounts = Array.isArray(accountsData) ? accountsData : [];
    }

    const { data: profileData } = await supabase
      .from("profiles")
      .select(
        "stripe_cashout_plaid_account_id, stripe_cashout_account_label, stripe_cashout_bank_synced_at",
      )
      .eq("id", userId)
      .maybeSingle();

    let switchPolicyRow: Record<string, unknown> | null = null;
    let monthlyLimit = DEFAULT_MONTHLY_SWITCH_LIMIT;
    let switchesUsed = 0;
    let switchesRemaining = DEFAULT_MONTHLY_SWITCH_LIMIT;
    if (CASHOUT_SWITCH_LIMIT_DISABLED) {
      monthlyLimit = TEST_UNLIMITED_SWITCH_LIMIT;
      switchesUsed = 0;
      switchesRemaining = TEST_UNLIMITED_SWITCH_LIMIT;
    } else {
      const { data: switchPolicyRows, error: switchPolicyError } =
        await supabase.rpc(
          "get_cashout_bank_switch_policy",
          {
            p_user_id: userId,
            p_monthly_limit: DEFAULT_MONTHLY_SWITCH_LIMIT,
          },
        );
      if (switchPolicyError) {
        throw new HttpError(
          switchPolicyError.message || "Unable to load payout switch policy.",
          500,
        );
      }
      switchPolicyRow = Array.isArray(switchPolicyRows)
        ? switchPolicyRows[0]
        : switchPolicyRows;
      monthlyLimit = Math.max(
        Number(switchPolicyRow?.monthly_limit) || DEFAULT_MONTHLY_SWITCH_LIMIT,
        1,
      );
      switchesUsed = Math.max(Number(switchPolicyRow?.switches_used) || 0, 0);
      switchesRemaining = switchPolicyRow?.switches_remaining != null
        ? Math.max(Number(switchPolicyRow.switches_remaining) || 0, 0)
        : Math.max(monthlyLimit - switchesUsed, 0);
    }

    const selectedPayoutAccountId = String(
      profileData?.stripe_cashout_plaid_account_id || "",
    ).trim();
    const linkedSince = active
      .map((item) => String(item.created_at || "").trim())
      .filter(Boolean)
      .sort()[0] || null;

    const institutionByItemId = new Map<string, string | null>();
    active.forEach((item) => {
      const itemId = String(item?.plaid_item_id || "").trim();
      if (!itemId) return;
      institutionByItemId.set(
        itemId,
        String(item?.institution_name || "").trim() || null,
      );
    });
    const activeCashoutItems = active.filter((item) =>
      hasPlaidLinkPurpose(item?.link_purposes, "cashout")
    );
    const activeReceiptItems = active.filter((item) =>
      hasPlaidLinkPurpose(item?.link_purposes, "receipt_verification")
    );
    const activeCashoutAccounts = linkedAccounts.filter((account) =>
      hasPlaidLinkPurpose(account?.link_purposes, "cashout")
    );
    const activeReceiptAccounts = linkedAccounts.filter((account) =>
      hasPlaidLinkPurpose(account?.link_purposes, "receipt_verification")
    );
    const selectedCashoutAccountId = activeCashoutAccounts.some((account) =>
        String(account?.plaid_account_id || "").trim() === selectedPayoutAccountId
      )
      ? selectedPayoutAccountId
      : "";

    return json({
      linked: active.length > 0,
      linkedCount: active.length,
      linkedSince,
      linkedAccountCount: activeCashoutAccounts.length,
      accounts: activeCashoutAccounts.map((account) => {
        const itemId = String(account?.plaid_item_id || "").trim();
        const accountId = String(account?.plaid_account_id || "").trim();
        const mask = String(account?.account_mask || "").trim() || null;
        return {
          itemId,
          accountId,
          institutionName: institutionByItemId.get(itemId) || null,
          name: String(account?.account_name || "").trim() || "Bank account",
          mask,
          subtype: String(account?.account_subtype || "").trim() || null,
          type: String(account?.account_type || "").trim() || null,
          selectedForPayout: Boolean(selectedPayoutAccountId) &&
            selectedPayoutAccountId === accountId,
        };
      }),
      payoutSelection: {
        selectedAccountId: selectedPayoutAccountId || null,
        label: String(profileData?.stripe_cashout_account_label || "").trim() ||
          null,
        syncedAt: profileData?.stripe_cashout_bank_synced_at || null,
      },
      payoutSwitchPolicy: {
        monthlyLimit,
        switchesUsed,
        switchesRemaining,
        monthResetsAt: CASHOUT_SWITCH_LIMIT_DISABLED
          ? null
          : switchPolicyRow?.month_resets_at || null,
        canSwitch: CASHOUT_SWITCH_LIMIT_DISABLED || switchesRemaining > 0,
      },
      updateMode: {
        required: Boolean(updateRequiredItem),
        accountSelectionAvailable: Boolean(
          !updateRequiredItem && newAccountsItem,
        ),
        needsAttention: Boolean(attentionItem),
        reason: updateModeReasonRaw || null,
        reasonLabel: updateModeReasonLabel,
        itemId: attentionItem?.plaid_item_id || null,
        detectedAt: attentionItem?.update_mode_detected_at || null,
      },
      items: active.map((item) => ({
        itemId: item.plaid_item_id,
        institutionId: item.institution_id || null,
        institutionName: item.institution_name || null,
        consentExpiresAt: item.consent_expires_at || null,
        lastSyncAt: item.last_sync_at || null,
      })),
      copy: {
        primary:
          "Cashback is automatically verified when purchases are visible through your linked bank.",
        secondary:
          "Some cards or banks may require receipt upload for verification.",
      },
      purposes: {
        cashout: {
          linked: activeCashoutItems.length > 0,
          linkedCount: activeCashoutItems.length,
          linkedAccountCount: activeCashoutAccounts.length,
          selectedPayoutAccountId: selectedCashoutAccountId || null,
        },
        receiptVerification: {
          linked: activeReceiptItems.length > 0,
          linkedCount: activeReceiptItems.length,
          linkedAccountCount: activeReceiptAccounts.length,
        },
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
    console.error("plaid-get-link-status failed", error);
    return json(
      {
        error: error?.message || "Server error",
      },
      500,
    );
  }
});
