import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type PlaidEventSeverity = "info" | "warn" | "error";

export type PlaidEventLogInput = {
  sourceFunction: string;
  eventName: string;
  severity?: PlaidEventSeverity;
  userId?: string | null;
  plaidItemId?: string | null;
  plaidAccountId?: string | null;
  requestId?: string | null;
  webhookType?: string | null;
  webhookCode?: string | null;
  reasonCode?: string | null;
  metadata?: Record<string, unknown> | null;
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE_KEY_REGEX =
  /(token|secret|password|authorization|api[_-]?key|access[_-]?token|public[_-]?token)/i;

const normalizeText = (value: unknown): string | null => {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
};

const sanitizeMetadata = (value: unknown, depth = 4): unknown => {
  if (depth <= 0) return "[truncated]";
  if (value == null) return null;
  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 30).map((entry) => sanitizeMetadata(entry, depth - 1));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        output[key] = "[redacted]";
      } else {
        output[key] = sanitizeMetadata(nested, depth - 1);
      }
    }
    return output;
  }
  return String(value);
};

export const logPlaidEvent = async (
  supabase: SupabaseClient,
  input: PlaidEventLogInput,
): Promise<void> => {
  const sourceFunction = normalizeText(input.sourceFunction);
  const eventName = normalizeText(input.eventName);
  if (!sourceFunction || !eventName) return;

  const payload = {
    source_function: sourceFunction,
    event_name: eventName,
    severity: input.severity || "info",
    user_id: UUID_REGEX.test(String(input.userId || "")) ? input.userId : null,
    plaid_item_id: normalizeText(input.plaidItemId),
    plaid_account_id: normalizeText(input.plaidAccountId),
    request_id: normalizeText(input.requestId),
    webhook_type: normalizeText(input.webhookType),
    webhook_code: normalizeText(input.webhookCode),
    reason_code: normalizeText(input.reasonCode),
    metadata: sanitizeMetadata(input.metadata || {}),
  };

  try {
    const { error } = await supabase
      .from("plaid_event_logs")
      .insert(payload);
    if (error) {
      console.warn("plaid-event-log insert failed", {
        sourceFunction,
        eventName,
        error: error.message,
      });
    }
  } catch (error) {
    console.warn("plaid-event-log write failure", {
      sourceFunction,
      eventName,
      error: String((error as { message?: string })?.message || error),
    });
  }
};
