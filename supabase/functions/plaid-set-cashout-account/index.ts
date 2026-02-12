import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import {
  HttpError,
  authenticateRequest,
  createAdminSupabase,
  json,
} from "../_shared/auth.ts";
import { plaidCreateStripeBankAccountToken } from "../_shared/plaid.ts";

export const config = { verify_jwt: false };

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const DEFAULT_MONTHLY_SWITCH_LIMIT = Math.max(
  Number(Deno.env.get("CASHOUT_BANK_SWITCH_MONTHLY_LIMIT") || 2) || 2,
  1,
);

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
  timeout: 15000,
  maxNetworkRetries: 0,
});

const toLabel = (parts: Array<string | null | undefined>) =>
  parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

const createManagedCashoutAccount = async (
  userId: string,
  email: string | null | undefined,
) => {
  return await stripe.accounts.create({
    type: "express",
    country: "US",
    default_currency: "usd",
    business_type: "individual",
    email: String(email || "").trim() || undefined,
    metadata: {
      purpose: "consumer_cashout",
      user_id: userId,
    },
    capabilities: {
      transfers: { requested: true },
    },
  });
};

const isRecoverableCashoutAccountError = (
  error: unknown,
): boolean => {
  const code = String((error as { code?: string })?.code || "").trim();
  const type = String((error as { type?: string })?.type || "").trim();
  return (
    code === "oauth_not_supported" ||
    code === "resource_missing" ||
    code === "account_invalid" ||
    type === "StripePermissionError"
  );
};

