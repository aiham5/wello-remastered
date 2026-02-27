import { createSupabaseRuntime } from "./lib/supabase.js";
import { createStore } from "./state/store.js";
import { createRouter } from "./router.js";
import { createToastManager } from "./components/toasts.js";
import { createConfirmModal } from "./components/modal.js";
import { createDrawer } from "./components/drawer.js";
import { MODULES, MODULE_MAP } from "./modules/index.js";

const config = window.WELLO_CONFIG || {};

const ui = {
  authPanel: document.getElementById("auth-panel"),
  authEmail: document.getElementById("auth-email"),
  authPassword: document.getElementById("auth-password"),
  authError: document.getElementById("auth-error"),
  signIn: document.getElementById("sign-in"),
  appShell: document.getElementById("app-shell"),
  navList: document.getElementById("admin-nav-list"),
  moduleTitle: document.getElementById("module-title"),
  moduleSubTitle: document.getElementById("module-subtitle"),
  moduleContent: document.getElementById("module-content"),
  currentUser: document.getElementById("admin-user"),
  currentRole: document.getElementById("admin-role"),
  signOut: document.getElementById("sign-out"),
  refreshSession: document.getElementById("refresh-session"),
  themeToggle: document.getElementById("admin-theme-toggle"),
  themeToggleText: document.getElementById("admin-theme-toggle-text"),
  toastContainer: document.getElementById("toast-container"),
  modalRoot: document.getElementById("confirm-modal"),
  modalTitle: document.getElementById("confirm-modal-title"),
  modalBody: document.getElementById("confirm-modal-body"),
  modalCancel: document.getElementById("confirm-modal-cancel"),
  modalConfirm: document.getElementById("confirm-modal-confirm"),
  drawerRoot: document.getElementById("global-drawer"),
  drawerTitle: document.getElementById("global-drawer-title"),
  drawerContent: document.getElementById("global-drawer-content"),
  drawerClose: document.getElementById("global-drawer-close"),
};

const store = createStore();
let runtime = null;
let router = null;
let toast = null;
let confirmModal = null;
let drawer = null;
let activeModuleKey = null;
let authSyncInFlight = null;
let backgroundRefreshTimer = null;

const setTheme = (theme) => {
  const normalized = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", normalized);
  try {
    localStorage.setItem("wello-admin-theme", normalized);
  } catch {
    // ignore
  }
  const isDark = normalized === "dark";
  ui.themeToggle?.setAttribute("aria-pressed", String(isDark));
  if (ui.themeToggleText) ui.themeToggleText.textContent = isDark ? "Light mode" : "Dark mode";
};

const restoreTheme = () => {
  let savedTheme = "light";
  try {
    savedTheme = localStorage.getItem("wello-admin-theme") || "light";
  } catch {
    savedTheme = "light";
  }
  setTheme(savedTheme === "dark" ? "dark" : "light");
};

const setAuthError = (message = "") => {
  if (!ui.authError) return;
  ui.authError.textContent = message;
};

const setAuthVisible = (isVisible) => {
  ui.authPanel?.classList.toggle("is-hidden", !isVisible);
  ui.appShell?.classList.toggle("is-hidden", isVisible);
};

const resetIdentityUi = () => {
  if (ui.currentUser) ui.currentUser.textContent = "Not signed in";
  if (ui.currentRole) ui.currentRole.textContent = "--";
  activeModuleKey = null;
};

const isTransientIdentityError = (error) => {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("abort") ||
    message.includes("failed to fetch") ||
    message.includes("enetunreach")
  );
};

const isRecoverableSessionError = (error) =>
  Boolean(runtime?.isAuthError?.(error)) || isTransientIdentityError(error);

