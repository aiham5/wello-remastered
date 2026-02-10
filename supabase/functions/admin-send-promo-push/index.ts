// Sends a promo-code push notification to customer devices via Expo Push API.
//
// Auth:
// - verify_jwt disabled (so cron/admin tools can call), but we still REQUIRE an Authorization Bearer user JWT
// - only staff (admin/supervisor) can send
//
// Notes:
// - Requires SUPABASE_URL and a service-role Secret API key in EDGE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY).
// - Optional: EXPO_ACCESS_TOKEN for higher Expo push limits.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.40.0";

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

const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN") ?? "";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
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

const chunk = <T>(arr: T[], size: number) => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

type Audience = "all" | "new_offer_opt_in";

type RequestBody = {
  promoCodeId?: string;
  audience?: Audience;
  title?: string;
  body?: string;
  dryRun?: boolean;
};

async function requireStaff(req: Request) {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return { ok: false as const, status: 401, error: "Missing authorization." };

  const authClient = createAuthClient();
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData?.user?.id) return { ok: false as const, status: 401, error: "Invalid JWT." };

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError || !profile) return { ok: false as const, status: 403, error: "Forbidden." };
  const role = String((profile as any).role || "");
  if (!["admin", "supervisor"].includes(role)) return { ok: false as const, status: 403, error: "Forbidden." };
  return { ok: true as const, admin };
}

async function sendExpo(messages: any[], dryRun: boolean) {
  if (dryRun) return { ok: true, tickets: messages.map(() => ({ status: "ok", id: "dry_run" })) };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (EXPO_ACCESS_TOKEN) headers["Authorization"] = `Bearer ${EXPO_ACCESS_TOKEN}`;
  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(messages),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Expo push failed (${res.status}): ${text.slice(0, 200)}`);
  return { ok: true, raw: text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Missing server configuration." });

  try {
    const staff = await requireStaff(req);
    if (!staff.ok) return json(staff.status, { error: staff.error });
    const admin = staff.admin;

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const promoCodeId = String(body?.promoCodeId || "").trim();
    const audience = (String(body?.audience || "all") as Audience) || "all";
    const title = String(body?.title || "").trim();
    const messageBody = String(body?.body || "").trim();
    const dryRun = Boolean(body?.dryRun);

    if (!promoCodeId) return json(400, { error: "Missing promoCodeId." });
    if (!title) return json(400, { error: "Missing title." });
    if (!messageBody) return json(400, { error: "Missing body." });

    const { data: promo, error: promoError } = await admin
      .from("promo_codes")
      .select("id, code, cashback_rate_bps, active, starts_at, ends_at")
      .eq("id", promoCodeId)
      .maybeSingle();
    if (promoError) return json(500, { error: promoError.message || "Unable to load promo code." });
    if (!promo?.id) return json(404, { error: "Promo code not found." });

    // Load device tokens.
    const { data: tokenRows, error: tokenError } = await admin
      .from("notification_tokens")
      .select("user_id, expo_push_token")
      .not("expo_push_token", "is", null);
    if (tokenError) return json(500, { error: tokenError.message || "Unable to load notification tokens." });

    const tokens = Array.isArray(tokenRows) ? tokenRows : [];
    const userIds = [...new Set(tokens.map((r: any) => String(r.user_id || "")).filter(Boolean))];

    // Filter to consumers only.
    const roleByUser = new Map<string, string>();
    for (const batch of chunk(userIds, 500)) {
      const { data: profRows, error: profErr } = await admin
        .from("profiles")
        .select("id, role")
        .in("id", batch);
      if (profErr) return json(500, { error: profErr.message || "Unable to load user profiles." });
      for (const row of Array.isArray(profRows) ? profRows : []) {
        const uid = String((row as any).id || "");
        if (!uid) continue;
        roleByUser.set(uid, String((row as any).role || ""));
      }
    }

    // Preferences (optional filter).
    const prefNewOfferByUser = new Map<string, boolean | null>();
    if (audience === "new_offer_opt_in" && userIds.length) {
      for (const batch of chunk(userIds, 500)) {
        const { data: prefRows, error: prefErr } = await admin
          .from("notification_preferences")
          .select("user_id, new_offer")
          .in("user_id", batch);
        if (prefErr) return json(500, { error: prefErr.message || "Unable to load notification preferences." });
        for (const row of Array.isArray(prefRows) ? prefRows : []) {
          const uid = String((row as any).user_id || "");
          if (!uid) continue;
          prefNewOfferByUser.set(uid, Boolean((row as any).new_offer));
        }
      }
    }

    const messages: any[] = [];
    for (const row of tokens) {
      const uid = String((row as any).user_id || "");
      const token = String((row as any).expo_push_token || "");
      if (!uid || !token) continue;

      if (roleByUser.get(uid) !== "consumer") continue;

      if (audience === "new_offer_opt_in") {
        // Missing row => treat as enabled (consistent with push-dispatch default).
        const enabled = prefNewOfferByUser.has(uid) ? Boolean(prefNewOfferByUser.get(uid)) : true;
        if (!enabled) continue;
      }

      messages.push({
        to: token,
        title,
        body: messageBody,
        sound: "default",
        data: {
          kind: "promo_code",
          promoCodeId: String((promo as any).id),
          promoCode: String((promo as any).code || ""),
          cashbackRateBps: Number((promo as any).cashback_rate_bps) || null,
        },
      });
    }

    let sent = 0;
    let errors = 0;
    for (const batch of chunk(messages, 100)) {
      if (!batch.length) continue;
      try {
        await sendExpo(batch, dryRun);
        sent += batch.length;
      } catch {
        errors += batch.length;
      }
    }

    return json(200, { ok: true, sent, errors, dryRun });
  } catch (e: any) {
    console.error("admin-send-promo-push failed", e?.message || e, e?.stack);
    return json(500, { error: "Internal Server Error", message: String(e?.message || e || "unknown") });
  }
});

