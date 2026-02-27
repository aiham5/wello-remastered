import { createAdminSupabase, HttpError, json } from "./auth.ts";

const DOTS_WEBHOOK_SECRET = String(Deno.env.get("DOTS_WEBHOOK_SECRET") || "")
  .trim();
const DOTS_WEBHOOK_MAX_AGE_SECONDS = Math.max(
  Math.trunc(Number(Deno.env.get("DOTS_WEBHOOK_MAX_AGE_SECONDS") || 300)),
  30,
);
const DOTS_BASE_URL = String(
  Deno.env.get("DOTS_BASE_URL") || "https://pls.senddotssandbox.com/api",
)
  .trim()
  .replace(/\/+$/, "");
const DOTS_CLIENT_ID = String(Deno.env.get("DOTS_CLIENT_ID") || "").trim();
const DOTS_API_KEY = String(Deno.env.get("DOTS_API_KEY") || "")
  .trim()
  .replace(/^Bearer\s+/i, "");
const DOTS_APP_ID = String(Deno.env.get("DOTS_APP_ID") || "").trim();

type DotsWebhookHandlerOptions = {
  endpointName: string;
  enableDeprecationLog?: boolean;
};

const SUCCESS_TRANSFER_STATUSES = new Set([
  "completed",
  "paid",
  "processed",
  "claimed",
  "sent",
  "succeeded",
  "success",
]);
const FAILURE_TRANSFER_STATUSES = new Set([
  "failed",
  "canceled",
  "cancelled",
  "expired",
  "reversed",
  "returned",
  "rejected",
]);

const textEncoder = new TextEncoder();

const toHex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const sha256Hex = async (message: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(message),
  );
  return toHex(digest);
};

const normalizeBase64 = (value: string) =>
  String(value || "")
    .trim()
    .replace(/^v1,/, "");

const constantTimeEqual = (a: string, b: string) => {
  const left = normalizeBase64(a);
  const right = normalizeBase64(b);
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
};

const decodeSvixSecret = (secret: string) => {
  const normalized = String(secret || "").trim();
  const withoutPrefix = normalized.startsWith("whsec_")
    ? normalized.slice("whsec_".length)
    : normalized;
  const padded = withoutPrefix +
    "=".repeat((4 - (withoutPrefix.length % 4)) % 4);
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
};

