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
  detailPromo: document.getElementById("detail-promo"),
  detailPromoHelp: document.getElementById("detail-promo-help"),
  detailCashbackLabel: document.getElementById("detail-cashback-label"),
  detailCashback: document.getElementById("detail-cashback"),
  detailCashbackHelp: document.getElementById("detail-cashback-help"),
  detailSubsidy: document.getElementById("detail-subsidy"),
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
  testPaid: document.getElementById("test-paid"),
  imageModal: document.getElementById("image-modal"),
  imageModalImg: document.getElementById("image-modal-img"),
  imageModalClose: document.getElementById("image-modal-close"),
  promoCode: document.getElementById("promo-code"),
  promoRate: document.getElementById("promo-rate"),
  promoActive: document.getElementById("promo-active"),
  promoStart: document.getElementById("promo-start"),
  promoEnd: document.getElementById("promo-end"),
  promoCreate: document.getElementById("promo-create"),
  promoStatus: document.getElementById("promo-status"),
  promoList: document.getElementById("promo-list"),
  promoPushCode: document.getElementById("promo-push-code"),
  promoPushAudience: document.getElementById("promo-push-audience"),
  promoPushTitle: document.getElementById("promo-push-title"),
  promoPushBody: document.getElementById("promo-push-body"),
  promoPushSend: document.getElementById("promo-push-send"),
  promoPushStatus: document.getElementById("promo-push-status"),
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

// Timeouts: DB calls can be slower than edge invocations (especially on free tiers),
// but we still want a ceiling to avoid "hung tab" behavior.
const DB_TIMEOUT_MS = 45000;
const EDGE_TIMEOUT_MS = 20000;
const REQUEST_TIMEOUT_MS = DB_TIMEOUT_MS;
const PRESIGN_CACHE_MAX_AGE_MS = 8 * 60 * 1000; // keep small; URLs also have their own expiry
const PRESIGN_MAX_CONCURRENT = 2;

const presignCache = new Map(); // cacheKey -> { data, expiresAtMs }
const presignInFlight = new Map(); // cacheKey -> Promise<{data,error}>
const presignQueue = [];
let presignActive = 0;
const presignControllers = new Set();

// Browsers can pause/throttle network and timers heavily when a tab is backgrounded.
// To avoid "stuck" UI actions (save, invoice charge, etc), we attach a shared signal
// to every network request and abort it immediately when the page becomes hidden.
let pageNetworkController = new AbortController();
const getPageNetworkSignal = () => pageNetworkController.signal;
const resetPageNetworkController = () => {
  pageNetworkController = new AbortController();
};
const abortPageNetwork = (reason) => {
  try {
    if (!pageNetworkController.signal.aborted) {
      pageNetworkController.abort(reason || "hidden");
    }
  } catch {
    // ignore
  }
};

const nowMs = () => Date.now();

const cleanupPresignCache = () => {
  const now = nowMs();
  for (const [key, entry] of presignCache.entries()) {
    if (!entry?.expiresAtMs || entry.expiresAtMs <= now) {
      presignCache.delete(key);
    }
  }
};

const abortAllPresigns = (reason) => {
  if (!presignControllers.size) return;
  logDebug("r2-presign abortAll", { reason, count: presignControllers.size });
  for (const controller of presignControllers) {
    try {
      controller.abort();
    } catch {
      // ignore
    }
  }
  presignControllers.clear();
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

const fetchTextWithAbortTimeout = async (url, init, timeoutMs, label) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  presignControllers.add(controller);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return { res, text };
  } catch (error) {
    const message = error?.message || "";
    const aborted =
      error?.name === "AbortError" ||
      message.toLowerCase().includes("aborted") ||
      message.toLowerCase().includes("aborterror");
    if (aborted) {
      const err = new Error(`${label || "request"} aborted`);
      err.name = "AbortError";
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(id);
    presignControllers.delete(controller);
  }
};

const fetchTextWithTimeout = async (url, init, timeoutMs, label) => {
  const controller = new AbortController();
  const pageSignal = getPageNetworkSignal();
  const upstream = init?.signal;

  const signals = [upstream, pageSignal].filter(Boolean);
  const abortHandlers = [];
  for (const s of signals) {
    try {
      if (s.aborted) {
        controller.abort();
        break;
      }
      const handler = () => controller.abort();
      s.addEventListener("abort", handler, { once: true });
      abortHandlers.push([s, handler]);
    } catch {
      // ignore
    }
  }

  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return { res, text };
  } catch (error) {
    const message = error?.message || "";
    const aborted =
      error?.name === "AbortError" ||
      message.toLowerCase().includes("aborted") ||
      message.toLowerCase().includes("aborterror");
    if (aborted) {
      const err = new Error(`${label || "request"} aborted`);
      err.name = "AbortError";
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(id);
    for (const [s, handler] of abortHandlers) {
      try {
        s.removeEventListener("abort", handler);
      } catch {
        // ignore
      }
    }
  }
};

function createTimedFetch(timeoutMs) {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const signal = controller.signal;
    const upstream = init?.signal;
    const pageSignal = getPageNetworkSignal();

    const signals = [upstream, pageSignal].filter(Boolean);
    const abortHandlers = [];
    for (const s of signals) {
      try {
        if (s.aborted) {
          controller.abort();
          break;
        }
        const handler = () => controller.abort();
        s.addEventListener("abort", handler, { once: true });
        abortHandlers.push([s, handler]);
      } catch {
        // ignore
      }
    }

    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal });
    } finally {
      clearTimeout(id);
      for (const [s, handler] of abortHandlers) {
        try {
          s.removeEventListener("abort", handler);
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
          fetch: createTimedFetch(DB_TIMEOUT_MS),
        },
      })
    : null;

