import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  authenticateRequest,
  createAdminSupabase,
  HttpError,
  json,
} from "../_shared/auth.ts";
import { logPlaidEvent } from "../_shared/plaidLogging.ts";
import { plaidCreateLinkToken } from "../_shared/plaid.ts";

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
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) {
      throw new HttpError(
        profileError.message || "Unable to load profile.",
        500,
      );
    }

    const { data: itemRows, error: itemError } = await supabase
      .from("plaid_linked_items")
      .select(
        "plaid_item_id, plaid_access_token, status, update_mode_required, update_mode_reason, new_accounts_available, updated_at, created_at",
      )
      .eq("user_id", userId)
      .neq("status", "revoked")
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (itemError) {
      throw new HttpError(
        itemError.message || "Unable to load linked bank items.",
        500,
      );
    }

    const platform = typeof body?.platform === "string"
      ? body.platform.toLowerCase()
      : "";
    const androidPackageName = typeof body?.androidPackageName === "string"
      ? body.androidPackageName
      : typeof body?.android_package_name === "string"
      ? body.android_package_name
      : null;

    const items = Array.isArray(itemRows) ? itemRows : [];
    const updateRequiredItem = items.find((row) =>
      Boolean(row?.update_mode_required) &&
      String(row?.plaid_access_token || "").trim().length > 0
    );
    const newAccountsItem = items.find((row) =>
      !row?.update_mode_required &&
      Boolean(row?.new_accounts_available) &&
      String(row?.plaid_access_token || "").trim().length > 0
    );
    const updateItem = updateRequiredItem || newAccountsItem || null;
    const updateModeReason = String(updateItem?.update_mode_reason || "")
      .trim()
      .toLowerCase();
    const updateModeRequired = Boolean(updateRequiredItem);
    const accountSelectionEnabled = Boolean(
      !updateRequiredItem && newAccountsItem,
    );

    const plaid = await plaidCreateLinkToken({
      userId,
      email: profile?.email || null,
      fullName: profile?.full_name || null,
      platform,
      androidPackageName,
      accessToken: updateItem?.plaid_access_token || null,
      accountSelectionEnabled,
    });

    const mode = updateItem
      ? accountSelectionEnabled ? "update_account_selection" : "update_repair"
      : "link_new";

    await logPlaidEvent(supabase, {
      sourceFunction: "plaid-create-link-token",
      eventName: "link_token_created",
      severity: "info",
      userId,
      plaidItemId: String(updateItem?.plaid_item_id || "").trim() || null,
      requestId: plaid.request_id || null,
      reasonCode: updateModeReason || null,
      metadata: {
        mode,
        accountSelectionEnabled,
        updateModeRequired,
        platform,
      },
    });

    return json({
      linkToken: plaid.link_token,
      expiration: plaid.expiration,
      requestId: plaid.request_id || null,
      mode,
      update: updateItem
        ? {
          required: updateModeRequired,
          reason: updateModeReason || null,
          itemId: String(updateItem.plaid_item_id || "").trim() || null,
          accountSelectionEnabled,
        }
        : null,
      copy: {
        primary: updateItem
          ? accountSelectionEnabled
            ? "Your bank has new eligible accounts. Review and add the accounts you want to share."
            : "Your bank connection needs a quick update to continue automatic verification."
          : "Cashback is automatically verified when purchases are visible through your linked bank.",
        secondary: updateItem
          ? "You can continue after confirming in your bank."
          : "Some cards or banks may require receipt upload for verification.",
      },
    });
  } catch (error) {
    if (supabaseForLog && userIdForLog) {
      const reasonCode = error instanceof HttpError
        ? String(error?.details?.reason || "").trim() || null
        : null;
      await logPlaidEvent(supabaseForLog, {
        sourceFunction: "plaid-create-link-token",
        eventName: "link_token_failed",
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
    console.error("plaid-create-link-token failed", error);
    return json(
      {
        error: error?.message || "Server error",
      },
      500,
    );
  }
});
