import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
} from "https://esm.sh/jose@5.9.6";
import { createAdminSupabase, HttpError, json } from "../_shared/auth.ts";
import { logPlaidEvent } from "../_shared/plaidLogging.ts";
import {
  ensurePlaidEnv,
  plaidGetAccounts,
  plaidGetWebhookVerificationKey,
} from "../_shared/plaid.ts";

type PlaidWebhookPayload = {
  webhook_type?: string | null;
  webhook_code?: string | null;
  item_id?: string | null;
  error?: {
    error_type?: string | null;
    error_code?: string | null;
    error_message?: string | null;
  } | null;
};

const PLAID_LOGIN_REQUIRED_CODE = "ITEM_LOGIN_REQUIRED";
const PLAID_WEBHOOK_SECRET = String(
  Deno.env.get("PLAID_WEBHOOK_SECRET") || "",
).trim();
const PLAID_WEBHOOK_MAX_AGE_SECONDS = Math.max(
  Number(Deno.env.get("PLAID_WEBHOOK_MAX_AGE_SECONDS") || 300) || 300,
  30,
);

const textEncoder = new TextEncoder();
type PlaidVerificationKey = Awaited<ReturnType<typeof importJWK>>;
const webhookKeyCache = new Map<string, { key: PlaidVerificationKey; expiresAtMs: number }>();

const toHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const constantTimeEqual = (a: string, b: string) => {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
};

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return toHex(digest);
};

const getLegacyHeaderWebhookSecret = (req: Request) =>
  String(
    req.headers.get("x-plaid-webhook-secret") ||
      req.headers.get("plaid-webhook-secret") ||
      "",
  ).trim();

const getPlaidVerificationToken = (req: Request) =>
  String(
    req.headers.get("plaid-verification") ||
      req.headers.get("Plaid-Verification") ||
      "",
  ).trim();

const parseEpochSeconds = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) return Math.floor(asNumber);
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) return Math.floor(dateMs / 1000);
  return null;
};

const resolveKeyExpiryMs = (raw: unknown) => {
  const epochSeconds = parseEpochSeconds(raw);
  if (!epochSeconds || epochSeconds <= 0) {
    return Date.now() + 5 * 60 * 1000;
  }
  // Keep cache bounded even if provider sends long expiration.
  const maxExpiryMs = Date.now() + 24 * 60 * 60 * 1000;
  return Math.min(epochSeconds * 1000, maxExpiryMs);
};

const loadWebhookVerificationKey = async (keyId: string) => {
  const cached = webhookKeyCache.get(keyId);
  if (cached && cached.expiresAtMs > Date.now()) return cached.key;

  const response = await plaidGetWebhookVerificationKey(keyId);
  const key = response?.key || null;
  const kty = String(key?.kty || "").trim();
  const crv = String(key?.crv || "").trim();
  const x = String(key?.x || "").trim();
  const y = String(key?.y || "").trim();
  const alg = String(key?.alg || "ES256").trim().toUpperCase();

  if (!kty || !crv || !x || !y || alg !== "ES256") {
    throw new HttpError("Invalid Plaid verification key.", 401, {
      reason: "invalid_plaid_verification_key",
      keyId,
    });
  }

  const cryptoKey = await importJWK(
    {
      kty,
      crv,
      x,
      y,
      kid: String(key?.kid || keyId).trim(),
      alg,
      use: String(key?.use || "sig").trim(),
    },
    "ES256",
  );

  webhookKeyCache.set(keyId, {
    key: cryptoKey,
    expiresAtMs: resolveKeyExpiryMs(key?.expired_at),
  });
  return cryptoKey;
};

