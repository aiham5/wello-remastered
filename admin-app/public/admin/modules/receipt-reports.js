import { createSectionHeader, mapStatusBadge } from "./helpers.js";
import { formatDateTime, escapeHtml } from "../lib/format.js";
import { renderTable } from "../components/table.js";
import { renderPagination } from "../components/pagination.js";
import { debounce } from "../lib/http.js";

const PAGE_SIZE = 30;

export const receiptReportsModule = {
  key: "receipt-reports",
  label: "Receipt Reports",
  async mount(ctx) {
    const { content, runtime, toast, drawer, confirmModal } = ctx;
    const state = {
      page: 0,
      rows: [],
      filters: { status: "all", reason: "all", businessId: "all", search: "" },
    };

    content.innerHTML = `
      ${createSectionHeader({
        title: "Receipt reports",
        subtitle: "Business-owner reported receipts for admin resolution.",
        actions: `<button class="button secondary" id="reports-refresh">Refresh</button>`,
      })}
      <section class="panel-card sticky-filters">
        <div class="filters-grid">
          <label class="field"><span>Status</span><select id="reports-status"><option value="all">All</option><option value="open">Open</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></label>
          <label class="field"><span>Reason</span><select id="reports-reason"><option value="all">All</option><option value="wrong_receipt">Wrong receipt</option><option value="duplicate_receipt">Duplicate receipt</option><option value="incorrect_total">Incorrect total</option><option value="suspicious_activity">Suspicious activity</option><option value="illegible_receipt">Illegible receipt</option><option value="other">Other</option></select></label>
          <label class="field"><span>Business</span><select id="reports-business"><option value="all">All businesses</option></select></label>
          <label class="field"><span>Search</span><input id="reports-search" type="search" placeholder="Report id or details" /></label>
        </div>
      </section>
      <section class="panel-card">
        <div class="panel-card-header"><h3>Report queue</h3><p class="notice" id="reports-meta"></p></div>
        <div id="reports-table"></div>
        <div id="reports-pagination"></div>
      </section>
    `;

    const table = content.querySelector("#reports-table");
    const pager = content.querySelector("#reports-pagination");
    const meta = content.querySelector("#reports-meta");

    const loadBusinesses = async () => {
      const { data, error } = await runtime.client.from("businesses").select("id,name").order("name", { ascending: true }).limit(300);
      if (error) throw error;
      const select = content.querySelector("#reports-business");
      select.innerHTML = '<option value="all">All businesses</option>';
      (data || []).forEach((row) => {
        const option = document.createElement("option");
        option.value = row.id;
        option.textContent = row.name;
        select.appendChild(option);
      });
    };

    const load = async () => {
      try {
        let query = runtime.client
          .from("receipt_reports")
          .select("id,receipt_upload_id,business_id,reporter_id,reason,details,status,resolution_notes,resolved_by,resolved_at,created_at,updated_at,business:businesses(id,name),receipt:receipt_uploads(id,review_status,uploaded_at,receipt_total_cents)")
          .order("created_at", { ascending: false })
          .range(state.page * PAGE_SIZE, state.page * PAGE_SIZE + PAGE_SIZE - 1);

        if (state.filters.status !== "all") query = query.eq("status", state.filters.status);
        if (state.filters.reason !== "all") query = query.eq("reason", state.filters.reason);
        if (state.filters.businessId !== "all") query = query.eq("business_id", state.filters.businessId);
        const text = String(state.filters.search || "").trim();
        if (text) {
          const safe = text.replace(/,/g, " ");
          query = query.or(`id.ilike.%${safe}%,details.ilike.%${safe}%`);
        }

        const { data, error } = await query;
        if (error) throw error;
        state.rows = data || [];
        meta.textContent = `${state.rows.length} report${state.rows.length === 1 ? "" : "s"} loaded`;

        renderTable({
          container: table,
          columns: [
            { label: "Created", render: (row) => escapeHtml(formatDateTime(row.created_at)) },
            { label: "Business", render: (row) => escapeHtml(row.business?.name || "--") },
            { label: "Reason", render: (row) => escapeHtml(row.reason || "--") },
            { label: "Receipt", render: (row) => escapeHtml(row.receipt_upload_id || "--") },
            { label: "Status", render: (row) => mapStatusBadge(row.status) },
          ],
          rows: state.rows,
          rowKey: (row) => row.id,
          onRowClick: (row) => openReport(row),
          emptyText: "No receipt reports found.",
        });

        renderPagination({
          container: pager,
          page: state.page,
          pageSize: PAGE_SIZE,
          rowCount: state.rows.length,
          onPageChange: async (next) => { state.page = next; await load(); },
        });
      } catch (error) {
        toast.error(runtime.normalizeSupabaseError(error, "Unable to load receipt reports."));
      }
    };

    const updateReport = async ({ row, nextStatus, notes }) => {
      try {
        const user = await runtime.getUser();
        let changed = null;
        try {
          const rpc = await runtime.client.rpc("admin_update_receipt_report", {
            p_report_id: row.id,
            p_status: nextStatus,
            p_resolution_notes: notes || null,
            p_resolved_by: user?.id || null,
          });
          if (rpc.error) throw rpc.error;
          changed = rpc.data;
        } catch {
          const updates = { status: nextStatus, resolution_notes: notes || null, updated_at: new Date().toISOString() };
          if (["resolved", "dismissed"].includes(nextStatus)) {
            updates.resolved_by = user?.id || null;
            updates.resolved_at = new Date().toISOString();
          }
          const fallback = await runtime.client
            .from("receipt_reports")
            .update(updates)
            .eq("id", row.id)
            .in("status", ["open", "reviewing"])
            .select("id")
            .maybeSingle();
          if (fallback.error) throw fallback.error;
          changed = fallback.data;
        }

        if (!changed) toast.warning("No changes applied. Report already updated.");
        else {
          toast.success(`Report moved to ${nextStatus}.`);
          await runtime.logAction({ action: "receipt_report_updated", entity: "receipt_reports", entityId: row.id, before: { status: row.status }, after: { status: nextStatus } });
        }
        drawer.close();
        await load();
      } catch (error) {
        toast.error(runtime.normalizeSupabaseError(error, "Unable to update report."));
      }
    };

    const openReport = (row) => {
      const node = document.createElement("div");
      node.className = "detail-form-wrapper";
      node.innerHTML = `
        <div class="detail-grid">
          <div class="detail-line"><span>Report ID</span><strong>${escapeHtml(row.id)}</strong></div>
          <div class="detail-line"><span>Business</span><strong>${escapeHtml(row.business?.name || "--")}</strong></div>
          <div class="detail-line"><span>Reason</span><strong>${escapeHtml(row.reason || "--")}</strong></div>
          <div class="detail-line"><span>Status</span><strong>${escapeHtml(row.status || "--")}</strong></div>
        </div>
        <label class="field"><span>Reporter details</span><textarea rows="4" readonly>${escapeHtml(row.details || "No details provided.")}</textarea></label>
        <label class="field"><span>Resolution notes</span><textarea id="report-notes" rows="4">${escapeHtml(row.resolution_notes || "")}</textarea></label>
        <div class="cta-row">
          <button class="button secondary" data-next="reviewing">Move to reviewing</button>
          <button class="button primary" data-next="resolved">Resolve</button>
          <button class="button danger-outline" data-next="dismissed">Dismiss</button>
        </div>
      `;

      node.querySelectorAll("button[data-next]").forEach((button) => {
        button.addEventListener("click", () => {
          const nextStatus = button.getAttribute("data-next");
          const notes = node.querySelector("#report-notes")?.value || null;
          confirmModal.open({
            title: "Update report",
            body: `Move this report from ${row.status} to ${nextStatus}?`,
            confirmLabel: "Apply",
            onConfirm: async () => updateReport({ row, nextStatus, notes }),
          });
        });
      });

      drawer.open({ title: "Receipt report details", content: node });
    };

    const applyFilters = debounce(async () => {
      state.page = 0;
      state.filters.status = content.querySelector("#reports-status")?.value || "all";
      state.filters.reason = content.querySelector("#reports-reason")?.value || "all";
      state.filters.businessId = content.querySelector("#reports-business")?.value || "all";
      state.filters.search = content.querySelector("#reports-search")?.value || "";
      await load();
    }, 220);

    ["#reports-status", "#reports-reason", "#reports-business", "#reports-search"].forEach((selector) => {
      content.querySelector(selector)?.addEventListener("change", applyFilters);
      content.querySelector(selector)?.addEventListener("input", applyFilters);
    });
    content.querySelector("#reports-refresh")?.addEventListener("click", load);

    await loadBusinesses();
    await load();
  },
};