const selectModuleInNav = (key) => {
  ui.navList?.querySelectorAll("button[data-module]").forEach((button) => {
    const active = button.getAttribute("data-module") === key;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
};

const mountModule = async (key) => {
  const module = MODULE_MAP[key] || MODULE_MAP.overview;
  if (!module || !ui.moduleContent) return;

  activeModuleKey = module.key;
  store.setState({ activeModule: module.key });
  selectModuleInNav(module.key);
  if (ui.moduleTitle) ui.moduleTitle.textContent = module.label;
  if (ui.moduleSubTitle) ui.moduleSubTitle.textContent = "";

  ui.moduleContent.innerHTML = "<div class='admin-loading'>Loading module...</div>";

  try {
    await module.mount({ content: ui.moduleContent, runtime, toast, confirmModal, drawer, router, store });
  } catch (error) {
    if (isRecoverableSessionError(error)) {
      try {
        const session = await runtime.refreshSession({ force: true });
        await syncIdentity(session, { allowCachedProfile: true });
        await module.mount({ content: ui.moduleContent, runtime, toast, confirmModal, drawer, router, store });
        return;
      } catch (retryError) {
        error = retryError;
      }
    }
    toast.error(runtime?.normalizeSupabaseError(error, "Unable to load module."));
    ui.moduleContent.innerHTML = "<div class='admin-empty'>Unable to load this module.</div>";
  }
};

const buildNav = () => {
  if (!ui.navList) return;
  ui.navList.innerHTML = MODULES.map((module) => `<li><button type="button" class="admin-nav-btn" data-module="${module.key}">${module.label}</button></li>`).join("");

  ui.navList.querySelectorAll("button[data-module]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.getAttribute("data-module");
      router.navigate(key);
    });
  });
};

const hydrateIdentity = async (sessionHint = null, options = {}) => {
  const allowCachedProfile = options.allowCachedProfile === true;
  try {
    const { user, profile } = await runtime.ensureStaffProfile({ session: sessionHint });
    store.setState({ session: { user }, profile });
    if (ui.currentUser) ui.currentUser.textContent = profile.full_name || profile.email || user.email || "Staff";
    if (ui.currentRole) ui.currentRole.textContent = String(profile.role || "staff");
    setAuthVisible(false);
    setAuthError("");
    return { user, profile, fromCache: false };
  } catch (error) {
    const cached = store.getState().profile;
    const fallbackUser = sessionHint?.user || store.getState().session?.user || null;
    const userId = fallbackUser?.id || null;
    if (allowCachedProfile && cached?.id && cached.id === userId && isTransientIdentityError(error)) {
      store.setState({ session: { user: fallbackUser }, profile: cached });
      if (ui.currentUser) ui.currentUser.textContent = cached.full_name || cached.email || "Staff";
      if (ui.currentRole) ui.currentRole.textContent = String(cached.role || "staff");
      setAuthVisible(false);
      setAuthError("");
      return { user: fallbackUser, profile: cached, fromCache: true };
    }
    throw error;
  }
};

const syncIdentity = async (sessionHint = null, options = {}) => {
  if (authSyncInFlight) return authSyncInFlight;
  authSyncInFlight = (async () => {
    try {
      return await hydrateIdentity(sessionHint, options);
    } finally {
      authSyncInFlight = null;
    }
  })();
  return authSyncInFlight;
};

const handleSessionRefresh = async () => {
  try {
    const session = await runtime.refreshSession({ force: true });
    await syncIdentity(session, { allowCachedProfile: true });
    await mountModule(store.getState().activeModule || "overview");
    toast.success("Session refreshed.");
  } catch (error) {
    setAuthVisible(true);
    resetIdentityUi();
    setAuthError(runtime.normalizeSupabaseError(error, "Session expired. Please sign in again."));
  }
};

const keepSessionWarm = async ({ silent = true, force = false } = {}) => {
  try {
    const session = await runtime.refreshSession({ force });
    if (!session?.user) return false;
    await syncIdentity(session, { allowCachedProfile: true });
    return true;
  } catch (error) {
    if (silent && isRecoverableSessionError(error) && store.getState().profile) {
      return false;
    }
    throw error;
  }
};

const scheduleBackgroundRefresh = (delayMs = 900) => {
  if (backgroundRefreshTimer) {
    window.clearTimeout(backgroundRefreshTimer);
  }
  backgroundRefreshTimer = window.setTimeout(() => {
    backgroundRefreshTimer = null;
    keepSessionWarm({ silent: true, force: false }).catch(() => null);
  }, delayMs);
};

