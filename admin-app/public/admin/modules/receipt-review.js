import { createSectionHeader, mapStatusBadge } from "./helpers.js";
import {
  formatCurrencyFromCents,
  formatDateTime,
  dollarsFromCents,
  centsFromDollars,
  escapeHtml,
} from "../lib/format.js";
import { renderPagination } from "../components/pagination.js";
import { debounce } from "../lib/http.js";

const PAGE_SIZE = 30;
const RECEIPT_BUCKET_CANDIDATES = ["receipt-images", "receipt_uploads", "receipts"];
const RECEIPT_SIGNED_URL_TTL_MS = 30 * 60 * 1000;
const RECEIPT_SIGNED_URL_REFRESH_BUFFER_MS = 90 * 1000;

const receiptImageCache = new Map();
const receiptImageInflight = new Map();

const safeDecode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return String(value || "");
  }
};

const splitStoragePath = (storagePath) => {
  const raw = String(storagePath || "").trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    const fromStorageApi = raw.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/i);
    if (fromStorageApi) {
      return {
        directUrl: "",
        bucket: safeDecode(fromStorageApi[1]),
        objectPath: safeDecode(fromStorageApi[2]),
      };
    }
    return { directUrl: raw, bucket: "", objectPath: "" };
  }

  let normalized = raw.replace(/^\/+/, "");
  const fromPublicPrefix = normalized.match(/^public\/([^/]+)\/(.+)$/i);
  if (fromPublicPrefix) {
    normalized = `${fromPublicPrefix[1]}/${fromPublicPrefix[2]}`;
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return {
      directUrl: "",
      bucket: parts[0],
      objectPath: parts.slice(1).join("/"),
    };
  }

  return {
    directUrl: "",
    bucket: "",
    objectPath: normalized,
  };
};

