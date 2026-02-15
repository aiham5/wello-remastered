import { createClient } from "npm:@supabase/supabase-js@2.40.0";

export const config = { verify_jwt: false };

const R2_ENDPOINT = Deno.env.get("R2_ENDPOINT") ?? "";
const R2_BUCKET = Deno.env.get("R2_BUCKET") ?? "";
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
const SUPABASE_URL =
  Deno.env.get("EDGE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY =
  Deno.env.get("EDGE_SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY") ??
  "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("EDGE_SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const encoder = new TextEncoder();

const toHex = (buffer: ArrayBuffer | Uint8Array) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const encodeRfc3986 = (value: string) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const encodePath = (path: string) =>
  path
    .split("/")
    .map((segment) => encodeRfc3986(segment))
    .join("/");

const sha256Hex = async (value: string) =>
  toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));

const hmacRaw = async (key: Uint8Array, value: string) => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(value),
  );
  return new Uint8Array(signature);
};

const getSigningKey = async (
  secret: string,
  dateStamp: string,
  region: string,
  service: string,
) => {
  const kDate = await hmacRaw(encoder.encode(`AWS4${secret}`), dateStamp);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, service);
  return hmacRaw(kService, "aws4_request");
};

const buildQueryString = (params: Record<string, string>) => {
  const keys = Object.keys(params).sort();
  return keys
    .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(params[key])}`)
    .join("&");
};

const createPresignedUrl = async (
  method: string,
  key: string,
  expiresIn: number,
) => {
  const endpoint = R2_ENDPOINT.replace(/\/+$/, "");
  const url = new URL(endpoint);
  const host = url.host;
  const basePath = url.pathname && url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : "";
  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const credential = `${R2_ACCESS_KEY_ID}/${credentialScope}`;
  // Support both endpoint styles:
  // - https://<account>.r2.cloudflarestorage.com
  // - https://<account>.r2.cloudflarestorage.com/<bucket>
  const canonicalUri = basePath
    ? `${basePath}/${encodePath(key)}`
    : `/${encodePath(`${R2_BUCKET}/${key}`)}`;
  const payloadHash = "UNSIGNED-PAYLOAD";

  const queryParams: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  };

  const canonicalQueryString = buildQueryString(queryParams);
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    "host",
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await getSigningKey(
    R2_SECRET_ACCESS_KEY,
    dateStamp,
    "auto",
    "s3",
  );
  const signature = toHex(await hmacRaw(signingKey, stringToSign));

  const finalQuery = `${canonicalQueryString}&X-Amz-Signature=${signature}`;
  return `${endpoint}${canonicalUri}?${finalQuery}`;
};

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const getCorsHeaders = (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  if (origin && ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) {
    return null;
  }
  return {
    "Access-Control-Allow-Origin": origin || "*",
    Vary: "Origin",
    ...baseCorsHeaders,
  };
};

const fetchWithTimeout = async (
  input: string,
  init: RequestInit,
  timeoutMs: number,
) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
};

const parseReceiptKey = (key: string) => {
  const normalized = String(key || "").trim();
  if (!normalized || normalized.includes("..") || normalized.startsWith("/")) {
    return null;
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length !== 4) return null;
  if (segments[0] !== "receipts") return null;
  const businessId = segments[1];
  const redemptionId = segments[2];
  const fileName = segments[3];
  if (!businessId || !redemptionId || !fileName) return null;
  return { key: normalized, businessId, redemptionId, fileName };
};

const getBodyId = (body: Record<string, unknown>, camel: string, snake: string) => {
  const value =
    typeof body?.[camel] === "string"
      ? body[camel]
      : typeof body?.[snake] === "string"
        ? body[snake]
        : "";
  return String(value || "").trim();
};

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (!corsHeaders) {
    return new Response(JSON.stringify({ error: "CORS blocked" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  if (
    !R2_ENDPOINT ||
    !R2_BUCKET ||
    !R2_ACCESS_KEY_ID ||
    !R2_SECRET_ACCESS_KEY ||
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    return new Response(
      JSON.stringify({ error: "Missing R2 configuration." }),
      { status: 500, headers: corsHeaders },
    );
  }

  try {
    const authHeader =
      req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
    const incomingApiKey =
      req.headers.get("apikey") ?? req.headers.get("Apikey") ?? "";
    const body = await req.json().catch(() => ({}));
    const bodyAccessToken =
      typeof body?.accessToken === "string"
        ? body.accessToken
        : typeof body?.access_token === "string"
          ? body.access_token
          : typeof body?.session?.access_token === "string"
            ? body.session.access_token
            : "";
    const headerToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;
    const token = String(bodyAccessToken || headerToken || "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", reason: "missing_token" }),
        { status: 401, headers: corsHeaders },
      );
    }
    const authKey =
      incomingApiKey || SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY;
    let userResponse: Response;
    try {
      userResponse = await fetchWithTimeout(
        `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/user`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: authKey,
          },
        },
        8000,
      );
    } catch (error) {
      const message = String(error?.message || "");
      const isAbort =
        message.toLowerCase().includes("aborted") ||
        message.toLowerCase().includes("aborterror");
      return new Response(
        JSON.stringify({
          error: "Auth timeout",
          reason: isAbort ? "auth_fetch_timeout" : "auth_fetch_failed",
        }),
        { status: 503, headers: corsHeaders },
      );
    }
    if (!userResponse.ok) {
      const raw = await userResponse.text();
      return new Response(
        JSON.stringify({
          error: "Invalid JWT",
          reason: raw || `auth_status_${userResponse.status}`,
        }),
        { status: 401, headers: corsHeaders },
      );
    }
    const user = await userResponse.json().catch(() => null);
    const userId = String(user?.id || "").trim();
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Invalid JWT", reason: "missing_user_id" }),
        { status: 401, headers: corsHeaders },
      );
    }

    const action = String(body?.action || "").toLowerCase();
    const key = String(body?.key || "").trim();
    const parsedReceiptKey = parseReceiptKey(key);
    if (!parsedReceiptKey) {
      return new Response(
        JSON.stringify({ error: "Invalid object key." }),
        { status: 400, headers: corsHeaders },
      );
    }
    const expiresInRaw = Number(body?.expiresIn);
    const expiresIn = Math.min(
      3600,
      Math.max(60, Number.isFinite(expiresInRaw) ? expiresInRaw : 900),
    );

    const method = action === "upload" ? "PUT" : "GET";
    if (!["upload", "download"].includes(action)) {
      return new Response(
        JSON.stringify({ error: "Invalid action." }),
        { status: 400, headers: corsHeaders },
      );
    }

    const supabaseAdminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    if (action === "upload") {
      const bodyBusinessId = getBodyId(body, "businessId", "business_id");
      const bodyRedemptionId = getBodyId(body, "redemptionId", "redemption_id");
      if (!bodyBusinessId || !bodyRedemptionId) {
        return new Response(
          JSON.stringify({
            error: "Missing receipt upload identifiers.",
            reason: "missing_business_or_redemption",
          }),
          { status: 400, headers: corsHeaders },
        );
      }
      if (
        parsedReceiptKey.businessId !== bodyBusinessId ||
        parsedReceiptKey.redemptionId !== bodyRedemptionId
      ) {
        return new Response(
          JSON.stringify({
            error: "Receipt key does not match redemption context.",
            reason: "key_context_mismatch",
          }),
          { status: 403, headers: corsHeaders },
        );
      }

      const { data: redemption, error: redemptionError } = await supabaseAdminClient
        .from("redemptions")
        .select("id, business_id, scanned_by")
        .eq("id", bodyRedemptionId)
        .eq("business_id", bodyBusinessId)
        .eq("scanned_by", userId)
        .maybeSingle();
      if (redemptionError || !redemption) {
        return new Response(
          JSON.stringify({
            error: "Not allowed to upload for this redemption.",
            reason: "redemption_not_owned",
          }),
          { status: 403, headers: corsHeaders },
        );
      }
    } else {
      const { data: receipt, error: receiptError } = await supabaseAdminClient
        .from("receipt_uploads")
        .select("id, user_id, business_id")
        .eq("storage_path", parsedReceiptKey.key)
        .maybeSingle();
      if (receiptError || !receipt) {
        return new Response(
          JSON.stringify({
            error: "Receipt not found.",
            reason: "receipt_not_found",
          }),
          { status: 404, headers: corsHeaders },
        );
      }
      let allowed = String(receipt.user_id || "") === userId;
      if (!allowed) {
        const { data: ownedBusiness } = await supabaseAdminClient
          .from("businesses")
          .select("id")
          .eq("id", receipt.business_id)
          .eq("owner_id", userId)
          .maybeSingle();
        allowed = Boolean(ownedBusiness?.id);
      }
      if (!allowed) {
        const { data: profile } = await supabaseAdminClient
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .maybeSingle();
        const role = String(profile?.role || "").toLowerCase();
        allowed = role === "admin" || role === "supervisor";
      }
      if (!allowed) {
        return new Response(
          JSON.stringify({
            error: "Not allowed to access this receipt.",
            reason: "receipt_access_denied",
          }),
          { status: 403, headers: corsHeaders },
        );
      }
    }

    const signedUrl = await createPresignedUrl(method, parsedReceiptKey.key, expiresIn);
    return new Response(
      JSON.stringify({
        signedUrl,
        key: parsedReceiptKey.key,
        action,
        method,
        expiresIn,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error?.message || "Unable to sign URL." }),
      { status: 500, headers: corsHeaders },
    );
  }
});
