import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  authenticateRequest,
  createAdminSupabase,
  HttpError,
  json,
} from "../_shared/auth.ts";
import {
  mergePlaidLinkPurposes,
  parsePlaidLinkPurpose,
} from "../_shared/plaidLinkPurposes.ts";
import { logPlaidEvent } from "../_shared/plaidLogging.ts";
import {
  plaidExchangePublicToken,
  plaidGetAccounts,
  plaidGetInstitutionById,
  plaidGetItem,
} from "../_shared/plaid.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";

export const config = { verify_jwt: false };

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let userIdForLog: string | null = null;
  let supabaseForLog: ReturnType<typeof createAdminSupabase> | null = null;

  try {
    const { userId, body } = await authenticateRequest(req);
    userIdForLog = userId;
    const supabase = createAdminSupabase();
    supabaseForLog = supabase;
    const purposes = parsePlaidLinkPurpose(
      body?.purpose ?? body?.linkPurpose ?? body?.link_purpose,
      { allowLegacyBoth: true, field: "purpose" },
    );
    await enforceRateLimit({
      req,
      scope: "plaid:exchange-public-token",
      userId,
      maxRequests: 8,
      windowSeconds: 10 * 60,
      supabase,
    });
    const publicToken = String(body?.publicToken || body?.public_token || "")
      .trim();
    if (!publicToken) {
      throw new HttpError("Missing public token.", 400, {
        reason: "missing_public_token",
      });
    }
    if (publicToken.length > 512) {
      throw new HttpError("Invalid public token.", 400, {
        reason: "invalid_public_token",
      });
    }

    const exchange = await plaidExchangePublicToken(publicToken);
    const item = await plaidGetItem(exchange.access_token);
    const accounts = await plaidGetAccounts(exchange.access_token);
    const institutionId = item?.item?.institution_id || null;

    let institutionName: string | null = null;
    if (institutionId) {
      try {
        const institution = await plaidGetInstitutionById(institutionId, [
          "US",
        ]);
        institutionName = institution?.institution?.name || null;
      } catch {
        institutionName = null;
      }
    }

    const { data: existingItem, error: existingItemError } = await supabase
      .from("plaid_linked_items")
      .select("user_id, link_purposes")
      .eq("plaid_item_id", exchange.item_id)
      .maybeSingle();
    if (existingItemError) {
      throw new HttpError(
        existingItemError.message ||
          "Unable to validate linked bank ownership.",
        500,
      );
    }
    const existingOwnerId = String(existingItem?.user_id || "").trim();
    if (existingOwnerId && existingOwnerId !== userId) {
      throw new HttpError(
        "This bank connection is already linked to another account.",
        409,
        { reason: "plaid_item_owned_by_another_user" },
      );
    }

    const { data: existingBankAccount, error: existingBankAccountError } =
      await supabase
        .from("user_bank_accounts")
        .select("user_id")
        .eq("plaid_item_id", exchange.item_id)
        .neq("user_id", userId)
        .maybeSingle();
    if (existingBankAccountError) {
      const message = String(existingBankAccountError.message || "")
        .toLowerCase();
      if (!message.includes("plaid_item_id")) {
        throw new HttpError(
          existingBankAccountError.message ||
            "Unable to validate bank account ownership.",
          500,
        );
      }
    }
    if (String(existingBankAccount?.user_id || "").trim()) {
      throw new HttpError(
        "This bank account is already linked to another Wello account.",
        409,
        {
          reason: "bank_already_linked",
          error: "BANK_ALREADY_LINKED",
        },
      );
    }

    const mergedItemPurposes = mergePlaidLinkPurposes(
      existingItem?.link_purposes,
      purposes,
    );
    const { error: upsertError } = await supabase
      .from("plaid_linked_items")
      .upsert(
        {
          user_id: userId,
          plaid_item_id: exchange.item_id,
          plaid_access_token: exchange.access_token,
          institution_id: institutionId,
          institution_name: institutionName,
          status: "active",
          available_products: item?.item?.available_products || [],
          billed_products: item?.item?.billed_products || [],
          consent_expires_at: item?.item?.consent_expiration_time || null,
          last_sync_at: null,
          link_purposes: mergedItemPurposes,
          update_mode_required: false,
          update_mode_reason: null,
          update_mode_detected_at: null,
          new_accounts_available: false,
          last_webhook_code: "LINK_SUCCESS",
        },
        { onConflict: "plaid_item_id" },
      );

    if (upsertError) {
      throw new HttpError(
        upsertError.message || "Unable to save linked bank.",
        500,
      );
    }

    const accountRows =
      (Array.isArray(accounts.accounts) ? accounts.accounts : [])
        .filter((account) =>
          String(account?.account_id || "").trim().length > 0
        )
        .map((account) => ({
          user_id: userId,
          plaid_item_id: exchange.item_id,
          plaid_account_id: String(account.account_id).trim(),
          account_name: String(
            account.official_name || account.name || account.subtype ||
              "Bank account",
          ).trim(),
          account_mask: String(account.mask || "").trim() || null,
          account_subtype: String(account.subtype || "").trim() || null,
          account_type: String(account.type || "").trim() || null,
          status: "active",
          link_purposes: purposes,
        }));

    if (accountRows.length > 0) {
      const { data: existingAccounts } = await supabase
        .from("plaid_linked_accounts")
        .select("plaid_account_id, link_purposes")
        .eq("user_id", userId)
        .eq("plaid_item_id", exchange.item_id);
      const purposeByAccountId = new Map<string, typeof purposes>();
      (Array.isArray(existingAccounts) ? existingAccounts : []).forEach((row) => {
        const accountId = String(row?.plaid_account_id || "").trim();
        if (!accountId) return;
        purposeByAccountId.set(
          accountId,
          mergePlaidLinkPurposes(row?.link_purposes, purposes),
        );
      });
      accountRows.forEach((row) => {
        row.link_purposes = purposeByAccountId.get(row.plaid_account_id) || purposes;
      });
    }

    if (accountRows.length > 0) {
      const { error: accountUpsertError } = await supabase
        .from("plaid_linked_accounts")
        .upsert(accountRows, {
          onConflict: "plaid_item_id,plaid_account_id",
        });
      if (accountUpsertError) {
        throw new HttpError(
          accountUpsertError.message ||
            "Unable to save linked account details.",
          500,
        );
      }

      const keepIds = new Set(accountRows.map((row) => row.plaid_account_id));
      const { data: activeRows } = await supabase
        .from("plaid_linked_accounts")
        .select("id, plaid_account_id")
        .eq("user_id", userId)
        .eq("plaid_item_id", exchange.item_id)
        .eq("status", "active");
      const staleIds = (Array.isArray(activeRows) ? activeRows : [])
        .filter((row) =>
          !keepIds.has(String(row?.plaid_account_id || "").trim())
        )
        .map((row) => row.id)
        .filter(Boolean);
      if (staleIds.length > 0) {
        await supabase
          .from("plaid_linked_accounts")
          .update({ status: "revoked" })
          .in("id", staleIds);
      }

      const { error: userBankAccountError } = await supabase
        .from("user_bank_accounts")
        .update({
          plaid_item_id: exchange.item_id,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
      if (userBankAccountError) {
        const message = String(userBankAccountError.message || "").toLowerCase();
        if (!message.includes("plaid_item_id")) {
          throw new HttpError(
            userBankAccountError.message ||
              "Unable to update linked bank cross-reference.",
            500,
          );
        }
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("stripe_cashout_plaid_item_id, stripe_cashout_plaid_account_id")
        .eq("id", userId)
        .maybeSingle();
      const selectedItemId = String(profile?.stripe_cashout_plaid_item_id || "")
        .trim();
      const selectedAccountId = String(
        profile?.stripe_cashout_plaid_account_id || "",
      ).trim();
      if (
        selectedItemId === exchange.item_id &&
        selectedAccountId &&
        !keepIds.has(selectedAccountId)
      ) {
        await supabase
          .from("profiles")
          .update({
            stripe_cashout_plaid_item_id: null,
            stripe_cashout_plaid_account_id: null,
            stripe_cashout_account_label: null,
            stripe_cashout_external_account_id: null,
            stripe_cashout_bank_synced_at: null,
          })
          .eq("id", userId);
      }
    } else {
      await supabase
        .from("plaid_linked_accounts")
        .update({ status: "revoked" })
        .eq("user_id", userId)
        .eq("plaid_item_id", exchange.item_id)
        .eq("status", "active");

      await supabase
        .from("profiles")
        .update({
          stripe_cashout_plaid_item_id: null,
          stripe_cashout_plaid_account_id: null,
          stripe_cashout_account_label: null,
          stripe_cashout_external_account_id: null,
          stripe_cashout_bank_synced_at: null,
        })
        .eq("id", userId)
        .eq("stripe_cashout_plaid_item_id", exchange.item_id);
    }

    await logPlaidEvent(supabase, {
      sourceFunction: "plaid-exchange-public-token",
      eventName: "public_token_exchanged",
      severity: "info",
      userId,
      plaidItemId: exchange.item_id,
      requestId: exchange.request_id || item.request_id || accounts.requestId || null,
      metadata: {
        linkedAccountCount: accountRows.length,
        hasInstitutionId: Boolean(institutionId),
        hasInstitutionName: Boolean(institutionName),
        purposes,
      },
    });

    return json({
      linked: true,
      itemId: exchange.item_id,
      institutionId,
      institutionName,
      linkedAccountCount: accountRows.length,
      purposes,
      copy: {
        primary:
          "Cashback is automatically verified when purchases are visible through your linked bank.",
        secondary:
          "Cashback may appear as pending while verification completes.",
      },
    });
  } catch (error) {
    if (supabaseForLog && userIdForLog) {
      const reasonCode = error instanceof HttpError
        ? String(error?.details?.reason || "").trim() || null
        : null;
      await logPlaidEvent(supabaseForLog, {
        sourceFunction: "plaid-exchange-public-token",
        eventName: "public_token_exchange_failed",
        severity: "error",
        userId: userIdForLog,
        reasonCode,
        metadata: {
          status: error instanceof HttpError ? error.status : 500,
          message: String(error?.message || "Server error"),
        },
      });
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
    console.error("plaid-exchange-public-token failed", error);
    return json(
      {
        error: error?.message || "Server error",
      },
      500,
    );
  }
});
