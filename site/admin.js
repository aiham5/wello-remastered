const config = window.WELLO_CONFIG || {};
const supabaseUrl = config.supabaseUrl || "";
const supabaseAnonKey = config.supabaseAnonKey || "";
const debugEnabled =
  new URLSearchParams(window.location.search).has("debug") ||
  config.debug === true;

const debugState = {
  panel: null,
  lines: [],
  maxLines: 200,
};

const logDebug = (message, meta) => {
  if (!debugEnabled) return;
  const timestamp = new Date().toISOString().slice(11, 19);
  const line = meta ? `${timestamp} ${message} ${JSON.stringify(meta)}` : `${timestamp} ${message}`;
  debugState.lines.push(line);
  if (debugState.lines.length > debugState.maxLines) {
    debugState.lines.shift();
  }
  if (debugState.panel) {
    debugState.panel.textContent = debugState.lines.join("\n");
  }
  console.log("[admin-debug]", message, meta || "");
};

const initDebugPanel = () => {
  if (!debugEnabled || debugState.panel) return;
  const panel = document.createElement("pre");
  panel.id = "admin-debug-panel";
  panel.style.position = "fixed";
  panel.style.right = "12px";
  panel.style.bottom = "12px";
  panel.style.width = "360px";
  panel.style.maxHeight = "240px";
  panel.style.overflow = "auto";
  panel.style.padding = "10px";
  panel.style.background = "rgba(10, 14, 20, 0.9)";
  panel.style.color = "#d7e0ff";
  panel.style.fontSize = "11px";
  panel.style.lineHeight = "1.4";
  panel.style.borderRadius = "10px";
  panel.style.zIndex = "9999";
  panel.style.boxShadow = "0 12px 30px rgba(0,0,0,0.35)";
  panel.textContent = "admin debug enabled\n";
  document.body.appendChild(panel);
  debugState.panel = panel;
};

const ui = {
  authPanel: document.getElementById("auth-panel"),
  adminPanel: document.getElementById("admin-panel"),
  authEmail: document.getElementById("auth-email"),
  authPassword: document.getElementById("auth-password"),
  authError: document.getElementById("auth-error"),
  signIn: document.getElementById("sign-in"),
  signOut: document.getElementById("sign-out"),
  adminUser: document.getElementById("admin-user"),
  refresh: document.getElementById("refresh-data"),
  statPending: document.getElementById("stat-pending"),
  statVerified: document.getElementById("stat-verified"),
  statGross: document.getElementById("stat-gross"),
  statCommission: document.getElementById("stat-commission"),
  filterSearch: document.getElementById("filter-search"),
  filterStatus: document.getElementById("filter-status"),
  filterBusiness: document.getElementById("filter-business"),
  filterStart: document.getElementById("filter-start"),
  filterEnd: document.getElementById("filter-end"),
  filterRate: document.getElementById("filter-rate"),
  receiptsMeta: document.getElementById("receipts-meta"),
  receiptsBody: document.getElementById("receipts-body"),
  exportCsv: document.getElementById("export-csv"),
  detailEmpty: document.getElementById("detail-empty"),
  detailContent: document.getElementById("detail-content"),
  detailTitle: document.getElementById("detail-title"),
  detailSubtitle: document.getElementById("detail-subtitle"),
  detailStatus: document.getElementById("detail-status"),
  detailImage: document.getElementById("detail-image"),
  detailOpen: document.getElementById("detail-open"),
  detailTotal: document.getElementById("detail-total"),
  detailCommission: document.getElementById("detail-commission"),
  detailCashback: document.getElementById("detail-cashback"),
  detailStatusSelect: document.getElementById("detail-status-select"),
  detailNotes: document.getElementById("detail-notes"),
  detailSave: document.getElementById("detail-save"),
  detailVerify: document.getElementById("detail-verify"),
  detailError: document.getElementById("detail-error"),
  businessSummary: document.getElementById("business-summary"),
  activitySummary: document.getElementById("activity-summary"),
  testBusiness: document.getElementById("test-business"),
  testAmount: document.getElementById("test-amount"),
  testDate: document.getElementById("test-date"),
  testRedemption: document.getElementById("test-redemption"),
  testCreate: document.getElementById("test-create"),
  testCharge: document.getElementById("test-charge"),
  testStatus: document.getElementById("test-status"),
  testPeriod: document.getElementById("test-period"),
  testPending: document.getElementById("test-pending"),
  testInvoiced: document.getElementById("test-invoiced"),
  imageModal: document.getElementById("image-modal"),
  imageModalImg: document.getElementById("image-modal-img"),
  imageModalClose: document.getElementById("image-modal-close"),
};

if (!supabaseUrl || !supabaseAnonKey) {
  if (ui.authError) ui.authError.textContent =
    "Missing Supabase credentials. Set them in admin-config.js.";
}

if (debugEnabled) {
  initDebugPanel();
  logDebug("Debug enabled");
  window.addEventListener("error", (event) => {
    logDebug("window error", {
      message: event?.message,
      source: event?.filename,
      line: event?.lineno,
      column: event?.colno,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    logDebug("unhandledrejection", {
      reason: event?.reason?.message || String(event?.reason || ""),
    });
  });
}

const REQUEST_TIMEOUT_MS = 15000;
const PRESIGN_CACHE_MAX_AGE_MS = 8 * 60 * 1000; // keep small; URLs also have their own expiry
const PRESIGN_MAX_CONCURRENT = 2;

const presignCache = new Map(); // cacheKey -> { data, expiresAtMs }
const presignInFlight = new Map(); // cacheKey -> Promise<{data,error}>
const presignQueue = [];
let presignActive = 0;

const nowMs = () => Date.now();

const cleanupPresignCache = () => {
  const now = nowMs();
  for (const [key, entry] of presignCache.entries()) {
    if (!entry?.expiresAtMs || entry.expiresAtMs <= now) {
      presignCache.delete(key);
    }
  }
};

const enqueuePresign = (fn) =>
  new Promise((resolve, reject) => {
    presignQueue.push({ fn, resolve, reject });
    drainPresignQueue();
  });

const drainPresignQueue = () => {
  while (presignActive < PRESIGN_MAX_CONCURRENT && presignQueue.length) {
    const task = presignQueue.shift();
    presignActive += 1;
    Promise.resolve()
      .then(task.fn)
      .then(task.resolve, task.reject)
      .finally(() => {
        presignActive -= 1;
        drainPresignQueue();
      });
  }
};

function createTimedFetch(timeoutMs) {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const signal = controller.signal;
    const upstream = init?.signal;

    let upstreamAbortHandler = null;
    if (upstream) {
      if (upstream.aborted) {
        controller.abort();
      } else {
        upstreamAbortHandler = () => controller.abort();
        try {
          upstream.addEventListener("abort", upstreamAbortHandler, { once: true });
        } catch {
          // ignore
        }
      }
    }

    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal });
    } finally {
      clearTimeout(id);
      if (upstream && upstreamAbortHandler) {
        try {
          upstream.removeEventListener("abort", upstreamAbortHandler);
        } catch {
          // ignore
        }
      }
    }
  };
}

