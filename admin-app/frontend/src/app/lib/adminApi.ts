export interface AdminError {
  status: number;
  code: string | null;
  reason: string | null;
  message: string;
}

export interface AdminResult<T> {
  data: T | null;
  error: AdminError | null;
  count: number;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

const REQUEST_TIMEOUT_MS = 45000;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Request timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const normalizeApiError = (error: unknown, fallback = "Request failed."): string => {
  const message = String((error as { message?: string })?.message || "").trim();
  if (!message) return fallback;
  const lower = message.toLowerCase();
  if (
    lower.includes("network") ||
    lower.includes("failed to fetch") ||
    lower.includes("timeout")
  ) {
    return "Network issue while contacting admin API. Please retry.";
  }
  if (
    lower.includes("session") ||
    lower.includes("jwt") ||
    lower.includes("token")
  ) {
    return "Access session expired. Re-authenticate through Cloudflare Access.";
  }
  if (
    lower.includes("permission") ||
    lower.includes("forbidden") ||
    lower.includes("access denied")
  ) {
    return "You do not have permission for this action.";
  }
  return message;
};

export const apiRequest = async <T>(
  path: string,
  options: RequestOptions = {},
): Promise<AdminResult<T>> => {
  const { method = "GET", body = null, signal } = options;
  try {
    const response = await withTimeout(
      fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: body == null ? undefined : JSON.stringify(body),
        signal,
      }),
      REQUEST_TIMEOUT_MS,
    );

    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = {};
    }

    if (!response.ok || parsed?.ok === false) {
      const message = String(
        (parsed?.error as { message?: string })?.message ||
          parsed?.message ||
          `Request failed (${response.status}).`,
      );
      return {
        data: null,
        error: {
          status: response.status,
          code: ((parsed?.error as { code?: string })?.code || null) as
            | string
            | null,
          reason: ((parsed?.error as { reason?: string })?.reason || null) as
            | string
            | null,
          message: normalizeApiError(
            { message },
            `Request failed (${response.status}).`,
          ),
        },
        count: 0,
      };
    }

    if (parsed?.ok === true) {
      return {
        data: (parsed?.data ?? null) as T | null,
        error: null,
        count: Number(parsed?.count || 0),
      };
    }

    return {
      data: (parsed?.data ?? parsed ?? null) as T | null,
      error: null,
      count: Number(parsed?.count || 0),
    };
  } catch (error) {
    return {
      data: null,
      error: {
        status: 0,
        code: "network_error",
        reason: "network_error",
        message: normalizeApiError(error, "Unable to contact admin API."),
      },
      count: 0,
    };
  }
};

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);

export const formatCurrencyFromCents = (cents: number) =>
  formatCurrency((Number(cents) || 0) / 100);

export const formatDateTime = (value?: string | null) => {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString();
};

export const formatRelativeTime = (value?: string | null) => {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  const diffMs = Date.now() - date.getTime();
  const abs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const suffix = diffMs >= 0 ? "ago" : "from now";
  if (abs < minute) return `just now`;
  if (abs < hour) return `${Math.round(abs / minute)}m ${suffix}`;
  if (abs < day) return `${Math.round(abs / hour)}h ${suffix}`;
  return `${Math.round(abs / day)}d ${suffix}`;
};

export const summarizeError = (error: AdminError | null, fallback: string) =>
  error?.message || fallback;
