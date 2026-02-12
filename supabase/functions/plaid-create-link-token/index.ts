import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  HttpError,
  authenticateRequest,
  createAdminSupabase,
  json,
} from "../_shared/auth.ts";
import { plaidCreateLinkToken } from "../_shared/plaid.ts";

export const config = { verify_jwt: false };

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { userId, body } = await authenticateRequest(req);
    const supabase = createAdminSupabase();
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle();

    const platform =
      typeof body?.platform === "string" ? body.platform.toLowerCase() : "";
    const androidPackageName =
      typeof body?.androidPackageName === "string"
        ? body.androidPackageName
        : typeof body?.android_package_name === "string"
          ? body.android_package_name
          : null;

    const plaid = await plaidCreateLinkToken({
      userId,
      email: profile?.email || null,
      fullName: profile?.full_name || null,
      platform,
      androidPackageName,
    });

    return json({
      linkToken: plaid.link_token,
      expiration: plaid.expiration,
      requestId: plaid.request_id || null,
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
    console.error("plaid-create-link-token failed", error);
    return json(
      {
        error: error?.message || "Server error",
      },
      500,
    );
  }
});
