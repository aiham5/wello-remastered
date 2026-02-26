import { withTimeout } from "./http.js";

const DB_TIMEOUT_MS = 45000;
const EDGE_TIMEOUT_MS = 25000;
const STAFF_ROLES = new Set(["admin", "supervisor"]);

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
  if (lower.includes("jwt") || lower.includes("session") || lower.includes("token")) return "Session expired. Please sign in again.";
  if (lower.includes("permission") || lower.includes("forbidden")) return "You do not have permission for this action.";
  if (lower.includes("23505") || lower.includes("duplicate")) return "Duplicate request. Refresh and retry.";
  if (lower.includes("timeout") || lower.includes("abort")) return "Request timed out. Please retry.";
  return fallback;
};

export const createSupabaseRuntime = ({ supabaseUrl, supabaseAnonKey }) => {
  if (!supabaseUrl || !supabaseAnonKey || !window.supabase?.createClient) {
    throw new Error("Missing Supabase configuration for admin panel.");
  }

  const client = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
    global: { fetch: createTimedFetch(DB_TIMEOUT_MS) },
  });

  const getSession = async () => {
    const { data, error } = await withTimeout(client.auth.getSession(), 12000, "getSession");
    if (error) throw error;
    return data?.session || null;
  };

  const getUser = async () => {
    const { data, error } = await withTimeout(client.auth.getUser(), 12000, "getUser");
    if (error) throw error;
    return data?.user || null;
  };

  const signIn = async ({ email, password }) => {
    const { error } = await withTimeout(client.auth.signInWithPassword({ email, password }), 18000, "signIn");
    if (error) throw new Error(normalizeSupabaseError(error, "Unable to sign in."));
  };

  const signOut = async () => {
    await withTimeout(client.auth.signOut({ scope: "local" }), 12000, "signOut");
  };

  const getProfile = async (userId) => {
    const { data, error } = await client
      .from("profiles")
      .select("id, email, full_name, role")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  };

  const ensureStaffProfile = async () => {
    const user = await getUser();
    if (!user?.id) throw new Error("Session expired. Please sign in again.");
    const profile = await getProfile(user.id);
    if (!profile || !STAFF_ROLES.has(String(profile.role || ""))) {
      throw new Error("Access denied. Admin or supervisor role required.");
    }
    return { user, profile };
  };

  const invokeFunction = async (name, body = {}) => {
    const { data, error } = await withTimeout(client.functions.invoke(name, { body }), EDGE_TIMEOUT_MS, name);
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
    getUser,
    signIn,
    signOut,
    getProfile,
    ensureStaffProfile,
    invokeFunction,
    logAction,
    normalizeSupabaseError,
  };
};
