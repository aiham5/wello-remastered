import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createAdminSupabase,
  createAuthSupabase,
  HttpError,
  json,
} from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";

export const config = { verify_jwt: false };

const GOOGLE_PLACES_SERVER_KEY = String(
  Deno.env.get("GOOGLE_PLACES_SERVER_KEY") ||
    Deno.env.get("GOOGLE_MAPS_SERVER_KEY") ||
    "",
).trim();
const GOOGLE_PLACES_AUTOCOMPLETE_URL =
  "https://places.googleapis.com/v1/places:autocomplete";
const GOOGLE_PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places";
const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const GOOGLE_NEAREST_ROADS_URL =
  "https://roads.googleapis.com/v1/nearestRoads";

const GOOGLE_PLACES_AUTOCOMPLETE_FIELDMASK =
  "suggestions.placePrediction.placeId,suggestions.placePrediction.place,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text";
const GOOGLE_PLACES_DETAILS_FIELDMASK =
  "formattedAddress,addressComponents,location";

const ALLOWED_ORIGINS = String(Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const getCorsHeaders = (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  if (
    origin && ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(origin)
  ) {
    return null;
  }
  return {
    "Access-Control-Allow-Origin": origin || "*",
    Vary: "Origin",
    ...baseCorsHeaders,
  };
};

const parseJsonSafe = (raw: string) => {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const normalizeSessionToken = (value: unknown) => {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 120);
  return normalized || null;
};

const normalizePlaceId = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("places/")) return raw.slice("places/".length).trim();
  return raw;
};

const extractToken = (req: Request, body: Record<string, unknown>) => {
  const authHeader = req.headers.get("authorization") ??
    req.headers.get("Authorization") ?? "";
  const headerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;
  const bodyToken = typeof body?.accessToken === "string"
    ? body.accessToken
    : typeof body?.access_token === "string"
    ? body.access_token
    : "";
  return String(bodyToken || headerToken || "").trim();
};

const resolveUserId = async (req: Request, body: Record<string, unknown>) => {
  const token = extractToken(req, body);
  if (!token) return null;
  try {
    const authClient = createAuthSupabase();
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    return data.user.id;
  } catch {
    return null;
  }
};

const googleHeaders = (fieldMask: string) => ({
  "content-type": "application/json",
  "X-Goog-Api-Key": GOOGLE_PLACES_SERVER_KEY,
  "X-Goog-FieldMask": fieldMask,
});

const ensureServerKey = () => {
  if (!GOOGLE_PLACES_SERVER_KEY) {
    throw new HttpError("Missing Google Places server key.", 500, {
      reason: "missing_google_places_server_key",
    });
  }
};

const runAutocomplete = async (body: Record<string, unknown>) => {
  const input = String(body?.input || body?.query || "").trim();
  if (input.length < 2 || input.length > 180) {
    throw new HttpError("Invalid address query.", 400, {
      reason: "invalid_autocomplete_input",
    });
  }
  const payload: Record<string, unknown> = { input };
  const sessionToken = normalizeSessionToken(body?.sessionToken);
  if (sessionToken) payload.sessionToken = sessionToken;

  const response = await fetch(GOOGLE_PLACES_AUTOCOMPLETE_URL, {
    method: "POST",
    headers: googleHeaders(GOOGLE_PLACES_AUTOCOMPLETE_FIELDMASK),
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  const parsed = parseJsonSafe(raw);
  if (!response.ok) {
    throw new HttpError("Unable to load address suggestions right now.", 502, {
      reason: "google_places_autocomplete_failed",
      upstreamStatus: response.status || null,
    });
  }
  return parsed;
};

const runDetails = async (body: Record<string, unknown>) => {
  const placeId = normalizePlaceId(body?.placeId);
  if (!placeId || placeId.length > 220) {
    throw new HttpError("Invalid place id.", 400, {
      reason: "invalid_place_id",
    });
  }

  const sessionToken = normalizeSessionToken(body?.sessionToken);
  const detailsUrl =
    `${GOOGLE_PLACES_DETAILS_URL}/${encodeURIComponent(placeId)}` +
    (sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : "");
  const response = await fetch(detailsUrl, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": GOOGLE_PLACES_SERVER_KEY,
      "X-Goog-FieldMask": GOOGLE_PLACES_DETAILS_FIELDMASK,
    },
  });
  const raw = await response.text();
  const parsed = parseJsonSafe(raw);
  if (!response.ok) {
    throw new HttpError("Unable to load place details right now.", 502, {
      reason: "google_places_details_failed",
      upstreamStatus: response.status || null,
    });
  }
  return parsed;
};

