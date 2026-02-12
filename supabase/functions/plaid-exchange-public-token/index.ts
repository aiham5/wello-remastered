import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  HttpError,
  authenticateRequest,
  createAdminSupabase,
  json,
} from "../_shared/auth.ts";
import {
  plaidExchangePublicToken,
  plaidGetInstitutionById,
  plaidGetItem,
} from "../_shared/plaid.ts";

export const config = { verify_jwt: false };

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { userId, body } = await authenticateRequest(req);
    const publicToken = String(body?.publicToken || body?.public_token || "")
      .trim();
    if (!publicToken) {
      throw new HttpError("Missing public token.", 400, {
        reason: "missing_public_token",
      });
    }

    const exchange = await plaidExchangePublicToken(publicToken);
    const item = await plaidGetItem(exchange.access_token);
    const institutionId = item?.item?.institution_id || null;

    let institutionName: string | null = null;
    if (institutionId) {
      try {
        const institution = await plaidGetInstitutionById(institutionId, ["US"]);
        institutionName = institution?.institution?.name || null;
      } catch {
        institutionName = null;
      }
    }

    const supabase = createAdminSupabase();
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
        },
        { onConflict: "plaid_item_id" },
      );

    if (upsertError) {
      throw new HttpError(upsertError.message || "Unable to save linked bank.", 500);
    }

    return json({
      linked: true,
      itemId: exchange.item_id,
      institutionId,
      institutionName,
      copy: {
        primary:
          "Cashback is automatically verified when purchases are visible through your linked bank.",
        secondary:
          "Cashback may appear as pending while verification completes.",
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
    console.error("plaid-exchange-public-token failed", error);
    return json(
      {
        error: error?.message || "Server error",
      },
      500,
    );
  }
});
