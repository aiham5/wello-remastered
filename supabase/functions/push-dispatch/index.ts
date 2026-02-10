// Sends push notifications via Expo Push API.
// Auth:
// - Cron can call with `x-cron-secret: <PUSH_CRON_SECRET>` (config.verify_jwt=false)
// - Admin/staff can call with a normal Supabase user JWT in Authorization header
//
// Notes:
// - This does not require Docker locally; deploy via Supabase Edge Functions.
// - Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets.
// - Optional: `EXPO_ACCESS_TOKEN` for higher limits.

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

const PUSH_CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") ?? "";
const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN") ?? "";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-cron-secret",
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

type Kind = "new_offer" | "expiring_offer" | "nearby_offer";

type DispatchRequest = {
  kinds?: Kind[];
  dryRun?: boolean;
  // For testing, you can force a time window (ISO).
  since?: string;
  // nearby_offer mode:
  // - "since" (default): only count offers since last_run_at (used for high-frequency runs)
  // - "digest": count all active nearby offers and include an example offer+business
  nearbyMode?: "since" | "digest";
};

type Recipient = {
  user_id: string;
  expo_push_token: string;
  new_offer: boolean | null;
  expiring_offer: boolean | null;
  nearby_offer: boolean | null;
  latitude: number | null;
  longitude: number | null;
};

async function isStaffOrCron(req: Request): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const cronSecret = req.headers.get("x-cron-secret") || "";
  if (PUSH_CRON_SECRET && cronSecret && cronSecret === PUSH_CRON_SECRET) return { ok: true };

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return { ok: false, status: 401, error: "Missing authorization." };

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, status: 500, error: "Missing server configuration." };
  }

  const authClient = createAuthClient();
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData?.user?.id) return { ok: false, status: 401, error: "Invalid JWT." };

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError || !profile) return { ok: false, status: 403, error: "Forbidden." };
  if (!["admin", "supervisor"].includes(String(profile.role))) return { ok: false, status: 403, error: "Forbidden." };
  return { ok: true };
}

async function getOfferExpirationColumn(admin: ReturnType<typeof createAdminClient>) {
  // Try common column names without crashing the whole function.
  const candidates = ["expires_at", "ends_at", "end_at", "end_date", "expires_on"];
  const { data, error } = await admin
    .from("information_schema.columns")
    .select("column_name")
    .eq("table_schema", "public")
    .eq("table_name", "offers")
    .in("column_name", candidates);
  if (error || !Array.isArray(data) || !data.length) return null;
  return String(data[0].column_name);
}

async function getOfferApprovedAtColumn(admin: ReturnType<typeof createAdminClient>) {
  // Notifications should trigger when an offer becomes visible (approved),
  // not when it's first created (often pending review for hours).
  const candidates = ["approved_at"];
  const { data, error } = await admin
    .from("information_schema.columns")
    .select("column_name")
    .eq("table_schema", "public")
    .eq("table_name", "offers")
    .in("column_name", candidates);
  if (error || !Array.isArray(data) || !data.length) return null;
  return String(data[0].column_name);
}

async function loadRecipients(admin: ReturnType<typeof createAdminClient>): Promise<Recipient[]> {
  // IMPORTANT:
  // PostgREST embedded relationships only work when there is an explicit FK between the tables.
  // In our schema, `notification_tokens`, `notification_preferences`, and `user_locations` all point
  // at `auth.users`, but they do not FK to each other, so embedding can fail with a schema cache error.
  // We load each table separately and merge in memory.

  const { data: tokenRows, error: tokenError } = await admin
    .from("notification_tokens")
    .select("user_id, expo_push_token")
    .not("expo_push_token", "is", null);
  if (tokenError) throw new Error(tokenError.message || "Failed to load notification tokens.");

  const rows = Array.isArray(tokenRows) ? tokenRows : [];
  const userIds = [...new Set(rows.map((r: any) => String(r.user_id || "")).filter(Boolean))];

  const prefByUser = new Map<string, { new_offer: boolean; expiring_offer: boolean; nearby_offer: boolean }>();
  if (userIds.length) {
    const { data: prefsRows, error: prefsError } = await admin
      .from("notification_preferences")
      .select("user_id, new_offer, expiring_offer, nearby_offer")
      .in("user_id", userIds);
    if (prefsError) throw new Error(prefsError.message || "Failed to load notification preferences.");
    for (const p of Array.isArray(prefsRows) ? prefsRows : []) {
      const uid = String((p as any).user_id || "");
      if (!uid) continue;
      prefByUser.set(uid, {
        new_offer: Boolean((p as any).new_offer),
        expiring_offer: Boolean((p as any).expiring_offer),
        nearby_offer: Boolean((p as any).nearby_offer),
      });
    }
  }

  const locByUser = new Map<string, { latitude: number | null; longitude: number | null }>();
  if (userIds.length) {
    const { data: locRows, error: locError } = await admin
      .from("user_locations")
      .select("user_id, latitude, longitude")
      .in("user_id", userIds);
    if (locError) throw new Error(locError.message || "Failed to load user locations.");
    for (const l of Array.isArray(locRows) ? locRows : []) {
      const uid = String((l as any).user_id || "");
      if (!uid) continue;
      const lat = (l as any).latitude;
      const lng = (l as any).longitude;
      locByUser.set(uid, {
        latitude: typeof lat === "number" ? lat : lat == null ? null : Number(lat),
        longitude: typeof lng === "number" ? lng : lng == null ? null : Number(lng),
      });
    }
  }

  return rows
    .map((row: any) => {
      const uid = String(row.user_id || "");
      const token = String(row.expo_push_token || "");
      const prefs = prefByUser.get(uid);
      const loc = locByUser.get(uid);

      return {
        user_id: uid,
        expo_push_token: token,
        // Missing prefs means: default enabled (null => enabled later).
        new_offer: prefs ? prefs.new_offer : null,
        expiring_offer: prefs ? prefs.expiring_offer : null,
        nearby_offer: prefs ? prefs.nearby_offer : null,
        latitude: loc?.latitude ?? null,
        longitude: loc?.longitude ?? null,
      } satisfies Recipient;
    })
    .filter((r) => r.user_id && r.expo_push_token);
}

