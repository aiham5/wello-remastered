import { createAdminApiRuntime } from "./lib/admin-api.js";
import { createStore } from "./state/store.js";
import { createRouter } from "./router.js";
import { createToastManager } from "./components/toasts.js";
import { createConfirmModal } from "./components/modal.js";
import { createDrawer } from "./components/drawer.js";
import { MODULES, MODULE_MAP } from "./modules/index.js";

const ui = {
  accessPanel: document.getElementById("access-panel"),
  accessMessage: document.getElementById("access-message"),
  accessRetry: document.getElementById("access-retry"),
  appShell: document.getElementById("app-shell"),
  navList: document.getElementById("admin-nav-list"),
  moduleTitle: document.getElementById("module-title"),
  moduleSubTitle: document.getElementById("module-subtitle"),
  moduleContent: document.getElementById("module-content"),
  currentUser: document.getElementById("admin-user"),
  currentRole: document.getElementById("admin-role"),
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
const runtime = createAdminApiRuntime();
const toast = createToastManager(ui.toastContainer);
const confirmModal = createConfirmModal({
  root: ui.modalRoot,
  titleEl: ui.modalTitle,
  bodyEl: ui.modalBody,
  cancelBtn: ui.modalCancel,
  confirmBtn: ui.modalConfirm,
});
const drawer = createDrawer({
  root: ui.drawerRoot,
  titleEl: ui.drawerTitle,
  contentEl: ui.drawerContent,
  closeBtn: ui.drawerClose,
});

let router = null;
let activeModuleKey = null;
const navGroups = [];
const navGroupedModules = MODULES.reduce((acc, module) => {
  const group = String(module.group || "Operations");
  if (!acc[group]) {
    acc[group] = [];
    navGroups.push(group);
  }
  acc[group].push(module);
  return acc;
}, {});

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });

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

const setAccessState = ({ granted, message }) => {
  if (ui.accessMessage) ui.accessMessage.textContent = message || "";
  ui.accessPanel?.classList.toggle("is-hidden", granted);
  ui.appShell?.classList.toggle("is-hidden", !granted);
};

const selectModuleInNav = (key) => {
  ui.navList?.querySelectorAll("button[data-module]").forEach((button) => {
    const active = button.getAttribute("data-module") === key;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
};

const buildNav = () => {
  if (!ui.navList) return;
  ui.navList.innerHTML = navGroups
    .map((group) => {
      const modules = navGroupedModules[group] || [];
      return `
        <li class="admin-nav-group">
          <p class="admin-nav-group-label">${escapeHtml(group)}</p>
          <ul class="admin-nav-group-list">
            ${modules
              .map(
                (module) => `
              <li>
                <button
                  type="button"
                  class="admin-nav-btn"
                  data-module="${escapeHtml(module.key)}"
                  aria-label="${escapeHtml(module.label)}"
                >
                  <span class="admin-nav-icon" aria-hidden="true">${escapeHtml(module.icon || "NA")}</span>
                  <span class="admin-nav-copy">
                    <strong>${escapeHtml(module.label)}</strong>
                    <small>${escapeHtml(module.description || "")}</small>
                  </span>
                </button>
              </li>
            `,
              )
              .join("")}
          </ul>
        </li>
      `;
    })
    .join("");

  ui.navList.querySelectorAll("button[data-module]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.getAttribute("data-module");
      router.navigate(key);
    });
  });
};

const mountModule = async (key) => {
  const module = MODULE_MAP[key] || MODULE_MAP.overview;
  if (!module || !ui.moduleContent) return;

  activeModuleKey = module.key;
  store.setState({ activeModule: module.key });
  selectModuleInNav(module.key);
  if (ui.moduleTitle) ui.moduleTitle.textContent = module.label;
  if (ui.moduleSubTitle) ui.moduleSubTitle.textContent = module.description || "";

  ui.moduleContent.innerHTML = "<div class='admin-loading'>Loading module...</div>";

  try {
    await module.mount({ content: ui.moduleContent, runtime, toast, confirmModal, drawer, router, store });
  } catch (error) {
    toast.error(runtime.normalizeSupabaseError(error, "Unable to load module."));
    ui.moduleContent.innerHTML = "<div class='admin-empty'>Unable to load this module.</div>";
  }
};

const hydrateIdentity = async () => {
  const { user, profile } = await runtime.ensureStaffProfile();
  store.setState({ session: { user }, profile });
  if (ui.currentUser) ui.currentUser.textContent = profile.full_name || profile.email || user.email || "Staff";
  if (ui.currentRole) ui.currentRole.textContent = String(profile.role || "staff");
};

const handleRefreshAccess = async () => {
  try {
    setAccessState({ granted: false, message: "Refreshing access session…" });
    await hydrateIdentity();
    setAccessState({ granted: true, message: "" });
    await mountModule(store.getState().activeModule || "overview");
    toast.success("Access refreshed.");
  } catch (error) {
    setAccessState({ granted: false, message: runtime.normalizeSupabaseError(error, "Access validation failed.") });
    toast.error(runtime.normalizeSupabaseError(error, "Access validation failed."));
  }
};

const init = async () => {
  try {
    restoreTheme();

    buildNav();
    router = createRouter({
      onRouteChange: async (routeKey) => {
        if (!store.getState().profile) return;
        await mountModule(routeKey);
      },
    });

    ui.themeToggle?.addEventListener("click", () => {
      const dark = document.documentElement.getAttribute("data-theme") === "dark";
      setTheme(dark ? "light" : "dark");
    });
    ui.refreshSession?.addEventListener("click", handleRefreshAccess);
    ui.accessRetry?.addEventListener("click", handleRefreshAccess);

    await hydrateIdentity();
    setAccessState({ granted: true, message: "" });
    router.start();
  } catch (error) {
    setAccessState({ granted: false, message: runtime.normalizeSupabaseError(error, "Access denied. Contact owner.") });
  }
};

init();
