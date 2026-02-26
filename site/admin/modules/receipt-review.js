import { createSectionHeader, mapStatusBadge } from "./helpers.js";
import { formatCurrencyFromCents, formatDateTime, dollarsFromCents, centsFromDollars, escapeHtml } from "../lib/format.js";
import { renderTable } from "../components/table.js";
import { renderPagination } from "../components/pagination.js";
import { debounce } from "../lib/http.js";

const PAGE_SIZE = 30;
const RECEIPT_BUCKET = "receipt-images";

export const receiptReviewModule = {
  key: "receipt-review",
  label: "Receipt Review",
  async mount(ctx) {
    const { content, runtime, toast, drawer, confirmModal } = ctx;
    const state = {
      page: 0,
      rows: [],
      filters: { search: "", status: "pending", businessId: "all", startDate: "", endDate: "" },
      businesses: [],
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
      <section class="panel-card">
        <div class="panel-card-header"><h3>Queue</h3><p class="notice" id="rr-meta"></p></div>
        <div id="rr-table"></div>
        <div id="rr-pagination"></div>
      </section>
    `;

    const tableContainer = content.querySelector("#rr-table");
    const paginationContainer = content.querySelector("#rr-pagination");
    const meta = content.querySelector("#rr-meta");

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

        renderTable({
          container: tableContainer,
          columns: [
            { label: "Business", render: (row) => escapeHtml(row.business?.name || "--") },
            { label: "Offer", render: (row) => escapeHtml(row.redemption?.offer?.title || "--") },
            { label: "Uploaded", render: (row) => escapeHtml(formatDateTime(row.uploaded_at)) },
            { label: "Total", render: (row) => escapeHtml(formatCurrencyFromCents(row.receipt_total_cents || 0)) },
            { label: "Commission", render: (row) => escapeHtml(formatCurrencyFromCents(row.commission_due_cents || 0)) },
            { label: "Status", render: (row) => mapStatusBadge(row.review_status) },
          ],
          rows: state.rows,
          rowKey: (row) => row.id,
          onRowClick: (row) => openReceipt(row),
          emptyText: "No receipts match current filters.",
        });

        renderPagination({
          container: paginationContainer,
          page: state.page,
          pageSize: PAGE_SIZE,
          rowCount: state.rows.length,
          onPageChange: async (nextPage) => { state.page = nextPage; await load(); },
        });
      } catch (error) {
        toast.error(runtime.normalizeSupabaseError(error, "Unable to load receipts."));
      }
    };

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

        if (!changed) toast.warning("No changes applied. Receipt is no longer pending.");
        else {
          toast.success(`Receipt ${nextStatus}.`);
          await runtime.logAction({
            action: `receipt_${nextStatus}`,
            entity: "receipt_uploads",
            entityId: row.id,
            before: { review_status: row.review_status },
            after: { review_status: nextStatus, receipt_total_cents: totalCents },
          });
        }
        drawer.close();
        await load();
      } catch (error) {
        toast.error(runtime.normalizeSupabaseError(error, `Unable to ${nextStatus} receipt.`));
      }
    };

    const openReceipt = async (row) => {
      let signedUrl = "";
      const path = String(row.storage_path || "").trim();
      if (path) {
        const result = await runtime.client.storage.from(RECEIPT_BUCKET).createSignedUrl(path, 60 * 30);
        signedUrl = result?.data?.signedUrl || "";
      }

      const node = document.createElement("div");
      node.className = "detail-form-wrapper";
      node.innerHTML = `
        <div class="detail-grid">
          <div class="detail-line"><span>Status</span><strong>${escapeHtml(row.review_status || "pending")}</strong></div>
          <div class="detail-line"><span>Uploaded</span><strong>${escapeHtml(formatDateTime(row.uploaded_at))}</strong></div>
          <div class="detail-line"><span>Business</span><strong>${escapeHtml(row.business?.name || "--")}</strong></div>
          <div class="detail-line"><span>Offer</span><strong>${escapeHtml(row.redemption?.offer?.title || "--")}</strong></div>
        </div>
        <label class="field"><span>Receipt total ($)</span><input id="rr-total" type="number" min="0" step="0.01" value="${escapeHtml(dollarsFromCents(row.receipt_total_cents || 0))}" /></label>
        <label class="field"><span>Review notes</span><textarea id="rr-notes" rows="4">${escapeHtml(row.review_notes || "")}</textarea></label>
        <div class="drawer-image-wrap">${signedUrl ? `<img src="${signedUrl}" alt="Receipt image" />` : "<div class='admin-empty'>No image available</div>"}</div>
        <div class="cta-row">
          <button class="button primary" id="rr-verify">Verify receipt</button>
          <button class="button danger-outline" id="rr-reject">Reject receipt</button>
        </div>
      `;

      node.querySelector("#rr-verify")?.addEventListener("click", () => {
        const totalCents = centsFromDollars(node.querySelector("#rr-total")?.value);
        if (!Number.isFinite(totalCents) || totalCents <= 0) {
          toast.error("Enter a valid receipt total.");
          return;
        }
        const notes = node.querySelector("#rr-notes")?.value || null;
        confirmModal.open({
          title: "Verify receipt",
          body: `Mark this receipt as verified with total ${formatCurrencyFromCents(totalCents)}?`,
          confirmLabel: "Verify",
          onConfirm: async () => verifyOrReject({ row, nextStatus: "verified", totalCents, notes }),
        });
      });

      node.querySelector("#rr-reject")?.addEventListener("click", () => {
        const notes = node.querySelector("#rr-notes")?.value || null;
        confirmModal.open({
          title: "Reject receipt",
          body: "Mark this receipt as rejected?",
          confirmLabel: "Reject",
          onConfirm: async () => verifyOrReject({ row, nextStatus: "rejected", totalCents: row.receipt_total_cents || 0, notes }),
        });
      });

      drawer.open({ title: `Receipt ${row.id.slice(0, 8)}`, content: node });
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
