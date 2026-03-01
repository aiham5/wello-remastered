// Registers an Expo push token for the current signed-in user.
// Uses service-role to allow safe "re-claiming" a token if a device changes accounts.
//
// Client usage:
//   await supabase.functions.invoke("push-register-token", { body: { expoPushToken } })
//
// Requires secrets:
// - SUPABASE_URL (or EDGE_SUPABASE_URL)
// - SUPABASE_SERVICE_ROLE_KEY (sb_secret_...)
// - SUPABASE_ANON_KEY (sb_publishable_... or legacy anon JWT)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.40.0";
import { HttpError } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";

export const config = { verify_jwt: false };

const SUPABASE_URL =
  Deno.env.get("EDGE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("EDGE_SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("EDGE_SERVICE_ROLE_KEY") ??
  "";
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("EDGE_SUPABASE_ANON_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const createAdminClient = () =>
  createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const createAuthClient = () =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

type RegisterBody = {
  expoPushToken?: string;
  platform?: string;
  deviceInfo?: string;
};

const EXPO_PUSH_TOKEN_REGEX = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{8,200}\]$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    return json(500, { error: "Missing server configuration." });
  }

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return json(401, { error: "Missing authorization." });

  const body = (await req.json().catch(() => ({}))) as RegisterBody;
  const expoPushToken = String(body.expoPushToken || "").trim();
  const platform = String(body.platform || "").trim().slice(0, 40);
  const deviceInfo = String(body.deviceInfo || "").trim().slice(0, 200);
  if (!expoPushToken) return json(400, { error: "Missing expoPushToken." });
  if (!EXPO_PUSH_TOKEN_REGEX.test(expoPushToken)) {
    return json(400, { error: "Invalid expoPushToken." });
  }

  const auth = createAuthClient();
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  if (authError || !authData?.user?.id) return json(401, { error: "Invalid JWT." });

  const admin = createAdminClient();
  try {
    await enforceRateLimit({
      req,
      scope: "push:register-token",
      userId: authData.user.id,
      identifier: `${authData.user.id}|token:${expoPushToken.slice(0, 40)}`,
      maxRequests: 24,
      windowSeconds: 60 * 60,
      supabase: admin,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return json(error.status, {
        error: error.message,
        ...(error.details || {}),
      });
    }
    throw error;
  }
  const now = new Date().toISOString();

  // Upsert by token (unique constraint). This lets a device token move between users.
  const { error } = await admin.from("notification_tokens").upsert(
    {
      user_id: authData.user.id,
      expo_push_token: expoPushToken,
      platform: platform || null,
      device_info: deviceInfo || null,
      last_seen_at: now,
    },
    { onConflict: "expo_push_token" },
  );

  if (error) return json(500, { error: error.message || "Failed to save token." });
  return json(200, { ok: true });
});

