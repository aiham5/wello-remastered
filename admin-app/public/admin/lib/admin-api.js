import { withTimeout } from "./http.js";

const REQUEST_TIMEOUT_MS = 45000;
const EDGE_TIMEOUT_MS = 25000;

const normalizeApiError = (error, fallback = "Request failed.") => {
  const message = String(error?.message || "").trim();
  if (!message) return fallback;
  const lower = message.toLowerCase();
  if (
    lower.includes("network") ||
    lower.includes("failed to fetch") ||
    lower.includes("enetunreach") ||
    lower.includes("econnreset") ||
    lower.includes("abort") ||
    lower.includes("timeout")
  ) {
    return "Network issue while contacting admin API. Please retry.";
  }
  if (lower.includes("session") || lower.includes("jwt") || lower.includes("token")) {
    return "Access session expired. Re-authenticate through Cloudflare Access.";
  }
  if (lower.includes("permission") || lower.includes("forbidden") || lower.includes("access denied")) {
    return "You do not have permission for this action.";
  }
  return message || fallback;
};

const encodeInList = (values = []) => {
  const parts = (Array.isArray(values) ? values : [values]).map((item) => {
    if (item == null) return "null";
    if (typeof item === "number" || typeof item === "boolean") return String(item);
    return `"${String(item).replace(/"/g, '""')}"`;
  });
  return `(${parts.join(",")})`;
};

const createQueryBuilder = (request, table) => {
  const spec = {
    table,
    action: "select",
    select: "*",
    selectOptions: {},
    filters: [],
    order: [],
    range: null,
    limit: null,
    body: null,
    single: "none",
  };

  const api = {
    select(columns = "*", options = {}) {
      spec.action = "select";
      spec.select = String(columns || "*");
      spec.selectOptions = options || {};
      return api;
    },
    insert(payload) {
      spec.action = "insert";
      spec.body = payload;
      return api;
    },
    update(payload) {
      spec.action = "update";
      spec.body = payload;
      return api;
    },
    eq(column, value) {
      spec.filters.push({ op: "eq", column, value });
      return api;
    },
    in(column, values) {
      spec.filters.push({ op: "in", column, value: values });
      return api;
    },
    gte(column, value) {
      spec.filters.push({ op: "gte", column, value });
      return api;
    },
    lte(column, value) {
      spec.filters.push({ op: "lte", column, value });
      return api;
    },
    lt(column, value) {
      spec.filters.push({ op: "lt", column, value });
      return api;
    },
    is(column, value) {
      spec.filters.push({ op: "is", column, value });
      return api;
    },
    or(value) {
      spec.filters.push({ op: "or", column: "or", value });
      return api;
    },
    order(column, options = {}) {
      spec.order.push({
        column,
        ascending: options?.ascending !== false,
        nullsFirst: options?.nullsFirst === true,
      });
      return api;
    },
    limit(value) {
      spec.limit = Number(value);
      return api;
    },
    range(from, to) {
      spec.range = { from: Number(from), to: Number(to) };
      return api;
    },
    maybeSingle() {
      spec.single = "maybe";
      return api;
    },
    single() {
      spec.single = "single";
      return api;
    },
    then(resolve, reject) {
      return api.execute().then(resolve, reject);
    },
    catch(reject) {
      return api.execute().catch(reject);
    },
    async execute() {
      const payload = {
        ...spec,
        filters: spec.filters.map((entry) => {
          if (entry.op === "in") {
            return { ...entry, value: encodeInList(entry.value) };
          }
          return entry;
        }),
      };
      return request("/api/admin/query", {
        method: "POST",
        body: payload,
      });
    },
  };

  return api;
};

const createStorageClient = (request) => ({
  from(bucket) {
    return {
      createSignedUrl(path, expiresIn = 1800) {
        return request("/api/admin/storage/sign", {
          method: "POST",
          body: { bucket, path, expiresIn },
        });
      },
    };
  },
});

export const createAdminApiRuntime = () => {
  let cachedUser = null;
  let cachedProfile = null;

  const request = async (path, { method = "GET", body = null, signal = null } = {}) => {
    try {
      const response = await withTimeout(
        fetch(path, {
          method,
          headers: {
            "content-type": "application/json",
          },
          body: body == null ? undefined : JSON.stringify(body),
          signal: signal || undefined,
          credentials: "same-origin",
        }),
        method === "GET" ? REQUEST_TIMEOUT_MS : EDGE_TIMEOUT_MS,
        `${method} ${path}`,
      );

      const text = await response.text();
      let parsed = {};
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = {};
      }

      if (!response.ok || parsed?.ok === false) {
        const message =
          parsed?.error?.message ||
          parsed?.message ||
          `Request failed (${response.status}).`;
        return {
          data: null,
          error: {
            status: response.status,
            code: parsed?.error?.code || null,
            reason: parsed?.error?.reason || null,
            message: normalizeApiError({ message }, `Request failed (${response.status}).`),
          },
          count: 0,
        };
      }

      if (parsed?.ok === true) {
        return {
          data: parsed.data ?? null,
          error: null,
          count: Number(parsed.count || 0),
        };
      }

      return {
        data: parsed?.data ?? parsed ?? null,
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

  const ensureStaffProfile = async () => {
    const { data, error } = await request("/api/admin/me", { method: "GET" });
    if (error) throw new Error(error.message || "Unable to verify access.");
    const user = data?.user || null;
    const profile = data?.profile || null;
    if (!user?.id || !profile?.id) {
      throw new Error("Access denied. Admin or supervisor role required.");
    }
    cachedUser = user;
    cachedProfile = profile;
    return { user, profile, session: { user } };
  };

  const runtime = {
    client: {
      from(table) {
        return createQueryBuilder(request, table);
      },
      rpc(name, args = {}) {
        return request("/api/admin/rpc", {
          method: "POST",
          body: { name, args },
        });
      },
      storage: createStorageClient(request),
    },
    async getUser() {
      if (cachedUser?.id) return cachedUser;
      const { user } = await ensureStaffProfile();
      return user;
    },
    async ensureStaffProfile() {
      return ensureStaffProfile();
    },
    async refreshSession() {
      const { user } = await ensureStaffProfile();
      return { user };
    },
    async getSession() {
      if (cachedUser?.id) return { user: cachedUser };
      const { user } = await ensureStaffProfile();
      return { user };
    },
    async invokeFunction(name, body = {}) {
      const result = await request(`/api/admin/functions/${encodeURIComponent(name)}`, {
        method: "POST",
        body,
      });
      if (result.error) {
        const err = new Error(result.error.message || `Unable to run ${name}.`);
        err.cause = result.error;
        throw err;
      }
      return result.data;
    },
    async logAction({ action, entity, entityId, status = "success", before = null, after = null, meta = null }) {
      await request("/api/admin/log-action", {
        method: "POST",
        body: {
          action,
          entity,
          entityId,
          status,
          before,
          after,
          meta,
        },
      });
    },
    isAuthError(error) {
      const message = String(error?.message || "").toLowerCase();
      return message.includes("access") || message.includes("session") || message.includes("token") || message.includes("jwt") || message.includes("401") || message.includes("403");
    },
    normalizeSupabaseError(error, fallback = "Request failed.") {
      return normalizeApiError(error, fallback);
    },
  };

  return runtime;
};
