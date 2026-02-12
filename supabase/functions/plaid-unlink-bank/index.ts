import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  HttpError,
  authenticateRequest,
  createAdminSupabase,
  json,
} from "../_shared/auth.ts";
import { plaidRemoveItem } from "../_shared/plaid.ts";

export const config = { verify_jwt: false };

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { userId, body } = await authenticateRequest(req);
    const targetItemId = String(body?.itemId || body?.item_id || "").trim();
    const supabase = createAdminSupabase();

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
