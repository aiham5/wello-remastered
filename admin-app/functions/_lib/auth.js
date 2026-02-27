const STAFF_ROLES = new Set(["admin", "supervisor"]);

let certCache = {
  fetchedAt: 0,
  keys: [],
};

const CERT_CACHE_MS = 5 * 60 * 1000;

const textDecoder = new TextDecoder();

const b64UrlToUint8 = (input) => {
  const normalized = String(input || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const decodeJwtPart = (part) => {
  const bytes = b64UrlToUint8(part);
  return JSON.parse(textDecoder.decode(bytes));
};

const normalizeTeamDomain = (raw) => {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.includes("cloudflareaccess.com")) return value.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return `${value}.cloudflareaccess.com`;
};

const getCerts = async (env) => {
  const now = Date.now();
  if (certCache.keys.length && now - certCache.fetchedAt < CERT_CACHE_MS) {
    return certCache.keys;
  }

  const teamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  if (!teamDomain) throw new Error("Missing CF_ACCESS_TEAM_DOMAIN.");

  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) {
    throw new Error(`Unable to fetch Access certs (${response.status}).`);
  }
  const payload = await response.json();
  const keys = Array.isArray(payload?.keys) ? payload.keys : [];
  if (!keys.length) throw new Error("Access cert set is empty.");
  certCache = { fetchedAt: now, keys };
  return keys;
};

const verifyJwtSignature = async ({ token, header, signaturePart, signingInput, env }) => {
  const keys = await getCerts(env);
  const key = keys.find((candidate) => String(candidate?.kid || "") === String(header?.kid || "")) || keys[0];
  if (!key) throw new Error("No matching Access cert key.");

  const algorithm = String(header?.alg || "RS256").toUpperCase();
  if (algorithm !== "RS256") {
    throw new Error(`Unsupported Access JWT alg '${algorithm}'.`);
  }

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    key,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["verify"],
  );

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    b64UrlToUint8(signaturePart),
    new TextEncoder().encode(signingInput),
  );

  if (!valid) throw new Error("Invalid Access JWT signature.");

  return token;
};

const parseAndVerifyAccessJwt = async (token, env) => {
  const value = String(token || "").trim();
  const parts = value.split(".");
  if (parts.length !== 3) throw new Error("Malformed Access JWT.");

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeJwtPart(headerPart);
  const payload = decodeJwtPart(payloadPart);

  await verifyJwtSignature({
    token: value,
    header,
    signaturePart,
    signingInput: `${headerPart}.${payloadPart}`,
    env,
  });

  const now = Math.floor(Date.now() / 1000);
  const exp = Number(payload?.exp || 0);
  if (!exp || exp < now - 10) throw new Error("Access JWT expired.");

  const audClaim = payload?.aud;
  const expectedAud = String(env.CF_ACCESS_AUD || "").trim();
  if (!expectedAud) throw new Error("Missing CF_ACCESS_AUD.");

  const validAud = Array.isArray(audClaim)
    ? audClaim.map(String).includes(expectedAud)
    : String(audClaim || "") === expectedAud;
  if (!validAud) throw new Error("Access JWT audience mismatch.");

  const email = String(payload?.email || payload?.sub || "").trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("Access JWT missing email claim.");

  return { payload, email };
};

const toPostgrestFilter = (column, op, value) => {
  const key = String(column || "").trim();
  if (!key) return null;

  if (op === "is") {
    if (value === null || String(value).toLowerCase() === "null") {
      return [key, "is.null"];
    }
    return [key, `is.${String(value)}`];
  }

  if (op === "in") {
    return [key, `in.${String(value || "()")}`];
  }

  if (op === "or") {
    return ["or", String(value || "")];
  }

  const scalar =
    typeof value === "boolean" || typeof value === "number"
      ? String(value)
      : String(value ?? "");
  return [key, `${op}.${scalar}`];
};

const supabaseRequest = async (env, path, init = {}) => {
  const baseUrl = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const serviceKey = String(
    env.ADMIN_SUPABASE_SECRET_KEY ||
      env.SUPABASE_SECRET_KEY ||
      env.SUPABASE_SERVICE_ROLE_KEY ||
      "",
  ).trim();
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or ADMIN_SUPABASE_SECRET_KEY.");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });

  return response;
};

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

export const getAdminContext = async (request, env) => {
  const assertion = String(request.headers.get("Cf-Access-Jwt-Assertion") || "").trim();
  if (!assertion) {
    throw new Error("Missing Access assertion.");
  }

  const { email } = await parseAndVerifyAccessJwt(assertion, env);

  const allowedEmailsRaw = String(env.ADMIN_ALLOWED_EMAILS || "").trim();
  if (allowedEmailsRaw) {
    const allowed = new Set(
      allowedEmailsRaw
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    );
    if (allowed.size && !allowed.has(email)) {
      throw new Error("Access denied for this email.");
    }
  }

  const params = new URLSearchParams({
    select: "id,email,full_name,role",
    email: `eq.${email}`,
    limit: "1",
  });

  const profileRes = await supabaseRequest(env, `/rest/v1/profiles?${params.toString()}`);
  if (!profileRes.ok) {
    const text = await profileRes.text();
    throw new Error(`Profile lookup failed (${profileRes.status}): ${text.slice(0, 240)}`);
  }
  const rows = await profileRes.json();
  const profile = Array.isArray(rows) ? rows[0] || null : null;
  if (!profile?.id) throw new Error("Access denied. Staff profile not found.");
  if (!STAFF_ROLES.has(String(profile.role || ""))) {
    throw new Error("Access denied. Admin or supervisor role required.");
  }

  return {
    email,
    profile,
    supabaseRequest: (path, init = {}) => supabaseRequest(env, path, init),
    toPostgrestFilter,
  };
};

export const logAuthEvent = async (
  ctx,
  {
    outcome = "success",
    eventName = "request",
    endpoint = "",
    reason = null,
    statusCode = null,
    metadata = null,
  } = {},
) => {
  try {
    const body = {
      event_name: String(eventName || "request"),
      endpoint: String(endpoint || ""),
      actor_email: String(ctx?.email || ""),
      actor_profile_id: String(ctx?.profile?.id || "") || null,
      actor_role: String(ctx?.profile?.role || "") || null,
      outcome: String(outcome || "success"),
      reason: reason == null ? null : String(reason),
      status_code: statusCode == null ? null : Number(statusCode),
      metadata: metadata && typeof metadata === "object" ? metadata : null,
    };

    await ctx.supabaseRequest("/rest/v1/admin_auth_events", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Non-blocking diagnostics.
  }
};