const supabaseClient =
  supabaseUrl && supabaseAnonKey
    ? window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          // Let supabase-js manage refresh in the background; it is more reliable than manual refresh races.
          autoRefreshToken: true,
        },
        global: {
          fetch: createTimedFetch(REQUEST_TIMEOUT_MS),
        },
      })
    : null;

const state = {
  session: null,
  profile: null,
  receipts: [],
  filtered: [],
  businesses: [],
  selected: null,
  defaultRate: 10,
};
const imageState = {
  key: null,
  inFlight: false,
};
const refreshState = {
  inFlight: false,
  timer: null,
  lastAt: 0,
};
const liveState = {
  channel: null,
  debounce: null,
};
const resumeState = {
  timer: null,
  inFlight: false,
  lastSource: null,
};
let didBootResume = false;
const abortRecovery = {
  inFlight: false,
  lastAt: 0,
};
const AUTO_REFRESH_MS = 30000;
const LIVE_DEBOUNCE_MS = 1200;
const CASHBACK_RATE = 0.05;

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const formatCurrency = (cents) =>
  currencyFormatter.format((Number(cents) || 0) / 100);

const formatDate = (value) => {
  if (!value) return "--";
  const date = new Date(value);
  return date.toLocaleDateString();
};

const formatDateTime = (value) => {
  if (!value) return "--";
  const date = new Date(value);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
};

const withTimeout = (promise, ms, label) =>
  new Promise((resolve, reject) => {
    let done = false;
    const id = setTimeout(() => {
      if (done) return;
      done = true;
      const error = new Error(`${label || "Request"} timed out after ${ms}ms`);
      error.name = "TimeoutError";
      reject(error);
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        if (done) return;
        done = true;
        clearTimeout(id);
        resolve(value);
      },
      (err) => {
        if (done) return;
        done = true;
        clearTimeout(id);
        reject(err);
      },
    );
  });

const sessionState = {
  refreshPromise: null,
};

const SESSION_REFRESH_BUFFER_MS = 90_000;

const needsRefresh = (session) => {
  const expiresAtSeconds = Number(session?.expires_at) || 0;
  if (!expiresAtSeconds) return true;
  const msLeft = expiresAtSeconds * 1000 - Date.now();
  return msLeft < SESSION_REFRESH_BUFFER_MS;
};

// Keep this extremely conservative: prefer getSession; refresh only when needed.
const ensureSession = async ({ force } = {}) => {
  if (!supabaseClient) return null;

  // If we already have a token and it's not close to expiring, keep it.
  if (!force && state.session?.access_token && !needsRefresh(state.session)) {
    return state.session;
  }

  try {
    if (!sessionState.refreshPromise) {
      sessionState.refreshPromise = withTimeout(
        (async () => {
          logDebug("ensureSession start", { force: Boolean(force) });
          logDebug("ensureSession getSession start");
          const {
            data: { session },
          } = await supabaseClient.auth.getSession();
          logDebug("ensureSession getSession done", {
            hasSession: Boolean(session?.access_token),
          });

          if (session?.access_token && !force && !needsRefresh(session)) {
            return session;
          }

          logDebug("ensureSession refreshSession start");
          const refreshed = await supabaseClient.auth.refreshSession();
          const next = refreshed?.data?.session || null;
          logDebug("ensureSession refreshSession done", {
            hasSession: Boolean(next?.access_token),
          });
          return next;
        })(),
        REQUEST_TIMEOUT_MS,
        force ? "ensureSession(force)" : "ensureSession",
      ).finally(() => {
        sessionState.refreshPromise = null;
      });
    }

    const session = await sessionState.refreshPromise;
    state.session = session;
    return session || null;
  } catch (error) {
    const message = error?.message || "unknown";
    logDebug("ensureSession failed", { message });
    // If the refresh was aborted but we still have a usable token, keep going.
    if (state.session?.access_token && !needsRefresh(state.session)) {
      return state.session;
    }
    return null;
  }
};

const recoverFromAbort = async (source) => {
  const now = Date.now();
  if (abortRecovery.inFlight || now - abortRecovery.lastAt < 4000) return;
  abortRecovery.inFlight = true;
  abortRecovery.lastAt = now;
  logDebug("recoverFromAbort", { source });
  try {
    stopLiveRefresh();
    stopAutoRefresh();
    await refreshAll({ silent: true });
    startAutoRefresh();
    startLiveRefresh();
  } finally {
    abortRecovery.inFlight = false;
  }
};

const callR2Presign = async ({ action, key, accessToken }) => {
  if (!supabaseClient) {
    return { data: null, error: "Supabase is not configured." };
  }
  cleanupPresignCache();
  const cacheKey = `${String(action || "").toLowerCase()}:${key}`;
  const cached = presignCache.get(cacheKey);
  if (cached?.data?.signedUrl && cached.expiresAtMs > nowMs()) {
    logDebug("r2-presign cache hit", { action, key });
    return { data: cached.data, error: null };
  }
  const existing = presignInFlight.get(cacheKey);
  if (existing) {
    logDebug("r2-presign dedupe await", { action, key });
    return existing;
  }
  logDebug("r2-presign request", { action, key });
  // Explicitly attach the current user token; we have seen cases where invoke() does not
  // include it consistently after tab backgrounding.
  const session = await ensureSession({ force: false });
  const token = session?.access_token || state.session?.access_token || "";
  if (!token) {
    return { data: null, error: "Missing access token." };
  }
  const invoke = () =>
    withTimeout(
      supabaseClient.functions.invoke("r2-presign", {
        body: { action, key },
        headers: { Authorization: `Bearer ${token}` },
      }),
      REQUEST_TIMEOUT_MS,
      "r2-presign",
    );

  const run = async () => {
    let response = null;
    try {
      response = await invoke();
      if (response?.error?.message) {
        const msg = String(response.error.message).toLowerCase();
        if (msg.includes("jwt") || msg.includes("authorization")) {
          await ensureSession({ force: true });
          response = await invoke();
        }
      }
    } catch (error) {
      const message = error?.message || "unknown";
      console.warn("r2-presign exception", message);
      logDebug("r2-presign exception", { message });
      return {
        data: null,
        error: message.includes("timed out") ? "r2_invoke timeout" : message,
      };
    }

    if (!response?.error) {
      let parsedData = response?.data ?? null;
      if (typeof parsedData === "string") {
        try {
          parsedData = parsedData ? JSON.parse(parsedData) : null;
        } catch {
          parsedData = response?.data ?? null;
        }
      }
      logDebug("r2-presign success", { action, key });
      if (parsedData?.signedUrl) {
        const expiresInSec = Number(parsedData?.expiresIn) || 0;
        const ttlMs = Math.min(
          PRESIGN_CACHE_MAX_AGE_MS,
          Math.max(30_000, (expiresInSec ? expiresInSec * 1000 : 0) - 60_000),
        );
        presignCache.set(cacheKey, {
          data: parsedData,
          expiresAtMs: nowMs() + ttlMs,
        });
      }
      return { data: parsedData, error: null };
    }

    const err = response.error;
    const context = err?.context;
    let raw = "";
    let parsed = null;
    if (context?.text) {
      try {
        raw = await context.text();
      } catch {
        raw = "";
      }
    }
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    const status = context?.status ?? null;
    console.warn("r2-presign failed", {
      status,
      message: err?.message,
      raw,
    });
    logDebug("r2-presign failed", { status, message: err?.message, raw });
    return {
      data: null,
      error:
        parsed?.error ||
        parsed?.message ||
        err?.message ||
        (status ? `R2 presign failed (${status}).` : "R2 presign failed."),
    };
  };

  const promise = enqueuePresign(run).finally(() => {
    presignInFlight.delete(cacheKey);
  });
  presignInFlight.set(cacheKey, promise);
  return promise;
};

