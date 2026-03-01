import { createAdminSupabase, extractClientIp, HttpError } from "./auth.ts";

type RateLimitInput = {
  req: Request;
  scope: string;
  maxRequests: number;
  windowSeconds: number;
  userId?: string | null;
  identifier?: string | null;
  supabase?: any;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: string | null;
  scope: string;
  identifier: string;
};

const normalizeScope = (scope: string) =>
  String(scope || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, "")
    .slice(0, 80);

const normalizeIdentifier = (identifier: string) =>
  String(identifier || "")
    .trim()
    .toLowerCase()
    .slice(0, 180);

const toFiniteInt = (value: number, fallback: number) => {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const computeIdentifier = (input: RateLimitInput) => {
  const explicit = normalizeIdentifier(String(input.identifier || ""));
  if (explicit) return explicit;
  const ip = extractClientIp(input.req);
  const user = String(input.userId || "").trim();
  if (user) return `user:${user}|ip:${ip}`;
  return `ip:${ip}`;
};

export const enforceRateLimit = async (
  input: RateLimitInput,
): Promise<RateLimitResult> => {
  const scope = normalizeScope(input.scope);
  if (!scope) {
    throw new HttpError("Rate limiter misconfigured.", 500, {
      reason: "invalid_rate_limit_scope",
    });
  }
  const maxRequests = toFiniteInt(input.maxRequests, 30);
  const windowSeconds = toFiniteInt(input.windowSeconds, 60);
  const identifier = computeIdentifier(input);
  const supabase = input.supabase ?? createAdminSupabase();

  const { data, error } = await supabase
    .rpc("consume_edge_rate_limit", {
      p_scope: scope,
      p_identifier: identifier,
      p_window_seconds: windowSeconds,
      p_max_requests: maxRequests,
    })
    .maybeSingle();
  const row = (data || {}) as {
    allowed?: boolean;
    remaining?: number;
    retry_after_seconds?: number;
    reset_at?: string;
  };

  if (error) {
    throw new HttpError("Unable to enforce rate limiting.", 500, {
      reason: "rate_limit_check_failed",
    });
  }

  const allowed = Boolean(row.allowed);
  const remaining = Math.max(0, Number(row.remaining) || 0);
  const retryAfterSeconds = Math.max(
    1,
    Number(row.retry_after_seconds) || windowSeconds,
  );
  const resetAt = String(row.reset_at || "").trim() || null;

  if (!allowed) {
    throw new HttpError("Too many requests. Please try again shortly.", 429, {
      reason: "rate_limited",
      retryAfterSeconds,
      rateLimit: {
        scope,
        limit: maxRequests,
        remaining,
        resetAt,
      },
    });
  }

  return {
    allowed,
    limit: maxRequests,
    remaining,
    retryAfterSeconds,
    resetAt,
    scope,
    identifier,
  };
};
