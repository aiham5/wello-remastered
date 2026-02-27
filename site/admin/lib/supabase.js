import { withTimeout } from "./http.js";

const DB_TIMEOUT_MS = 45000;
const EDGE_TIMEOUT_MS = 25000;
const STAFF_ROLES = new Set(["admin", "supervisor"]);
const SESSION_REFRESH_BUFFER_MS = 1000 * 60 * 2;

const createTimedFetch = (timeoutMs) => async (input, init = {}) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const upstream = init.signal;
  let remove = null;

  if (upstream) {
    const abort = () => controller.abort();
    upstream.addEventListener("abort", abort, { once: true });
    remove = () => upstream.removeEventListener("abort", abort);
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
    if (remove) remove();
  }
};

const normalizeSupabaseError = (error, fallback = "Request failed.") => {
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
    return "Network issue while contacting Supabase. Please retry.";
  }
  if (
    lower.includes("jwt expired") ||
    lower.includes("invalid jwt") ||
    lower.includes("refresh token not found") ||
    lower.includes("session missing") ||
    lower.includes("invalid refresh token")
  ) {
    return "Session expired. Please sign in again.";
  }
  if (lower.includes("permission") || lower.includes("forbidden")) return "You do not have permission for this action.";
  if (lower.includes("23505") || lower.includes("duplicate")) return "Duplicate request. Refresh and retry.";
  if (lower.includes("session") && lower.includes("expired")) return "Session expired. Please sign in again.";
  return fallback;
};

const isAuthError = (error) => {
  const message = String(error?.message || "").trim().toLowerCase();
  if (!message) return false;
  return (
    message.includes("jwt") ||
    message.includes("token") ||
    message.includes("session") ||
    message.includes("auth") ||
    message.includes("refresh token") ||
    message.includes("invalid claim") ||
    message.includes("401") ||
    message.includes("403")
  );
};

const sessionExpiresSoon = (session) => {
  const expiresAtSeconds = Number(session?.expires_at) || 0;
  if (!expiresAtSeconds) return true;
  return expiresAtSeconds * 1000 - Date.now() <= SESSION_REFRESH_BUFFER_MS;
};

export const createSupabaseRuntime = ({ supabaseUrl, supabaseAnonKey }) => {
  if (!supabaseUrl || !supabaseAnonKey || !window.supabase?.createClient) {
    throw new Error("Missing Supabase configuration for admin panel.");
  }

  const client = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
    global: { fetch: createTimedFetch(DB_TIMEOUT_MS) },
  });

  let sessionRefreshPromise = null;

  const refreshSession = async ({ force = false } = {}) => {
    if (sessionRefreshPromise) return sessionRefreshPromise;
    sessionRefreshPromise = (async () => {
      const { data, error } = await withTimeout(client.auth.getSession(), 12000, "getSession");
      if (error) throw error;
      const currentSession = data?.session || null;
      if (!force && currentSession?.access_token && !sessionExpiresSoon(currentSession)) {
        return currentSession;
      }
      const refreshed = await withTimeout(client.auth.refreshSession(), 15000, "refreshSession");
      if (refreshed?.error) {
        if (currentSession?.access_token) return currentSession;
        throw refreshed.error;
      }
      return refreshed?.data?.session || currentSession || null;
    })();

    try {
      return await sessionRefreshPromise;
    } finally {
      sessionRefreshPromise = null;
    }
  };

  const getSession = async ({ forceRefresh = false } = {}) => {
    if (forceRefresh) return refreshSession({ force: true });
    const { data, error } = await withTimeout(client.auth.getSession(), 12000, "getSession");
    if (error) throw error;
    const session = data?.session || null;
    if (session?.access_token && !sessionExpiresSoon(session)) return session;
    return refreshSession({ force: false });
  };

  const getUser = async ({ forceRefresh = false } = {}) => {
    let session = await getSession({ forceRefresh });

    const attempt = async (accessToken) => {
      const { data, error } = await withTimeout(client.auth.getUser(accessToken), 12000, "getUser");
      if (error) throw error;
      return data?.user || null;
    };

    try {
      if (session?.access_token) return (await attempt(session.access_token)) || session?.user || null;
      return session?.user || null;
    } catch (error) {
      if (!isAuthError(error)) throw error;
      session = await refreshSession({ force: true });
      if (session?.access_token) return (await attempt(session.access_token)) || session?.user || null;
      return session?.user || null;
    }
  };

  const signIn = async ({ email, password }) => {
    const { error } = await withTimeout(client.auth.signInWithPassword({ email, password }), 18000, "signIn");
    if (error) throw new Error(normalizeSupabaseError(error, "Unable to sign in."));
  };

  const signOut = async () => {
    await withTimeout(client.auth.signOut({ scope: "local" }), 12000, "signOut");
  };

  const getProfile = async (userId, { forceRefresh = false } = {}) => {
    await getSession({ forceRefresh });

    const load = async () => {
      const { data, error } = await client
        .from("profiles")
        .select("id, email, full_name, role")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    };

    try {
      return await load();
    } catch (error) {
      if (!isAuthError(error)) throw error;
      await refreshSession({ force: true });
      return load();
    }
  };

  const ensureStaffProfile = async ({ session: sessionHint = null } = {}) => {
    let session = sessionHint;
    let user = session?.user || null;

    if (!user?.id) {
      session = await getSession();
      user = session?.user || null;
    }
    if (!user?.id) {
      session = await refreshSession({ force: true });
      user = session?.user || null;
    }
    if (!user?.id) throw new Error("Session expired. Please sign in again.");

    const profile = await getProfile(user.id);
    if (!profile || !STAFF_ROLES.has(String(profile.role || ""))) {
      throw new Error("Access denied. Admin or supervisor role required.");
    }
    return { user, profile, session };
  };

  const invokeFunction = async (name, body = {}) => {
    const invoke = async () =>
      withTimeout(client.functions.invoke(name, { body }), EDGE_TIMEOUT_MS, name);

    let result = await invoke();
    if (result?.error && isAuthError(result.error)) {
      await refreshSession({ force: true });
      result = await invoke();
    }

    const { data, error } = result;
    if (error) {
      const err = new Error(normalizeSupabaseError(error, `Unable to run ${name}.`));
      err.cause = error;
      throw err;
    }
    return data;
  };

  const logAction = async ({ action, entity, entityId, status = "success", before = null, after = null, meta = null }) => {
    try {
      await client.rpc("admin_write_action_log", {
        p_action: String(action || "unknown"),
        p_entity: String(entity || "unknown"),
        p_entity_id: entityId || null,
        p_status: String(status || "success"),
        p_before_state: before,
        p_after_state: after,
        p_meta: meta,
      });
    } catch {
      // Non-blocking during transition.
    }
  };

  return {
    client,
    getSession,
    refreshSession,
    getUser,
    signIn,
    signOut,
    getProfile,
    ensureStaffProfile,
    invokeFunction,
    logAction,
    isAuthError,
    normalizeSupabaseError,
  };
};