const state = {
  session: null,
  profile: null,
  receipts: [],
  filtered: [],
  businesses: [],
  promoCodes: [],
  userPromosById: {},
  selected: null,
  detailDraft: null,
  detailDirty: false,
  defaultRate: 10,
  businessesLoadedAt: 0,
  promoCodesLoadedAt: 0,
};
const imageState = {
  key: null,
  inFlight: false,
  seq: 0,
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

const clearDetailDraft = () => {
  state.detailDirty = false;
  state.detailDraft = null;
};

const setDetailDraftFromUI = () => {
  if (!state.selected?.id) return;
  state.detailDirty = true;
  state.detailDraft = {
    receiptId: state.selected.id,
    total: ui.detailTotal?.value ?? "",
    notes: ui.detailNotes?.value ?? "",
    status: ui.detailStatusSelect?.value ?? "pending",
    updatedAt: nowMs(),
  };
};

const getActiveDetailDraft = (receiptId) => {
  const id = String(receiptId || "").trim();
  if (!id) return null;
  if (!state.detailDirty) return null;
  if (!state.detailDraft?.receiptId) return null;
  return state.detailDraft.receiptId === id ? state.detailDraft : null;
};

const AUTO_REFRESH_MS = 30000;
const LIVE_DEBOUNCE_MS = 1200;
const CASHBACK_BASE_RATE_BPS = 500; // 5% of commission
const MERCHANT_COMMISSION_RATE_BPS = 1000; // 10% of receipt total (merchant cap)

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

const normalizeMaybeArray = (value) =>
  Array.isArray(value) ? value : value ? [value] : [];

const getReceiptCashbackEvent = (receipt) => {
  const events = normalizeMaybeArray(receipt?.cashback_events);
  if (!events.length) return null;
  // Usually 0/1 row; if multiple, prefer available/paid over reversed.
  const ranked = [...events].sort((a, b) => {
    const rank = (status) =>
      status === "paid" ? 3 : status === "available" ? 2 : status === "reversed" ? 1 : 0;
    return rank(b?.status) - rank(a?.status);
  });
  return ranked[0] || null;
};

const calculateCashbackCents = (commissionCents, cashbackRateBps) => {
  const cents = Number(commissionCents) || 0;
  const bps = Number(cashbackRateBps) || CASHBACK_BASE_RATE_BPS;
  if (cents <= 0 || bps <= 0) return 0;
  return Math.round((cents * bps) / 10000);
};

const calculateCommissionCents = (receiptTotalCents) => {
  const cents = Number(receiptTotalCents) || 0;
  if (cents <= 0) return 0;
  return Math.round((cents * MERCHANT_COMMISSION_RATE_BPS) / 10000);
};

const calculatePromoDiscountCents = (receiptTotalCents, promoRateBps) => {
  const cents = Number(receiptTotalCents) || 0;
  const bps = Number(promoRateBps) || 0;
  if (cents <= 0 || bps <= 0) return 0;
  return Math.round((cents * bps) / 10000);
};

const formatRatePct = (bps) => {
  const n = Number(bps) || 0;
  if (!n) return "0.00";
  return (n / 100).toFixed(2);
};

const isPromoActiveAt = (promo, atIso) => {
  if (!promo) return false;
  if (promo.active === false) return false;
  const at = atIso ? new Date(atIso) : new Date();
  if (Number.isNaN(at.getTime())) return false;
  const starts = promo.starts_at ? new Date(promo.starts_at) : null;
  const ends = promo.ends_at ? new Date(promo.ends_at) : null;
  if (starts && !Number.isNaN(starts.getTime()) && at < starts) return false;
  if (ends && !Number.isNaN(ends.getTime()) && at > ends) return false;
  return true;
};

const getUserPromoForId = (userId) => {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  return state.userPromosById?.[uid] || null;
};

const rebuildPromoCodeIndex = () => {
  const list = Array.isArray(state.promoCodes) ? state.promoCodes : [];
  const byId = {};
  for (const promo of list) {
    const id = promo?.id ? String(promo.id) : "";
    if (id) byId[id] = promo;
  }
  state.promoCodesById = byId;
};

const getPromoById = (promoId) => {
  const pid = String(promoId || "").trim();
  if (!pid) return null;
  return state.promoCodesById?.[pid] || null;
};

const getAppliedPromoForReceipt = (receipt) => {
  // Prefer the latest promo record loaded into the admin UI (consistent across renders).
  // Fall back to the embedded join if the promo isn't in the local index (e.g. older promo not in the last 60).
  const promo = getPromoById(receipt?.promo_code_id) || receipt?.applied_promo || null;
  if (!promo?.id) return null;
  return {
    id: String(promo.id),
    code: String(promo.code || "").trim(),
    cashback_rate_bps: Number(promo.cashback_rate_bps) || 0,
    active: promo.active !== false,
    starts_at: promo.starts_at || null,
    ends_at: promo.ends_at || null,
  };
};

const getEffectiveCashbackMetaForReceipt = (receipt) => {
  const cashbackEvent = getReceiptCashbackEvent(receipt);
  const eventRateBps = Number(cashbackEvent?.cashback_rate_bps) || 0;
  const eventPromoCode =
    cashbackEvent?.promo_code?.code
      ? String(cashbackEvent.promo_code.code)
      : cashbackEvent?.promo_code_id
        ? String(getPromoById(cashbackEvent.promo_code_id)?.code || "") || null
        : null;
  if (eventRateBps > 0) {
    return { rateBps: eventRateBps, promoCode: eventPromoCode, source: "event" };
  }

  const userPromo = getUserPromoForId(receipt?.user_id);
  if (userPromo && isPromoActiveAt(userPromo, receipt?.uploaded_at || null)) {
    const rateBps = Number(userPromo.cashback_rate_bps) || CASHBACK_BASE_RATE_BPS;
    const promoCode = userPromo?.code ? String(userPromo.code) : null;
    return { rateBps, promoCode, source: "user_promo" };
  }

  return { rateBps: CASHBACK_BASE_RATE_BPS, promoCode: null, source: "base" };
};

// For receipts being verified "now", promo eligibility should reflect the current time,
// not when the receipt was uploaded.
const getEffectiveCashbackMetaForReceiptAt = (receipt, atIso) => {
  const cashbackEvent = getReceiptCashbackEvent(receipt);
  const eventRateBps = Number(cashbackEvent?.cashback_rate_bps) || 0;
  const eventPromoCode =
    cashbackEvent?.promo_code?.code
      ? String(cashbackEvent.promo_code.code)
      : cashbackEvent?.promo_code_id
        ? String(getPromoById(cashbackEvent.promo_code_id)?.code || "") || null
        : null;
  if (eventRateBps > 0) {
    return { rateBps: eventRateBps, promoCode: eventPromoCode, source: "event" };
  }

  const userPromo = getUserPromoForId(receipt?.user_id);
  if (userPromo && isPromoActiveAt(userPromo, atIso)) {
    const rateBps = Number(userPromo.cashback_rate_bps) || CASHBACK_BASE_RATE_BPS;
    const promoCode = userPromo?.code ? String(userPromo.code) : null;
    return { rateBps, promoCode, source: "user_promo" };
  }

  return { rateBps: CASHBACK_BASE_RATE_BPS, promoCode: null, source: "base" };
};

const getEffectivePromoMetaForReceipt = (receipt) => {
  // Prefer receipt snapshot for "pre-verify clarity". This is what we show to admins.
  const applied = getAppliedPromoForReceipt(receipt);
  if (applied?.id && applied.cashback_rate_bps > 0) {
    return {
      promoId: applied.id,
      promoCode: applied.code || null,
      rateBps: Number(applied.cashback_rate_bps) || 0,
      source: "receipt",
    };
  }
  // Fallback: if an event exists, it is authoritative for already-verified receipts.
  const cashbackEvent = getReceiptCashbackEvent(receipt);
  const eventRateBps = Number(cashbackEvent?.cashback_rate_bps) || 0;
  const eventPromoCode =
    cashbackEvent?.promo_code?.code
      ? String(cashbackEvent.promo_code.code)
      : cashbackEvent?.promo_code_id
        ? String(getPromoById(cashbackEvent.promo_code_id)?.code || "") || null
        : null;
  if (eventPromoCode && eventRateBps > 0) {
    return {
      promoId: cashbackEvent?.promo_code_id ? String(cashbackEvent.promo_code_id) : null,
      promoCode: eventPromoCode,
      rateBps: eventRateBps,
      source: "event",
    };
  }
  return { promoId: null, promoCode: null, rateBps: 0, source: "none" };
};

const userPromoInFlight = new Map(); // userId -> Promise<void>
const loadUserPromoForId = async (userId) => {
  const uid = String(userId || "").trim();
  if (!uid) return;
  if (state.userPromosById?.[uid]) return;
  if (userPromoInFlight.has(uid)) return userPromoInFlight.get(uid);
  if (!supabaseClient) return;

  const task = (async () => {
    try {
      const sp = new URLSearchParams();
      sp.append("select", "id,promo_code:promo_codes(id,code,cashback_rate_bps,active,starts_at,ends_at)");
      sp.append("id", `eq.${uid}`);
      sp.append("limit", "1");
      const result = await postgrestGetJson({
        path: "profiles",
        label: "loadUserPromo",
        timeoutMs: DB_TIMEOUT_MS,
        searchParams: sp,
      });
      const row = result?.data || null;
      const promo = row?.promo_code || null;
      if (!promo?.id) return;
      state.userPromosById = state.userPromosById || {};
      state.userPromosById[uid] = {
        id: String(promo.id),
        code: String(promo.code || "").trim(),
        cashback_rate_bps: Number(promo.cashback_rate_bps) || CASHBACK_BASE_RATE_BPS,
        active: promo.active !== false,
        starts_at: promo.starts_at || null,
        ends_at: promo.ends_at || null,
      };
    } catch (error) {
      // Best-effort only; policies may block reading other users' profiles.
      logDebug("loadUserPromo skipped", { message: error?.message || "unknown" });
    }
  })();

  userPromoInFlight.set(uid, task);
  try {
    await task;
  } finally {
    userPromoInFlight.delete(uid);
  }
};

const callEdgeFunctionJson = async (functionName, body, { timeoutMs, label } = {}) => {
  if (!supabaseClient) {
    return { data: null, error: "Supabase is not configured.", status: null, raw: "" };
  }
  if (document.hidden) {
    return { data: null, error: "Page hidden.", status: null, raw: "" };
  }
  const session = await ensureSession({ force: false });
  const token = session?.access_token || state.session?.access_token || "";
  if (!token) {
    return { data: null, error: "Missing access token.", status: 401, raw: "" };
  }
  const url = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/${functionName}`;
  const { res, text } = await fetchTextWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
        "x-client-info": "wello-admin",
      },
      body: JSON.stringify(body || {}),
    },
    timeoutMs || EDGE_TIMEOUT_MS,
    label || functionName,
  );

  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (res.ok) {
    return { data: parsed, error: null, status: res.status, raw: text };
  }
  return {
    data: null,
    error: parsed?.error || parsed?.message || `Edge function failed (${res.status}).`,
    status: res.status,
    raw: text,
  };
};

const postgrestUpdateReceipt = async ({ receiptId, updates, select }) => {
  const session = await ensureSession({ force: false });
  const token = session?.access_token || state.session?.access_token || "";
  if (!token) {
    return { data: null, error: { message: "Missing access token." } };
  }
  const base = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/receipt_uploads`;
  const query = `id=eq.${encodeURIComponent(receiptId)}&select=${encodeURIComponent(select)}`;
  const url = `${base}?${query}`;

  const { res, text } = await fetchTextWithTimeout(
    url,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/vnd.pgrst.object+json",
        Prefer: "return=representation",
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify(updates || {}),
    },
    DB_TIMEOUT_MS,
    "saveReceipt",
  );

  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (res.ok) {
    return { data: parsed, error: null };
  }
  return {
    data: null,
    error: {
      message: parsed?.message || parsed?.error || `Bad request (${res.status}).`,
      code: parsed?.code || null,
      details: parsed?.details || null,
      hint: parsed?.hint || null,
      status: res.status,
      raw: text,
    },
  };
};