const buildStorageTargets = (parsed) => {
  const targets = [];
  const seen = new Set();

  const add = (bucket, objectPath) => {
    const cleanBucket = String(bucket || "").trim();
    const cleanPath = String(objectPath || "").trim().replace(/^\/+/, "");
    if (!cleanBucket || !cleanPath) return;
    const key = `${cleanBucket}/${cleanPath}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ bucket: cleanBucket, path: cleanPath });
  };

  if (parsed?.bucket && parsed?.objectPath) add(parsed.bucket, parsed.objectPath);

  const fallbackPath = parsed?.objectPath || "";
  if (fallbackPath) {
    RECEIPT_BUCKET_CANDIDATES.forEach((bucket) => add(bucket, fallbackPath));
  }

  return targets;
};

const resolveReceiptImage = async (runtime, storagePath) => {
  const normalizedRawPath = String(storagePath || "").trim().replace(/^\/+/, "");
  if (!normalizedRawPath) {
    return {
      signedUrl: "",
      resolvedPath: "",
      resolvedBucket: "",
      errorReason: "Missing receipt path.",
    };
  }

  const cached = receiptImageCache.get(normalizedRawPath);
  if (cached && cached.expiresAt > Date.now() + RECEIPT_SIGNED_URL_REFRESH_BUFFER_MS) {
    return cached.result;
  }

  if (receiptImageInflight.has(normalizedRawPath)) {
    return receiptImageInflight.get(normalizedRawPath);
  }

  const task = (async () => {
    if (normalizedRawPath.startsWith("receipts/")) {
      const r2Result = await runtime.client.storage
        .from("__r2__")
        .createSignedUrl(normalizedRawPath, 60 * 30);
      if (!r2Result?.error && r2Result?.data?.signedUrl) {
        const result = {
          signedUrl: r2Result.data.signedUrl,
          resolvedPath: normalizedRawPath,
          resolvedBucket: "r2",
          errorReason: "",
        };
        receiptImageCache.set(normalizedRawPath, {
          expiresAt: Date.now() + RECEIPT_SIGNED_URL_TTL_MS,
          result,
        });
        return result;
      }
    }

    const parsed = splitStoragePath(storagePath);
    if (!parsed) {
      return {
        signedUrl: "",
        resolvedPath: "",
        resolvedBucket: "",
        errorReason: "Missing receipt path.",
      };
    }

    if (parsed.directUrl) {
      const result = {
        signedUrl: parsed.directUrl,
        resolvedPath: parsed.directUrl,
        resolvedBucket: "external",
        errorReason: "",
      };
      receiptImageCache.set(normalizedRawPath, {
        expiresAt: Date.now() + RECEIPT_SIGNED_URL_TTL_MS,
        result,
      });
      return result;
    }

    const targets = buildStorageTargets(parsed);
    let lastError = "";
    for (const target of targets) {
      const result = await runtime.client.storage.from(target.bucket).createSignedUrl(target.path, 60 * 30);
      if (!result?.error && result?.data?.signedUrl) {
        const resolved = {
          signedUrl: result.data.signedUrl,
          resolvedPath: target.path,
          resolvedBucket: target.bucket,
          errorReason: "",
        };
        receiptImageCache.set(normalizedRawPath, {
          expiresAt: Date.now() + RECEIPT_SIGNED_URL_TTL_MS,
          result: resolved,
        });
        return resolved;
      }
      if (result?.error?.message) {
        lastError = result.error.message;
      }
    }

    const unresolved = {
      signedUrl: "",
      resolvedPath: parsed.objectPath || "",
      resolvedBucket: parsed.bucket || "",
      errorReason: lastError || "No readable image in configured receipt stores.",
    };
    receiptImageCache.set(normalizedRawPath, {
      expiresAt: Date.now() + 30 * 1000,
      result: unresolved,
    });
    return unresolved;
  })();

  receiptImageInflight.set(normalizedRawPath, task);
  try {
    return await task;
  } finally {
    receiptImageInflight.delete(normalizedRawPath);
  }
};

const renderDetailPlaceholder = (container, message) => {
  if (!container) return;
  container.innerHTML = `<div class="admin-empty receipt-review-empty">${escapeHtml(message)}</div>`;
};

const getPromoMeta = (detail) => {
  const directPromo = detail?.promo_code;
  if (directPromo?.code) {
    return {
      code: String(directPromo.code),
      rateBps: Number(directPromo.cashback_rate_bps || 0),
      source: "receipt",
    };
  }

  const cashbackEvent = Array.isArray(detail?.cashback_events)
    ? detail.cashback_events.find((row) => row?.promo_code?.code || row?.promo_code_id)
    : null;

  if (cashbackEvent?.promo_code?.code) {
    return {
      code: String(cashbackEvent.promo_code.code),
      rateBps: Number(cashbackEvent.promo_code.cashback_rate_bps || cashbackEvent.cashback_rate_bps || 0),
      source: "cashback_event",
    };
  }

  return { code: null, rateBps: 0, source: "none" };
};

const receiptIsLocked = (detail) => {
  const commissionEvents = Array.isArray(detail?.redemption?.commission_events)
    ? detail.redemption.commission_events
    : [];
  const cashbackEvents = Array.isArray(detail?.cashback_events)
    ? detail.cashback_events
    : [];

  const commissionLocked = commissionEvents.some((row) => {
    const status = String(row?.status || "").toLowerCase();
    return status === "invoiced" || status === "paid";
  });

  const cashbackLocked = cashbackEvents.some((row) => String(row?.status || "").toLowerCase() === "paid");
  return commissionLocked || cashbackLocked;
};

const renderReceiptsTable = ({ container, rows, selectedId, onRowSelect }) => {
  if (!container) return;

  if (!rows.length) {
    container.innerHTML = "<div class='admin-empty'>No receipts match current filters.</div>";
    return;
  }

  container.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Business</th>
          <th>Offer</th>
          <th>Uploaded</th>
          <th>Total</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
          <tr data-row-id="${escapeHtml(row.id)}" class="${row.id === selectedId ? "is-selected" : ""}">
            <td>${escapeHtml(row.business?.name || "--")}</td>
            <td>${escapeHtml(row.redemption?.offer?.title || "--")}</td>
            <td>${escapeHtml(formatDateTime(row.uploaded_at))}</td>
            <td>${escapeHtml(formatCurrencyFromCents(row.receipt_total_cents || 0))}</td>
            <td>${mapStatusBadge(row.review_status)}</td>
          </tr>
        `,
          )
          .join("")}
      </tbody>
    </table>
  `;

  container.querySelectorAll("tr[data-row-id]").forEach((rowEl) => {
    rowEl.addEventListener("click", () => {
      const id = rowEl.getAttribute("data-row-id");
      if (id) onRowSelect(id);
    });
  });
};

export const receiptReviewModule = {
  key: "receipt-review",
  label: "Receipt Review",
  async mount(ctx) {
    const { content, runtime, toast } = ctx;

    const state = {
      page: 0,
      rows: [],
      selectedId: null,
      businesses: [],
      filters: {
        search: "",
        status: "pending",
        businessId: "all",
        startDate: "",
        endDate: "",
      },
      detail: null,
      image: null,
      detailRequestId: 0,
      previewRequestId: 0,
      preview: null,
      previewLoading: false,
      previewError: "",
      editMode: false,
      imageExpanded: false,
      imageZoomMode: "fit",
    };

    content.innerHTML = `
      ${createSectionHeader({
        title: "Receipt review",
        subtitle: "One-click decisions with live payout/commission preview.",
        actions: `<button class="button secondary" id="rr-refresh">Refresh</button>`,
      })}
      <section class="panel-card sticky-filters">
        <div class="filters-grid">
          <label class="field"><span>Search</span><input id="rr-search" type="search" placeholder="Receipt id or notes" /></label>
          <label class="field"><span>Status</span><select id="rr-status"><option value="all">All</option><option value="pending" selected>Pending</option><option value="verified">Verified</option><option value="rejected">Rejected</option></select></label>
          <label class="field"><span>Business</span><select id="rr-business"><option value="all">All businesses</option></select></label>
          <label class="field"><span>From</span><input id="rr-start" type="date" /></label>
          <label class="field"><span>To</span><input id="rr-end" type="date" /></label>
        </div>
      </section>
      <section class="receipt-review-layout">
        <section class="panel-card receipt-review-table-panel">
          <div class="panel-card-header"><h3>Queue</h3><p class="notice" id="rr-meta"></p></div>
          <div id="rr-table"></div>
          <div id="rr-pagination"></div>
        </section>
        <aside class="panel-card receipt-review-detail-panel">
          <div class="panel-card-header"><h3>Receipt details</h3></div>
          <div id="rr-detail"></div>
        </aside>
      </section>
    `;

    const tableContainer = content.querySelector("#rr-table");
    const paginationContainer = content.querySelector("#rr-pagination");
    const meta = content.querySelector("#rr-meta");
    const detailContainer = content.querySelector("#rr-detail");

    let previewTimer = null;

    const clearPreviewTimer = () => {
      if (previewTimer) {
        clearTimeout(previewTimer);
        previewTimer = null;
      }
    };

    const loadBusinesses = async () => {
      const { data, error } = await runtime.client
        .from("businesses")
        .select("id,name")
        .order("name", { ascending: true })
        .limit(300);
      if (error) throw error;
      state.businesses = data || [];

      const select = content.querySelector("#rr-business");
      select.innerHTML = '<option value="all">All businesses</option>';
      state.businesses.forEach((row) => {
        const option = document.createElement("option");
        option.value = row.id;
        option.textContent = row.name;
        select.appendChild(option);
      });
    };

    const loadList = async () => {
      const params = new URLSearchParams({
        page: String(state.page),
        pageSize: String(PAGE_SIZE),
      });
      if (state.filters.status !== "all") params.set("status", state.filters.status);
      if (state.filters.businessId !== "all") params.set("businessId", state.filters.businessId);
      if (state.filters.startDate) params.set("startDate", state.filters.startDate);
      if (state.filters.endDate) params.set("endDate", state.filters.endDate);
      if (state.filters.search) params.set("search", state.filters.search);

      const { data, error } = await runtime.apiRequest(`/api/admin/receipts?${params.toString()}`);
      if (error) throw error;
      state.rows = Array.isArray(data) ? data : [];

      if (!state.rows.length) {
        state.selectedId = null;
      } else if (!state.rows.some((row) => row.id === state.selectedId)) {
        state.selectedId = state.rows[0].id;
      }

      const handleRowSelect = async (id) => {
        state.selectedId = id;
        state.editMode = false;
        state.imageExpanded = false;
        state.imageZoomMode = "fit";
        state.preview = null;
        state.previewError = "";
        state.previewLoading = false;

        renderReceiptsTable({
          container: tableContainer,
          rows: state.rows,
          selectedId: state.selectedId,
          onRowSelect: handleRowSelect,
        });
        await loadDetail(id);
        await renderDetail();
      };

      meta.textContent = `${state.rows.length} receipt${state.rows.length === 1 ? "" : "s"} loaded`;
      renderReceiptsTable({
        container: tableContainer,
        rows: state.rows,
        selectedId: state.selectedId,
        onRowSelect: handleRowSelect,
      });

      renderPagination({
        container: paginationContainer,
        page: state.page,
        pageSize: PAGE_SIZE,
        rowCount: state.rows.length,
        onPageChange: async (nextPage) => {
          state.page = nextPage;
          await refresh();
        },
      });

      const prefetchRows = state.rows.slice(0, Math.min(6, state.rows.length));
      Promise.allSettled(prefetchRows.map((item) => resolveReceiptImage(runtime, item.storage_path)));
    };

    const loadDetail = async (id) => {
      if (!id) {
        state.detail = null;
        state.image = null;
        return;
      }

      const requestId = ++state.detailRequestId;
      const { data, error } = await runtime.apiRequest(`/api/admin/receipts/${encodeURIComponent(id)}/detail`);
      if (requestId !== state.detailRequestId) return;
      if (error) throw error;

      state.detail = data || null;
      state.image = await resolveReceiptImage(runtime, state.detail?.storage_path || "");

      if (requestId !== state.detailRequestId) return;

      const detailStatus = String(state.detail?.review_status || "").toLowerCase();
      if (detailStatus === "pending") {
        const cents = Number(state.detail?.receipt_total_cents || 0);
        if (cents > 0) {
          await runPreview(cents);
        } else {
          state.preview = null;
          state.previewError = "";
          state.previewLoading = false;
        }
      }
    };

    const runPreview = async (totalCents) => {
      const detail = state.detail;
      if (!detail?.id) return;
      if (!Number.isFinite(totalCents) || totalCents <= 0) {
        state.preview = null;
        state.previewError = "";
        state.previewLoading = false;
        await renderDetail();
        return;
      }

      const requestId = ++state.previewRequestId;
      state.previewLoading = true;
      state.previewError = "";
      await renderDetail();

      const { data, error } = await runtime.apiRequest(`/api/admin/receipts/${encodeURIComponent(detail.id)}/preview`, {
        method: "POST",
        body: {
          receiptTotalCents: Math.trunc(totalCents),
        },
      });

      if (requestId !== state.previewRequestId) return;

      state.previewLoading = false;
      if (error) {
        state.preview = null;
        state.previewError = error.message || "Unable to calculate preview.";
      } else {
        state.preview = data || null;
        state.previewError = "";
      }
      await renderDetail();
    };

    const schedulePreview = (totalInput) => {
      clearPreviewTimer();
      const cents = centsFromDollars(totalInput);
      previewTimer = setTimeout(async () => {
        await runPreview(cents);
      }, 150);
    };

    const isDecisionEditable = () => {
      if (!state.detail) return false;
      const status = String(state.detail.review_status || "").toLowerCase();
      if (status === "pending") return true;
      if (status === "verified" && state.editMode && !receiptIsLocked(state.detail)) return true;
      return false;
    };

    const applyDecision = async ({ action, totalCents, notes, expectedStatus, expectedReviewedAt }) => {
      if (!state.detail?.id) return;

      const { data, error } = await runtime.apiRequest(`/api/admin/receipts/${encodeURIComponent(state.detail.id)}/decision`, {
        method: "POST",
        body: {
          action,
          receiptTotalCents: totalCents,
          reviewNotes: notes,
          expectedStatus,
          expectedReviewedAt,
        },
      });

      if (error) throw error;
      return data;
    };

    const refresh = async () => {
      await loadList();
      if (state.selectedId) {
        await loadDetail(state.selectedId);
      } else {
        state.detail = null;
        state.image = null;
      }
      await renderDetail();
    };

    const triggerDecision = async (action) => {
      try {
        const detail = state.detail;
        if (!detail?.id) return;

        const totalInput = detailContainer.querySelector("#rr-total")?.value || "";
        const notesInput = detailContainer.querySelector("#rr-notes")?.value || null;
        const totalCents = centsFromDollars(totalInput);

        if (["verify", "edit"].includes(action) && (!Number.isFinite(totalCents) || totalCents <= 0)) {
          toast.error("Enter a valid receipt total.");
          return;
        }

        const expectedStatus = String(detail.review_status || "").toLowerCase();
        const expectedReviewedAt = detail.reviewed_at || null;

        const updated = await applyDecision({
          action,
          totalCents,
          notes: notesInput,
          expectedStatus,
          expectedReviewedAt,
        });

        if (!updated?.id) {
          toast.warning("No changes applied.");
          return;
        }

        const decisionLabel =
          action === "verify"
            ? "verified"
            : action === "reject"
              ? "rejected"
              : action === "undo"
                ? "moved back to pending"
                : "updated";

        if (action === "verify" || action === "reject") {
          toast.success(`Receipt ${decisionLabel}.`, {
            durationMs: 8000,
            action: {
              label: "Undo",
              onClick: async () => {
                try {
                  const undoResponse = await runtime.apiRequest(`/api/admin/receipts/${encodeURIComponent(updated.id)}/decision`, {
                    method: "POST",
                    body: {
                      action: "undo",
                      expectedStatus: updated.review_status,
                      expectedReviewedAt: updated.reviewed_at || null,
                      reviewNotes: updated.review_notes || null,
                    },
                  });
                  if (undoResponse.error) {
                    throw undoResponse.error;
                  }
                  toast.success("Decision undone.");
                  state.editMode = false;
                  await refresh();
                } catch (undoError) {
                  toast.error(runtime.normalizeSupabaseError(undoError, "Unable to undo decision."));
                }
              },
            },
          });
        } else {
          toast.success(`Receipt ${decisionLabel}.`);
        }

        state.editMode = false;
        await refresh();
      } catch (error) {
        toast.error(runtime.normalizeSupabaseError(error, "Unable to update receipt."));
      }
    };

    const renderDetail = async () => {
      const detail = state.detail;
      if (!detail) {
        renderDetailPlaceholder(detailContainer, "Select a receipt from the queue to review.");
        return;
      }

      const status = String(detail.review_status || "").toLowerCase();
      const isPending = status === "pending";
      const isVerified = status === "verified";
      const locked = receiptIsLocked(detail);
      const promoMeta = getPromoMeta(detail);
      const totalEditable = isDecisionEditable();
      const preview = state.preview;

      const imageZoomScale = state.imageZoomMode === "actual" ? 1 : 0.78;
      const imageClass = state.imageExpanded ? "drawer-image-wrap is-expanded" : "drawer-image-wrap";

      detailContainer.innerHTML = `
        <div class="detail-form-wrapper">
          <div class="detail-grid">
            <div class="detail-line"><span>Status</span><strong>${escapeHtml(detail.review_status || "pending")}</strong></div>
            <div class="detail-line"><span>Uploaded</span><strong>${escapeHtml(formatDateTime(detail.uploaded_at))}</strong></div>
            <div class="detail-line"><span>Business</span><strong>${escapeHtml(detail.business?.name || "--")}</strong></div>
            <div class="detail-line"><span>Offer</span><strong>${escapeHtml(detail.redemption?.offer?.title || "--")}</strong></div>
          </div>

          <div class="detail-grid">
            <div class="detail-line"><span>Promo code used</span><strong>${escapeHtml(promoMeta.code || "No promo")}</strong></div>
            <div class="detail-line"><span>Promo rate</span><strong>${escapeHtml(promoMeta.rateBps ? `${(promoMeta.rateBps / 100).toFixed(2)}%` : "--")}</strong></div>
          </div>

          <label class="field">
            <span>Receipt total ($)</span>
            <input id="rr-total" type="number" min="0" step="0.01" value="${escapeHtml(dollarsFromCents(detail.receipt_total_cents || 0))}" ${totalEditable ? "" : "disabled"} />
          </label>

          <label class="field">
            <span>Review notes</span>
            <textarea id="rr-notes" rows="4" ${totalEditable ? "" : "disabled"}>${escapeHtml(detail.review_notes || "")}</textarea>
          </label>

          <div class="receipt-preview-grid">
            <div class="receipt-preview-card"><span>Commission</span><strong>${escapeHtml(preview ? formatCurrencyFromCents(preview.commission_cents || 0) : "--")}</strong><small>${escapeHtml(preview ? `${(Number(preview.commission_rate_bps || 0) / 100).toFixed(2)}% rate` : "")}</small></div>
            <div class="receipt-preview-card"><span>User cashback</span><strong>${escapeHtml(preview ? formatCurrencyFromCents(preview.cashback_cents || 0) : "--")}</strong><small>${escapeHtml(preview ? `${(Number(preview.effective_cashback_rate_bps || 0) / 100).toFixed(2)}% effective` : "")}</small></div>
            <div class="receipt-preview-card"><span>Promo applied</span><strong>${escapeHtml(preview?.applied_promo_code || promoMeta.code || "None")}</strong><small>${escapeHtml(preview?.applied_promo_rate_bps ? `${(Number(preview.applied_promo_rate_bps || 0) / 100).toFixed(2)}%` : "")}</small></div>
            <div class="receipt-preview-card"><span>Platform subsidy</span><strong>${escapeHtml(preview ? formatCurrencyFromCents(preview.platform_subsidy_cents || 0) : "--")}</strong><small>${escapeHtml(preview ? "cashback minus commission" : "")}</small></div>
          </div>

          <p class="notice">${escapeHtml(state.previewLoading ? "Calculating authoritative preview..." : state.previewError || "Preview updates in real time while you type.")}</p>

          <div class="${imageClass}">
            ${state.image?.signedUrl
              ? `
              <div class="receipt-image-stage">
                <img src="${state.image.signedUrl}" alt="Receipt image" style="transform: scale(${imageZoomScale}); transform-origin: top left; width: ${state.imageZoomMode === "actual" ? "auto" : "100%"};" />
              </div>
              `
              : "<div class='admin-empty'>Unable to load receipt image.</div>"}
            <div class="receipt-full-controls">
              <span title="${escapeHtml(detail.storage_path || "")}">${state.image?.signedUrl ? escapeHtml(`Source: ${state.image.resolvedBucket}/${state.image.resolvedPath}`) : escapeHtml(`Image unavailable: ${state.image?.errorReason || "No image"}`)}</span>
              ${state.image?.signedUrl
                ? `
                <div class="cta-row">
                  <button class="button secondary" id="rr-image-fit" type="button">Fit</button>
                  <button class="button secondary" id="rr-image-actual" type="button">100%</button>
                  <button class="button secondary" id="rr-image-toggle" type="button">${state.imageExpanded ? "Close full image" : "Open full image"}</button>
                </div>
                `
                : ""}
            </div>
          </div>

          <div class="cta-row">
            <button class="button primary" id="rr-verify" ${isPending && !state.previewLoading && !state.previewError ? "" : "disabled"}>Verify now</button>
            <button class="button danger-outline" id="rr-reject" ${isPending ? "" : "disabled"}>Reject</button>
            <button class="button secondary" id="rr-edit" ${isVerified && !state.editMode && !locked ? "" : "disabled"}>Edit verified receipt</button>
            <button class="button primary" id="rr-save-edit" ${state.editMode && isVerified && !locked && !state.previewLoading && !state.previewError ? "" : "disabled"}>Save correction</button>
            <button class="button secondary" id="rr-cancel-edit" ${state.editMode ? "" : "disabled"}>Cancel edit</button>
          </div>

          <p class="notice">${escapeHtml(locked ? "This receipt is locked because invoicing/payout has already progressed." : "")}</p>
        </div>
      `;

      detailContainer.querySelector("#rr-total")?.addEventListener("input", (event) => {
        if (!isDecisionEditable()) return;
        schedulePreview(event.target.value);
      });

      detailContainer.querySelector("#rr-verify")?.addEventListener("click", async () => {
        await triggerDecision("verify");
      });

      detailContainer.querySelector("#rr-reject")?.addEventListener("click", async () => {
        await triggerDecision("reject");
      });

      detailContainer.querySelector("#rr-edit")?.addEventListener("click", async () => {
        state.editMode = true;
        const cents = centsFromDollars(detailContainer.querySelector("#rr-total")?.value || "");
        if (Number.isFinite(cents) && cents > 0) {
          await runPreview(cents);
        }
        await renderDetail();
      });

      detailContainer.querySelector("#rr-save-edit")?.addEventListener("click", async () => {
        await triggerDecision("edit");
      });

      detailContainer.querySelector("#rr-cancel-edit")?.addEventListener("click", async () => {
        state.editMode = false;
        state.previewError = "";
        await renderDetail();
      });

      detailContainer.querySelector("#rr-image-fit")?.addEventListener("click", async () => {
        state.imageZoomMode = "fit";
        await renderDetail();
      });

      detailContainer.querySelector("#rr-image-actual")?.addEventListener("click", async () => {
        state.imageZoomMode = "actual";
        await renderDetail();
      });

      detailContainer.querySelector("#rr-image-toggle")?.addEventListener("click", async () => {
        state.imageExpanded = !state.imageExpanded;
        await renderDetail();
      });
    };

    const applyFilters = debounce(async () => {
      state.page = 0;
      state.filters.search = content.querySelector("#rr-search")?.value || "";
      state.filters.status = content.querySelector("#rr-status")?.value || "all";
      state.filters.businessId = content.querySelector("#rr-business")?.value || "all";
      state.filters.startDate = content.querySelector("#rr-start")?.value || "";
      state.filters.endDate = content.querySelector("#rr-end")?.value || "";
      state.editMode = false;
      state.imageExpanded = false;
      state.imageZoomMode = "fit";
      state.preview = null;
      state.previewError = "";
      state.previewLoading = false;
      await refresh();
    }, 220);

    ["#rr-search", "#rr-status", "#rr-business", "#rr-start", "#rr-end"].forEach((selector) => {
      content.querySelector(selector)?.addEventListener("input", applyFilters);
      content.querySelector(selector)?.addEventListener("change", applyFilters);
    });

    content.querySelector("#rr-refresh")?.addEventListener("click", async () => {
      state.editMode = false;
      state.imageExpanded = false;
      state.imageZoomMode = "fit";
      state.preview = null;
      state.previewError = "";
      state.previewLoading = false;
      await refresh();
    });

    try {
      await loadBusinesses();
      await refresh();
      if (!state.detail) {
        renderDetailPlaceholder(detailContainer, "Select a receipt from the queue to review.");
      }
    } catch (error) {
      toast.error(runtime.normalizeSupabaseError(error, "Unable to load receipt review."));
      renderDetailPlaceholder(detailContainer, "Unable to load receipt details.");
    }
  },
};
