const config = window.WELLO_CONFIG || {};
const supabaseUrl = config.supabaseUrl || "";
const supabaseAnonKey = config.supabaseAnonKey || "";

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
  detailStatusSelect: document.getElementById("detail-status-select"),
  detailNotes: document.getElementById("detail-notes"),
  detailSave: document.getElementById("detail-save"),
  detailVerify: document.getElementById("detail-verify"),
  detailError: document.getElementById("detail-error"),
  businessSummary: document.getElementById("business-summary"),
  activitySummary: document.getElementById("activity-summary"),
};

if (!supabaseUrl || !supabaseAnonKey) {
  ui.authError.textContent =
    "Missing Supabase credentials. Set them in admin-config.js.";
}

const supabase =
  supabaseUrl && supabaseAnonKey
    ? window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
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

const setAuthUI = (isSignedIn) => {
  ui.authPanel.classList.toggle("is-hidden", isSignedIn);
  ui.adminPanel.classList.toggle("is-hidden", !isSignedIn);
  ui.signOut.classList.toggle("is-hidden", !isSignedIn);
};

const setAuthError = (message) => {
  ui.authError.textContent = message || "";
};

const setDetailError = (message) => {
  ui.detailError.textContent = message || "";
};

const resetDetail = () => {
  state.selected = null;
  ui.detailContent.classList.add("is-hidden");
  ui.detailEmpty.classList.remove("is-hidden");
  ui.detailImage.removeAttribute("src");
  ui.detailTitle.textContent = "Receipt";
  ui.detailSubtitle.textContent = "";
  updateStatusPill(ui.detailStatus, "pending");
  ui.detailTotal.value = "";
  ui.detailCommission.value = "";
  ui.detailStatusSelect.value = "pending";
  ui.detailNotes.value = "";
  setDetailError("");
};

const requireStaff = async () => {
  if (!supabase) return false;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, full_name, email")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) {
    setAuthError(error?.message || "Unable to verify admin access.");
    await supabase.auth.signOut();
    return false;
  }
  if (!["admin", "supervisor"].includes(data.role)) {
    setAuthError("This account does not have admin access.");
    await supabase.auth.signOut();
    return false;
  }
  state.profile = data;
  ui.adminUser.textContent = data.full_name || data.email || "Admin";
  return true;
};

const loadBusinesses = async () => {
  if (!supabase) return;
  const { data, error } = await supabase
    .from("businesses")
    .select("id, name")
    .order("name");
  if (error) {
    return;
  }
  state.businesses = data || [];
  ui.filterBusiness.innerHTML = `<option value="all">All businesses</option>`;
  state.businesses.forEach((business) => {
    const option = document.createElement("option");
    option.value = business.id;
    option.textContent = business.name;
    ui.filterBusiness.appendChild(option);
  });
};