const parseMoneyToCents = (value) => {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
};

const calculateCashbackCents = (commissionCents) => {
  if (!Number.isFinite(commissionCents) || commissionCents <= 0) return 0;
  return Math.round(commissionCents * CASHBACK_RATE);
};

const updateStatusPill = (el, status) => {
  const normalized = status || "pending";
  el.textContent = normalized;
  el.classList.remove("pending", "verified", "rejected");
  el.classList.add(normalized);
};

const openImageModal = (src) => {
  if (!src) return;
  ui.imageModalImg.src = src;
  ui.imageModal.classList.remove("is-hidden");
  document.body.classList.add("modal-open");
};

const closeImageModal = () => {
  ui.imageModal.classList.add("is-hidden");
  ui.imageModalImg.removeAttribute("src");
  document.body.classList.remove("modal-open");
};

const setAuthUI = (isSignedIn) => {
  if (ui.authPanel) ui.authPanel.classList.toggle("is-hidden", isSignedIn);
  if (ui.adminPanel) ui.adminPanel.classList.toggle("is-hidden", !isSignedIn);
  if (ui.signOut) ui.signOut.classList.toggle("is-hidden", !isSignedIn);
};

const setAuthError = (message) => {
  if (ui.authError) ui.authError.textContent = message || "";
};

const setDetailError = (message) => {
  if (ui.detailError) ui.detailError.textContent = message || "";
};

const setTestStatus = (message, isError = false) => {
  if (!ui.testStatus) return;
  ui.testStatus.textContent = message || "";
  ui.testStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
};

const getBillingPeriodForDate = (dateValue) => {
  const date = dateValue
    ? new Date(`${dateValue}T12:00:00Z`)
    : new Date();
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  return { start, end };
};

const formatPeriodLabel = ({ start, end }) =>
  `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`;

const resetDetail = () => {
  state.selected = null;
  ui.detailContent.classList.add("is-hidden");
  ui.detailEmpty.classList.remove("is-hidden");
  ui.detailImage.removeAttribute("src");
  ui.detailOpen.disabled = true;
  ui.detailTitle.textContent = "Receipt";
  ui.detailSubtitle.textContent = "";
  updateStatusPill(ui.detailStatus, "pending");
  ui.detailTotal.value = "";
  ui.detailCommission.value = "";
  ui.detailCashback.value = "";
  ui.detailStatusSelect.value = "pending";
  ui.detailNotes.value = "";
  setDetailError("");
};

const requireStaff = async () => {
  if (!supabaseClient) return false;
  const {
    data: { user },
  } = await supabaseClient.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, role, full_name, email")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) {
    setAuthError(error?.message || "Unable to verify admin access.");
    await supabaseClient.auth.signOut();
    return false;
  }
  if (!["admin", "supervisor"].includes(data.role)) {
    setAuthError("This account does not have admin access.");
    await supabaseClient.auth.signOut();
    return false;
  }
  state.profile = data;
  ui.adminUser.textContent = data.full_name || data.email || "Admin";
  return true;
};

const loadBusinesses = async () => {
  if (!supabaseClient) return;
  const selectedFilter = ui.filterBusiness.value;
  const selectedTest = ui.testBusiness ? ui.testBusiness.value : "";
  let data = null;
  let error = null;
  try {
    const result = await withTimeout(
      supabaseClient.from("businesses").select("id, name").order("name"),
      REQUEST_TIMEOUT_MS,
      "loadBusinesses",
    );
    data = result?.data ?? null;
    error = result?.error ?? null;
  } catch (err) {
    error = err;
  }
  if (error?.message && error.message.toLowerCase().includes("jwt")) {
    await ensureSession({ force: true });
    try {
      const retry = await withTimeout(
        supabaseClient.from("businesses").select("id, name").order("name"),
        REQUEST_TIMEOUT_MS,
        "loadBusinessesRetry",
      );
      data = retry?.data ?? null;
      error = retry?.error ?? null;
    } catch (err) {
      error = err;
    }
  }
  if (error) {
    const message = error.message || "unknown";
    logDebug("loadBusinesses error", { message });
    if (!document.hidden && message.toLowerCase().includes("aborterror")) {
      recoverFromAbort("loadBusinesses");
    }
    return;
  }
  state.businesses = data || [];
  ui.filterBusiness.innerHTML = `<option value="all">All businesses</option>`;
  if (ui.testBusiness) {
    ui.testBusiness.innerHTML = `<option value="">Select a business</option>`;
  }
  state.businesses.forEach((business) => {
    const option = document.createElement("option");
    option.value = business.id;
    option.textContent = business.name;
    ui.filterBusiness.appendChild(option);
    if (ui.testBusiness) {
      const testOption = document.createElement("option");
      testOption.value = business.id;
      testOption.textContent = business.name;
      ui.testBusiness.appendChild(testOption);
    }
  });
  if (selectedFilter && selectedFilter !== "all") {
    ui.filterBusiness.value = selectedFilter;
  }
  if (ui.testBusiness && selectedTest) {
    ui.testBusiness.value = selectedTest;
  }
};

