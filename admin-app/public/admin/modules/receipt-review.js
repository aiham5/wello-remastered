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

  if (parsed?.bucket && parsed?.objectPath) {
    add(parsed.bucket, parsed.objectPath);
  }

  const fallbackPath = parsed?.objectPath || "";
  if (fallbackPath) {
    RECEIPT_BUCKET_CANDIDATES.forEach((bucket) => add(bucket, fallbackPath));
  }

  return targets;
};

const resolveReceiptImage = async (runtime, storagePath) => {
  const normalizedRawPath = String(storagePath || "").trim().replace(/^\/+/, "");
  if (normalizedRawPath.startsWith("receipts/")) {
    const r2Result = await runtime.client.storage
      .from("__r2__")
      .createSignedUrl(normalizedRawPath, 60 * 30);
    if (!r2Result?.error && r2Result?.data?.signedUrl) {
      return {
        signedUrl: r2Result.data.signedUrl,
        resolvedPath: normalizedRawPath,
        resolvedBucket: "r2",
        errorReason: "",
      };
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
    return {
      signedUrl: parsed.directUrl,
      resolvedPath: parsed.directUrl,
      resolvedBucket: "external",
      errorReason: "",
    };
  }

  const targets = buildStorageTargets(parsed);
  let lastError = "";
  for (const target of targets) {
    const result = await runtime.client.storage.from(target.bucket).createSignedUrl(target.path, 60 * 30);
    if (!result?.error && result?.data?.signedUrl) {
      return {
        signedUrl: result.data.signedUrl,
        resolvedPath: target.path,
        resolvedBucket: target.bucket,
        errorReason: "",
      };
    }
    if (result?.error?.message) {
      lastError = result.error.message;
    }
  }

  return {
    signedUrl: "",
    resolvedPath: parsed.objectPath || "",
    resolvedBucket: parsed.bucket || "",
    errorReason: lastError || "No readable image in configured receipt stores.",
  };
};

const renderDetailPlaceholder = (container, message) => {
  if (!container) return;
  container.innerHTML = `<div class="admin-empty receipt-review-empty">${escapeHtml(message)}</div>`;
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
          <th>Commission</th>
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
            <td>${escapeHtml(formatCurrencyFromCents(row.commission_due_cents || 0))}</td>
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
    const { content, runtime, toast, confirmModal } = ctx;
    const state = {
      page: 0,
      rows: [],
      selectedId: null,
      businesses: [],
      detailRequestId: 0,
      filters: { search: "", status: "pending", businessId: "all", startDate: "", endDate: "" },
    };

    content.innerHTML = `
      ${createSectionHeader({
        title: "Receipt review",
        subtitle: "Verify/reject uploaded receipts with concurrency-safe updates.",
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

    const getSelectedRow = () => state.rows.find((row) => row.id === state.selectedId) || null;

    const verifyOrReject = async ({ row, nextStatus, totalCents, notes }) => {
      try {
        const user = await runtime.getUser();
        let changed = null;

        try {
          const rpc = await runtime.client.rpc("admin_review_receipt", {
            p_receipt_id: row.id,
            p_receipt_total_cents: totalCents,
            p_review_status: nextStatus,
            p_review_notes: notes || null,
            p_reviewed_by: user?.id || null,
          });
          if (rpc.error) throw rpc.error;
          changed = rpc.data;
        } catch {
          const updates = {
            review_status: nextStatus,
            review_notes: notes || null,
            reviewed_by: user?.id || null,
            reviewed_at: new Date().toISOString(),
          };
          if (nextStatus === "verified") updates.receipt_total_cents = totalCents;

          const fallback = await runtime.client
            .from("receipt_uploads")
            .update(updates)
            .eq("id", row.id)
            .eq("review_status", "pending")
            .select("id")
            .maybeSingle();
          if (fallback.error) throw fallback.error;
          changed = fallback.data;
        }

        if (!changed) {
          toast.warning("No changes applied. Receipt is no longer pending.");
        } else {
          toast.success(`Receipt ${nextStatus}.`);
          await runtime.logAction({
            action: `receipt_${nextStatus}`,
            entity: "receipt_uploads",
            entityId: row.id,
            before: { review_status: row.review_status },
            after: { review_status: nextStatus, receipt_total_cents: totalCents },
          });
        }

        await load();
      } catch (error) {
        toast.error(runtime.normalizeSupabaseError(error, `Unable to ${nextStatus} receipt.`));
      }
    };

    const renderDetail = async (row) => {
      if (!row) {
        renderDetailPlaceholder(detailContainer, "Select a receipt from the queue to review.");
        return;
      }

      const requestId = ++state.detailRequestId;
      detailContainer.innerHTML = "<div class='admin-loading'>Loading receipt details...</div>";
      const image = await resolveReceiptImage(runtime, row.storage_path);

      if (requestId !== state.detailRequestId) return;

      const isPending = String(row.review_status || "").toLowerCase() === "pending";
      detailContainer.innerHTML = `
        <div class="detail-form-wrapper">
          <div class="detail-grid">
            <div class="detail-line"><span>Status</span><strong>${escapeHtml(row.review_status || "pending")}</strong></div>
            <div class="detail-line"><span>Uploaded</span><strong>${escapeHtml(formatDateTime(row.uploaded_at))}</strong></div>
            <div class="detail-line"><span>Business</span><strong>${escapeHtml(row.business?.name || "--")}</strong></div>
            <div class="detail-line"><span>Offer</span><strong>${escapeHtml(row.redemption?.offer?.title || "--")}</strong></div>
          </div>
          <label class="field"><span>Receipt total ($)</span><input id="rr-total" type="number" min="0" step="0.01" value="${escapeHtml(dollarsFromCents(row.receipt_total_cents || 0))}" ${isPending ? "" : "disabled"} /></label>
          <label class="field"><span>Review notes</span><textarea id="rr-notes" rows="4" ${isPending ? "" : "disabled"}>${escapeHtml(row.review_notes || "")}</textarea></label>
          <div class="drawer-image-wrap">
            ${image.signedUrl ? `<img src="${image.signedUrl}" alt="Receipt image" />` : "<div class='admin-empty'>Unable to load receipt image.</div>"}
            <div class="receipt-image-meta">
              <span title="${escapeHtml(row.storage_path || "")}">${image.signedUrl ? escapeHtml(`Source: ${image.resolvedBucket}/${image.resolvedPath}`) : escapeHtml(`Image unavailable: ${image.errorReason}`)}</span>
              ${image.signedUrl ? '<button class="button secondary" id="rr-open-image" type="button">Open full image</button>' : ""}
            </div>
          </div>
          <div class="cta-row">
            <button class="button primary" id="rr-verify" ${isPending ? "" : "disabled"}>Verify receipt</button>
            <button class="button danger-outline" id="rr-reject" ${isPending ? "" : "disabled"}>Reject receipt</button>
          </div>
        </div>
      `;

      detailContainer.querySelector("#rr-open-image")?.addEventListener("click", () => {
        window.open(image.signedUrl, "_blank", "noopener,noreferrer");
      });

      detailContainer.querySelector("#rr-verify")?.addEventListener("click", () => {
        const totalCents = centsFromDollars(detailContainer.querySelector("#rr-total")?.value);
        if (!Number.isFinite(totalCents) || totalCents <= 0) {
          toast.error("Enter a valid receipt total.");
          return;
        }
        const notes = detailContainer.querySelector("#rr-notes")?.value || null;
        confirmModal.open({
          title: "Verify receipt",
          body: `Mark this receipt as verified with total ${formatCurrencyFromCents(totalCents)}?`,
          confirmLabel: "Verify",
          onConfirm: async () => verifyOrReject({ row, nextStatus: "verified", totalCents, notes }),
        });
      });

      detailContainer.querySelector("#rr-reject")?.addEventListener("click", () => {
        const notes = detailContainer.querySelector("#rr-notes")?.value || null;
        confirmModal.open({
          title: "Reject receipt",
          body: "Mark this receipt as rejected?",
          confirmLabel: "Reject",
          onConfirm: async () => verifyOrReject({ row, nextStatus: "rejected", totalCents: row.receipt_total_cents || 0, notes }),
        });
      });
    };

    const handleRowSelect = (id) => {
      state.selectedId = id;
      renderReceiptsTable({
        container: tableContainer,
        rows: state.rows,
        selectedId: state.selectedId,
        onRowSelect: handleRowSelect,
      });
      renderDetail(getSelectedRow());
    };

    const loadBusinesses = async () => {
      const { data, error } = await runtime.client.from("businesses").select("id,name").order("name", { ascending: true }).limit(300);
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

    const load = async () => {
      try {
        let query = runtime.client
          .from("receipt_uploads")
          .select("id,uploaded_at,storage_path,receipt_total_cents,commission_due_cents,review_status,review_notes,reviewed_at,reviewed_by,business_id,redemption_id,user_id,business:businesses(id,name),redemption:redemptions(id,offer:offers(id,title)),cashback_events(amount_cents,status)")
          .order("uploaded_at", { ascending: false })
          .range(state.page * PAGE_SIZE, state.page * PAGE_SIZE + PAGE_SIZE - 1);

        if (state.filters.status !== "all") query = query.eq("review_status", state.filters.status);
        if (state.filters.businessId !== "all") query = query.eq("business_id", state.filters.businessId);
        if (state.filters.startDate) query = query.gte("uploaded_at", `${state.filters.startDate}T00:00:00.000Z`);
        if (state.filters.endDate) query = query.lte("uploaded_at", `${state.filters.endDate}T23:59:59.999Z`);

        const text = String(state.filters.search || "").trim();
        if (text) {
          const safe = text.replace(/,/g, " ");
          query = query.or(`id.ilike.%${safe}%,review_notes.ilike.%${safe}%`);
        }

        const { data, error } = await query;
        if (error) throw error;

        state.rows = data || [];
        meta.textContent = `${state.rows.length} receipt${state.rows.length === 1 ? "" : "s"} loaded`;

        if (!state.rows.length) {
          state.selectedId = null;
        } else if (!state.rows.some((row) => row.id === state.selectedId)) {
          state.selectedId = state.rows[0].id;
        }

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
            await load();
          },
        });

        await renderDetail(getSelectedRow());
      } catch (error) {
        toast.error(runtime.normalizeSupabaseError(error, "Unable to load receipts."));
      }
    };

    const applyFilters = debounce(async () => {
      state.page = 0;
      state.filters.search = content.querySelector("#rr-search")?.value || "";
      state.filters.status = content.querySelector("#rr-status")?.value || "all";
      state.filters.businessId = content.querySelector("#rr-business")?.value || "all";
      state.filters.startDate = content.querySelector("#rr-start")?.value || "";
      state.filters.endDate = content.querySelector("#rr-end")?.value || "";
      await load();
    }, 220);

    ["#rr-search", "#rr-status", "#rr-business", "#rr-start", "#rr-end"].forEach((selector) => {
      content.querySelector(selector)?.addEventListener("input", applyFilters);
      content.querySelector(selector)?.addEventListener("change", applyFilters);
    });

    content.querySelector("#rr-refresh")?.addEventListener("click", load);

    await loadBusinesses();
    await load();
  },
};