const loadReceipts = async () => {
  if (!supabase) return;
  const { data, error } = await supabase
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
    .limit(400);
  if (error) {
    ui.receiptsMeta.textContent = error.message || "Unable to load receipts.";
    return;
  }
  state.receipts = data || [];
  applyFilters();
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
      <td><span class="status-pill ${receipt.review_status || "pending"}">${receipt.review_status || "pending"}</span></td>
    `;
    row.addEventListener("click", () => selectReceipt(receipt.id));
    ui.receiptsBody.appendChild(row);
  });
};

const selectReceipt = async (receiptId) => {
  const receipt = state.receipts.find((item) => item.id === receiptId);
  if (!receipt) return;
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
  ui.detailNotes.value = receipt.review_notes || "";
  setDetailError("");
  await loadReceiptImage(receipt);
  renderReceipts();
};

const loadReceiptImage = async (receipt) => {
  ui.detailImage.removeAttribute("src");
  if (!receipt?.storage_path || !supabase) return;
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke("r2-presign", {
      body: {
        action: "download",
        key: receipt.storage_path,
        accessToken: session?.access_token || "",
      },
    });
    if (error || !data?.signedUrl) {
      setDetailError(error?.message || "Unable to load receipt image.");
      return;
    }
    ui.detailImage.src = data.signedUrl;
    ui.detailOpen.onclick = () => window.open(data.signedUrl, "_blank");
  } catch (error) {
    setDetailError(error?.message || "Unable to load receipt image.");
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
    };
    current.count += 1;
    current.gross += receipt.receipt_total_cents || 0;
    current.commission += receipt.commission_due_cents || 0;
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

const saveReceipt = async (options = {}) => {
  const receipt = state.selected;
  if (!receipt || !supabase) return;
  setDetailError("");
  const totalCents = parseMoneyToCents(ui.detailTotal.value);
  let commissionCents = parseMoneyToCents(ui.detailCommission.value);
  if (commissionCents == null && totalCents != null) {
    const rate = Number(ui.filterRate.value || state.defaultRate) / 100;
    commissionCents = Math.round(totalCents * rate);
  }
  const status = options.status || ui.detailStatusSelect.value;
  const notes = ui.detailNotes.value || null;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const updates = {
    receipt_total_cents: totalCents,
    commission_due_cents: commissionCents,
    review_status: status,
    review_notes: notes,
    reviewed_at: new Date().toISOString(),
    reviewed_by: user?.id || null,
  };

  const { data, error } = await supabase
    .from("receipt_uploads")
    .update(updates)
    .eq("id", receipt.id)
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
    .maybeSingle();

  if (error || !data) {
    setDetailError(error?.message || "Unable to save receipt review.");
    return;
  }

  state.receipts = state.receipts.map((item) =>
    item.id === receipt.id ? data : item,
  );
  state.selected = data;
  applyFilters();
  selectReceipt(data.id);
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
      "Status",
    ],
    ...state.filtered.map((receipt) => [
      receipt.business?.name || "",
      receipt.redemption?.offer?.title || "",
      formatDateTime(receipt.uploaded_at),
      (receipt.receipt_total_cents || 0) / 100,
      (receipt.commission_due_cents || 0) / 100,
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
  ui.signIn.addEventListener("click", async () => {
    setAuthError("");
    if (!supabase) {
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
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setAuthError(error.message || "Unable to sign in.");
        return;
      }
    } finally {
      ui.signIn.disabled = false;
    }
  });

  ui.signOut.addEventListener("click", async () => {
    if (!supabase) return;
    await supabase.auth.signOut({ scope: "local" });
    ui.adminUser.textContent = "Not signed in";
  });

  ui.refresh.addEventListener("click", async () => {
    await loadReceipts();
  });

  ui.filterSearch.addEventListener("input", applyFilters);
  ui.filterStatus.addEventListener("change", applyFilters);
  ui.filterBusiness.addEventListener("change", applyFilters);
  ui.filterStart.addEventListener("change", applyFilters);
  ui.filterEnd.addEventListener("change", applyFilters);
  ui.filterRate.addEventListener("input", () => {
    state.defaultRate = Number(ui.filterRate.value) || state.defaultRate;
  });

  ui.detailSave.addEventListener("click", () => saveReceipt());
  ui.detailVerify.addEventListener("click", () =>
    saveReceipt({ status: "verified" }),
  );
  ui.exportCsv.addEventListener("click", exportCsv);
};

const init = async () => {
  if (!supabase) {
    setAuthUI(false);
    return;
  }
  attachListeners();
  ui.filterRate.value = state.defaultRate.toFixed(2);
  const {
    data: { session },
  } = await supabase.auth.getSession();
  state.session = session;
  if (session?.user) {
    const ok = await requireStaff();
    if (ok) {
      setAuthUI(true);
      await loadBusinesses();
      await loadReceipts();
    }
  } else {
    setAuthUI(false);
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    if (session?.user) {
      const ok = await requireStaff();
      if (ok) {
        setAuthUI(true);
        await loadBusinesses();
        await loadReceipts();
      }
    } else {
      setAuthUI(false);
      resetDetail();
    }
  });
};

init();
