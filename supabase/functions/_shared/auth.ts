import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL =
  Deno.env.get("EDGE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
export const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("EDGE_SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("EDGE_SERVICE_ROLE_KEY") ??
  "";
export const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("EDGE_SUPABASE_ANON_KEY") ??
  "";

export class HttpError extends Error {
  status: number;
  details?: Record<string, unknown>;

  constructor(
    message: string,
    status = 500,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });

export const ensureSupabaseEnv = () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    throw new HttpError("Missing server configuration.", 500, {
      missing: {
        SUPABASE_URL: !SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: !SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_ANON_KEY: !SUPABASE_ANON_KEY,
      },
    });
  }
};

export const createAdminSupabase = () =>
  createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

export const createAuthSupabase = () =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const decodeJwtPayload = (token: string) => {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const decodeJwtHeader = (token: string) => {
  try {
    const header = token.split(".")[0];
    if (!header) return null;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const extractToken = async (req: Request) => {
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
  return {
    body,
    token: String(bodyAccessToken || headerToken || "").trim(),
    hasAuthHeader: Boolean(headerToken),
    hasBodyToken: Boolean(bodyAccessToken),
  };
};

export const authenticateRequest = async (req: Request) => {
  ensureSupabaseEnv();
  const extracted = await extractToken(req);
  if (!extracted.token) {
    throw new HttpError("Unauthorized", 401, {
      reason: "missing_token",
      hasAuthHeader: extracted.hasAuthHeader,
      hasBodyToken: extracted.hasBodyToken,
    });
  }

  const tokenPayload = decodeJwtPayload(extracted.token) || {};
  const tokenHeader = decodeJwtHeader(extracted.token) || {};
  const expectedIssuer = `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1`;
  if (tokenPayload?.iss && tokenPayload.iss !== expectedIssuer) {
    throw new HttpError("Unauthorized", 401, {
      reason: "project_mismatch",
      message: "Session belongs to a different Supabase project.",
      debug: {
        supabaseUrl: SUPABASE_URL,
        expectedIssuer,
        tokenIssuer: tokenPayload?.iss || null,
        tokenAud: tokenPayload?.aud || null,
        tokenSub: tokenPayload?.sub || null,
        tokenKid: tokenHeader?.kid || null,
        tokenAlg: tokenHeader?.alg || null,
      },
    });
  }

  const authClient = createAuthSupabase();
  const { data: authData, error: authError } = await authClient.auth.getUser(
    extracted.token,
  );
  if (authError || !authData?.user?.id) {
    throw new HttpError("Unauthorized", 401, {
      reason: "invalid_token",
      message: authError?.message || "Invalid JWT",
      debug: {
        supabaseUrl: SUPABASE_URL,
        expectedIssuer,
        tokenIssuer: tokenPayload?.iss || null,
        tokenAud: tokenPayload?.aud || null,
        tokenSub: tokenPayload?.sub || null,
        tokenKid: tokenHeader?.kid || null,
        tokenAlg: tokenHeader?.alg || null,
      },
    });
  }

  return {
    userId: authData.user.id,
    token: extracted.token,
    body: extracted.body,
  };
};
