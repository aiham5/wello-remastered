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

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const toLabel = (parts: Array<string | null | undefined>) =>
  parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

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

    const supabase = createAdminSupabase();
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

    const stripeToken = await plaidCreateStripeBankAccountToken(
      accessToken,
      plaidAccountId,
    );

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select(
        "id, full_name, email, stripe_cashout_account_id, stripe_cashout_external_account_id",
      )
      .eq("id", userId)
      .maybeSingle();
    if (profileError || !profile) {
      throw new HttpError(profileError?.message || "Profile not found.", 404);
    }

    let accountId = String(profile.stripe_cashout_account_id || "").trim();
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        default_currency: "usd",
        business_type: "individual",
        email: String(profile.email || "").trim() || undefined,
        metadata: {
          purpose: "consumer_cashout",
          user_id: userId,
        },
        capabilities: {
          transfers: { requested: true },
        },
      });
      accountId = account.id;
    }

    const external = await stripe.accounts.createExternalAccount(accountId, {
      external_account: stripeToken.stripe_bank_account_token,
    });
    const externalAccountId = String(external?.id || "").trim() || null;
    if (externalAccountId) {
      try {
        await stripe.accounts.updateExternalAccount(accountId, externalAccountId, {
          default_for_currency: true,
        });
      } catch {
        // Continue even if default selection fails; payouts can still be enabled.
      }
    }

    const previousExternalAccountId = String(
      profile?.stripe_cashout_external_account_id || "",
    ).trim();
    if (
      previousExternalAccountId &&
      externalAccountId &&
      previousExternalAccountId !== externalAccountId
    ) {
      try {
        await stripe.accounts.deleteExternalAccount(accountId, previousExternalAccountId);
      } catch {
        // Non-fatal: keep the new selection even if old external account cleanup fails.
      }
    }

    const account = await stripe.accounts.retrieve(accountId);
    const payoutsEnabled = Boolean(account?.payouts_enabled);
    const detailsSubmitted = Boolean(account?.details_submitted);
    const requirementsDue = Array.isArray(account?.requirements?.currently_due)
      ? account.requirements.currently_due
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
      disabledReason: account?.requirements?.disabled_reason || null,
      copy: {
        primary: payoutsEnabled
          ? "Payout bank selected. Cashouts are ready."
          : "Payout bank selected. Stripe may still require one-time verification.",
        secondary:
          "Cashback payouts still move through Stripe; Plaid is used to choose your bank.",
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