const postgrestGetJson = async ({ path, searchParams, label, timeoutMs }) => {
  const session = await ensureSession({ force: false });
  const token = session?.access_token || state.session?.access_token || "";
  if (!token) {
    return { data: null, error: { message: "Missing access token." } };
  }
  const url = new URL(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/${path.replace(/^\/+/, "")}`);
  if (searchParams) {
    const sp = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams);
    for (const [k, v] of sp.entries()) url.searchParams.append(k, v);
  }

  const { res, text } = await fetchTextWithTimeout(
    url.toString(),
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
    },
    timeoutMs || DB_TIMEOUT_MS,
    label || `GET ${path}`,
  );

  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (res.ok) {
    return { data: parsed, error: null };
  }
  return {
    data: null,
    error: {
      message: parsed?.message || parsed?.error || `Request failed (${res.status}).`,
      code: parsed?.code || null,
      status: res.status,
      raw: text,
    },
  };
};

const postgrestWriteJson = async ({
  path,
  method,
  searchParams,
  body,
  label,
  timeoutMs,
  acceptObject,
}) => {
  const session = await ensureSession({ force: false });
  const token = session?.access_token || state.session?.access_token || "";
  if (!token) {
    return { data: null, error: { message: "Missing access token." } };
  }
  const url = new URL(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/${path.replace(/^\/+/, "")}`);
  if (searchParams) {
    const sp = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams);
    for (const [k, v] of sp.entries()) url.searchParams.append(k, v);
  }

  const { res, text } = await fetchTextWithTimeout(
    url.toString(),
    {
      method: method || "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: acceptObject
          ? "application/vnd.pgrst.object+json"
          : "application/json",
        Prefer: "return=representation",
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify(body || {}),
    },
    timeoutMs || DB_TIMEOUT_MS,
    label || `${method || "POST"} ${path}`,
  );

  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (res.ok) {
    return { data: parsed, error: null };
  }
  return {
    data: null,
    error: {
      message: parsed?.message || parsed?.error || `Request failed (${res.status}).`,
      code: parsed?.code || null,
      status: res.status,
      raw: text,
    },
  };
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

const shouldReloadBusinesses = () => {
  if (!state.businesses?.length) return true;
  const ageMs = nowMs() - (Number(state.businessesLoadedAt) || 0);
  return ageMs > 10 * 60 * 1000; // 10 minutes
};

const shouldReloadPromoCodes = () => {
  if (!state.promoCodes?.length) return true;
  const ageMs = nowMs() - (Number(state.promoCodesLoadedAt) || 0);
  return ageMs > 5 * 60 * 1000; // 5 minutes
};

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
  if (document.hidden) {
    return { data: null, error: "Page hidden." };
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
  const invoke = async () => {
    const url = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/r2-presign`;
    const { res, text } = await fetchTextWithAbortTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: supabaseAnonKey,
          "x-client-info": "wello-admin",
        },
        body: JSON.stringify({ action, key }),
      },
      EDGE_TIMEOUT_MS,
      "r2-presign",
    );
    return { res, text };
  };

  const run = async () => {
    let response = null;
    try {
      const first = await invoke();
      response = first;
      if (!first?.res?.ok) {
        const msg = String(first?.text || "").toLowerCase();
        if (msg.includes("jwt") || msg.includes("authorization")) {
          await ensureSession({ force: true });
          response = await invoke();
        }
      }
    } catch (error) {
      const message = error?.message || "unknown";
      const aborted = error?.name === "AbortError";
      if (aborted && document.hidden) {
        logDebug("r2-presign aborted", { reason: "hidden" });
        return { data: null, error: "aborted_hidden" };
      }
      console.warn("r2-presign exception", message);
      logDebug("r2-presign exception", { message });
      return {
        data: null,
        error: aborted ? "aborted" : message,
      };
    }

    const ok = Boolean(response?.res?.ok);
    let parsedData = null;
    try {
      parsedData = response?.text ? JSON.parse(response.text) : null;
    } catch {
      parsedData = null;
    }

    if (ok) {
      let pathname = null;
      try {
        pathname = parsedData?.signedUrl ? new URL(parsedData.signedUrl).pathname : null;
      } catch {
        pathname = null;
      }
      logDebug("r2-presign success", { action, key, pathname });
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

    const status = response?.res?.status ?? null;
    const raw = response?.text || "";
    const parsed = parsedData;
    console.warn("r2-presign failed", {
      status,
      raw,
    });
    logDebug("r2-presign failed", { status, raw });
    return {
      data: null,
      error:
        parsed?.error ||
        parsed?.message ||
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

const setPromoStatus = (message, isError = false) => {
  if (!ui.promoStatus) return;
  ui.promoStatus.textContent = message || "";
  ui.promoStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
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
  let user = state.session?.user || null;
  if (!user) {
    try {
      const result = await withTimeout(supabaseClient.auth.getUser(), 12000, "getUser");
      user = result?.data?.user || null;
    } catch (error) {
      logDebug("getUser failed", { message: error?.message || "unknown" });
      user = null;
    }
  }
  if (!user) return false;
  const profileResult = await postgrestGetJson({
    path: "profiles",
    label: "requireStaff",
    timeoutMs: DB_TIMEOUT_MS,
    searchParams: new URLSearchParams({
      select: "id,role,full_name,email",
      id: `eq.${user.id}`,
      limit: "1",
    }),
  }).catch((error) => ({ data: null, error: { message: error?.message || "unknown" } }));

  const error = profileResult?.error || null;
  const row = Array.isArray(profileResult?.data) ? profileResult.data[0] : profileResult?.data || null;
  const data = row || null;
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
    const result = await postgrestGetJson({
      path: "businesses",
      label: "loadBusinesses",
      timeoutMs: DB_TIMEOUT_MS,
      searchParams: new URLSearchParams({
        select: "id,name",
        order: "name.asc",
      }),
    });
    data = result?.data ?? null;
    error = result?.error ?? null;
  } catch (err) {
    error = err;
  }
  if (error?.message && error.message.toLowerCase().includes("jwt")) {
    await ensureSession({ force: true });
    try {
      const retry = await postgrestGetJson({
        path: "businesses",
        label: "loadBusinessesRetry",
        timeoutMs: DB_TIMEOUT_MS,
        searchParams: new URLSearchParams({
          select: "id,name",
          order: "name.asc",
        }),
      });
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
  state.businessesLoadedAt = nowMs();
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

const parsePercentToBps = (value) => {
  const raw = Number(String(value || "").trim());
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(raw * 100);
};

const toStartOfDayIso = (dateValue) => {
  const date = String(dateValue || "").trim();
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const toEndOfDayIso = (dateValue) => {
  const date = String(dateValue || "").trim();
  if (!date) return null;
  const parsed = new Date(`${date}T23:59:59.999Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const loadPromoCodes = async () => {
  if (!supabaseClient) return;
  let data = null;
  let error = null;
  try {
    const sp = new URLSearchParams();
    sp.append("select", "id,code,cashback_rate_bps,active,starts_at,ends_at,created_at,updated_at");
    sp.append("order", "created_at.desc");
    sp.append("limit", "60");
    const result = await postgrestGetJson({
      path: "promo_codes",
      label: "loadPromoCodes",
      timeoutMs: DB_TIMEOUT_MS,
      searchParams: sp,
    });
    data = result?.data ?? null;
    error = result?.error ?? null;
  } catch (err) {
    error = err;
  }

  if (error?.message && String(error.message).toLowerCase().includes("jwt")) {
    await ensureSession({ force: true });
    try {
      const sp = new URLSearchParams();
      sp.append("select", "id,code,cashback_rate_bps,active,starts_at,ends_at,created_at,updated_at");
      sp.append("order", "created_at.desc");
      sp.append("limit", "60");
      const retry = await postgrestGetJson({
        path: "promo_codes",
        label: "loadPromoCodesRetry",
        timeoutMs: DB_TIMEOUT_MS,
        searchParams: sp,
      });
      data = retry?.data ?? null;
      error = retry?.error ?? null;
    } catch (err) {
      error = err;
    }
  }

  if (error) {
    const message = error.message || "Unable to load promo codes.";
    const status = Number(error.status) || null;
    const lower = String(message).toLowerCase();
    logDebug("loadPromoCodes error", { message, status });
    // Don't block the dashboard if promo codes aren't available yet.
    if (
      status === 404 ||
      lower.includes("could not find") ||
      lower.includes("promo_codes") ||
      lower.includes("relation") ||
      lower.includes("schema cache")
    ) {
      setPromoStatus(
        "Promo codes are not set up in the database yet. Run migration 20260209_promo_codes.sql.",
        true,
      );
    } else {
      setPromoStatus(message, true);
    }
    return;
  }

  state.promoCodes = Array.isArray(data) ? data : [];
  state.promoCodesLoadedAt = nowMs();
  rebuildPromoCodeIndex();
  setPromoStatus("");
  renderPromoCodes();
};

const createPromoCode = async () => {
  if (!supabaseClient) {
    setPromoStatus("Supabase is not configured.", true);
    return;
  }
  const rawCode = String(ui.promoCode?.value || "").trim();
  const code = rawCode.replace(/\s+/g, "").toUpperCase();
  const bps = parsePercentToBps(ui.promoRate?.value);
  const active = String(ui.promoActive?.value || "true") === "true";
  const startsAt = toStartOfDayIso(ui.promoStart?.value);
  const endsAt = toEndOfDayIso(ui.promoEnd?.value);

  if (!code) {
    setPromoStatus("Enter a promo code.", true);
    return;
  }
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
    setPromoStatus("Promo code must be 3-32 characters (A-Z, 0-9, _ or -).", true);
    return;
  }
  if (!bps) {
    setPromoStatus("Enter a cashback rate greater than 0.", true);
    return;
  }
  if (bps > 5000) {
    setPromoStatus("Cashback rate cannot exceed 50%.", true);
    return;
  }
  if (startsAt && endsAt && String(startsAt) > String(endsAt)) {
    setPromoStatus("Start date must be before end date.", true);
    return;
  }

  setPromoStatus("Creating promo code...");
  if (ui.promoCreate) ui.promoCreate.disabled = true;
  try {
    const { data, error } = await postgrestWriteJson({
      path: "promo_codes",
      method: "POST",
      label: "createPromoCode",
      timeoutMs: DB_TIMEOUT_MS,
      acceptObject: true,
      body: {
        code,
        cashback_rate_bps: bps,
        active,
        starts_at: startsAt,
        ends_at: endsAt,
      },
      searchParams: new URLSearchParams({
        select: "id,code,cashback_rate_bps,active,starts_at,ends_at,created_at,updated_at",
      }),
    });

    if (error) {
      const raw = String(error?.raw || "");
      const msg = String(error?.message || "Unable to create promo code.");
      const lower = `${msg} ${raw}`.toLowerCase();
      if (lower.includes("duplicate") || lower.includes("already")) {
        setPromoStatus("That promo code already exists.", true);
      } else if (
        lower.includes("could not find") ||
        lower.includes("promo_codes") ||
        lower.includes("relation") ||
        lower.includes("schema cache")
      ) {
        setPromoStatus(
          "Promo codes are not set up in the database yet. Run migration 20260209_promo_codes.sql.",
          true,
        );
      } else if (lower.includes("forbidden") || lower.includes("permission")) {
        setPromoStatus("Forbidden. You need an admin account.", true);
      } else {
        setPromoStatus(msg, true);
      }
      return;
    }

    const created = data || null;
    if (created?.id) {
      // Optimistic prepend to avoid waiting on a reload.
      state.promoCodes = [created, ...(Array.isArray(state.promoCodes) ? state.promoCodes : [])];
      state.promoCodesLoadedAt = nowMs();
      rebuildPromoCodeIndex();
      renderPromoCodes();
    } else {
      await loadPromoCodes();
    }

    setPromoStatus(`Promo code created: ${code} (${(bps / 100).toFixed(2)}%).`);
    // Keep the code in the input for easy re-copy; clear dates/rate for speed.
    if (ui.promoRate) ui.promoRate.value = "";
    if (ui.promoStart) ui.promoStart.value = "";
    if (ui.promoEnd) ui.promoEnd.value = "";
  } catch (err) {
    setPromoStatus(err?.message || "Unable to create promo code.", true);
  } finally {
    if (ui.promoCreate) ui.promoCreate.disabled = false;
  }
};

const copyToClipboard = async (text) => {
  const value = String(text || "");
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const input = document.createElement("input");
    input.value = value;
    input.setAttribute("readonly", "true");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(input);
    return ok;
  } catch {
    return false;
  }
};