async function getLastRun(admin: ReturnType<typeof createAdminClient>, kind: Kind) {
  const { data } = await admin
    .from("notification_dispatch_state")
    .select("kind, last_run_at")
    .eq("kind", kind)
    .maybeSingle();
  const last = data?.last_run_at ? new Date(data.last_run_at) : null;
  return last && !Number.isNaN(last.getTime()) ? last : null;
}

async function setLastRun(admin: ReturnType<typeof createAdminClient>, kind: Kind, when: Date) {
  await admin.from("notification_dispatch_state").upsert(
    { kind, last_run_at: when.toISOString() },
    { onConflict: "kind" },
  );
}

async function countNewOffers(admin: ReturnType<typeof createAdminClient>, since: Date, sinceCol: string) {
  const { count, error } = await admin
    .from("offers")
    .select("id", { count: "exact", head: true })
    .eq("approval_status", "approved")
    .eq("active", true)
    .gte(sinceCol, since.toISOString());
  if (error) throw new Error(error.message || "Failed to count offers.");
  return Number(count) || 0;
}

async function countExpiringOffers(
  admin: ReturnType<typeof createAdminClient>,
  expiresCol: string,
  now: Date,
  horizonHours: number,
) {
  const end = new Date(now.getTime() + horizonHours * 60 * 60 * 1000);
  const { count, error } = await admin
    .from("offers")
    .select("id", { count: "exact", head: true })
    .eq("approval_status", "approved")
    .eq("active", true)
    .gte(expiresCol, now.toISOString())
    .lt(expiresCol, end.toISOString());
  if (error) throw new Error(error.message || "Failed to count expiring offers.");
  return Number(count) || 0;
}

async function countNearbyOffers(
  admin: ReturnType<typeof createAdminClient>,
  since: Date,
  latitude: number,
  longitude: number,
  radiusMeters: number,
) {
  // Haversine in SQL; uses businesses(lat/lng) and offers(business_id).
  // If your businesses table uses different column names, adjust here.
  const lat = latitude;
  const lng = longitude;
  const { data, error } = await admin.rpc("count_nearby_offers_since", {
    since_ts: since.toISOString(),
    lat,
    lng,
    radius_meters: radiusMeters,
  });
  if (error) throw new Error(error.message || "Failed to count nearby offers.");
  return Number(data) || 0;
}

async function getNearbyDigest(
  admin: ReturnType<typeof createAdminClient>,
  latitude: number,
  longitude: number,
  radiusMeters: number,
): Promise<{ count: number; offerTitle: string | null; businessName: string | null; offerId: string | null; businessId: string | null }> {
  const { data, error } = await admin.rpc("get_nearby_offer_digest", {
    lat: latitude,
    lng: longitude,
    radius_meters: radiusMeters,
  });
  if (error) throw new Error(error.message || "Failed to load nearby offer digest.");

  const row = Array.isArray(data) ? data[0] : data;
  const count = Number((row as any)?.offer_count);
  const offerTitle = (row as any)?.offer_title != null ? String((row as any).offer_title) : null;
  const businessName = (row as any)?.business_name != null ? String((row as any).business_name) : null;
  const offerId = (row as any)?.offer_id != null ? String((row as any).offer_id) : null;
  const businessId = (row as any)?.business_id != null ? String((row as any).business_id) : null;
  return { count: Number.isFinite(count) ? count : 0, offerTitle, businessName, offerId, businessId };
}

