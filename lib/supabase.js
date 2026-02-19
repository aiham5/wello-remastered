import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";
import { getEnv } from "./env";

let currentUrl = null;
let currentAnonKey = null;
let currentStorageMode = "secure_preferred";
let storageMode = "secure_preferred";
let storageFailureReason = null;
let secureStorageWarned = false;
let secureStorageSizeWarned = false;
const SECURE_STORE_SAFE_MAX_BYTES = 1900;
const STORAGE_TIMEOUT_MS = 12000;
const FETCH_TIMEOUT_MS = 12000;
const FETCH_TIMEOUT_LONG_MS = 30000;

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout`)), ms),
    ),
  ]);

const fetchWithAbortTimeout = async (input, init = {}, timeoutMs = 12000) => {
  const controller = new AbortController();
  const outerSignal = init?.signal;
  const timeoutId = setTimeout(() => {
    try {
      controller.abort(new Error("fetch timeout"));
    } catch {
      controller.abort();
    }
  }, timeoutMs);

  let abortListener = null;
  if (outerSignal) {
    if (outerSignal.aborted) {
      try {
        controller.abort(outerSignal.reason);
      } catch {
        controller.abort();
      }
    } else {
      abortListener = () => {
        try {
          controller.abort(outerSignal.reason);
        } catch {
          controller.abort();
        }
      };
      outerSignal.addEventListener("abort", abortListener, { once: true });
    }
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
    if (outerSignal && abortListener) {
      try {
        outerSignal.removeEventListener("abort", abortListener);
      } catch {
        // ignore
      }
    }
  }
};

const memoryStore = {};
const memoryStorage = {
  getItem: async (key) =>
    Object.prototype.hasOwnProperty.call(memoryStore, key)
      ? memoryStore[key]
      : null,
  setItem: async (key, value) => {
    memoryStore[key] = value;
  },
  removeItem: async (key) => {
    delete memoryStore[key];
  },
};

const isAuthStorageKey = (key) => {
  const normalized = String(key || "");
  return normalized === "supabase.auth.token" || normalized.includes("auth-token");
};

const estimateBytes = (value) => {
  const normalized = String(value ?? "");
  if (typeof TextEncoder !== "undefined") {
    try {
      return new TextEncoder().encode(normalized).length;
    } catch {
      // fall through
    }
  }
  return normalized.length;
};

const canStoreInSecureStore = (value) =>
  estimateBytes(value) <= SECURE_STORE_SAFE_MAX_BYTES;

const noteSecureStorageSizeFallback = (key, value) => {
  if (secureStorageSizeWarned) return;
  secureStorageSizeWarned = true;
  console.warn(
    "Auth payload too large for SecureStore. Falling back to AsyncStorage for session persistence.",
    { key, bytes: estimateBytes(value) },
  );
};

const noteSecureStorageFailure = (error) => {
  const reason = String(error?.message || "secure_storage_unavailable");
  storageFailureReason = reason;
  if (secureStorageWarned) return;
  secureStorageWarned = true;
  console.warn("SecureStore unavailable, falling back to AsyncStorage auth session storage.", reason);
};

const asyncStorageAdapter = {
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

const secureStorageAdapter = {
  getItem: async (key) => {
    try {
      const available = await withTimeout(
        SecureStore.isAvailableAsync(),
        STORAGE_TIMEOUT_MS,
        "secure.available",
      );
      if (!available) {
        noteSecureStorageFailure(new Error("secure_store_unavailable"));
        return null;
      }
      return await withTimeout(
        SecureStore.getItemAsync(key),
        STORAGE_TIMEOUT_MS,
        "secure.get",
      );
    } catch (error) {
      noteSecureStorageFailure(error);
      return null;
    }
  },
  setItem: async (key, value) => {
    try {
      const available = await withTimeout(
        SecureStore.isAvailableAsync(),
        STORAGE_TIMEOUT_MS,
        "secure.available",
      );
      if (!available) {
        noteSecureStorageFailure(new Error("secure_store_unavailable"));
        return false;
      }
      await withTimeout(
        SecureStore.setItemAsync(key, value),
        STORAGE_TIMEOUT_MS,
        "secure.set",
      );
      return true;
    } catch (error) {
      noteSecureStorageFailure(error);
      return false;
    }
  },
  removeItem: async (key) => {
    try {
      const available = await withTimeout(
        SecureStore.isAvailableAsync(),
        STORAGE_TIMEOUT_MS,
        "secure.available",
      );
      if (!available) return false;
      await withTimeout(
        SecureStore.deleteItemAsync(key),
        STORAGE_TIMEOUT_MS,
        "secure.remove",
      );
      return true;
    } catch (error) {
      noteSecureStorageFailure(error);
      return false;
    }
  },
};

const safeStorage = {
  getItem: async (key) => {
    if (!isAuthStorageKey(key)) {
      return asyncStorageAdapter.getItem(key);
    }

    const secureValue = await secureStorageAdapter.getItem(key);
    if (secureValue !== null && secureValue !== undefined) {
      storageMode = "secure_preferred";
      return secureValue;
    }

    const asyncValue = await asyncStorageAdapter.getItem(key);
    if (asyncValue !== null && asyncValue !== undefined) {
      if (canStoreInSecureStore(asyncValue)) {
        const migrated = await secureStorageAdapter.setItem(key, asyncValue);
        if (migrated) {
          storageMode = "secure_preferred";
          await asyncStorageAdapter.removeItem(key);
        } else {
          storageMode = "async_fallback";
        }
      } else {
        storageMode = "async_fallback";
        noteSecureStorageSizeFallback(key, asyncValue);
        await secureStorageAdapter.removeItem(key);
      }
    }
    return asyncValue;
  },
  setItem: async (key, value) => {
    if (!isAuthStorageKey(key)) {
      return asyncStorageAdapter.setItem(key, value);
    }

    if (!canStoreInSecureStore(value)) {
      storageMode = "async_fallback";
      noteSecureStorageSizeFallback(key, value);
      await secureStorageAdapter.removeItem(key);
      await asyncStorageAdapter.setItem(key, value);
      return;
    }

    const secureSaved = await secureStorageAdapter.setItem(key, value);
    if (secureSaved) {
      storageMode = "secure_preferred";
      await asyncStorageAdapter.removeItem(key);
      return;
    }

    storageMode = "async_fallback";
    await asyncStorageAdapter.setItem(key, value);
  },
  removeItem: async (key) => {
    if (!isAuthStorageKey(key)) {
      return asyncStorageAdapter.removeItem(key);
    }

    await Promise.all([
      secureStorageAdapter.removeItem(key),
      asyncStorageAdapter.removeItem(key),
    ]);
  },
  getAllKeys: async () => asyncStorageAdapter.getAllKeys(),
};

const createSupabaseClient = (url, anonKey, storage) =>
  createClient(url, anonKey, {
    global: {
      // Prevent hung network requests (common on mobile after app backgrounding)
      // from wedging auth flows until the app is reloaded.
      fetch: async (input, init = {}) => {
        const url = typeof input === "string" ? input : input?.url || "";
        const isAuthRequest = String(url).includes("/auth/v1/");
        const timeoutMs = isAuthRequest
          ? FETCH_TIMEOUT_MS
          : FETCH_TIMEOUT_LONG_MS;
        const outerSignal = init?.signal;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          try {
            controller.abort(new Error("fetch timeout"));
          } catch {
            controller.abort();
          }
        }, timeoutMs);

        let abortListener = null;
        if (outerSignal) {
          if (outerSignal.aborted) {
            try {
              controller.abort(outerSignal.reason);
            } catch {
              controller.abort();
            }
          } else {
            abortListener = () => {
              try {
                controller.abort(outerSignal.reason);
              } catch {
                controller.abort();
              }
            };
            outerSignal.addEventListener("abort", abortListener, {
              once: true,
            });
          }
        }

        try {
          return await fetch(input, { ...init, signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
          if (outerSignal && abortListener) {
            try {
              outerSignal.removeEventListener("abort", abortListener);
            } catch {
              // ignore
            }
          }
        }
      },
    },
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
  } catch (error) {}
  const stored = await getStoredSession();
  if (stored?.session?.access_token) {
    return {
      accessToken: stored.session.access_token,
      session: stored.session,
      source: "storage",
      storageKey: stored.storageKey,
    };
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
    const response = await fetchWithAbortTimeout(
      `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: {
          apikey: supabaseAnonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      },
      timeoutMs,
    );
    const rawText = await response.text();
    const parsed = rawText ? JSON.parse(rawText) : {};
    if (!response.ok) {
      return {
        accessToken: "",
        error:
          parsed?.error_description ||
          parsed?.error ||
          rawText ||
          "refresh_failed",
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

  // Never allow secret keys in client builds.
  // `sb_secret_...` keys are privileged and must only live in server-side env (Edge Functions, servers).
  if (String(supabaseAnonKey).startsWith("sb_secret_")) {
    return {
      ok: false,
      error:
        "EXPO_PUBLIC_SUPABASE_ANON_KEY is a secret (sb_secret_...). Replace it with a publishable key (sb_publishable_...) or legacy anon JWT key. Do not ship secret keys in the app.",
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