const retrieveAccountWithTimeout = async (
  accountId: string,
  timeoutMs = 2500,
) => {
  let timer: number | null = null;
  try {
    return await Promise.race([
      stripe.accounts.retrieve(accountId),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
};

type PayoutSwitchPolicy = {
  monthlyLimit: number;
  switchesUsed: number;
  switchesRemaining: number;
  monthResetsAt: string | null;
  canSwitch: boolean;
};

const parseSwitchPolicyRow = (
  row: Record<string, unknown> | null | undefined,
): PayoutSwitchPolicy => {
  const monthlyLimit = Math.max(
    Number(row?.monthly_limit) || DEFAULT_MONTHLY_SWITCH_LIMIT,
    1,
  );
  const switchesUsed = Math.max(Number(row?.switches_used) || 0, 0);
  const switchesRemaining =
    row?.switches_remaining != null
      ? Math.max(Number(row.switches_remaining) || 0, 0)
      : Math.max(monthlyLimit - switchesUsed, 0);
  return {
    monthlyLimit,
    switchesUsed,
    switchesRemaining,
    monthResetsAt: row?.month_resets_at
      ? String(row.month_resets_at)
      : null,
    canSwitch: switchesRemaining > 0,
  };
};

const loadSwitchPolicy = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
): Promise<PayoutSwitchPolicy> => {
  const { data: policyRows, error: policyError } = await supabase.rpc(
    "get_cashout_bank_switch_policy",
    {
      p_user_id: userId,
      p_monthly_limit: DEFAULT_MONTHLY_SWITCH_LIMIT,
    },
  );
  if (policyError) {
    throw new HttpError(
      policyError.message || "Unable to read payout switch policy.",
      500,
    );
  }
  const row = Array.isArray(policyRows) ? policyRows[0] : policyRows;
  return parseSwitchPolicyRow(row || null);
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let supabase: ReturnType<typeof createAdminSupabase> | null = null;
  let consumedSwitchEventId: string | null = null;

  try {
    if (!STRIPE_SECRET_KEY) {
      throw new HttpError("Missing server configuration.", 500);
    }

    const { userId, body } = await authenticateRequest(req);
    const plaidAccountId = String(
      body?.plaidAccountId || body?.plaid_account_id || body?.accountId || "",
    ).trim();
    if (!plaidAccountId) {
      throw new HttpError("Choose a bank account first.", 400, {
        reason: "missing_plaid_account_id",
      });
    }

    supabase = createAdminSupabase();
    const { data: linkedAccount, error: linkedAccountError } = await supabase
      .from("plaid_linked_accounts")
      .select(
        "plaid_item_id, plaid_account_id, account_name, account_mask, account_subtype, account_type, status",
      )
      .eq("user_id", userId)
      .eq("plaid_account_id", plaidAccountId)
      .eq("status", "active")
      .maybeSingle();
    if (linkedAccountError || !linkedAccount) {
      throw new HttpError(
        linkedAccountError?.message || "Linked account not found.",
        400,
        { reason: "plaid_account_not_found" },
      );
    }

    const plaidItemId = String(linkedAccount.plaid_item_id || "").trim();
    const { data: linkedItem, error: linkedItemError } = await supabase
      .from("plaid_linked_items")
      .select("plaid_access_token, institution_name, status")
      .eq("user_id", userId)
      .eq("plaid_item_id", plaidItemId)
      .eq("status", "active")
      .maybeSingle();
    if (linkedItemError || !linkedItem) {
      throw new HttpError(
        linkedItemError?.message || "Linked institution is not active.",
        400,
        { reason: "plaid_item_not_active" },
      );
    }

    const accessToken = String(linkedItem.plaid_access_token || "").trim();
    if (!accessToken) {
      throw new HttpError("Linked institution requires relinking.", 400, {
        reason: "plaid_access_token_missing",
      });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select(
        [
          "id",
          "full_name",
          "email",
          "stripe_cashout_account_id",
          "stripe_cashout_external_account_id",
          "stripe_cashout_plaid_account_id",
          "stripe_cashout_payouts_enabled",
        ].join(","),
      )
      .eq("id", userId)
      .maybeSingle();
    if (profileError || !profile) {
      throw new HttpError(profileError?.message || "Profile not found.", 404);
    }
    const profileRow = profile as unknown as Record<string, unknown>;

    const previousSelectedPlaidAccountId = String(
      profileRow.stripe_cashout_plaid_account_id || "",
    ).trim();
    let switchPolicy = await loadSwitchPolicy(supabase, userId);
    if (
      previousSelectedPlaidAccountId &&
      previousSelectedPlaidAccountId !== plaidAccountId
    ) {
      const { data: consumeRows, error: consumeError } = await supabase.rpc(
        "consume_cashout_bank_switch",
        {
          p_user_id: userId,
          p_from_plaid_account_id: previousSelectedPlaidAccountId,
          p_to_plaid_account_id: plaidAccountId,
          p_monthly_limit: DEFAULT_MONTHLY_SWITCH_LIMIT,
        },
      );
      if (consumeError) {
        throw new HttpError(
          consumeError.message || "Unable to enforce payout switch policy.",
          500,
        );
      }

      const consumeRow = Array.isArray(consumeRows) ? consumeRows[0] : consumeRows;
      switchPolicy = parseSwitchPolicyRow({
        monthly_limit: consumeRow?.monthly_limit,
        switches_used: consumeRow?.switches_used,
        switches_remaining: consumeRow?.switches_remaining,
        month_resets_at: consumeRow?.month_resets_at,
      });
      consumedSwitchEventId = String(consumeRow?.event_id || "").trim() || null;
      if (!consumeRow?.allowed) {
        throw new HttpError(
          "You can change your payout bank up to 2 times per month.",
          429,
          {
            reason: "cashout_switch_limit_reached",
            payoutSwitchPolicy: switchPolicy,
          },
        );
      }
    }

    const stripeToken = await plaidCreateStripeBankAccountToken(
      accessToken,
      plaidAccountId,
    );

    let accountId = String(profileRow.stripe_cashout_account_id || "").trim();
    if (!accountId) {
      const replacement = await createManagedCashoutAccount(
        userId,
        String(profileRow.email || "").trim() || null,
      );
      accountId = replacement.id;
    }

    const createExternalForAccount = async (targetAccountId: string) => {
      const external = await stripe.accounts.createExternalAccount(targetAccountId, {
        external_account: stripeToken.stripe_bank_account_token,
      });
      return String(external?.id || "").trim() || null;
    };

    let externalAccountId: string | null = null;
    try {
      externalAccountId = await createExternalForAccount(accountId);
    } catch (error) {
      if (isRecoverableCashoutAccountError(error)) {
        const replacement = await createManagedCashoutAccount(
          userId,
          String(profileRow.email || "").trim() || null,
        );
        accountId = replacement.id;
        externalAccountId = await createExternalForAccount(accountId);
      } else {
        throw error;
      }
    }

    // Best-effort, time-bounded account status fetch to keep UX fast.
    const account = await retrieveAccountWithTimeout(accountId, 2500);
    const payoutsEnabled =
      account && typeof account === "object"
        ? Boolean((account as { payouts_enabled?: boolean })?.payouts_enabled)
        : Boolean(profileRow?.stripe_cashout_payouts_enabled);
    const detailsSubmitted =
      account && typeof account === "object"
        ? Boolean((account as { details_submitted?: boolean })?.details_submitted)
        : false;
    const requirementsDue =
      account && typeof account === "object"
      && Array.isArray((account as { requirements?: { currently_due?: string[] } })?.requirements?.currently_due)
        ? (account as { requirements?: { currently_due?: string[] } }).requirements?.currently_due || []
        : [];
    const onboardingRequired = !payoutsEnabled || requirementsDue.length > 0;

    const label = toLabel([
      String(linkedItem.institution_name || "").trim() || "Linked bank",
      String(linkedAccount.account_name || "").trim() ||
        String(linkedAccount.account_subtype || "").trim() ||
        "Account",
      linkedAccount.account_mask
        ? `****${String(linkedAccount.account_mask).trim()}`
        : null,
    ]);

    const { error: profileUpdateError } = await supabase
      .from("profiles")
      .update({
        stripe_cashout_account_id: accountId,
        stripe_cashout_payouts_enabled: payoutsEnabled,
        stripe_cashout_onboarded_at: payoutsEnabled
          ? new Date().toISOString()
          : null,
        stripe_cashout_plaid_item_id: plaidItemId,
        stripe_cashout_plaid_account_id: plaidAccountId,
        stripe_cashout_account_label: label || null,
        stripe_cashout_external_account_id: externalAccountId,
        stripe_cashout_bank_synced_at: new Date().toISOString(),
      })
      .eq("id", userId);
    if (profileUpdateError) {
      throw new HttpError(
        profileUpdateError.message || "Unable to save payout bank selection.",
        500,
      );
    }
    consumedSwitchEventId = null;

    return json({
      selected: true,
      connected: true,
      payoutsEnabled,
      detailsSubmitted,
      onboardingRequired,
      accountId,
      selectedAccountId: plaidAccountId,
      selectedAccountLabel: label || null,
      requirementsDue,
      disabledReason:
        account && typeof account === "object"
          ? (account as { requirements?: { disabled_reason?: string | null } })
              ?.requirements?.disabled_reason || null
          : null,
      payoutSwitchPolicy: switchPolicy,
      copy: {
        primary: payoutsEnabled
          ? "Payout bank selected. Cashouts are ready."
          : "Payout bank selected. Stripe may still require one-time verification.",
        secondary:
          "Cashback payouts still move through Stripe; Plaid is used to choose your bank.",
      },
    });
  } catch (error) {
    if (consumedSwitchEventId && supabase) {
      await supabase
        .from("cashout_bank_switch_events")
        .delete()
        .eq("id", consumedSwitchEventId);
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
    console.error("plaid-set-cashout-account failed", error);
    return json(
      {
        error: error?.message || "Unable to set payout account.",
        type: error?.type || null,
        code: error?.code || null,
      },
      500,
    );
  }
});