async function sendExpo(messages: any[], dryRun: boolean) {
  if (dryRun) {
    return { ok: true, tickets: messages.map(() => ({ status: "ok", id: "dry_run" })) };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (EXPO_ACCESS_TOKEN) headers["Authorization"] = `Bearer ${EXPO_ACCESS_TOKEN}`;
  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(messages),
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    throw new Error(`Expo push failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return { ok: true, raw: parsed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Missing server configuration." });

  try {
    const auth = await isStaffOrCron(req);
    if (!auth.ok) return json(auth.status, { error: auth.error });

    const body = (await req.json().catch(() => ({}))) as DispatchRequest;
    const kinds: Kind[] = Array.isArray(body.kinds) && body.kinds.length
      ? body.kinds
      : ["new_offer", "expiring_offer", "nearby_offer"];
    const dryRun = Boolean(body.dryRun);
    const nearbyMode = body.nearbyMode === "digest" ? "digest" : "since";

    const now = new Date();
    const admin = createAdminClient();

    const expiresCol = await getOfferExpirationColumn(admin);
    const approvedAtCol = await getOfferApprovedAtColumn(admin);
    const offerSinceCol = approvedAtCol || "created_at";

    const recipients = await loadRecipients(admin);

    const summary: Record<string, any> = { ok: true, dryRun, now: now.toISOString(), results: [] as any[] };

    for (const kind of kinds) {
      const stateLast = body.since ? new Date(body.since) : await getLastRun(admin, kind);
      const since = stateLast && !Number.isNaN(stateLast.getTime())
        ? stateLast
        : new Date(now.getTime() - 60 * 60 * 1000);

      let globalCount = 0;
      if (kind === "new_offer") {
        globalCount = await countNewOffers(admin, since, offerSinceCol);
      } else if (kind === "expiring_offer") {
        if (!expiresCol) {
          summary.results.push({ kind, skipped: true, reason: "missing_expiration_column" });
          await setLastRun(admin, kind, now);
          continue;
        }
        globalCount = await countExpiringOffers(admin, expiresCol, now, 24);
      }

      const toSend: any[] = [];
      for (const r of recipients) {
        const pref =
          kind === "new_offer"
            ? r.new_offer
            : kind === "expiring_offer"
              ? r.expiring_offer
              : r.nearby_offer;
        const enabled = pref == null ? true : Boolean(pref);
        if (!enabled) continue;

        let count = globalCount;
        if (kind === "nearby_offer") {
          if (r.latitude == null || r.longitude == null) continue;
          if (nearbyMode === "digest") {
            const digest = await getNearbyDigest(admin, r.latitude, r.longitude, 5000);
            count = digest.count;
            if (!count || count <= 0) continue;

            const title = "Offers near you";
            const example =
              digest.offerTitle && digest.businessName
                ? `${digest.offerTitle} at ${digest.businessName}`
                : digest.offerTitle
                  ? digest.offerTitle
                  : null;
            const bodyText = example
              ? `${count} nearby offer${count === 1 ? "" : "s"}. Example: ${example}.`
              : `${count} nearby offer${count === 1 ? "" : "s"} available.`;

            toSend.push({
              to: r.expo_push_token,
              title,
              body: bodyText,
              sound: "default",
              data: { kind, count, offerId: digest.offerId, businessId: digest.businessId },
            });
            continue;
          }

          count = await countNearbyOffers(admin, since, r.latitude, r.longitude, 5000);
        }

        if (!count || count <= 0) continue;

        const title =
          kind === "new_offer"
            ? "New offers on Wello"
            : kind === "expiring_offer"
              ? "Offers expiring soon"
              : "New offers near you";
        const bodyText =
          kind === "new_offer"
            ? `${count} new offer${count === 1 ? "" : "s"} available.`
            : kind === "expiring_offer"
              ? `${count} offer${count === 1 ? "" : "s"} expiring in the next 24 hours.`
              : `${count} new nearby offer${count === 1 ? "" : "s"}.`;

        toSend.push({
          to: r.expo_push_token,
          title,
          body: bodyText,
          sound: "default",
          data: { kind, count },
        });
      }

      const batches = chunk(toSend, 100);
      let sent = 0;
      let errors = 0;

      for (const batch of batches) {
        if (!batch.length) continue;
        try {
          await sendExpo(batch, dryRun);
          sent += batch.length;
        } catch (_e) {
          errors += batch.length;
        }
      }

      await admin.from("notification_deliveries").insert({
        kind,
        sent_count: sent,
        error_count: errors,
        since_at: since.toISOString(),
        ran_at: now.toISOString(),
        dry_run: dryRun,
      });

      await setLastRun(admin, kind, now);
      summary.results.push({ kind, since: since.toISOString(), recipients: recipients.length, sent, errors, globalCount });
    }

    return json(200, summary);
  } catch (e: any) {
    console.error("push-dispatch failed", e?.message || e, e?.stack);
    return json(500, { error: "Internal Server Error", message: String(e?.message || e || "unknown") });
  }
});