const handleSignIn = async () => {
  const email = String(ui.authEmail?.value || "").trim();
  const password = String(ui.authPassword?.value || "");
  if (!email || !password) {
    setAuthError("Enter email and password.");
    return;
  }

  ui.signIn.disabled = true;
  setAuthError("");
  try {
    await runtime.signIn({ email, password });
    const session = await runtime.getSession();
    await syncIdentity(session, { allowCachedProfile: false });
    router.navigate("overview");
  } catch (error) {
    setAuthError(error?.message || runtime.normalizeSupabaseError(error, "Unable to sign in."));
  } finally {
    ui.signIn.disabled = false;
  }
};

const init = async () => {
  try {
    restoreTheme();

    runtime = createSupabaseRuntime({ supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey });
    toast = createToastManager(ui.toastContainer);
    confirmModal = createConfirmModal({ root: ui.modalRoot, titleEl: ui.modalTitle, bodyEl: ui.modalBody, cancelBtn: ui.modalCancel, confirmBtn: ui.modalConfirm });
    drawer = createDrawer({ root: ui.drawerRoot, titleEl: ui.drawerTitle, contentEl: ui.drawerContent, closeBtn: ui.drawerClose });

    buildNav();

    router = createRouter({
      onRouteChange: async (routeKey) => {
        if (!store.getState().profile) return;
        await mountModule(routeKey);
      },
    });

    ui.signIn?.addEventListener("click", handleSignIn);
    ui.authEmail?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") handleSignIn();
    });
    ui.authPassword?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") handleSignIn();
    });

    ui.signOut?.addEventListener("click", async () => {
      if (backgroundRefreshTimer) {
        window.clearTimeout(backgroundRefreshTimer);
        backgroundRefreshTimer = null;
      }
      await runtime.signOut();
      store.setState({ session: null, profile: null });
      drawer.close();
      confirmModal.close();
      setAuthVisible(true);
      setAuthError("");
      resetIdentityUi();
    });

    ui.refreshSession?.addEventListener("click", handleSessionRefresh);
    ui.themeToggle?.addEventListener("click", () => {
      const dark = document.documentElement.getAttribute("data-theme") === "dark";
      setTheme(dark ? "light" : "dark");
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && store.getState().profile) {
        scheduleBackgroundRefresh(250);
      }
    });
    window.addEventListener("focus", () => {
      if (store.getState().profile) scheduleBackgroundRefresh(150);
    });
    window.addEventListener("pageshow", () => {
      if (store.getState().profile) scheduleBackgroundRefresh(150);
    });

    runtime.client.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") {
        if (backgroundRefreshTimer) {
          window.clearTimeout(backgroundRefreshTimer);
          backgroundRefreshTimer = null;
        }
        store.setState({ session: null, profile: null });
        drawer.close();
        confirmModal.close();
        resetIdentityUi();
        setAuthVisible(true);
        setAuthError("");
        return;
      }
      if (!session?.user) return;

      const isBackgroundEvent = event === "TOKEN_REFRESHED" || event === "USER_UPDATED";
      try {
        await syncIdentity(session, { allowCachedProfile: isBackgroundEvent });
        if (!activeModuleKey) router.start();
      } catch (error) {
        const normalized = runtime.normalizeSupabaseError(error, "Session refresh failed.");
        const keepCurrentSession =
          isBackgroundEvent &&
          (isRecoverableSessionError(error) || normalized.includes("Session expired"));

        if (keepCurrentSession && store.getState().profile) {
          scheduleBackgroundRefresh(1200);
          return;
        }

        const isFatal =
          normalized.includes("Access denied") ||
          event === "INITIAL_SESSION" ||
          event === "SIGNED_IN";

        if (!isFatal && isBackgroundEvent) return;

        store.setState({ session: null, profile: null });
        resetIdentityUi();
        setAuthVisible(true);
        setAuthError(normalized);
      }
    });

    const session = await runtime.getSession();
    if (!session?.user) {
      setAuthVisible(true);
      resetIdentityUi();
      return;
    }

    await syncIdentity(session, { allowCachedProfile: false });
    router.start();
  } catch (error) {
    setAuthVisible(true);
    resetIdentityUi();
    setAuthError(error?.message || "Unable to initialize admin panel.");
  }
};

init();
