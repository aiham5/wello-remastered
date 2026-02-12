import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  HttpError,
  authenticateRequest,
  createAdminSupabase,
  json,
} from "../_shared/auth.ts";

export const config = { verify_jwt: false };

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
    return json({
      linked: active.length > 0,
      linkedCount: active.length,
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