const verifyPlaidWebhookSignature = async (req: Request, rawBody: string) => {
  const token = getPlaidVerificationToken(req);
  if (!token) {
    throw new HttpError("Unauthorized webhook request.", 401, {
      reason: "missing_plaid_verification",
    });
  }

  try {
    const protectedHeader = decodeProtectedHeader(token);
    const keyId = String(protectedHeader?.kid || "").trim();
    const alg = String(protectedHeader?.alg || "").trim().toUpperCase();
    if (!keyId || alg !== "ES256") {
      throw new HttpError("Unauthorized webhook request.", 401, {
        reason: "invalid_plaid_verification_header",
      });
    }

    const key = await loadWebhookVerificationKey(keyId);
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["ES256"],
    });

    const issuedAt = Number(payload?.iat || 0);
    if (!Number.isFinite(issuedAt) || issuedAt <= 0) {
      throw new HttpError("Unauthorized webhook request.", 401, {
        reason: "invalid_plaid_signature_iat",
      });
    }
    const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - issuedAt);
    if (ageSeconds > PLAID_WEBHOOK_MAX_AGE_SECONDS) {
      throw new HttpError("Unauthorized webhook request.", 401, {
        reason: "stale_plaid_signature",
        ageSeconds,
        maxAgeSeconds: PLAID_WEBHOOK_MAX_AGE_SECONDS,
      });
    }

    const expectedHash = String(payload?.request_body_sha256 || "")
      .trim()
      .toLowerCase();
    if (!expectedHash) {
      throw new HttpError("Unauthorized webhook request.", 401, {
        reason: "missing_request_body_hash",
      });
    }

    const actualHash = (await sha256Hex(rawBody)).toLowerCase();
    if (!constantTimeEqual(expectedHash, actualHash)) {
      throw new HttpError("Unauthorized webhook request.", 401, {
        reason: "request_body_hash_mismatch",
      });
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError("Unauthorized webhook request.", 401, {
      reason: "plaid_signature_verification_failed",
    });
  }
};

const markUpdateModeRequired = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  plaidItemId: string,
  reason: "item_login_required" | "pending_expiration" | "pending_disconnect",
  webhookCode: string,
) => {
  await supabase
    .from("plaid_linked_items")
    .update({
      status: "active",
      update_mode_required: true,
      update_mode_reason: reason,
      update_mode_detected_at: new Date().toISOString(),
      last_webhook_code: webhookCode,
    })
    .eq("plaid_item_id", plaidItemId);
};

const markNewAccountsAvailable = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  plaidItemId: string,
  webhookCode: string,
) => {
  await supabase
    .from("plaid_linked_items")
    .update({
      new_accounts_available: true,
      last_webhook_code: webhookCode,
    })
    .eq("plaid_item_id", plaidItemId);
};

const clearUpdateModeState = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  plaidItemId: string,
  webhookCode: string,
) => {
  await supabase
    .from("plaid_linked_items")
    .update({
      status: "active",
      update_mode_required: false,
      update_mode_reason: null,
      update_mode_detected_at: null,
      new_accounts_available: false,
      last_webhook_code: webhookCode,
      last_sync_at: new Date().toISOString(),
    })
    .eq("plaid_item_id", plaidItemId);
};

const clearSelectedCashoutAccountIfStale = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
  plaidItemId: string,
  validAccountIds: Set<string>,
) => {
  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_cashout_plaid_item_id, stripe_cashout_plaid_account_id")
    .eq("id", userId)
    .maybeSingle();

  const selectedItemId = String(profile?.stripe_cashout_plaid_item_id || "")
    .trim();
  const selectedAccountId = String(
    profile?.stripe_cashout_plaid_account_id || "",
  ).trim();

  if (selectedItemId !== plaidItemId) return;
  if (!selectedAccountId || validAccountIds.has(selectedAccountId)) return;

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
};

