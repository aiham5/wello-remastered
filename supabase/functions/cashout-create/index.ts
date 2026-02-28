import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createReloadlyCashoutHandler } from "../_shared/reloadlyCashout.ts";
import { createCheckbookCashoutHandler } from "../_shared/checkbookCashout.ts";
import { json } from "../_shared/auth.ts";

export const config = { verify_jwt: false };

const reloadlyHandler = createReloadlyCashoutHandler({
  endpointName: "cashout-create:reloadly",
  requireIdempotencyKey: true,
});
const checkbookHandler = createCheckbookCashoutHandler({
  endpointName: "cashout-create:checkbook",
  requireIdempotencyKey: true,
});

const normalizeProvider = (value: unknown) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "checkbook") return "checkbook";
  if (normalized === "trolley") return "checkbook"; // legacy alias
  if (normalized === "reloadly") return "reloadly";
  return "";
};

const normalizeMethodType = (value: unknown) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "gift_card") return "gift_card";
  if (normalized === "bank_transfer") return "bank_transfer";
  return "";
};

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const requestUrl = new URL(req.url);
  const body = await req.clone().json().catch(() => ({}));
  const methodType = normalizeMethodType(
    body?.methodType || body?.method_type || "",
  );
  if (methodType === "bank_transfer") {
    return checkbookHandler(req);
  }
  if (methodType === "gift_card") {
    return reloadlyHandler(req);
  }

  // Backward-compat provider-based routing for older clients.
  const configuredProvider = normalizeProvider(
    Deno.env.get("CONSUMER_CASHOUT_PROVIDER") || "reloadly",
  );
  const requestedProvider = normalizeProvider(
    requestUrl.searchParams.get("provider") ||
      req.headers.get("x-cashout-provider") ||
      body?.provider,
  );
  const provider = requestedProvider || configuredProvider || "reloadly";
  if (provider === "checkbook") return checkbookHandler(req);
  if (provider === "reloadly") return reloadlyHandler(req);
  return json(
    {
      error: "Unsupported cashout method/provider.",
      reason: "invalid_cashout_provider",
    },
    400,
  );
});