const loadReceipts = async () => {
  if (!supabaseClient) return;
  let data = null;
  let error = null;
  try {
    const result = await withTimeout(
      supabaseClient
        .from("receipt_uploads")
        .select(
          [
            "id",
            "storage_path",
            "uploaded_at",
            "receipt_total_cents",
            "commission_due_cents",
            "review_status",
            "review_notes",
            "reviewed_at",
            "business:businesses (id, name)",
            "redemption:redemptions (id, created_at, offer:offers (id, title))",
          ].join(","),
        )
        .order("uploaded_at", { ascending: false })
        .limit(400),
      REQUEST_TIMEOUT_MS,
      "loadReceipts",
    );
    data = result?.data ?? null;
    error = result?.error ?? null;
  } catch (err) {
    error = err;
  }
  if (error?.message && error.message.toLowerCase().includes("jwt")) {
    await ensureSession({ force: true });
    try {
      const retry = await withTimeout(
        supabaseClient
          .from("receipt_uploads")
          .select(
            [
              "id",
              "storage_path",
              "uploaded_at",
              "receipt_total_cents",
              "commission_due_cents",
              "review_status",
              "review_notes",
              "reviewed_at",
              "business:businesses (id, name)",
              "redemption:redemptions (id, created_at, offer:offers (id, title))",
            ].join(","),
          )
          .order("uploaded_at", { ascending: false })
          .limit(400),
        REQUEST_TIMEOUT_MS,
        "loadReceiptsRetry",
      );
      data = retry?.data ?? null;
      error = retry?.error ?? null;
    } catch (err) {
      error = err;
    }
  }
  if (error) {
    const message = error.message || "Unable to load receipts.";
    ui.receiptsMeta.textContent = message;
    logDebug("loadReceipts error", { message });
    if (!document.hidden && message.toLowerCase().includes("aborterror")) {
      recoverFromAbort("loadReceipts");
    }
    return;
  }
  state.receipts = data || [];
  applyFilters();
};

const refreshAll = async ({ silent } = {}) => {
  if (!supabaseClient || !state.session?.user) return;
  if (refreshState.inFlight) return;
  // Avoid hammering on tab focus. If we refreshed very recently, skip.
  if (silent && refreshState.lastAt && nowMs() - refreshState.lastAt < 8000) {
    return;
  }
  refreshState.inFlight = true;
  if (!silent) {
    ui.receiptsMeta.textContent = "Refreshing...";
  }
  logDebug("refreshAll start", { silent });
  try {
    await ensureSession({ force: false });
    // Sequential requests reduce burstiness when the tab resumes.
    await loadBusinesses();
    await loadReceipts();
    if (state.selected?.id) {
      selectReceipt(state.selected.id, { forceImage: false, skipImage: true });
    }
    logDebug("refreshAll done");
    refreshState.lastAt = nowMs();
  } finally {
    refreshState.inFlight = false;
  }
};

const startAutoRefresh = () => {
  if (refreshState.timer) return;
  refreshState.timer = setInterval(() => {
    if (document.hidden) return;
    refreshAll({ silent: true });
  }, AUTO_REFRESH_MS);
  logDebug("auto refresh started", { intervalMs: AUTO_REFRESH_MS });
};

const stopAutoRefresh = () => {
  if (refreshState.timer) {
    clearInterval(refreshState.timer);
    refreshState.timer = null;
    logDebug("auto refresh stopped");
  }
};

const scheduleLiveRefresh = () => {
  if (liveState.debounce) return;
  liveState.debounce = setTimeout(() => {
    liveState.debounce = null;
    refreshAll({ silent: true });
  }, LIVE_DEBOUNCE_MS);
};

const startLiveRefresh = () => {
  if (!supabaseClient || liveState.channel) return;
  const channel = supabaseClient.channel("admin-receipts-live");
  const handleChange = () => scheduleLiveRefresh();
  channel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: "receipt_uploads" },
    handleChange,
  );
  channel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: "commission_events" },
    handleChange,
  );
  channel.subscribe();
  liveState.channel = channel;
  logDebug("live refresh subscribed");
};

const stopLiveRefresh = () => {
  if (liveState.debounce) {
    clearTimeout(liveState.debounce);
    liveState.debounce = null;
  }
  if (liveState.channel) {
    liveState.channel.unsubscribe();
    liveState.channel = null;
    logDebug("live refresh unsubscribed");
  }
};

const resumeNow = async (source) => {
  if (!supabaseClient || document.hidden) return;
  if (resumeState.inFlight) return;
  resumeState.inFlight = true;
  resumeState.lastSource = source || null;
  logDebug("resume start", { source: source || null });
  try {
    // Make sure we have a usable session before hitting Edge Functions / PostgREST.
    await ensureSession({ force: false });

    startAutoRefresh();
    startLiveRefresh();
    await refreshAll({ silent: true });
    await loadTestCharges();
  } catch (error) {
    logDebug("resume failed", { message: error?.message || "unknown" });
  } finally {
    resumeState.inFlight = false;
    logDebug("resume done", { source: source || null });
  }
};

const scheduleResume = (source) => {
  if (!supabaseClient || document.hidden) return;
  if (resumeState.inFlight) return;
  if (resumeState.timer) {
    clearTimeout(resumeState.timer);
    resumeState.timer = null;
  }
  resumeState.timer = setTimeout(() => {
    resumeState.timer = null;
    resumeNow(source);
  }, 150);
};