const syncAccountsForItem = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  plaidItemId: string,
  lastWebhookCode: string | null = null,
) => {
  const { data: item, error: itemError } = await supabase
    .from("plaid_linked_items")
    .select("user_id, plaid_access_token, status")
    .eq("plaid_item_id", plaidItemId)
    .maybeSingle();

  if (itemError) {
    throw new HttpError(
      itemError.message || "Unable to load linked item.",
      500,
      {
        reason: "linked_item_lookup_failed",
      },
    );
  }

  if (!item?.user_id) {
    // Item may already be removed. Acknowledge without failing retries.
    return {
      synced: false,
      reason: "item_not_found",
      linkedAccountCount: 0,
    };
  }

  const userId = String(item.user_id).trim();
  const accessToken = String(item.plaid_access_token || "").trim();
  if (!accessToken) {
    await supabase
      .from("plaid_linked_items")
      .update({
        status: "errored",
        last_sync_at: new Date().toISOString(),
      })
      .eq("plaid_item_id", plaidItemId);
    return {
      synced: false,
      reason: "missing_access_token",
      linkedAccountCount: 0,
    };
  }

  const accountsResult = await plaidGetAccounts(accessToken);
  const accountRows =
    (Array.isArray(accountsResult.accounts) ? accountsResult.accounts : [])
      .filter((account) => String(account?.account_id || "").trim().length > 0)
      .map((account) => ({
        user_id: userId,
        plaid_item_id: plaidItemId,
        plaid_account_id: String(account.account_id).trim(),
        account_name: String(
          account.official_name || account.name || account.subtype ||
            "Bank account",
        ).trim(),
        account_mask: String(account.mask || "").trim() || null,
        account_subtype: String(account.subtype || "").trim() || null,
        account_type: String(account.type || "").trim() || null,
        status: "active",
      }));

  if (accountRows.length > 0) {
    const { error: upsertError } = await supabase
      .from("plaid_linked_accounts")
      .upsert(accountRows, {
        onConflict: "plaid_item_id,plaid_account_id",
      });
    if (upsertError) {
      throw new HttpError(
        upsertError.message || "Unable to sync linked accounts.",
        500,
        { reason: "linked_accounts_upsert_failed" },
      );
    }
  }

  const keepIds = new Set(accountRows.map((row) => row.plaid_account_id));
  const { data: activeRows } = await supabase
    .from("plaid_linked_accounts")
    .select("id, plaid_account_id")
    .eq("user_id", userId)
    .eq("plaid_item_id", plaidItemId)
    .eq("status", "active");
  const staleIds = (Array.isArray(activeRows) ? activeRows : [])
    .filter((row) => !keepIds.has(String(row?.plaid_account_id || "").trim()))
    .map((row) => row.id)
    .filter(Boolean);
  if (staleIds.length > 0) {
    await supabase
      .from("plaid_linked_accounts")
      .update({ status: "revoked" })
      .in("id", staleIds);
  }

  await clearSelectedCashoutAccountIfStale(
    supabase,
    userId,
    plaidItemId,
    keepIds,
  );

  await supabase
    .from("plaid_linked_items")
    .update({
      status: "active",
      last_sync_at: new Date().toISOString(),
      ...(lastWebhookCode ? { last_webhook_code: lastWebhookCode } : {}),
    })
    .eq("plaid_item_id", plaidItemId);

  return {
    synced: true,
    reason: null,
    linkedAccountCount: accountRows.length,
  };
};

