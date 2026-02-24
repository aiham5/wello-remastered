import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createAdminSupabase, HttpError, json } from "../_shared/auth.ts";

export const config = { verify_jwt: false };

const TREMENDOUS_WEBHOOK_SECRET = String(
  Deno.env.get("TREMENDOUS_WEBHOOK_SECRET") || "",
).trim();
const TREMENDOUS_WEBHOOK_MAX_AGE_SECONDS = Math.max(
  Math.trunc(Number(Deno.env.get("TREMENDOUS_WEBHOOK_MAX_AGE_SECONDS") || 300)),
  30,
);

const SUCCESS_EVENT_TYPES = new Set([
  "REWARD.DELIVERY.SUCCEEDED",
  "REWARDS.DELIVERY.SUCCEEDED",
]);
const FAILURE_EVENT_TYPES = new Set([
  "REWARD.DELIVERY.FAILED",
  "REWARDS.DELIVERY.FAILED",
  "REWARD.CANCELED",
  "REWARDS.CANCELED",
  "ORDER.CANCELED",
  "ORDERS.CANCELED",
]);

type SignatureShape =
  | { mode: "timestamped"; timestamp: number; signatures: string[] }
  | { mode: "simple"; signatures: string[] }
  | { mode: "invalid" };

const textEncoder = new TextEncoder();

const toHex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const normalizeHex = (value: string) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^sha256=/, "");

const constantTimeEqual = (a: string, b: string) => {
  const left = normalizeHex(a);
  const right = normalizeHex(b);
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
};

const hmacSha256Hex = async (secret: string, message: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(message),
  );
  return toHex(signature);
};

const sha256Hex = async (message: string) => {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(message));
  return toHex(digest);
};

const parseSignatureHeader = (headerValue: string): SignatureShape => {
  const raw = String(headerValue || "").trim();
  if (!raw) return { mode: "invalid" };
  if (!raw.includes("=")) {
    return {
      mode: "simple",
      signatures: raw
        .split(",")
        .map((part) => normalizeHex(part))
        .filter(Boolean),
    };
  }
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of parts) {
    const [key, value] = part.split("=");
    const normalizedKey = String(key || "").trim().toLowerCase();
    const normalizedValue = String(value || "").trim();
    if (!normalizedKey || !normalizedValue) continue;
    if (normalizedKey === "t") {
      timestamp = Number(normalizedValue);
      continue;
    }
    if (normalizedKey === "v1" || normalizedKey === "sha256") {
      signatures.push(normalizeHex(normalizedValue));
    }
  }
  if (signatures.length === 0) return { mode: "invalid" };
  if (Number.isFinite(timestamp) && timestamp > 0) {
    return {
      mode: "timestamped",
      timestamp: Math.trunc(timestamp),
      signatures,
    };
  }
  return { mode: "simple", signatures };
};

const getSignatureHeader = (req: Request) =>
  String(
    req.headers.get("X-Tremendous-Webhook-Signature") ||
      req.headers.get("x-tremendous-webhook-signature") ||
      req.headers.get("Tremendous-Webhook-Signature") ||
      req.headers.get("tremendous-webhook-signature") ||
      "",
  ).trim();

const normalizeEventType = (payload: Record<string, unknown>) =>
  String(
    payload?.event_type || payload?.event || payload?.type || payload?.name || "UNKNOWN",
  )
    .trim()
    .toUpperCase();

const extractPayloadObject = (payload: Record<string, unknown>) =>
  payload?.payload && typeof payload.payload === "object"
    ? payload.payload as Record<string, unknown>
    : {};

const extractEventUuid = (payload: Record<string, unknown>, requestHash: string, eventType: string) => {
  const directId = String(
    payload?.id ||
      payload?.event_uuid ||
      payload?.event_id ||
      payload?.eventId ||
      payload?.uuid ||
      "",
  ).trim();
  if (directId) return directId;
  return `${eventType}:${requestHash}`;
};

const uniqueNonEmpty = (values: unknown[]) => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const parsed = String(value || "").trim();
    if (!parsed || seen.has(parsed)) continue;
    seen.add(parsed);
    result.push(parsed);
  }
  return result;
};

const extractOrderAndRewardIds = (payload: Record<string, unknown>) => {
  const nested = extractPayloadObject(payload);
  const nestedResource = nested?.resource && typeof nested.resource === "object"
    ? nested.resource as Record<string, unknown>
    : {};
  const nestedMeta = nested?.meta && typeof nested.meta === "object"
    ? nested.meta as Record<string, unknown>
    : {};
  const nestedOrder = nested?.order && typeof nested.order === "object"
    ? nested.order as Record<string, unknown>
    : {};
  const nestedReward = nested?.reward && typeof nested.reward === "object"
    ? nested.reward as Record<string, unknown>
    : {};
  const rewardsArray = Array.isArray(nested?.rewards)
    ? nested.rewards as Array<Record<string, unknown>>
    : [];
  const resourceType = String(nestedResource?.type || "").trim().toLowerCase();

  const orderIds = uniqueNonEmpty([
    payload?.order_id,
    nested?.order_id,
    nestedMeta?.order_id,
    nestedOrder?.id,
    nestedReward?.order_id,
    resourceType.includes("order") ? nestedResource?.id : null,
  ]);
  const rewardIds = uniqueNonEmpty([
    payload?.reward_id,
    nested?.reward_id,
    nestedMeta?.reward_id,
    nestedReward?.id,
    rewardsArray[0]?.id,
    resourceType.includes("reward") ? nestedResource?.id : null,
  ]);

  return { orderIds, rewardIds };
};

