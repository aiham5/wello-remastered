import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  HttpError,
  authenticateRequest,
  createAdminSupabase,
  json,
} from "../_shared/auth.ts";
import { logPlaidEvent } from "../_shared/plaidLogging.ts";
import { plaidRemoveItem } from "../_shared/plaid.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";

export const config = { verify_jwt: false };
const PLAID_ITEM_ID_REGEX = /^[A-Za-z0-9_-]{8,128}$/;

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let userIdForLog: string | null = null;
  let supabaseForLog: ReturnType<typeof createAdminSupabase> | null = null;
  let targetItemIdForLog: string | null = null;

  try {
    const { userId, body } = await authenticateRequest(req);
    userIdForLog = userId;
    const targetItemId = String(body?.itemId || body?.item_id || "").trim();
    targetItemIdForLog = targetItemId || null;
    if (targetItemId && !PLAID_ITEM_ID_REGEX.test(targetItemId)) {
      throw new HttpError("Invalid linked bank id.", 400, {
        reason: "invalid_item_id",
      });
    }
    const supabase = createAdminSupabase();
    supabaseForLog = supabase;
    await enforceRateLimit({
      req,
      scope: "plaid:unlink-bank",
      userId,
      maxRequests: 10,
      windowSeconds: 60 * 60,
      supabase,
    });

    let query = supabase
      .from("plaid_linked_items")
      .select("id, plaid_item_id, plaid_access_token")
      .eq("user_id", userId)
      .eq("status", "active");

    if (targetItemId) {
      query = query.eq("plaid_item_id", targetItemId);
    }

    const { data: items, error: fetchError } = await query;
    if (fetchError) {
      throw new HttpError(fetchError.message || "Unable to load linked banks.", 500);
    }

    const targets = Array.isArray(items) ? items : [];
    const targetItemIds = targets
      .map((item) => String(item?.plaid_item_id || "").trim())
      .filter(Boolean);
    let unlinkedCount = 0;
    for (const item of targets) {
      const accessToken = String(item?.plaid_access_token || "").trim();
      if (accessToken) {
        try {
          await plaidRemoveItem(accessToken);
        } catch {
          // Continue cleanup even if Plaid remove fails; token will be cleared.
        }
      }
      const { error: updateError } = await supabase
        .from("plaid_linked_items")
        .update({
          status: "revoked",
          plaid_access_token: null,
          transactions_cursor: null,
          last_sync_at: null,
          institution_id: null,
          institution_name: null,
          available_products: [],
          billed_products: [],
          consent_expires_at: null,
        })
        .eq("id", item.id);
      if (!updateError) unlinkedCount += 1;
    }

    if (targetItemIds.length > 0) {
      await supabase
        .from("plaid_linked_accounts")
        .update({ status: "revoked" })
        .eq("user_id", userId)
        .in("plaid_item_id", targetItemIds);

      const { data: profile } = await supabase
        .from("profiles")
        .select("stripe_cashout_plaid_item_id")
        .eq("id", userId)
        .maybeSingle();

      const selectedItemId = String(profile?.stripe_cashout_plaid_item_id || "").trim();
      if (selectedItemId && targetItemIds.includes(selectedItemId)) {
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
    }

    await logPlaidEvent(supabase, {
      sourceFunction: "plaid-unlink-bank",
      eventName: "bank_unlinked",
      severity: "info",
      userId,
      plaidItemId: targetItemId || targetItemIds[0] || null,
      metadata: {
        unlinkedCount,
        targetedUnlink: Boolean(targetItemId),
      },
    });

    return json({
      unlinked: true,
      unlinkedCount,
      copy: {
        primary: "Linked bank removed.",
        secondary:
          "You can still upload a receipt to verify purchases when bank data is unavailable.",
      },
    });
  } catch (error) {
    if (supabaseForLog && userIdForLog) {
      const reasonCode = error instanceof HttpError
        ? String(error?.details?.reason || "").trim() || null
        : null;
      await logPlaidEvent(supabaseForLog, {
        sourceFunction: "plaid-unlink-bank",
        eventName: "bank_unlink_failed",
        severity: "error",
        userId: userIdForLog,
        plaidItemId: targetItemIdForLog,
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
    console.error("plaid-unlink-bank failed", error);
    return json(
      {
        error: error?.message || "Server error",
      },
      500,
    );
  }
});