const updatePromoActive = async ({ promoId, nextActive }) => {
  if (!supabaseClient) return;
  setPromoStatus("Updating promo code...");
  const { data, error } = await postgrestWriteJson({
    path: "promo_codes",
    method: "PATCH",
    label: "updatePromoActive",
    timeoutMs: DB_TIMEOUT_MS,
    acceptObject: true,
    searchParams: new URLSearchParams({
      id: `eq.${promoId}`,
      select: "id,code,cashback_rate_bps,active,starts_at,ends_at,created_at,updated_at",
    }),
    body: { active: Boolean(nextActive) },
  }).catch((err) => ({ data: null, error: { message: err?.message || "unknown" } }));

  if (error) {
    setPromoStatus(error?.message || "Unable to update promo code.", true);
    return;
  }

  const updated = data || null;
  if (updated?.id) {
    state.promoCodes = (Array.isArray(state.promoCodes) ? state.promoCodes : []).map((row) =>
      row.id === updated.id ? updated : row,
    );
    state.promoCodesLoadedAt = nowMs();
    rebuildPromoCodeIndex();
    renderPromoCodes();
    setPromoStatus("");
  } else {
    await loadPromoCodes();
    setPromoStatus("");
  }
};

const setPromoPushStatus = (message, isError = false) => {
  if (!ui.promoPushStatus) return;
  ui.promoPushStatus.textContent = message || "";
  ui.promoPushStatus.classList.toggle("error", Boolean(isError));
};

const sendPromoPush = async () => {
  if (!supabaseClient) {
    setPromoPushStatus("Supabase is not configured.", true);
    return;
  }
  const promoCodeId = String(ui.promoPushCode?.value || "").trim();
  const audience = String(ui.promoPushAudience?.value || "all").trim();
  if (!promoCodeId) {
    setPromoPushStatus("Select a promo code first.", true);
    return;
  }

  const promo = (Array.isArray(state.promoCodes) ? state.promoCodes : []).find(
    (p) => String(p.id) === promoCodeId,
  );
  const code = String(promo?.code || "").trim();
  const rateBps = Number(promo?.cashback_rate_bps) || CASHBACK_BASE_RATE_BPS;
  const ratePct = (rateBps / 100).toFixed(2);

  const titleRaw = String(ui.promoPushTitle?.value || "").trim();
  const bodyRaw = String(ui.promoPushBody?.value || "").trim();
  const title = titleRaw || (code ? `Promo: ${code}` : "Limited-time promo");
  const body =
    bodyRaw ||
    (code
      ? `Use code ${code} to earn ${ratePct}% cashback on verified receipts.`
      : `Open Wello to apply the promo code.`);

  setPromoPushStatus("Sending notification...");
  if (ui.promoPushSend) ui.promoPushSend.disabled = true;
  try {
    const result = await callEdgeFunctionJson(
      "admin-send-promo-push",
      { promoCodeId, audience, title, body },
      { timeoutMs: EDGE_TIMEOUT_MS, label: "sendPromoPush" },
    );
    if (result?.error) {
      setPromoPushStatus(result.error || "Unable to send notification.", true);
      logDebug("promo push failed", { status: result.status, raw: result.raw || "" });
      return;
    }
    const sent = Number(result?.data?.sent) || 0;
    const errors = Number(result?.data?.errors) || 0;
    setPromoPushStatus(
      `Sent to ${sent} device${sent === 1 ? "" : "s"}${errors ? ` (${errors} error${errors === 1 ? "" : "s"})` : ""}.`,
    );
    setTimeout(() => setPromoPushStatus(""), 2500);
  } catch (err) {
    setPromoPushStatus(err?.message || "Unable to send notification.", true);
  } finally {
    if (ui.promoPushSend) ui.promoPushSend.disabled = false;
  }
};

const isMissingRelationshipInSchemaCache = ({ message, parent, child }) => {
  const msg = String(message || "").toLowerCase();
  if (!msg) return false;
  if (!msg.includes("schema cache")) return false;
  if (!msg.includes("could not find a relationship")) return false;
  if (parent && !msg.includes(String(parent).toLowerCase())) return false;
  if (child && !msg.includes(String(child).toLowerCase())) return false;
  return true;
};

const RECEIPTS_SELECT_RICH = [
  "id",
  "storage_path",
  "uploaded_at",
  "user_id",
  "business_id",
  "promo_code_id",
  "receipt_total_cents",
  "commission_due_cents",
  "review_status",
  "review_notes",
  "reviewed_at",
  "applied_promo:promo_codes (id, code, cashback_rate_bps, active, starts_at, ends_at)",
  "cashback_events (amount_cents, status, cashback_rate_bps, cashback_basis, platform_subsidy_cents, promo_code_id, promo_code:promo_codes (id, code, cashback_rate_bps))",
  "business:businesses (id, name)",
  "redemption:redemptions (id, created_at, offer:offers (id, title))",
].join(",");

const RECEIPTS_SELECT_FALLBACK = [
  "id",
  "storage_path",
  "uploaded_at",
  "user_id",
  "business_id",
  "promo_code_id",
  "receipt_total_cents",
  "commission_due_cents",
  "review_status",
  "review_notes",
  "reviewed_at",
  // No applied_promo join here (FK may not exist yet).
  "cashback_events (amount_cents, status, cashback_rate_bps, cashback_basis, platform_subsidy_cents, promo_code_id)",
  "business:businesses (id, name)",
  "redemption:redemptions (id, created_at, offer:offers (id, title))",
].join(",");