const applyFilters = () => {
  const search = (ui.filterSearch.value || "").toLowerCase().trim();
  const status = ui.filterStatus.value;
  const business = ui.filterBusiness.value;
  const start = ui.filterStart.value ? new Date(ui.filterStart.value) : null;
  const end = ui.filterEnd.value ? new Date(ui.filterEnd.value) : null;
  if (end) {
    end.setHours(23, 59, 59, 999);
  }
  const filtered = state.receipts.filter((receipt) => {
    const receiptStatus = receipt.review_status || "pending";
    if (status !== "all" && receiptStatus !== status) return false;
    if (business !== "all" && receipt.business?.id !== business) return false;
    const uploadedAt = receipt.uploaded_at ? new Date(receipt.uploaded_at) : null;
    if (start && uploadedAt && uploadedAt < start) return false;
    if (end && uploadedAt && uploadedAt > end) return false;
    if (search) {
      const haystack = [
        receipt.business?.name,
        receipt.redemption?.offer?.title,
        receipt.redemption?.id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
  state.filtered = filtered;
  renderReceipts();
  renderStats();
  renderBusinessSummary();
  renderActivitySummary();
};

const renderReceipts = () => {
  ui.receiptsBody.innerHTML = "";
  ui.receiptsMeta.textContent = `${state.filtered.length} receipts`;
  state.filtered.forEach((receipt) => {
    const row = document.createElement("tr");
    row.dataset.id = receipt.id;
    if (state.selected?.id === receipt.id) {
      row.classList.add("active");
    }
    row.innerHTML = `
      <td>${receipt.business?.name || "--"}</td>
      <td>${receipt.redemption?.offer?.title || "--"}</td>
      <td>${formatDate(receipt.uploaded_at)}</td>
      <td>${formatCurrency(receipt.receipt_total_cents)}</td>
      <td>${formatCurrency(receipt.commission_due_cents)}</td>
      <td>${formatCurrency(
        calculateCashbackCents(Number(receipt.commission_due_cents) || 0),
      )}</td>
      <td><span class="status-pill ${receipt.review_status || "pending"}">${receipt.review_status || "pending"}</span></td>
    `;
    row.addEventListener("click", () => selectReceipt(receipt.id));
    ui.receiptsBody.appendChild(row);
  });
};

const selectReceipt = async (receiptId, options = {}) => {
  const receipt = state.receipts.find((item) => item.id === receiptId);
  if (!receipt) return;
  const sameReceipt = state.selected?.id === receiptId;
  const hasImage = Boolean(ui.detailImage.getAttribute("src"));
  closeImageModal();
  state.selected = receipt;
  ui.detailEmpty.classList.add("is-hidden");
  ui.detailContent.classList.remove("is-hidden");
  ui.detailTitle.textContent = receipt.business?.name || "Receipt";
  ui.detailSubtitle.textContent = `Uploaded ${formatDateTime(
    receipt.uploaded_at,
  )}`;
  updateStatusPill(ui.detailStatus, receipt.review_status || "pending");
  ui.detailStatusSelect.value = receipt.review_status || "pending";
  ui.detailTotal.value =
    receipt.receipt_total_cents != null
      ? (receipt.receipt_total_cents / 100).toFixed(2)
      : "";
  ui.detailCommission.value =
    receipt.commission_due_cents != null
      ? (receipt.commission_due_cents / 100).toFixed(2)
      : "";
  const cashbackCents = calculateCashbackCents(
    Number(receipt.commission_due_cents) || 0,
  );
  ui.detailCashback.value =
    receipt.commission_due_cents != null ? (cashbackCents / 100).toFixed(2) : "";
  ui.detailNotes.value = receipt.review_notes || "";
  setDetailError("");
  if (!sameReceipt) {
    ui.detailImage.removeAttribute("src");
    ui.detailOpen.disabled = true;
  }
  if (options.skipImage) {
    // Keep whatever is already on screen. This avoids a burst of presign calls on tab resume.
    ui.detailOpen.disabled = !Boolean(ui.detailImage.getAttribute("src"));
  } else if (!sameReceipt || !hasImage || options.forceImage) {
    await loadReceiptImage(receipt);
  } else {
    ui.detailOpen.disabled = false;
  }
  renderReceipts();
};

const loadReceiptImage = async (receipt) => {
  ui.detailImage.removeAttribute("src");
  ui.detailOpen.disabled = true;
  if (!receipt?.storage_path || !supabaseClient) return;
  if (imageState.inFlight && imageState.key === receipt.storage_path) {
    return;
  }
  imageState.inFlight = true;
  imageState.key = receipt.storage_path;
  try {
    let session = state.session;
    if (!session?.access_token) {
      session = await ensureSession();
    }
    if (!session?.access_token) {
      setDetailError("Session missing. Please sign in again.");
      imageState.inFlight = false;
      return;
    }
    let result = await callR2Presign({
      action: "download",
      key: receipt.storage_path,
      accessToken: session.access_token,
    });
    if (result.error) {
      const msg = String(result.error || "").toLowerCase();
      const shouldRetry =
        msg.includes("jwt") ||
        msg.includes("authorization") ||
        msg.includes("unauthorized") ||
        msg.includes("missing access token");
      if (shouldRetry) {
        const nextSession = await ensureSession({ force: true });
        if (nextSession?.access_token) {
          result = await callR2Presign({
            action: "download",
            key: receipt.storage_path,
            accessToken: nextSession.access_token,
          });
        }
      }
    }
    const { data, error } = result;
    if (error || !data?.signedUrl) {
      const message = error?.message || "Unable to load receipt image.";
      setDetailError(message);
      if (!document.hidden && message.toLowerCase().includes("aborterror")) {
        recoverFromAbort("loadReceiptImage");
      }
      imageState.inFlight = false;
      return;
    }
    ui.detailImage.src = data.signedUrl;
    ui.detailOpen.disabled = false;
    imageState.inFlight = false;
  } catch (error) {
    setDetailError(error?.message || "Unable to load receipt image.");
    imageState.inFlight = false;
  }
};

const renderStats = () => {
  const pending = state.filtered.filter(
    (receipt) => (receipt.review_status || "pending") === "pending",
  );
  const verified = state.filtered.filter(
    (receipt) => receipt.review_status === "verified",
  );
  const gross = state.filtered.reduce(
    (sum, receipt) => sum + (receipt.receipt_total_cents || 0),
    0,
  );
  const commission = state.filtered.reduce(
    (sum, receipt) => sum + (receipt.commission_due_cents || 0),
    0,
  );
  ui.statPending.textContent = pending.length;
  ui.statVerified.textContent = verified.length;
  ui.statGross.textContent = formatCurrency(gross);
  ui.statCommission.textContent = formatCurrency(commission);
};

const renderBusinessSummary = () => {
  const totals = new Map();
  state.filtered.forEach((receipt) => {
    const businessName = receipt.business?.name || "Unknown";
    const current = totals.get(businessName) || {
      count: 0,
      gross: 0,
      commission: 0,
      cashback: 0,
    };
    current.count += 1;
    const totalCents = Number(receipt.receipt_total_cents) || 0;
    current.gross += totalCents;
    current.commission += Number(receipt.commission_due_cents) || 0;
    current.cashback += calculateCashbackCents(
      Number(receipt.commission_due_cents) || 0,
    );
    totals.set(businessName, current);
  });
  ui.businessSummary.innerHTML = "";
  Array.from(totals.entries()).forEach(([name, data]) => {
    const item = document.createElement("div");
    item.className = "summary-item";
    item.innerHTML = `
      <h4>${name}</h4>
      <p>${data.count} receipts</p>
      <p>Gross: ${formatCurrency(data.gross)}</p>
      <p>Commission: ${formatCurrency(data.commission)}</p>
      <p>Customer cashback: ${formatCurrency(data.cashback)}</p>
    `;
    ui.businessSummary.appendChild(item);
  });
  if (!totals.size) {
    ui.businessSummary.innerHTML =
      '<p class="notice">No receipts match the current filters.</p>';
  }
};

const renderActivitySummary = () => {
  ui.activitySummary.innerHTML = "";
  const recent = state.filtered.slice(0, 6);
  recent.forEach((receipt) => {
    const item = document.createElement("div");
    item.className = "summary-item";
    item.innerHTML = `
      <h4>${receipt.redemption?.offer?.title || "Receipt"}</h4>
      <p>${receipt.business?.name || "--"} · ${formatDateTime(
      receipt.uploaded_at,
    )}</p>
      <p>Status: ${receipt.review_status || "pending"}</p>
    `;
    ui.activitySummary.appendChild(item);
  });
  if (!recent.length) {
    ui.activitySummary.innerHTML =
      '<p class="notice">No recent receipts yet.</p>';
  }
};

const getDefaultTestDate = () => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const previousMonth = month === 0 ? 11 : month - 1;
  const previousYear = month === 0 ? year - 1 : year;
  const date = new Date(Date.UTC(previousYear, previousMonth, 15, 12, 0, 0));
  return date.toISOString().slice(0, 10);
};

const loadTestCharges = async () => {
  if (!supabaseClient || !ui.testBusiness) return;
  const businessId = ui.testBusiness.value || "";
  const period = getBillingPeriodForDate(ui.testDate?.value || "");
  if (ui.testPeriod) {
    ui.testPeriod.textContent = formatPeriodLabel(period);
  }
  if (!businessId) {
    if (ui.testPending) ui.testPending.textContent = "$0.00";
    if (ui.testInvoiced) ui.testInvoiced.textContent = "$0.00";
    return;
  }
  const { data, error } = await supabaseClient
    .from("commission_events")
    .select("amount_cents, status, created_at")
    .eq("business_id", businessId)
    .gte("created_at", period.start.toISOString())
    .lt("created_at", period.end.toISOString());
  if (error) {
    setTestStatus(error.message || "Unable to load charges.", true);
    return;
  }
  const rows = data || [];
  const pendingCents = rows
    .filter((row) => row.status === "pending")
    .reduce((sum, row) => sum + (Number(row.amount_cents) || 0), 0);
  const invoicedCents = rows
    .filter((row) => row.status === "invoiced" || row.status === "paid")
    .reduce((sum, row) => sum + (Number(row.amount_cents) || 0), 0);
  if (ui.testPending) ui.testPending.textContent = formatCurrency(pendingCents);
  if (ui.testInvoiced)
    ui.testInvoiced.textContent = formatCurrency(invoicedCents);
};

const runTestInvoice = async ({ businessId, period }) => {
  if (!supabaseClient) {
    setTestStatus("Supabase is not configured.", true);
    return null;
  }
  let session = state.session;
  if (!session?.access_token) {
    session = await ensureSession({ force: true });
  }
  if (!session?.access_token) {
    setTestStatus("Session missing. Please sign in again.", true);
    return null;
  }

  const response = await withTimeout(
    supabaseClient.functions.invoke(
      "admin-run-monthly-invoices",
      {
        body: {
          businessId,
          periodStart: period.start.toISOString(),
          periodEnd: period.end.toISOString(),
        },
      },
    ),
    REQUEST_TIMEOUT_MS,
    "admin-run-monthly-invoices",
  );

  if (!response?.error) {
    return response.data || {};
  }
  const context = response.error?.context;
  let raw = "";
  if (context?.text) {
    try {
      raw = await context.text();
    } catch {
      raw = "";
    }
  }
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  setTestStatus(
    parsed?.error ||
      parsed?.message ||
      response.error?.message ||
      "Unable to run invoice.",
    true,
  );
  return null;
};

const addCommissionToStripe = async ({
  businessId,
  redemptionId,
  eventDate,
  context = "receipt",
}) => {
  if (!supabaseClient) {
    return { error: "Supabase is not configured." };
  }
  let session = state.session;
  if (!session?.access_token) {
    session = await ensureSession({ force: true });
  }
  if (!session?.access_token) {
    return { error: "Session missing. Please sign in again." };
  }

  const response = await withTimeout(
    supabaseClient.functions.invoke(
      "admin-add-commission-to-stripe",
      {
        body: {
          businessId,
          redemptionId,
          eventDate: eventDate || null,
        },
      },
    ),
    REQUEST_TIMEOUT_MS,
    "admin-add-commission-to-stripe",
  );

  if (!response?.error) {
    return { data: response.data || null, error: null };
  }
  const contextText = response.error?.context;
  let raw = "";
  if (contextText?.text) {
    try {
      raw = await contextText.text();
    } catch {
      raw = "";
    }
  }
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  return {
    data: null,
    error:
      parsed?.error ||
      parsed?.message ||
      response.error?.message ||
      `Unable to sync ${context} to Stripe.`,
  };
};

const createTestEvent = async () => {
  if (!supabaseClient) {
    setTestStatus("Supabase is not configured.", true);
    return;
  }
  const businessId = ui.testBusiness?.value || "";
  const amountCents = parseMoneyToCents(ui.testAmount?.value);
  const eventDate = ui.testDate?.value || "";
  const redemptionId = ui.testRedemption?.value?.trim() || "";
  const period = getBillingPeriodForDate(eventDate);

  if (!businessId) {
    setTestStatus("Select a business.", true);
    return;
  }
  if (amountCents == null || amountCents <= 0) {
    setTestStatus("Enter a commission amount greater than 0.", true);
    return;
  }

  logDebug("test event start", {
    businessId,
    amountCents,
    eventDate,
    redemptionId: redemptionId || null,
  });
  setTestStatus("Creating test event...");
  if (ui.testCreate) ui.testCreate.disabled = true;
  try {
    let session = state.session;
    if (!session?.access_token) {
      session = await ensureSession({ force: true });
    }
    if (!session?.access_token) {
      setTestStatus("Session missing. Please sign in again.", true);
      return;
    }
    const response = await withTimeout(
      supabaseClient.functions.invoke(
        "admin-create-test-commission",
        {
          body: {
            businessId,
            amountCents,
            eventDate,
            redemptionId: redemptionId || null,
          },
        },
      ),
      REQUEST_TIMEOUT_MS,
      "admin-create-test-commission",
    );
    if (!response?.error) {
      const redemptionIdResult =
        response?.data?.redemptionId || redemptionId || null;
      setTestStatus("Test event created. Syncing draft invoice...");
      const syncResult = redemptionIdResult
        ? await addCommissionToStripe({
            businessId,
            redemptionId: redemptionIdResult,
            eventDate,
            context: "test event",
          })
        : { data: null, error: "Missing redemption id for Stripe sync." };
      if (syncResult?.error) {
        setTestStatus(syncResult.error, true);
        return;
      }

      setTestStatus("Draft invoice updated. Charging in Stripe...");
      const invoiceResult = await runTestInvoice({ businessId, period });
      if (invoiceResult?.invoiceId) {
        setTestStatus(
          `Invoice sent: ${formatCurrency(invoiceResult.totalCents || 0)} (ID ${invoiceResult.invoiceId}).`,
        );
      } else if (invoiceResult?.totalCents === 0) {
        setTestStatus("No pending charges to invoice for this period.");
      }
      await refreshAll({ silent: true });
      await loadTestCharges();
      return;
    }
    const context = response.error?.context;
    let raw = "";
    if (context?.text) {
      try {
        raw = await context.text();
      } catch {
        raw = "";
      }
    }
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    const status = context?.status ?? null;
    if (status === 409 || parsed?.error?.includes?.("already exists")) {
      setTestStatus(
        "Test event already exists. Charging monthly invoice...",
      );
      const invoiceResult = await runTestInvoice({ businessId, period });
      if (invoiceResult?.invoiceId) {
        setTestStatus(
          `Invoice sent: ${formatCurrency(invoiceResult.totalCents || 0)} (ID ${invoiceResult.invoiceId}).`,
        );
      } else if (invoiceResult?.totalCents === 0) {
        setTestStatus("No pending charges to invoice for this period.");
      }
      await refreshAll({ silent: true });
      await loadTestCharges();
      return;
    }
    setTestStatus(
      parsed?.error || parsed?.message || response.error?.message || "Unable to create test event.",
      true,
    );
  } catch (error) {
    setTestStatus(error?.message || "Unable to create test event.", true);
  } finally {
    if (ui.testCreate) ui.testCreate.disabled = false;
  }
};

const chargeNow = async () => {
  if (!supabaseClient) {
    setTestStatus("Supabase is not configured.", true);
    return;
  }
  const businessId = ui.testBusiness?.value || "";
  const eventDate = ui.testDate?.value || "";
  const period = getBillingPeriodForDate(eventDate);

  if (!businessId) {
    setTestStatus("Select a business.", true);
    return;
  }

  setTestStatus("Charging monthly invoice...");
  if (ui.testCharge) ui.testCharge.disabled = true;
  try {
    const invoiceResult = await runTestInvoice({ businessId, period });
    if (invoiceResult?.invoiceId) {
      setTestStatus(
        `Invoice sent: ${formatCurrency(invoiceResult.totalCents || 0)} (ID ${invoiceResult.invoiceId}).`,
      );
    } else if (invoiceResult?.totalCents === 0) {
      setTestStatus("No pending charges to invoice for this period.");
    }
    await refreshAll({ silent: true });
    await loadTestCharges();
  } catch (error) {
    setTestStatus(error?.message || "Unable to charge invoice.", true);
  } finally {
    if (ui.testCharge) ui.testCharge.disabled = false;
  }
};

const saveReceipt = async (options = {}) => {
  const receipt = state.selected;
  if (!receipt || !supabaseClient) {
    setDetailError("Missing receipt or Supabase client.");
    return;
  }
  setDetailError("");
  ui.detailSave.disabled = true;
  ui.detailVerify.disabled = true;
  setDetailError("Saving...");
  logDebug("saveReceipt start", { receiptId: receipt.id, status: options.status });
  const totalCents = parseMoneyToCents(ui.detailTotal.value);
  let commissionCents = parseMoneyToCents(ui.detailCommission.value);
  if (commissionCents == null && totalCents != null) {
    const rate = Number(ui.filterRate.value || state.defaultRate) / 100;
    commissionCents = Math.round(totalCents * rate);
  }
  let status = options.status || ui.detailStatusSelect.value;
  const notes = ui.detailNotes.value || null;
  let user = null;
  try {
    const userResult = await supabaseClient.auth.getUser();
    user = userResult?.data?.user || null;
  } catch (error) {
    console.warn("getUser failed", error);
  }

  if (
    status === "pending" &&
    totalCents != null &&
    commissionCents != null &&
    commissionCents > 0
  ) {
    status = "verified";
  }

  const updates = {
    receipt_total_cents: totalCents,
    commission_due_cents: commissionCents,
    review_status: status,
    review_notes: notes,
    reviewed_at: new Date().toISOString(),
    reviewed_by: user?.id || null,
  };

  console.log("Saving receipt review", { receiptId: receipt.id, updates });
  let data = null;
  let error = null;
  try {
    const baseSelect = [
      "id",
      "storage_path",
      "uploaded_at",
      "receipt_total_cents",
      "commission_due_cents",
      "review_status",
      "review_notes",
      "reviewed_at",
      "business:businesses (id, name)",
      "redemption:redemptions (id, created_at, offer:offers (id, title))",
    ];

    const runUpdate = async (payload, fields) =>
      withTimeout(
        supabaseClient
          .from("receipt_uploads")
          .update(payload)
          .eq("id", receipt.id)
          .select(fields.join(","))
          .maybeSingle(),
        REQUEST_TIMEOUT_MS,
        "saveReceipt",
      );

    const first = await runUpdate(updates, baseSelect);
    data = first?.data || null;
    error = first?.error || null;

    const message = String(error?.message || "").toLowerCase();
    const isSchemaCacheError =
      message.includes("schema cache") ||
      String(error?.code || "").toLowerCase().includes("pgrst") ||
      message.includes("could not find the") ||
      message.includes("column") && message.includes("receipt_uploads");

    if (error && isSchemaCacheError) {
      // If the DB schema is missing some audit columns (common during early iterations),
      // retry without them so the review workflow still works.
      const retryUpdates = { ...updates };
      const retrySelect = [...baseSelect];

      const maybeStrip = (col) => {
        if (message.includes(`'${col}'`) || message.includes(` ${col} `) || message.includes(col)) {
          delete retryUpdates[col];
          const idx = retrySelect.indexOf(col);
          if (idx >= 0) retrySelect.splice(idx, 1);
        }
      };

      maybeStrip("reviewed_by");
      maybeStrip("reviewed_at");
      maybeStrip("review_notes");

      const second = await runUpdate(retryUpdates, retrySelect);
      data = second?.data || null;
      error = second?.error || null;
    }
  } catch (err) {
    error = err;
  }

  if (error || !data) {
    const raw = {
      message: error?.message || "unknown",
      code: error?.code || null,
      details: error?.details || null,
      hint: error?.hint || null,
    };
    console.warn("saveReceipt failed", raw);
    logDebug("saveReceipt failed", raw);
    setDetailError(
      debugEnabled && (raw.details || raw.hint)
        ? `${raw.message}${raw.details ? ` (${raw.details})` : ""}`
        : raw.message || "Unable to save receipt review.",
    );
    ui.detailSave.disabled = false;
    ui.detailVerify.disabled = false;
    return;
  }
  console.log("Receipt review saved", data);
  logDebug("saveReceipt success", { receiptId: data.id });

  state.receipts = state.receipts.map((item) =>
    item.id === receipt.id ? data : item,
  );
  state.selected = data;
  applyFilters();
  selectReceipt(data.id);
  setDetailError("Saved.");
  setTimeout(() => setDetailError(""), 2000);
  ui.detailSave.disabled = false;
  ui.detailVerify.disabled = false;

  if (status === "verified" && (Number(commissionCents) || 0) > 0) {
    const syncResult = await addCommissionToStripe({
      businessId: data.business?.id,
      redemptionId: data.redemption?.id,
      eventDate: data.reviewed_at || data.uploaded_at,
    });
    if (syncResult?.error) {
      setDetailError(`Saved, but Stripe sync failed: ${syncResult.error}`);
      setTimeout(() => setDetailError(""), 4000);
      logDebug("stripe sync failed", { error: syncResult.error });
    } else {
      logDebug("stripe sync success", syncResult?.data || {});
    }
  }
};

const exportCsv = () => {
  if (!state.filtered.length) return;
  const rows = [
    [
      "Business",
      "Offer",
      "Uploaded",
      "Receipt total",
      "Commission due",
      "Customer cashback",
      "Status",
    ],
    ...state.filtered.map((receipt) => [
      receipt.business?.name || "",
      receipt.redemption?.offer?.title || "",
      formatDateTime(receipt.uploaded_at),
      (receipt.receipt_total_cents || 0) / 100,
      (receipt.commission_due_cents || 0) / 100,
      calculateCashbackCents(Number(receipt.commission_due_cents) || 0) / 100,
      receipt.review_status || "pending",
    ]),
  ];
  const csv = rows.map((row) => row.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `wello-receipts-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

const attachListeners = () => {
  if (ui.signIn) ui.signIn.addEventListener("click", async () => {
    setAuthError("");
    if (!supabaseClient) {
      setAuthError("Supabase is not configured.");
      return;
    }
    const email = ui.authEmail.value.trim().toLowerCase();
    const password = ui.authPassword.value.trim();
    if (!email || !password) {
      setAuthError("Email and password are required.");
      return;
    }
    ui.signIn.disabled = true;
    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setAuthError(error.message || "Unable to sign in.");
        return;
      }
      if (data?.session) {
        state.session = data.session;
      }
    } finally {
      ui.signIn.disabled = false;
    }
  });

  if (ui.signOut) ui.signOut.addEventListener("click", async () => {
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut({ scope: "local" });
    if (ui.adminUser) ui.adminUser.textContent = "Not signed in";
  });

  if (ui.refresh) ui.refresh.addEventListener("click", async () => {
    await refreshAll({ silent: false });
  });

  if (ui.filterSearch) ui.filterSearch.addEventListener("input", applyFilters);
  if (ui.filterStatus) ui.filterStatus.addEventListener("change", applyFilters);
  if (ui.filterBusiness) ui.filterBusiness.addEventListener("change", applyFilters);
  if (ui.filterStart) ui.filterStart.addEventListener("change", applyFilters);
  if (ui.filterEnd) ui.filterEnd.addEventListener("change", applyFilters);
  if (ui.filterRate) ui.filterRate.addEventListener("input", () => {
    state.defaultRate = Number(ui.filterRate.value) || state.defaultRate;
  });
  if (ui.testBusiness) {
    ui.testBusiness.addEventListener("change", loadTestCharges);
  }
  if (ui.testDate) {
    ui.testDate.addEventListener("change", loadTestCharges);
  }

  if (ui.detailTotal) ui.detailTotal.addEventListener("input", () => {
    const totalCents = parseMoneyToCents(ui.detailTotal.value);
    if (totalCents == null) {
      if (ui.detailCommission) ui.detailCommission.value = "";
      if (ui.detailCashback) ui.detailCashback.value = "";
      return;
    }
    const rate = (Number(ui.filterRate.value) || state.defaultRate) / 100;
    const commissionCents = Math.round(totalCents * rate);
    if (ui.detailCommission) ui.detailCommission.value = (commissionCents / 100).toFixed(2);
    if (ui.detailCashback) ui.detailCashback.value = (calculateCashbackCents(commissionCents) / 100).toFixed(
      2,
    );
  });
  if (ui.detailCommission) ui.detailCommission.addEventListener("input", () => {
    const commissionCents = parseMoneyToCents(ui.detailCommission.value);
    if (commissionCents == null) {
      if (ui.detailCashback) ui.detailCashback.value = "";
      return;
    }
    if (ui.detailCashback) ui.detailCashback.value = (calculateCashbackCents(commissionCents) / 100).toFixed(
      2,
    );
  });

  if (ui.detailSave) ui.detailSave.addEventListener("click", () => saveReceipt());
  if (ui.detailVerify) ui.detailVerify.addEventListener("click", () =>
    saveReceipt({ status: "verified" }),
  );
  if (ui.exportCsv) ui.exportCsv.addEventListener("click", exportCsv);
  if (ui.testCreate) {
    ui.testCreate.addEventListener("click", createTestEvent);
  }
  if (ui.testCharge) {
    ui.testCharge.addEventListener("click", chargeNow);
  }

  if (ui.detailOpen) ui.detailOpen.addEventListener("click", () => {
    openImageModal(ui.detailImage?.src);
  });

  if (ui.imageModalClose) ui.imageModalClose.addEventListener("click", closeImageModal);
  if (ui.imageModal) ui.imageModal.addEventListener("click", (event) => {
    if (event.target === ui.imageModal) {
      closeImageModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      ui.imageModal &&
      !ui.imageModal.classList.contains("is-hidden")
    ) {
      closeImageModal();
    }
  });
};

const init = async () => {
  if (!supabaseClient) {
    setAuthUI(false);
    return;
  }
  attachListeners();
  ui.filterRate.value = state.defaultRate.toFixed(2);
  if (ui.testDate) {
    ui.testDate.value = getDefaultTestDate();
  }
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();
  state.session = session;
  if (!state.session?.access_token) {
    await ensureSession();
  }
  logDebug("init session", {
    hasSession: Boolean(session?.access_token),
    userId: session?.user?.id || null,
  });
  if (session?.user) {
    const ok = await requireStaff();
    if (ok) {
      setAuthUI(true);
      scheduleResume("init");
      didBootResume = true;
    }
  } else {
    setAuthUI(false);
  }

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    logDebug("auth state change", {
      event: _event,
      hasSession: Boolean(session?.access_token),
      userId: session?.user?.id || null,
    });
    // When the tab is backgrounded, browsers may throttle/abort network activity.
    // Avoid kicking off refresh cycles until the page is visible again.
    if (document.hidden) {
      return;
    }
    if (session?.user) {
      // Token refreshes are noisy and don't require a full UI refresh.
      if (_event === "TOKEN_REFRESHED") {
        return;
      }
      // Avoid double-boot refresh: init() already schedules one.
      if (_event === "INITIAL_SESSION" && didBootResume) {
        return;
      }
      const ok = await requireStaff();
      if (ok) {
        setAuthUI(true);
        scheduleResume(`auth:${_event}`);
      }
    } else {
      setAuthUI(false);
      resetDetail();
      stopAutoRefresh();
      stopLiveRefresh();
    }
  });

  document.addEventListener("visibilitychange", () => {
    logDebug("visibilitychange", { hidden: document.hidden });
    if (document.hidden) {
      stopAutoRefresh();
      stopLiveRefresh();
      return;
    }
    scheduleResume("visibilitychange");
  });

  window.addEventListener("focus", () => {
    if (!document.hidden) {
      logDebug("window focus");
      scheduleResume("focus");
    }
  });
};

init();