const runGeocode = async (body: Record<string, unknown>) => {
  const address = String(body?.address || "").trim();
  if (!address || address.length > 220) {
    throw new HttpError("Invalid address.", 400, {
      reason: "invalid_geocode_address",
    });
  }
  const response = await fetch(
    `${GOOGLE_GEOCODE_URL}?address=${encodeURIComponent(address)}&key=${
      encodeURIComponent(GOOGLE_PLACES_SERVER_KEY)
    }`,
    { method: "GET" },
  );
  const raw = await response.text();
  const parsed = parseJsonSafe(raw);
  const geocodeStatus = String(parsed?.status || "").toUpperCase();
  const hasKnownStatus = geocodeStatus === "OK" ||
    geocodeStatus === "ZERO_RESULTS";
  if (!response.ok || !hasKnownStatus) {
    throw new HttpError("Unable to geocode that address right now.", 502, {
      reason: "google_geocode_failed",
      upstreamStatus: response.status || null,
      geocodeStatus: geocodeStatus || null,
    });
  }
  return parsed;
};

const runNearestRoad = async (body: Record<string, unknown>) => {
  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new HttpError("Invalid coordinate.", 400, {
      reason: "invalid_road_coordinate",
    });
  }
  const response = await fetch(
    `${GOOGLE_NEAREST_ROADS_URL}?points=${encodeURIComponent(`${latitude},${longitude}`)}&key=${encodeURIComponent(GOOGLE_PLACES_SERVER_KEY)}`,
    { method: "GET" },
  );
  const raw = await response.text();
  const parsed = parseJsonSafe(raw);
  if (!response.ok) {
    throw new HttpError("Unable to locate the nearest road right now.", 502, {
      reason: "google_nearest_road_failed",
      upstreamStatus: response.status || null,
    });
  }
  return parsed;
};

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (!corsHeaders) {
    return json({ error: "CORS blocked." }, 403);
  }
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405, corsHeaders);
  }

  try {
    ensureServerKey();
    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const action = String(body?.action || "").trim().toLowerCase();
    if (!["autocomplete", "details", "geocode", "nearestroad"].includes(action)) {
      throw new HttpError("Invalid action.", 400, {
        reason: "invalid_action",
      });
    }

    const userId = await resolveUserId(req, body);
    const supabase = createAdminSupabase();
    if (action === "autocomplete") {
      await enforceRateLimit({
        req,
        scope: "places:autocomplete",
        userId,
        maxRequests: 180,
        windowSeconds: 10 * 60,
        supabase,
      });
      const payload = await runAutocomplete(body);
      return json(payload, 200, corsHeaders);
    }

    if (action === "details") {
      await enforceRateLimit({
        req,
        scope: "places:details",
        userId,
        maxRequests: 120,
        windowSeconds: 10 * 60,
        supabase,
      });
      const payload = await runDetails(body);
      return json(payload, 200, corsHeaders);
    }

    if (action === "nearestroad") {
      await enforceRateLimit({
        req,
        scope: "places:nearest-road",
        userId,
        maxRequests: 90,
        windowSeconds: 10 * 60,
        supabase,
      });
      const payload = await runNearestRoad(body);
      return json(payload, 200, corsHeaders);
    }

    await enforceRateLimit({
      req,
      scope: "places:geocode",
      userId,
      maxRequests: 90,
      windowSeconds: 10 * 60,
      supabase,
    });
    const payload = await runGeocode(body);
    return json(payload, 200, corsHeaders);
  } catch (error) {
    if (error instanceof HttpError) {
      return json(
        { error: error.message, ...(error.details || {}) },
        error.status,
        corsHeaders,
      );
    }
    console.error("places-proxy failed", String(error || ""));
    return json(
      { error: "Unable to process address lookup right now." },
      500,
      corsHeaders,
    );
  }
});