const revokeItem = async (
  supabase: ReturnType<typeof createAdminSupabase>,
  plaidItemId: string,
) => {
  const { data: item } = await supabase
    .from("plaid_linked_items")
    .select("user_id")
    .eq("plaid_item_id", plaidItemId)
    .maybeSingle();
  const userId = String(item?.user_id || "").trim();

  await supabase
    .from("plaid_linked_items")
    .update({
      status: "revoked",
      plaid_access_token: null,
      last_sync_at: new Date().toISOString(),
      update_mode_required: false,
      update_mode_reason: null,
      update_mode_detected_at: null,
      new_accounts_available: false,
      last_webhook_code: "USER_PERMISSION_REVOKED",
    })
    .eq("plaid_item_id", plaidItemId);

  await supabase
    .from("plaid_linked_accounts")
    .update({ status: "revoked" })
    .eq("plaid_item_id", plaidItemId);

  if (userId) {
    await supabase
      .from("profiles")
      .update({
        stripe_cashout_plaid_item_id: null,
        stripe_cashout_plaid_account_id: null,
        stripe_cashout_account_label: null,
        stripe_cashout_external_account_id: null,
        stripe_cashout_bank_synced_at: null,
      })
      .eq("id", userId)
      .eq("stripe_cashout_plaid_item_id", plaidItemId);
  }
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const rawBody = await req.text();

    // Transitional auth support:
    // - Preferred: Plaid signed webhooks via Plaid-Verification header.
    // - Legacy fallback: shared secret via custom header only (never query param).
    const legacyHeaderSecret = getLegacyHeaderWebhookSecret(req);
    if (legacyHeaderSecret) {
      if (!PLAID_WEBHOOK_SECRET || legacyHeaderSecret !== PLAID_WEBHOOK_SECRET) {
        throw new HttpError("Unauthorized webhook request.", 401, {
          reason: "invalid_webhook_secret",
        });
      }
    } else {
      await verifyPlaidWebhookSignature(req, rawBody);
    }

    ensurePlaidEnv();
    const supabase = createAdminSupabase();
    const payload = (() => {
      if (!rawBody) return {} as PlaidWebhookPayload;
      try {
        return JSON.parse(rawBody) as PlaidWebhookPayload;
      } catch {
        throw new HttpError("Invalid webhook payload.", 400, {
          reason: "invalid_json_payload",
        });
      }
    })();

    const webhookType = String(payload?.webhook_type || "")
      .trim()
      .toUpperCase();
    const webhookCode = String(payload?.webhook_code || "")
      .trim()
      .toUpperCase();
    const plaidItemId = String(payload?.item_id || "").trim();

    if (!webhookType || !webhookCode || !plaidItemId) {
      throw new HttpError("Invalid webhook payload.", 400, {
        reason: "invalid_payload",
      });
    }

    const logWebhookEvent = async (
      eventName: string,
      severity: "info" | "warn" | "error" = "info",
      metadata: Record<string, unknown> = {},
    ) => {
      await logPlaidEvent(supabase, {
        sourceFunction: "plaid-webhook",
        eventName,
        severity,
        plaidItemId,
        webhookType,
        webhookCode,
        reasonCode: String(payload?.error?.error_code || "").trim() || null,
        metadata,
      });
    };

    await logWebhookEvent("webhook_received", "info", {
      hasErrorPayload: Boolean(payload?.error),
    });

    if (webhookType === "ITEM" && webhookCode === "NEW_ACCOUNTS_AVAILABLE") {
      await markNewAccountsAvailable(supabase, plaidItemId, webhookCode);
      const syncResult = await syncAccountsForItem(
        supabase,
        plaidItemId,
        "NEW_ACCOUNTS_AVAILABLE_SYNC",
      );
      await logWebhookEvent("new_accounts_available_handled", "info", {
        handled: true,
        synced: Boolean(syncResult?.synced),
        linkedAccountCount: Number(syncResult?.linkedAccountCount || 0),
      });
      return json({
        received: true,
        handled: true,
        webhookType,
        webhookCode,
        plaidItemId,
        updateMode: {
          accountSelectionAvailable: true,
        },
        ...syncResult,
      });
    }

    if (webhookType === "ITEM" && webhookCode === "PENDING_EXPIRATION") {
      await markUpdateModeRequired(
        supabase,
        plaidItemId,
        "pending_expiration",
        webhookCode,
      );
      await logWebhookEvent("update_mode_marked_required", "warn", {
        handled: true,
        updateModeReason: "pending_expiration",
      });
      return json({
        received: true,
        handled: true,
        webhookType,
        webhookCode,
        plaidItemId,
        updateMode: {
          required: true,
          reason: "pending_expiration",
        },
      });
    }

    if (webhookType === "ITEM" && webhookCode === "DEFAULT_UPDATE") {
      // Sandbox/test mode commonly emits DEFAULT_UPDATE for "needs user action".
      // Reuse reconnect-needed prompt semantics in app UI.
      await markUpdateModeRequired(
        supabase,
        plaidItemId,
        "pending_disconnect",
        webhookCode,
      );
      await logWebhookEvent("update_mode_marked_required", "warn", {
        handled: true,
        updateModeReason: "pending_disconnect",
      });
      return json({
        received: true,
        handled: true,
        webhookType,
        webhookCode,
        plaidItemId,
        updateMode: {
          required: true,
          reason: "pending_disconnect",
        },
      });
    }

    if (webhookType === "ITEM" && webhookCode === "PENDING_DISCONNECT") {
      await markUpdateModeRequired(
        supabase,
        plaidItemId,
        "pending_disconnect",
        webhookCode,
      );
      await logWebhookEvent("update_mode_marked_required", "warn", {
        handled: true,
        updateModeReason: "pending_disconnect",
      });
      return json({
        received: true,
        handled: true,
        webhookType,
        webhookCode,
        plaidItemId,
        updateMode: {
          required: true,
          reason: "pending_disconnect",
        },
      });
    }

    if (webhookType === "ITEM" && webhookCode === "LOGIN_REPAIRED") {
      await clearUpdateModeState(supabase, plaidItemId, webhookCode);
      const syncResult = await syncAccountsForItem(
        supabase,
        plaidItemId,
        "LOGIN_REPAIRED_SYNC",
      );
      await logWebhookEvent("login_repaired_handled", "info", {
        handled: true,
        synced: Boolean(syncResult?.synced),
        linkedAccountCount: Number(syncResult?.linkedAccountCount || 0),
      });
      return json({
        received: true,
        handled: true,
        webhookType,
        webhookCode,
        plaidItemId,
        updateMode: {
          required: false,
          accountSelectionAvailable: false,
        },
        ...syncResult,
      });
    }

    if (webhookType === "ITEM" && webhookCode === "ISSUE_RESOLVED") {
      await clearUpdateModeState(supabase, plaidItemId, webhookCode);
      await logWebhookEvent("issue_resolved_handled", "info", {
        handled: true,
      });
      return json({
        received: true,
        handled: true,
        webhookType,
        webhookCode,
        plaidItemId,
        updateMode: {
          required: false,
          accountSelectionAvailable: false,
        },
      });
    }

    if (webhookType === "ITEM" && webhookCode === "USER_PERMISSION_REVOKED") {
      await revokeItem(supabase, plaidItemId);
      await logWebhookEvent("user_permission_revoked_handled", "warn", {
        handled: true,
      });
      return json({
        received: true,
        handled: true,
        webhookType,
        webhookCode,
        plaidItemId,
        revoked: true,
      });
    }

    if (webhookType === "ITEM" && webhookCode === "USER_ACCOUNT_REVOKED") {
      // Chase-only account-level revocation: resync accounts for the item and
      // revoke stale local accounts while preserving still-authorized accounts.
      const syncResult = await syncAccountsForItem(
        supabase,
        plaidItemId,
        "USER_ACCOUNT_REVOKED_SYNC",
      );
      await logWebhookEvent("user_account_revoked_handled", "warn", {
        handled: true,
        synced: Boolean(syncResult?.synced),
        linkedAccountCount: Number(syncResult?.linkedAccountCount || 0),
      });
      return json({
        received: true,
        handled: true,
        webhookType,
        webhookCode,
        plaidItemId,
        accountRevocationHandled: true,
        ...syncResult,
      });
    }

    if (webhookType === "ITEM" && webhookCode === "ERROR") {
      const errorCode = String(payload?.error?.error_code || "")
        .trim()
        .toUpperCase();
      if (errorCode === PLAID_LOGIN_REQUIRED_CODE) {
        await markUpdateModeRequired(
          supabase,
          plaidItemId,
          "item_login_required",
          webhookCode,
        );
        await logWebhookEvent("item_login_required_handled", "warn", {
          handled: true,
          errorCode,
        });
        return json({
          received: true,
          handled: true,
          webhookType,
          webhookCode,
          plaidItemId,
          updateMode: {
            required: true,
            reason: "item_login_required",
          },
          errorCode,
        });
      }

      await supabase
        .from("plaid_linked_items")
        .update({
          status: "errored",
          last_sync_at: new Date().toISOString(),
          last_webhook_code: webhookCode,
        })
        .eq("plaid_item_id", plaidItemId);
      await logWebhookEvent("webhook_error_marked_item_errored", "error", {
        handled: true,
        errorCode: errorCode || null,
      });
      return json({
        received: true,
        handled: true,
        webhookType,
        webhookCode,
        plaidItemId,
        errored: true,
        errorCode: errorCode || null,
      });
    }

    // Other webhooks are acknowledged for now.
    await logWebhookEvent("webhook_acknowledged_unhandled", "info", {
      handled: false,
    });
    return json({
      received: true,
      handled: false,
      webhookType,
      webhookCode,
      plaidItemId,
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
    console.error("plaid-webhook failed", error);
    return json(
      {
        error: (error as { message?: string })?.message || "Server error",
      },
      500,
    );
  }
});