const loadReceipts = async () => {
  if (!supabaseClient) return;
  let data = null;
  let error = null;
  try {
    const result = await postgrestGetJson({
      path: "receipt_uploads",
      label: "loadReceipts",
      timeoutMs: DB_TIMEOUT_MS,
      searchParams: new URLSearchParams({
        select: RECEIPTS_SELECT_RICH,
        order: "uploaded_at.desc",
        limit: "400",
      }),
    });
    data = result?.data ?? null;
    error = result?.error ?? null;
  } catch (err) {
    error = err;
  }

  if (
    error?.message &&
    isMissingRelationshipInSchemaCache({
      message: error.message,
      parent: "receipt_uploads",
      child: "promo_codes",
    })
  ) {
    logDebug("loadReceipts fallback (missing receipt_uploads->promo_codes FK)", {
      message: error.message,
    });
    try {
      const fallback = await postgrestGetJson({
        path: "receipt_uploads",
        label: "loadReceiptsFallback",
        timeoutMs: DB_TIMEOUT_MS,
        searchParams: new URLSearchParams({
          select: RECEIPTS_SELECT_FALLBACK,
          order: "uploaded_at.desc",
          limit: "400",
        }),
      });
      data = fallback?.data ?? null;
      error = fallback?.error ?? null;
    } catch (err) {
      error = err;
    }
  }
  if (error?.message && error.message.toLowerCase().includes("jwt")) {
    await ensureSession({ force: true });
    try {
      const retry = await postgrestGetJson({
        path: "receipt_uploads",
        label: "loadReceiptsRetry",
        timeoutMs: DB_TIMEOUT_MS,
        searchParams: new URLSearchParams({
          select: RECEIPTS_SELECT_RICH,
          order: "uploaded_at.desc",
          limit: "400",
        }),
      });
      data = retry?.data ?? null;
      error = retry?.error ?? null;
    } catch (err) {
      error = err;
    }
  }

  if (
    error?.message &&
    isMissingRelationshipInSchemaCache({
      message: error.message,
      parent: "receipt_uploads",
      child: "promo_codes",
    })
  ) {
    logDebug("loadReceipts retry fallback (missing receipt_uploads->promo_codes FK)", {
      message: error.message,
    });
    try {
      const fallback = await postgrestGetJson({
        path: "receipt_uploads",
        label: "loadReceiptsRetryFallback",
        timeoutMs: DB_TIMEOUT_MS,
        searchParams: new URLSearchParams({
          select: RECEIPTS_SELECT_FALLBACK,
          order: "uploaded_at.desc",
          limit: "400",
        }),
      });
      data = fallback?.data ?? null;
      error = fallback?.error ?? null;
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
    // Businesses are relatively static; avoid reloading them on every focus/refresh cycle.
    if (shouldReloadBusinesses()) {
      await loadBusinesses();
    }
    if (shouldReloadPromoCodes()) {
      await loadPromoCodes();
    }
    await loadReceipts();
    if (state.selected?.id) {
      const preserveDraft =
        Boolean(state.detailDirty) &&
        state.detailDraft?.receiptId === state.selected.id;
      if (!preserveDraft) {
        // Preserve any in-progress draft values (even if not marked "dirty" yet) so
        // auto-refresh / tab-focus doesn't wipe what the admin is typing.
        selectReceipt(state.selected.id, {
          preserveDraft: true,
          forceImage: false,
          skipImage: true,
        });
      } else {
        // Do not clobber in-progress edits on auto-refresh/tab focus.
        logDebug("refreshAll skipped selectReceipt (draft dirty)", {
          receiptId: state.selected.id,
        });
      }
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
    const cashbackEvent = getReceiptCashbackEvent(receipt);
    const eventCashbackCents = Number(cashbackEvent?.amount_cents) || 0;

    const totalCents = Number(receipt?.receipt_total_cents) || 0;
    const commissionCents =
      Number(receipt?.commission_due_cents) ||
      (totalCents > 0 ? calculateCommissionCents(totalCents) : 0);

    const promoMeta = getEffectivePromoMetaForReceipt(receipt);
    const promoCode = promoMeta?.promoCode ? String(promoMeta.promoCode) : null;
    const promoRateBps = Number(promoMeta?.rateBps) || 0;
    const hasPromo = Boolean(promoCode) && promoRateBps > 0;
    const canComputePromoCashback = hasPromo && totalCents > 0;

    const estimatedCashbackCents = canComputePromoCashback
      ? calculatePromoDiscountCents(totalCents, promoRateBps)
      : calculateCashbackCents(commissionCents, CASHBACK_BASE_RATE_BPS);

    const cashbackCents = eventCashbackCents || estimatedCashbackCents || 0;
    const displayRateBps = hasPromo ? promoRateBps : CASHBACK_BASE_RATE_BPS;
    const ratePct = displayRateBps ? (displayRateBps / 100).toFixed(2) : null;
    const cashbackTitleParts = [];
    if (promoCode) cashbackTitleParts.push(`Promo ${promoCode}`);
    if (ratePct) {
      if (hasPromo) {
        cashbackTitleParts.push(
          `${ratePct}% of receipt total${totalCents > 0 ? "" : " (enter total to calculate)"}`,
        );
      } else {
        cashbackTitleParts.push(`${ratePct}% of commission`);
      }
    }
    const cashbackTitle = cashbackTitleParts.join(" | ");
    const promoBadge = promoCode
      ? `<span class="promo-pill" title="${escapeHtml(cashbackTitle || "")}">${escapeHtml(promoCode)}${ratePct ? ` ${ratePct}%` : ""}</span>`
      : "";
    const cashbackCell = `<div class="cashback-cell"><span>${formatCurrency(cashbackCents)}</span></div>`;
    const row = document.createElement("tr"); 
    row.dataset.id = receipt.id;
    if (state.selected?.id === receipt.id) {
      row.classList.add("active");
    }
    row.innerHTML = ` 
      <td>${escapeHtml(receipt.business?.name || "--")}</td> 
      <td>
        <div class="offer-cell">
          <span class="offer-title">${escapeHtml(receipt.redemption?.offer?.title || "--")}</span>
          ${promoBadge}
        </div>
      </td> 
      <td>${formatDate(receipt.uploaded_at)}</td> 
      <td>${formatCurrency(receipt.receipt_total_cents)}</td> 
      <td>${formatCurrency(receipt.commission_due_cents)}</td> 
      <td title="${escapeHtml(cashbackTitle)}">${cashbackCell}</td> 
      <td><span class="status-pill ${receipt.review_status || "pending"}">${receipt.review_status || "pending"}</span></td> 
    `; 
    row.addEventListener("click", () => selectReceipt(receipt.id));
    ui.receiptsBody.appendChild(row);
  });
};

const selectReceipt = async (receiptId, options = {}) => {
  const receipt = state.receipts.find((item) => item.id === receiptId);
  if (!receipt) return;
  const seq = (imageState.seq = (imageState.seq || 0) + 1);
  const sameReceipt = state.selected?.id === receiptId;
  const hasImage = Boolean(ui.detailImage.getAttribute("src"));
  closeImageModal();
  if (!sameReceipt) {
    clearDetailDraft();
  }
  const draft =
    sameReceipt && options.preserveDraft ? getActiveDetailDraft(receiptId) : null;
  state.selected = receipt;
  ui.detailEmpty.classList.add("is-hidden");
  ui.detailContent.classList.remove("is-hidden");
  ui.detailTitle.textContent = receipt.business?.name || "Receipt";
  ui.detailSubtitle.textContent = `Uploaded ${formatDateTime(
    receipt.uploaded_at,
  )}`;
  const statusValue = draft?.status || receipt.review_status || "pending";
  updateStatusPill(ui.detailStatus, statusValue);
  ui.detailStatusSelect.value = statusValue;

  const storedTotalCents = Number(receipt?.receipt_total_cents) || 0;
  const draftTotalCents = draft ? parseMoneyToCents(draft.total) : null;
  const totalCents =
    draft && draftTotalCents != null ? draftTotalCents : storedTotalCents;
  ui.detailTotal.value = draft
    ? String(draft.total ?? "")
    : receipt.receipt_total_cents != null
      ? (receipt.receipt_total_cents / 100).toFixed(2)
      : "";

  // Commission is always fixed at 10% of receipt total (merchant is never charged more).
  // We show the computed value even if older rows have an inconsistent stored value.
  const storedCommissionCents = Number(receipt?.commission_due_cents) || 0;
  const computedCommissionCents =
    totalCents > 0 ? calculateCommissionCents(totalCents) : 0;
  const commissionCents =
    totalCents > 0 ? computedCommissionCents : storedCommissionCents;
  ui.detailCommission.value =
    commissionCents > 0 ? (commissionCents / 100).toFixed(2) : "";

  // Promo snapshot is shown pre-verify for clarity/auditability.
  const promoMeta = getEffectivePromoMetaForReceipt(receipt);
  const promoCode = promoMeta?.promoCode ? String(promoMeta.promoCode) : "";
  const promoRateBps = Number(promoMeta?.rateBps) || 0;
  const isPromo = Boolean(promoCode) && promoRateBps > 0;
  if (ui.detailPromo) ui.detailPromo.value = promoCode || "";
  if (ui.detailPromoHelp) {
    if (!promoCode || promoRateBps <= 0) {
      ui.detailPromoHelp.textContent = "No promo applied.";
    } else if (!totalCents) {
      ui.detailPromoHelp.textContent = `${formatRatePct(
        promoRateBps,
      )}% of receipt total (enter a receipt total to calculate).`;
    } else {
      ui.detailPromoHelp.textContent = `${formatRatePct(
        promoRateBps,
      )}% of receipt total. Merchant commission is capped at 10%.`;
    }
  }

  // Cashback/subsidy display:
  // - No promo: cashback = 5% of commission (10% commission).
  // - Promo: cashback = promo % of receipt total; any amount above commission is platform-funded.
  const cashbackEvent = getReceiptCashbackEvent(receipt);
  const eventCashbackCents = Number(cashbackEvent?.amount_cents) || 0;
  const eventSubsidyCents = Number(cashbackEvent?.platform_subsidy_cents) || 0;
  const eventBasis = cashbackEvent?.cashback_basis
    ? String(cashbackEvent.cashback_basis)
    : null;

  const estimatedCashbackCents =
    totalCents > 0
      ? isPromo
        ? calculatePromoDiscountCents(totalCents, promoRateBps)
        : calculateCashbackCents(commissionCents, CASHBACK_BASE_RATE_BPS)
      : 0;
  const cashbackCents = eventCashbackCents || estimatedCashbackCents || 0;
  const subsidyCents = eventCashbackCents
    ? eventSubsidyCents || Math.max(cashbackCents - commissionCents, 0)
    : isPromo
      ? Math.max(cashbackCents - commissionCents, 0)
      : 0;

  ui.detailCashback.value =
    cashbackCents > 0 ? (cashbackCents / 100).toFixed(2) : "";
  if (ui.detailSubsidy) {
    ui.detailSubsidy.value =
      subsidyCents > 0 ? (subsidyCents / 100).toFixed(2) : "";
  }

  if (ui.detailCashbackLabel) {
    if (isPromo) {
      ui.detailCashbackLabel.textContent = `Customer cashback (${formatRatePct(
        promoRateBps,
      )}% of receipt total)`;
    } else {
      ui.detailCashbackLabel.textContent = `Customer cashback (${formatRatePct(
        CASHBACK_BASE_RATE_BPS,
      )}% of commission)`;
    }
  }

  if (ui.detailCashbackHelp) {
    const parts = [];
    if (isPromo) {
      parts.push(
        `Promo: ${promoCode} (${formatRatePct(promoRateBps)}% of receipt total)`,
      );
    } else {
      parts.push(
        `Base cashback: ${formatRatePct(CASHBACK_BASE_RATE_BPS)}% of commission`,
      );
    }
    if (totalCents > 0) {
      parts.push(`Merchant commission: 10% (${formatCurrency(commissionCents)})`);
    }
    if (subsidyCents > 0) {
      parts.push(`Platform subsidy: ${formatCurrency(subsidyCents)}`);
    }
    if (eventCashbackCents > 0) {
      parts.push(eventBasis ? `Recorded (${eventBasis})` : "Recorded");
    } else if (totalCents > 0) {
      parts.push("Estimated");
    }
    if (
      totalCents > 0 &&
      storedCommissionCents > 0 &&
      storedCommissionCents !== computedCommissionCents
    ) {
      parts.push(
        `Stored commission differs (stored ${formatCurrency(
          storedCommissionCents,
        )}, expected ${formatCurrency(computedCommissionCents)})`,
      );
    }
    ui.detailCashbackHelp.textContent = parts.join(" | ");
  }
  ui.detailNotes.value = draft ? String(draft.notes ?? "") : receipt.review_notes || "";
  setDetailError("");
  if (!sameReceipt) {
    ui.detailImage.removeAttribute("src");
    ui.detailOpen.disabled = true;
  }
  if (options.skipImage) {
    // Keep whatever is already on screen. This avoids a burst of presign calls on tab resume.
    ui.detailOpen.disabled = !Boolean(ui.detailImage.getAttribute("src"));
  } else if (!sameReceipt || !hasImage || options.forceImage) {
    await loadReceiptImage(receipt, { seq });
  } else {
    ui.detailOpen.disabled = false;
  }
  renderReceipts();
};

const loadReceiptImage = async (receipt, { seq } = {}) => {
  ui.detailImage.removeAttribute("src");
  ui.detailOpen.disabled = true;
  if (!receipt?.storage_path || !supabaseClient) return;
  // Only allow the most recent selection to win. Older selections should not
  // overwrite the UI when they resolve late.
  const requestSeq = Number(seq) || imageState.seq || 0;

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
    if (requestSeq !== (imageState.seq || 0)) {
      // User selected a different receipt while we were loading; ignore.
      imageState.inFlight = false;
      return;
    }
    const tryLoad = async (signedUrl, attempt) => {
      if (!signedUrl) return false;
      ui.detailImage.src = signedUrl;
      const ok = await withTimeout(
        new Promise((resolve) => {
          const img = ui.detailImage;
          const done = (success) => resolve(Boolean(success));
          const onLoad = () => done(true);
          const onError = () => done(false);
          img.addEventListener("load", onLoad, { once: true });
          img.addEventListener("error", onError, { once: true });
        }),
        12000,
        "imageLoad",
      ).catch(() => false);
      logDebug("receipt image load", {
        attempt,
        ok,
        key: receipt.storage_path,
      });
      return ok;
    };

    let ok = await tryLoad(data.signedUrl, 1);
    if (!ok && requestSeq === (imageState.seq || 0)) {
      // Signed URL may have expired or endpoint may have been misconfigured; re-presign bypassing cache.
      presignCache.delete(`download:${receipt.storage_path}`);
      presignInFlight.delete(`download:${receipt.storage_path}`);
      const retry = await callR2Presign({
        action: "download",
        key: receipt.storage_path,
        accessToken: session.access_token,
      });
      if (retry?.data?.signedUrl) {
        ok = await tryLoad(retry.data.signedUrl, 2);
      }
    }

    ui.detailOpen.disabled = !ok;
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
    const cashbackEvent = getReceiptCashbackEvent(receipt);
    current.cashback += Number(cashbackEvent?.amount_cents) || 0;
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

const formatPromoWindow = (promo) => {
  const start = promo?.starts_at ? new Date(promo.starts_at) : null;
  const end = promo?.ends_at ? new Date(promo.ends_at) : null;
  if (!start && !end) return "No date limits";
  if (start && end) return `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`;
  if (start) return `Starts ${start.toISOString().slice(0, 10)}`;
  return `Ends ${end.toISOString().slice(0, 10)}`;
};

const renderPromoCodes = () => {
  if (!ui.promoList) return;
  ui.promoList.innerHTML = "";
  const promos = Array.isArray(state.promoCodes) ? state.promoCodes : [];
  if (ui.promoPushCode) {
    const selected = String(ui.promoPushCode.value || "");
    ui.promoPushCode.innerHTML = '<option value="">Select a promo code</option>';
    promos.forEach((promo) => {
      const code = String(promo?.code || "").trim();
      if (!code) return;
      const rateBps = Number(promo?.cashback_rate_bps) || CASHBACK_BASE_RATE_BPS;
      const ratePct = (rateBps / 100).toFixed(2);
      const option = document.createElement("option");
      option.value = String(promo.id);
      option.textContent = `${code} (${ratePct}%)`;
      ui.promoPushCode.appendChild(option);
    });
    if (selected) ui.promoPushCode.value = selected;
  }
  if (!promos.length) {
    ui.promoList.innerHTML = '<p class="notice">No promo codes yet.</p>';
    return;
  }

  promos.forEach((promo) => {
    const item = document.createElement("div");
    item.className = "summary-item";
    const rateBps = Number(promo?.cashback_rate_bps) || CASHBACK_BASE_RATE_BPS;
    const ratePct = (rateBps / 100).toFixed(2);
    const active = promo?.active === true;
    const windowText = formatPromoWindow(promo);
    const code = String(promo?.code || "").trim() || "(missing code)";

    const toggleText = active ? "Deactivate" : "Activate";
    const statusText = active ? "Active" : "Inactive";

    item.innerHTML = `
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;">
        <div style="display:grid; gap:4px;">
          <h4 style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <span>${escapeHtml(code)}</span>
            <span class="pill" style="padding:6px 10px; font-size:12px; ${active ? "" : "opacity:0.7;"}">${statusText}</span>
            <span class="pill" style="padding:6px 10px; font-size:12px;">${ratePct}%</span>
          </h4>
          <p>${escapeHtml(windowText)}</p>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <button class="button secondary" data-action="promo-copy" data-id="${promo.id}">Copy</button>
          <button class="button outline" data-action="promo-toggle" data-id="${promo.id}" data-next="${active ? "false" : "true"}">${toggleText}</button>
        </div>
      </div>
    `;
    ui.promoList.appendChild(item);
  });
};

const getDefaultTestDate = () => {
  // Use today's date so the billing period defaults to the current month.
  return new Date().toISOString().slice(0, 10);
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
    if (ui.testPaid) ui.testPaid.textContent = "$0.00";
    return;
  }
  let data = null;
  let error = null;
  try {
    const sp = new URLSearchParams();
    sp.append("select", "amount_cents,status");
    sp.append("business_id", `eq.${businessId}`);
    sp.append("created_at", `gte.${period.start.toISOString()}`);
    sp.append("created_at", `lt.${period.end.toISOString()}`);
    sp.append("status", "in.(pending,invoiced,paid)");
    const result = await postgrestGetJson({
      path: "commission_events",
      label: "loadTestCharges",
      timeoutMs: DB_TIMEOUT_MS,
      searchParams: sp,
    });
    data = result?.data ?? null;
    error = result?.error ?? null;
  } catch (err) {
    error = err;
  }
  if (error?.message && String(error.message).toLowerCase().includes("jwt")) {
    await ensureSession({ force: true });
    try {
      const sp = new URLSearchParams();
      sp.append("select", "amount_cents,status");
      sp.append("business_id", `eq.${businessId}`);
      sp.append("created_at", `gte.${period.start.toISOString()}`);
      sp.append("created_at", `lt.${period.end.toISOString()}`);
      sp.append("status", "in.(pending,invoiced,paid)");
      const retry = await postgrestGetJson({
        path: "commission_events",
        label: "loadTestChargesRetry",
        timeoutMs: DB_TIMEOUT_MS,
        searchParams: sp,
      });
      data = retry?.data ?? null;
      error = retry?.error ?? null;
    } catch (err) {
      error = err;
    }
  }
  if (error) {
    const message = error.message || "Unable to load charges.";
    setTestStatus(message, true);
    logDebug("loadTestCharges error", { message });
    return;
  }
  const rows = data || [];
  const pendingCents = rows
    .filter((row) => row.status === "pending")
    .reduce((sum, row) => sum + (Number(row.amount_cents) || 0), 0);
  const invoicedCents = rows
    .filter((row) => row.status === "invoiced")
    .reduce((sum, row) => sum + (Number(row.amount_cents) || 0), 0);
  const paidCents = rows
    .filter((row) => row.status === "paid")
    .reduce((sum, row) => sum + (Number(row.amount_cents) || 0), 0);
  if (ui.testPending) ui.testPending.textContent = formatCurrency(pendingCents);
  if (ui.testInvoiced) ui.testInvoiced.textContent = formatCurrency(invoicedCents);
  if (ui.testPaid) ui.testPaid.textContent = formatCurrency(paidCents);
};

const runTestInvoice = async ({ businessId, period }) => {
  if (!supabaseClient) {
    setTestStatus("Supabase is not configured.", true);
    return null;
  }
  const result = await callEdgeFunctionJson(
    "admin-run-monthly-invoices",
    {
      businessId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    },
    { timeoutMs: EDGE_TIMEOUT_MS, label: "admin-run-monthly-invoices" },
  ).catch((error) => ({
    data: null,
    error: error?.message || "Unable to run invoice.",
    status: null,
    raw: "",
  }));

  if (!result?.error) {
    return result.data || {};
  }
  setTestStatus(result.error || "Unable to run invoice.", true);
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
  const result = await callEdgeFunctionJson(
    "admin-add-commission-to-stripe",
    {
      businessId,
      redemptionId,
      eventDate: eventDate || null,
    },
    { timeoutMs: EDGE_TIMEOUT_MS, label: "admin-add-commission-to-stripe" },
  ).catch((error) => ({
    data: null,
    error: error?.message || `Unable to sync ${context} to Stripe.`,
    status: null,
    raw: "",
  }));

  if (!result?.error) {
    return { data: result.data || null, error: null };
  }
  return { data: null, error: result.error || `Unable to sync ${context} to Stripe.` };
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
    const response = await callEdgeFunctionJson(
      "admin-create-test-commission",
      {
        businessId,
        amountCents,
        eventDate,
        redemptionId: redemptionId || null,
      },
      { timeoutMs: EDGE_TIMEOUT_MS, label: "admin-create-test-commission" },
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
    const status = response?.status ?? null;
    const raw = response?.raw || "";
    if (status === 409 || String(raw).toLowerCase().includes("already exists")) {
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
      response.error || "Unable to create test event.",
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
  if (ui.detailSave) ui.detailSave.disabled = true;
  if (ui.detailVerify) ui.detailVerify.disabled = true;
  setDetailError("Saving...");
  logDebug("saveReceipt start", { receiptId: receipt.id, status: options.status });

  const status = options.status || ui.detailStatusSelect.value;
  const totalCents = parseMoneyToCents(ui.detailTotal.value);
  const commissionCents =
    totalCents != null && totalCents > 0 ? calculateCommissionCents(totalCents) : null;
  const notes = ui.detailNotes.value || null;

  // Fail-safe validation: you cannot verify without a receipt total.
  if (status === "verified") {
    if (totalCents == null || totalCents <= 0) {
      setDetailError("Enter a receipt total to verify this receipt.");
      if (ui.detailSave) ui.detailSave.disabled = false;
      if (ui.detailVerify) ui.detailVerify.disabled = false;
      return;
    }
  }

  // Keep the UI in sync (commission field is readonly but we set it programmatically).
  if (ui.detailCommission) {
    ui.detailCommission.value =
      commissionCents != null && commissionCents > 0
        ? (commissionCents / 100).toFixed(2)
        : "";
  }

  let userId = null;
  try {
    const userResult = await withTimeout(
      supabaseClient.auth.getUser(),
      12000,
      "getUser",
    );
    userId = userResult?.data?.user?.id || null;
  } catch (err) {
    logDebug("getUser failed", { message: err?.message || "unknown" });
    userId = null;
  }

  const updates = {
    receipt_total_cents: totalCents,
    commission_due_cents: commissionCents,
    review_status: status,
    review_notes: notes,
    reviewed_at: new Date().toISOString(),
    reviewed_by: userId,
  };

  const selectRich = [
    "id",
    "storage_path",
    "uploaded_at",
    "receipt_total_cents",
    "commission_due_cents",
    "promo_code_id",
    "applied_promo:promo_codes (id, code, cashback_rate_bps, active, starts_at, ends_at)",
    "review_status",
    "review_notes",
    "reviewed_at",
    "business:businesses (id, name)",
    "redemption:redemptions (id, created_at, offer:offers (id, title))",
    "cashback_events:cashback_events (id, amount_cents, cashback_rate_bps, cashback_basis, platform_subsidy_cents, promo_code_id, status, promo_code:promo_codes (id, code, cashback_rate_bps))",
  ].join(",");

  const selectFallback = [
    "id",
    "storage_path",
    "uploaded_at",
    "receipt_total_cents",
    "commission_due_cents",
    "promo_code_id",
    "review_status",
    "review_notes",
    "reviewed_at",
    "business:businesses (id, name)",
    "redemption:redemptions (id, created_at, offer:offers (id, title))",
    "cashback_events:cashback_events (id, amount_cents, cashback_rate_bps, cashback_basis, platform_subsidy_cents, promo_code_id, status)",
  ].join(",");

  try {
    console.log("Saving receipt review", { receiptId: receipt.id, updates });

    let result = await postgrestUpdateReceipt({
      receiptId: receipt.id,
      updates,
      select: selectRich,
    });

    // Retry once on JWT-ish errors by forcing a session refresh.
    const msg = String(result?.error?.message || "").toLowerCase();
    if (result?.error && (msg.includes("jwt") || msg.includes("authorization"))) {
      await ensureSession({ force: true });
      result = await postgrestUpdateReceipt({
        receiptId: receipt.id,
        updates,
        select: selectRich,
      });
    }

    let data = result?.data || null;
    let error = result?.error || null;

    const message = String(error?.message || "").toLowerCase();
    const isReceiptPromoJoinMissing = isMissingRelationshipInSchemaCache({
      message: error?.message || "",
      parent: "receipt_uploads",
      child: "promo_codes",
    });
    const isSchemaCacheError =
      message.includes("schema cache") ||
      String(error?.code || "").toLowerCase().includes("pgrst") ||
      message.includes("could not find the") ||
      (message.includes("column") && message.includes("receipt_uploads"));

    if (error && isReceiptPromoJoinMissing) {
      logDebug("saveReceipt fallback select (missing receipt_uploads->promo_codes FK)", {
        message: error.message,
      });
      const second = await postgrestUpdateReceipt({
        receiptId: receipt.id,
        updates,
        select: selectFallback,
      });
      data = second?.data || null;
      error = second?.error || null;
    }

    if (error && isSchemaCacheError) {
      const retryUpdates = { ...updates };
      const maybeStrip = (col) => {
        if (message.includes(`'${col}'`) || message.includes(` ${col} `) || message.includes(col)) {
          delete retryUpdates[col];
        }
      };
      maybeStrip("reviewed_by");
      maybeStrip("reviewed_at");
      maybeStrip("review_notes");
      const second = await postgrestUpdateReceipt({
        receiptId: receipt.id,
        updates: retryUpdates,
        select: isReceiptPromoJoinMissing ? selectFallback : selectRich,
      });
      data = second?.data || null;
      error = second?.error || null;
    }

    if (error || !data) {
      const raw = {
        message: error?.message || "unknown",
        code: error?.code || null,
        details: error?.details || null,
        hint: error?.hint || null,
      };
      throw Object.assign(new Error(raw.message), raw);
    }

    console.log("Receipt review saved", data);
    logDebug("saveReceipt success", { receiptId: data.id });

    state.receipts = state.receipts.map((item) =>
      item.id === receipt.id ? data : item,
    );
    state.selected = data;
    clearDetailDraft();
    applyFilters();
    selectReceipt(data.id);
    setDetailError("Saved.");
    setTimeout(() => setDetailError(""), 2000);

    if (status === "verified" && (Number(commissionCents) || 0) > 0) {
      const syncResult = await addCommissionToStripe({
        businessId: data.business?.id,
        redemptionId: data.redemption?.id,
        eventDate: data.reviewed_at || data.uploaded_at,
      }).catch((err) => ({ data: null, error: err?.message || "Stripe sync failed." }));

      if (syncResult?.error) {
        setDetailError(`Saved, but Stripe sync failed: ${syncResult.error}`);
        setTimeout(() => setDetailError(""), 4000);
        logDebug("stripe sync failed", { error: syncResult.error });
      } else {
        logDebug("stripe sync success", syncResult?.data || {});
      }
    }
  } catch (err) {
    const aborted = err?.name === "AbortError";
    const raw = {
      message: err?.message || "unknown",
      code: err?.code || null,
      details: err?.details || null,
      hint: err?.hint || null,
      aborted: Boolean(aborted),
    };
    console.warn("saveReceipt failed", raw);
    logDebug("saveReceipt failed", raw);
    setDetailError(
      aborted ? "Cancelled (tab was backgrounded). Try again." : raw.message,
    );
  } finally {
    if (ui.detailSave) ui.detailSave.disabled = false;
    if (ui.detailVerify) ui.detailVerify.disabled = false;
    logDebug("saveReceipt end", { receiptId: receipt.id });
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
      (Number(getReceiptCashbackEvent(receipt)?.amount_cents) || 0) / 100,
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
  if (ui.testBusiness) {
    ui.testBusiness.addEventListener("change", loadTestCharges);
  }
  if (ui.testDate) {
    ui.testDate.addEventListener("change", loadTestCharges);
  }

  if (ui.detailTotal) ui.detailTotal.addEventListener("input", () => {
    setDetailDraftFromUI();
    const totalCents = parseMoneyToCents(ui.detailTotal.value);
    const selected = state.selected;
    const promoMeta = selected
      ? getEffectivePromoMetaForReceipt(selected)
      : { promoId: null, promoCode: null, rateBps: 0, source: "none" };
    const promoCode = promoMeta?.promoCode ? String(promoMeta.promoCode) : "";
    const promoRateBps = Number(promoMeta?.rateBps) || 0;

    if (ui.detailPromo) ui.detailPromo.value = promoCode || "";
    if (ui.detailPromoHelp) {
      if (!promoCode || promoRateBps <= 0) {
        ui.detailPromoHelp.textContent = "No promo applied.";
      } else if (totalCents == null || totalCents <= 0) {
        ui.detailPromoHelp.textContent = `${formatRatePct(
          promoRateBps,
        )}% of receipt total (enter a receipt total to calculate).`;
      } else {
        ui.detailPromoHelp.textContent = `${formatRatePct(
          promoRateBps,
        )}% of receipt total. Merchant commission is capped at 10%.`;
      }
    }

    if (totalCents == null) {
      if (ui.detailCommission) ui.detailCommission.value = "";
      if (ui.detailCashback) ui.detailCashback.value = "";
      if (ui.detailSubsidy) ui.detailSubsidy.value = "";
      return;
    }

    const commissionCents = calculateCommissionCents(totalCents);
    // Promo eligibility is independent of whether a total has been entered.
    // The total only affects whether we can compute the promo cashback amount.
    const isPromo = Boolean(promoCode) && promoRateBps > 0;
    if (ui.detailCommission) ui.detailCommission.value = (commissionCents / 100).toFixed(2);
    if (ui.detailCashback) {
      const cashbackCents = isPromo
        ? calculatePromoDiscountCents(totalCents, promoRateBps)
        : calculateCashbackCents(commissionCents, CASHBACK_BASE_RATE_BPS);
      ui.detailCashback.value = cashbackCents > 0 ? (cashbackCents / 100).toFixed(2) : "";
    }
    if (ui.detailSubsidy) {
      const cashbackCents = isPromo
        ? calculatePromoDiscountCents(totalCents, promoRateBps)
        : calculateCashbackCents(commissionCents, CASHBACK_BASE_RATE_BPS);
      const subsidyCents = isPromo ? Math.max(cashbackCents - commissionCents, 0) : 0;
      ui.detailSubsidy.value = subsidyCents > 0 ? (subsidyCents / 100).toFixed(2) : "";
    }
    if (ui.detailCashbackHelp) {
      const cashbackCents = isPromo
        ? calculatePromoDiscountCents(totalCents, promoRateBps)
        : calculateCashbackCents(commissionCents, CASHBACK_BASE_RATE_BPS);
      const subsidyCents = isPromo ? Math.max(cashbackCents - commissionCents, 0) : 0;
      const parts = [];
      if (isPromo) {
        parts.push(
          `Promo: ${promoCode} (${formatRatePct(promoRateBps)}% of receipt total)`,
        );
      } else {
        parts.push(
          `Base cashback: ${formatRatePct(CASHBACK_BASE_RATE_BPS)}% of commission`,
        );
      }
      parts.push(`Merchant commission: 10% (${formatCurrency(commissionCents)})`);
      if (subsidyCents > 0) parts.push(`Platform subsidy: ${formatCurrency(subsidyCents)}`);
      parts.push("Estimated");
      ui.detailCashbackHelp.textContent = parts.join(" | ");
    }
    if (ui.detailCashbackLabel) {
      if (isPromo) {
        ui.detailCashbackLabel.textContent = `Customer cashback (${formatRatePct(
          promoRateBps,
        )}% of receipt total)`;
      } else {
        ui.detailCashbackLabel.textContent = `Customer cashback (${formatRatePct(
          CASHBACK_BASE_RATE_BPS,
        )}% of commission)`;
      }
    }
  });

  if (ui.detailNotes) ui.detailNotes.addEventListener("input", () => {
    setDetailDraftFromUI();
  });

  if (ui.detailStatusSelect) ui.detailStatusSelect.addEventListener("change", () => {
    setDetailDraftFromUI();
    updateStatusPill(ui.detailStatus, ui.detailStatusSelect.value);
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

  if (ui.promoCreate) {
    ui.promoCreate.addEventListener("click", createPromoCode);
  }
  if (ui.promoPushSend) {
    ui.promoPushSend.addEventListener("click", sendPromoPush);
  }
  if (ui.promoList) {
    ui.promoList.addEventListener("click", async (event) => {
      const button = event?.target?.closest?.("button[data-action]");
      if (!button) return;
      const action = button.getAttribute("data-action") || "";
      const promoId = button.getAttribute("data-id") || "";
      if (!promoId) return;

      if (action === "promo-copy") {
        const promo = (Array.isArray(state.promoCodes) ? state.promoCodes : []).find(
          (row) => row.id === promoId,
        );
        const ok = await copyToClipboard(promo?.code || "");
        setPromoStatus(ok ? "Copied promo code." : "Unable to copy promo code.", !ok);
        if (ok) setTimeout(() => setPromoStatus(""), 1200);
        return;
      }

      if (action === "promo-toggle") {
        const next = button.getAttribute("data-next");
        const nextActive = String(next) === "true";
        await updatePromoActive({ promoId, nextActive });
      }
    });
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
  // Commission is fixed at 10% (admin UI no longer supports changing it).
  if (ui.filterRate) {
    ui.filterRate.value = (MERCHANT_COMMISSION_RATE_BPS / 100).toFixed(2);
    ui.filterRate.disabled = true;
  }
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
      abortAllPresigns("hidden");
      abortPageNetwork("hidden");
      stopAutoRefresh();
      stopLiveRefresh();
      return;
    }
    // Ensure future requests don't inherit an already-aborted page signal.
    if (getPageNetworkSignal().aborted) {
      resetPageNetworkController();
    }
    scheduleResume("visibilitychange");
  });

  window.addEventListener("focus", () => {
    if (!document.hidden) {
      logDebug("window focus");
      if (getPageNetworkSignal().aborted) {
        resetPageNetworkController();
      }
      scheduleResume("focus");
    }
  });
};

init();