const computeSvixSignature = async (
  secret: string,
  messageId: string,
  timestamp: string,
  rawBody: string,
) => {
  const key = await crypto.subtle.importKey(
    "raw",
    decodeSvixSecret(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(`${messageId}.${timestamp}.${rawBody}`),
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
};

const parseSvixSignatureHeader = (headerValue: string) => {
  const matches = String(headerValue || "").match(/v1,([A-Za-z0-9+/=]+)/g) ||
    [];
  return matches.map((part) => part.replace(/^v1,/, "").trim()).filter(Boolean);
};

const normalizeEventType = (payload: Record<string, unknown>) =>
  String(payload?.event || payload?.type || payload?.event_type || "unknown")
    .trim()
    .toLowerCase();

const extractTransferObject = (payload: Record<string, unknown>) => {
  const direct = payload?.transfer;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }
  const nested = payload?.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return {};
};

const extractTransferId = (payload: Record<string, unknown>) => {
  const transfer = extractTransferObject(payload);
  return String(
    payload?.transfer_id ||
      payload?.transferId ||
      transfer?.id ||
      transfer?.transfer_id ||
      "",
  ).trim();
};

const extractPayoutLinkId = (payload: Record<string, unknown>) => {
  const transfer = extractTransferObject(payload);
  return String(
    payload?.payout_link_id ||
      payload?.payoutLinkId ||
      payload?.id ||
      transfer?.payout_link_id ||
      transfer?.payoutLinkId ||
      "",
  ).trim();
};

const extractTransferStatus = (payload: Record<string, unknown>) => {
  const transfer = extractTransferObject(payload);
  return String(
    payload?.status ||
      payload?.transfer_status ||
      transfer?.status ||
      transfer?.transfer_status ||
      "",
  )
    .trim()
    .toLowerCase();
};

const extractFailureReason = (
  payload: Record<string, unknown>,
  fallbackType: string,
) => {
  const transfer = extractTransferObject(payload);
  return String(
    payload?.reason ||
      payload?.message ||
      payload?.failure_reason ||
      transfer?.reason ||
      transfer?.failure_reason ||
      transfer?.status_reason ||
      "",
  ).trim() || `Dots event: ${fallbackType}`;
};

const getDotsAuthHeader = () => {
  if (!DOTS_CLIENT_ID || !DOTS_API_KEY) return "";
  return `Basic ${btoa(`${DOTS_CLIENT_ID}:${DOTS_API_KEY}`)}`;
};

const fetchDotsTransfer = async (transferId: string) => {
  if (!transferId || !getDotsAuthHeader()) return null;
  const response = await fetch(`${DOTS_BASE_URL}/v2/transfers/${transferId}`, {
    method: "GET",
    headers: {
      authorization: getDotsAuthHeader(),
      "content-type": "application/json",
      ...(DOTS_APP_ID ? { "Api-App-Id": DOTS_APP_ID } : {}),
    },
  });
  if (!response.ok) {
    if (response.status === 404) return null;
    const text = await response.text();
    throw new HttpError("Unable to refresh Dots transfer status.", 502, {
      reason: "dots_transfer_lookup_failed",
      transferId,
      upstreamStatus: response.status,
      upstreamBody: text.slice(0, 400),
    });
  }
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  const transfer = parsed?.transfer && typeof parsed.transfer === "object"
    ? parsed.transfer as Record<string, unknown>
    : parsed;
  return {
    status: String(
      transfer?.status || transfer?.transfer_status || "",
    ).trim().toLowerCase(),
    reason: String(
      transfer?.reason || transfer?.failure_reason || transfer?.status_reason ||
        "",
    ).trim(),
  };
};

export const createDotsWebhookHandler =
  (options: DotsWebhookHandlerOptions) => async (req: Request) => {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      if (options.enableDeprecationLog) {
        console.warn(
          `[${options.endpointName}] deprecated endpoint invoked; route providers to dots-webhook`,
        );
      }
      if (!DOTS_WEBHOOK_SECRET) {
        throw new HttpError("Missing webhook configuration.", 500, {
          reason: "webhook_secret_missing",
        });
      }

      const rawBody = await req.text();
      const payload = (rawBody ? JSON.parse(rawBody) : {}) as Record<
        string,
        unknown
      >;
      const messageId = String(
        req.headers.get("svix-id") || req.headers.get("webhook-id") || "",
      ).trim();
      const timestamp = String(
        req.headers.get("svix-timestamp") ||
          req.headers.get("webhook-timestamp") || "",
      ).trim();
      const signatureHeader = String(
        req.headers.get("svix-signature") ||
          req.headers.get("webhook-signature") || "",
      ).trim();

      if (!messageId || !timestamp || !signatureHeader) {
        throw new HttpError("Invalid webhook signature.", 401, {
          reason: "missing_svix_headers",
        });
      }

      const parsedTimestamp = Math.trunc(Number(timestamp));
      if (!Number.isFinite(parsedTimestamp) || parsedTimestamp <= 0) {
        throw new HttpError("Invalid webhook signature.", 401, {
          reason: "invalid_timestamp",
        });
      }

      const ageSeconds = Math.abs(
        Math.floor(Date.now() / 1000) - parsedTimestamp,
      );
      if (ageSeconds > DOTS_WEBHOOK_MAX_AGE_SECONDS) {
        throw new HttpError("Webhook signature expired.", 401, {
          reason: "stale_signature",
          ageSeconds,
        });
      }

      const expected = await computeSvixSignature(
        DOTS_WEBHOOK_SECRET,
        messageId,
        timestamp,
        rawBody,
      );
      const provided = parseSvixSignatureHeader(signatureHeader);
      const verified = provided.some((value) =>
        constantTimeEqual(value, expected)
      );
      if (!verified) {
        throw new HttpError("Invalid webhook signature.", 401, {
          reason: "signature_verification_failed",
        });
      }

      const requestBodySha256 = await sha256Hex(rawBody);
      const eventType = normalizeEventType(payload);
      const eventId = messageId;

      const supabase = createAdminSupabase();
      const { error: insertError } = await supabase
        .from("dots_webhook_events")
        .insert({
          event_id: eventId,
          event_type: eventType,
          signature_timestamp: parsedTimestamp,
          request_body_sha256: requestBodySha256,
        });

      const insertCode = String((insertError as { code?: string })?.code || "");
      if (insertError && insertCode !== "23505") {
        throw new HttpError(
          insertError.message || "Unable to persist webhook event.",
          500,
          {
            reason: "webhook_event_persist_failed",
          },
        );
      }
      if (insertCode === "23505") {
        return json({ received: true, duplicate: true }, 200);
      }

      const transferId = extractTransferId(payload);
      const payoutLinkId = extractPayoutLinkId(payload);
      let transferStatus = extractTransferStatus(payload);
      let failureReason = extractFailureReason(payload, eventType);

      if ((!transferStatus || eventType === "transfer.updated") && transferId) {
        const refreshed = await fetchDotsTransfer(transferId);
        if (refreshed?.status) transferStatus = refreshed.status;
        if (refreshed?.reason) failureReason = refreshed.reason;
      }

      let payoutRow: { id: string } | null = null;

      if (transferId) {
        const { data } = await supabase
          .from("cashout_payouts")
          .select("id")
          .eq("provider", "dots")
          .eq("provider_reward_id", transferId)
          .maybeSingle();
        if (data?.id) payoutRow = { id: data.id };
      }

      if (!payoutRow && payoutLinkId) {
        const { data } = await supabase
          .from("cashout_payouts")
          .select("id")
          .eq("provider", "dots")
          .eq("provider_order_id", payoutLinkId)
          .maybeSingle();
        if (data?.id) payoutRow = { id: data.id };
      }

      if (!payoutRow?.id) {
        await supabase
          .from("dots_webhook_events")
          .update({
            processed: true,
            processed_at: new Date().toISOString(),
          })
          .eq("event_id", eventId);
        return json({
          received: true,
          processed: true,
          reason: "payout_not_found",
        }, 200);
      }

      const providerStatus = [eventType, transferStatus].filter(Boolean).join(
        ":",
      );
      if (SUCCESS_TRANSFER_STATUSES.has(transferStatus)) {
        await supabase
          .from("cashout_payouts")
          .update({
            status: "paid",
            provider_status: providerStatus || eventType,
            failure_reason: null,
            processed_at: new Date().toISOString(),
          })
          .eq("id", payoutRow.id);
        await supabase
          .from("cashback_events")
          .update({ status: "paid" })
          .eq("payout_id", payoutRow.id)
          .eq("status", "reserved");
      } else if (FAILURE_TRANSFER_STATUSES.has(transferStatus)) {
        await supabase
          .from("cashout_payouts")
          .update({
            status: "failed",
            provider_status: providerStatus || eventType,
            failure_reason: failureReason,
            processed_at: new Date().toISOString(),
          })
          .eq("id", payoutRow.id);
        await supabase
          .from("cashback_events")
          .update({ status: "available", payout_id: null })
          .eq("payout_id", payoutRow.id)
          .eq("status", "reserved");
      } else {
        await supabase
          .from("cashout_payouts")
          .update({
            provider_status: providerStatus || eventType,
          })
          .eq("id", payoutRow.id);
      }

      await supabase
        .from("dots_webhook_events")
        .update({
          processed: true,
          processed_at: new Date().toISOString(),
        })
        .eq("event_id", eventId);

      return json({ received: true, processed: true }, 200);
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
      console.error(`${options.endpointName} failed`, error);
      return json(
        {
          error: String(
            (error as { message?: string })?.message ||
              "Webhook handling failed.",
          ),
        },
        500,
      );
    }
  };