const extractFailureReason = (payload: Record<string, unknown>, fallbackType: string) => {
  const nested = extractPayloadObject(payload);
  const nestedError = nested?.error && typeof nested.error === "object"
    ? nested.error as Record<string, unknown>
    : {};
  const nestedMeta = nested?.meta && typeof nested.meta === "object"
    ? nested.meta as Record<string, unknown>
    : {};
  const nestedFailure = nested?.failure && typeof nested.failure === "object"
    ? nested.failure as Record<string, unknown>
    : {};

  const reason = String(
    nested?.message ||
      nested?.reason ||
      nested?.status_reason ||
      nestedError?.message ||
      nestedError?.reason ||
      nestedFailure?.message ||
      nestedMeta?.message ||
      "",
  ).trim();
  return reason || `Tremendous event: ${fallbackType}`;
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    if (!TREMENDOUS_WEBHOOK_SECRET) {
      throw new HttpError("Missing webhook configuration.", 500, {
        reason: "webhook_secret_missing",
      });
    }

    const rawBody = await req.text();
    const payload = (rawBody ? JSON.parse(rawBody) : {}) as Record<string, unknown>;
    const signatureHeader = getSignatureHeader(req);
    const parsedSignature = parseSignatureHeader(signatureHeader);
    if (parsedSignature.mode === "invalid") {
      throw new HttpError("Invalid webhook signature.", 401, {
        reason: "invalid_signature_header",
      });
    }

    let verified = false;
    let signatureTimestamp: number | null = null;
    if (parsedSignature.mode === "timestamped") {
      signatureTimestamp = parsedSignature.timestamp;
      const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - signatureTimestamp);
      if (ageSeconds > TREMENDOUS_WEBHOOK_MAX_AGE_SECONDS) {
        throw new HttpError("Webhook signature expired.", 401, {
          reason: "stale_signature",
          ageSeconds,
        });
      }
      const expected = await hmacSha256Hex(
        TREMENDOUS_WEBHOOK_SECRET,
        `${signatureTimestamp}.${rawBody}`,
      );
      verified = parsedSignature.signatures.some((value) => constantTimeEqual(value, expected));
    } else {
      const expected = await hmacSha256Hex(TREMENDOUS_WEBHOOK_SECRET, rawBody);
      verified = parsedSignature.signatures.some((value) => constantTimeEqual(value, expected));
    }
    if (!verified) {
      throw new HttpError("Invalid webhook signature.", 401, {
        reason: "signature_verification_failed",
      });
    }

    const requestBodySha256 = await sha256Hex(rawBody);
    const eventType = normalizeEventType(payload);
    const eventUuid = extractEventUuid(payload, requestBodySha256, eventType);

    const supabase = createAdminSupabase();
    const { error: insertError } = await supabase
      .from("tremendous_webhook_events")
      .insert({
        event_uuid: eventUuid,
        event_type: eventType,
        signature_timestamp: signatureTimestamp,
        request_body_sha256: requestBodySha256,
      });

    const insertCode = String((insertError as { code?: string })?.code || "");
    if (insertError && insertCode !== "23505") {
      throw new HttpError(insertError.message || "Unable to persist webhook event.", 500, {
        reason: "webhook_event_persist_failed",
      });
    }
    if (insertCode === "23505") {
      return json({ received: true, duplicate: true }, 200);
    }

    const { orderIds, rewardIds } = extractOrderAndRewardIds(payload);
    let payoutRow: { id: string } | null = null;

    for (const orderId of orderIds) {
      const { data } = await supabase
        .from("cashout_payouts")
        .select("id")
        .eq("provider", "tremendous")
        .eq("provider_order_id", orderId)
        .maybeSingle();
      if (data?.id) {
        payoutRow = { id: data.id };
        break;
      }
    }

    if (!payoutRow) {
      for (const rewardId of rewardIds) {
        const { data } = await supabase
          .from("cashout_payouts")
          .select("id")
          .eq("provider", "tremendous")
          .eq("provider_reward_id", rewardId)
          .maybeSingle();
        if (data?.id) {
          payoutRow = { id: data.id };
          break;
        }
      }
    }

    if (!payoutRow?.id) {
      await supabase
        .from("tremendous_webhook_events")
        .update({
          processed: true,
          processed_at: new Date().toISOString(),
        })
        .eq("event_uuid", eventUuid);
      return json({ received: true, processed: true, reason: "payout_not_found" }, 200);
    }

    if (SUCCESS_EVENT_TYPES.has(eventType)) {
      await supabase
        .from("cashout_payouts")
        .update({
          status: "paid",
          provider_status: eventType,
          failure_reason: null,
          processed_at: new Date().toISOString(),
        })
        .eq("id", payoutRow.id);
      await supabase
        .from("cashback_events")
        .update({ status: "paid" })
        .eq("payout_id", payoutRow.id)
        .eq("status", "reserved");
    } else if (FAILURE_EVENT_TYPES.has(eventType)) {
      await supabase
        .from("cashout_payouts")
        .update({
          status: "failed",
          provider_status: eventType,
          failure_reason: extractFailureReason(payload, eventType),
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
          provider_status: eventType,
        })
        .eq("id", payoutRow.id);
    }

    await supabase
      .from("tremendous_webhook_events")
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
      })
      .eq("event_uuid", eventUuid);

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
    console.error("tremendous-webhook failed", error);
    return json(
      {
        error: String((error as { message?: string })?.message || "Webhook handling failed."),
      },
      500,
    );
  }
});
