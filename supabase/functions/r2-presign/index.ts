import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

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
  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const credential = `${R2_ACCESS_KEY_ID}/${credentialScope}`;
  const canonicalUri = `/${encodePath(`${R2_BUCKET}/${key}`)}`;
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
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
    !SUPABASE_ANON_KEY
  ) {
    return new Response(
      JSON.stringify({ error: "Missing R2 configuration." }),
      { status: 500, headers: corsHeaders },
    );
  }

  try {
    const authHeader =
      req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
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
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } =
      await supabaseAuth.auth.getUser(token);
    if (userError || !userData?.user?.id) {
      const payload = (() => {
        try {
          const part = token.split(".")[1];
          if (!part) return null;
          const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
          const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
          return JSON.parse(atob(padded));
        } catch {
          return null;
        }
      })();
      return new Response(
        JSON.stringify({
          error: "Invalid JWT",
          reason: userError?.message || null,
          debug: {
            issuer: payload?.iss || null,
            sub: payload?.sub || null,
            exp: payload?.exp || null,
          },
        }),
        { status: 401, headers: corsHeaders },
      );
    }
    const action = String(body?.action || "").toLowerCase();
    const key = String(body?.key || "").trim();
    if (!key || key.includes("..") || key.startsWith("/")) {
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

    const signedUrl = await createPresignedUrl(method, key, expiresIn);
    return new Response(
      JSON.stringify({
        signedUrl,
        key,
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
