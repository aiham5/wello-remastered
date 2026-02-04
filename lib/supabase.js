import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { getEnv } from "./env";

let currentUrl = null;
let currentAnonKey = null;
let currentStorageMode = "async";
let storageMode = "async";
let storageFailureReason = null;
const STORAGE_TIMEOUT_MS = 12000;

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout`)), ms),
    ),
  ]);

const memoryStore = {};
const memoryStorage = {
  getItem: async (key) => (Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null),
  setItem: async (key, value) => {
    memoryStore[key] = value;
  },
  removeItem: async (key) => {
    delete memoryStore[key];
  },
};

const safeStorage = {
  getItem: async (key) => {
    try {
      return await withTimeout(
        AsyncStorage.getItem(key),
        STORAGE_TIMEOUT_MS,
        "storage.get",
      );
    } catch (error) {
      console.warn("AsyncStorage getItem timeout", key, error?.message);
      return null;
    }
  },
  setItem: async (key, value) => {
    try {
      await withTimeout(
        AsyncStorage.setItem(key, value),
        STORAGE_TIMEOUT_MS,
        "storage.set",
      );
    } catch (error) {
      console.warn("AsyncStorage setItem timeout", key, error?.message);
    }
  },
  removeItem: async (key) => {
    try {
      await withTimeout(
        AsyncStorage.removeItem(key),
        STORAGE_TIMEOUT_MS,
        "storage.remove",
      );
    } catch (error) {
      console.warn("AsyncStorage removeItem timeout", key, error?.message);
    }
  },
  getAllKeys: async () => {
    try {
      return await withTimeout(
        AsyncStorage.getAllKeys(),
        STORAGE_TIMEOUT_MS,
        "storage.keys",
      );
    } catch (error) {
      console.warn("AsyncStorage getAllKeys timeout", error?.message);
      return [];
    }
  },
};

const createSupabaseClient = (url, anonKey, storage) =>
  createClient(url, anonKey, {
    auth: {
      storage,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

export let supabase = null;

export const getSupabaseStorageState = () => ({
  mode: storageMode,
  failure: storageFailureReason,
});

export const clearSupabaseSession = async () => {
  const supabaseUrl = getEnv("EXPO_PUBLIC_SUPABASE_URL");
  const ref = getProjectRef(supabaseUrl);
  const targets = new Set();

  if (ref) {
    targets.add(`sb-${ref}-auth-token`);
  }
  targets.add("supabase.auth.token");

  let keys = [];
  try {
    keys = await safeStorage.getAllKeys();
  } catch {
    keys = [];
  }

  keys
    .filter((key) => key && key.includes("auth-token"))
    .forEach((key) => targets.add(key));

  const removed = [];
  for (const key of targets) {
    try {
      await safeStorage.removeItem(key);
      removed.push(key);
    } catch (error) {
      console.warn("Failed to clear auth key", key, error?.message);
    }
  }
  return { removed };
};

const getProjectRef = (url) => {
  if (!url) return "";
  const match = String(url).match(/https?:\/\/([^.]+)\.supabase\.co/i);
  return match?.[1] || "";
};

const parseStoredSession = (raw) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.access_token) return parsed;
    if (parsed?.session?.access_token) return parsed.session;
    if (parsed?.currentSession?.access_token) return parsed.currentSession;
    return null;
  } catch {
    return null;
  }
};

export const getStoredSession = async () => {
  const supabaseUrl = getEnv("EXPO_PUBLIC_SUPABASE_URL");
  if (!supabaseUrl) return null;
  const ref = getProjectRef(supabaseUrl);
  const candidates = [];
  if (ref) {
    candidates.push(`sb-${ref}-auth-token`);
  }
  candidates.push("supabase.auth.token");

  let keys = [];
  try {
    keys = await safeStorage.getAllKeys();
  } catch {
    keys = [];
  }
  keys
    .filter((key) => key && key.includes("auth-token"))
    .filter((key) => !candidates.includes(key))
    .forEach((key) => candidates.push(key));

  for (const key of candidates) {
    const raw = await safeStorage.getItem(key);
    const session = parseStoredSession(raw);
    if (session?.access_token) {
      return { session, storageKey: key };
    }
  }
  return null;
};

export const getAccessTokenWithFallback = async (timeoutMs = 6000) => {
  if (!supabase) {
    return { accessToken: "", session: null, source: "none" };
  }
  const stored = await getStoredSession();
  if (stored?.session?.access_token) {
    return {
      accessToken: stored.session.access_token,
      session: stored.session,
      source: "storage",
      storageKey: stored.storageKey,
    };
  }
  try {
    const { data } = await withTimeout(
      supabase.auth.getSession(),
      timeoutMs,
      "getSession",
    );
    if (data?.session?.access_token) {
      return {
        accessToken: data.session.access_token,
        session: data.session,
        source: "supabase",
      };
    }
  } catch (error) {
  }
  return { accessToken: "", session: null, source: "none" };
};

export const refreshAccessTokenWithRefreshToken = async (
  timeoutMs = 6000,
  options = {},
) => {
  const supabaseUrl = getEnv("EXPO_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = getEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return { accessToken: "", error: "missing_env" };
  }
  const stored = await getStoredSession();
  const refreshToken = stored?.session?.refresh_token;
  if (!refreshToken) {
    return { accessToken: "", error: "missing_refresh_token" };
  }

  try {
    const response = await withTimeout(
      fetch(
        `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=refresh_token`,
        {
          method: "POST",
          headers: {
            apikey: supabaseAnonKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ refresh_token: refreshToken }),
        },
      ),
      timeoutMs,
      "refresh_token",
    );
    const rawText = await response.text();
    const parsed = rawText ? JSON.parse(rawText) : {};
    if (!response.ok) {
      return {
        accessToken: "",
        error: parsed?.error_description || parsed?.error || rawText || "refresh_failed",
      };
    }

    const accessToken = parsed?.access_token || "";
    const nextRefreshToken = parsed?.refresh_token || refreshToken;
    const shouldPersist = options?.persist !== false;
    if (accessToken && shouldPersist) {
      try {
        await withTimeout(
          supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: nextRefreshToken,
          }),
          Math.max(timeoutMs, 12000),
          "setSession",
        );
      } catch (error) {
        console.warn("supabase.setSession failed", error?.message);
      }
    }
    return {
      accessToken,
      refreshToken: nextRefreshToken,
      source: "refresh_token",
      storageKey: stored.storageKey,
      session: parsed,
    };
  } catch (error) {
    return { accessToken: "", error: error?.message || "refresh_failed" };
  }
};

export const refreshSupabaseClient = (force = false) => {
  const supabaseUrl = getEnv("EXPO_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = getEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      ok: false,
      error:
        "Supabase env vars missing. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    };
  }

  const nextStorageMode = storageMode;
  if (
    !force &&
    supabase &&
    supabaseUrl === currentUrl &&
    supabaseAnonKey === currentAnonKey &&
    nextStorageMode === currentStorageMode
  ) {
    return { ok: true, client: supabase, reused: true };
  }

  currentUrl = supabaseUrl;
  currentAnonKey = supabaseAnonKey;
  currentStorageMode = nextStorageMode;
  const storage = nextStorageMode === "memory" ? memoryStorage : safeStorage;
  if (nextStorageMode === "memory") {
    console.warn("Supabase auth using in-memory storage", storageFailureReason);
  }
  supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey, storage);
  return { ok: true, client: supabase, reused: false };
};

refreshSupabaseClient();
