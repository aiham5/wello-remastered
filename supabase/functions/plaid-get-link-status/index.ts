import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  HttpError,
  authenticateRequest,
  createAdminSupabase,
  json,
} from "../_shared/auth.ts";

export const config = { verify_jwt: false };
const DEFAULT_MONTHLY_SWITCH_LIMIT = Math.max(
  Number(Deno.env.get("CASHOUT_BANK_SWITCH_MONTHLY_LIMIT") || 2) || 2,
  1,
);

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { userId } = await authenticateRequest(req);
    const supabase = createAdminSupabase();
    const { data, error } = await supabase
      .from("plaid_linked_items")
      .select(
        "plaid_item_id, institution_id, institution_name, status, consent_expires_at, last_sync_at, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new HttpError(error.message || "Unable to load bank link status.", 500);
    }

    const active = (Array.isArray(data) ? data : []).filter(
      (item) => item.status === "active",
    );
    const activeItemIds = active
      .map((item) => String(item?.plaid_item_id || "").trim())
      .filter(Boolean);

    let linkedAccounts: Array<Record<string, unknown>> = [];
    if (activeItemIds.length > 0) {
      const { data: accountsData, error: accountsError } = await supabase
        .from("plaid_linked_accounts")
        .select(
          "plaid_item_id, plaid_account_id, account_name, account_mask, account_subtype, account_type, status, created_at",
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

    const { data: switchPolicyRows, error: switchPolicyError } = await supabase.rpc(
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
    const switchPolicyRow = Array.isArray(switchPolicyRows)
      ? switchPolicyRows[0]
      : switchPolicyRows;
    const monthlyLimit = Math.max(
      Number(switchPolicyRow?.monthly_limit) || DEFAULT_MONTHLY_SWITCH_LIMIT,
      1,
    );
    const switchesUsed = Math.max(Number(switchPolicyRow?.switches_used) || 0, 0);
    const switchesRemaining =
      switchPolicyRow?.switches_remaining != null
        ? Math.max(Number(switchPolicyRow.switches_remaining) || 0, 0)
        : Math.max(monthlyLimit - switchesUsed, 0);

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

    return json({
      linked: active.length > 0,
      linkedCount: active.length,
      linkedSince,
      linkedAccountCount: linkedAccounts.length,
      accounts: linkedAccounts.map((account) => {
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
          selectedForPayout:
            Boolean(selectedPayoutAccountId) &&
            selectedPayoutAccountId === accountId,
        };
      }),
      payoutSelection: {
        selectedAccountId: selectedPayoutAccountId || null,
        label: String(profileData?.stripe_cashout_account_label || "").trim() || null,
        syncedAt: profileData?.stripe_cashout_bank_synced_at || null,
      },
      payoutSwitchPolicy: {
        monthlyLimit,
        switchesUsed,
        switchesRemaining,
        monthResetsAt: switchPolicyRow?.month_resets_at || null,
        canSwitch: switchesRemaining > 0,
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
