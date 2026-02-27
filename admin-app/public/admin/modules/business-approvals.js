import { createSectionHeader, mapStatusBadge } from "./helpers.js";
import { formatDateTime, escapeHtml } from "../lib/format.js";
import { renderTable } from "../components/table.js";
import { renderPagination } from "../components/pagination.js";
import { debounce } from "../lib/http.js";

const PAGE_SIZE = 25;

export const businessApprovalsModule = {
  key: "business-approvals",
  label: "Business Approvals",
  async mount(ctx) {
    const { content, runtime, toast, drawer, confirmModal } = ctx;
    const state = { page: 0, rows: [], filters: { search: "" } };

    content.innerHTML = `
      ${createSectionHeader({ title: "Business approvals", subtitle: "Approve or reject pending business profiles.", actions: `<button class="button secondary" id="ba-refresh">Refresh</button>` })}
      <section class="panel-card sticky-filters"><div class="filters-grid"><label class="field"><span>Search</span><input id="ba-search" type="search" placeholder="Business name or owner id" /></label></div></section>
      <section class="panel-card"><div class="panel-card-header"><h3>Pending businesses</h3><p class="notice" id="ba-meta"></p></div><div id="ba-table"></div><div id="ba-pagination"></div></section>
    `;

    const table = content.querySelector("#ba-table");
    const pager = content.querySelector("#ba-pagination");
    const meta = content.querySelector("#ba-meta");

    const load = async () => {
      try {
        let query = runtime.client
          .from("businesses")
          .select("id,name,owner_id,category_label,approval_status,status,created_at,updated_at")
          .eq("approval_status", "pending")
          .order("created_at", { ascending: true })
          .range(state.page * PAGE_SIZE, state.page * PAGE_SIZE + PAGE_SIZE - 1);

        const text = String(state.filters.search || "").trim();
        if (text) {
          const safe = text.replace(/,/g, " ");
          query = query.or(`name.ilike.%${safe}%,owner_id.ilike.%${safe}%`);
        }

        const { data, error } = await query;
        if (error) throw error;
        state.rows = data || [];
        meta.textContent = `${state.rows.length} pending business${state.rows.length === 1 ? "" : "es"}`;

        renderTable({
          container: table,
          columns: [
            { label: "Name", render: (row) => escapeHtml(row.name || "--") },
            { label: "Category", render: (row) => escapeHtml(row.category_label || "--") },
            { label: "Submitted", render: (row) => escapeHtml(formatDateTime(row.created_at)) },
            { label: "Status", render: (row) => mapStatusBadge(row.approval_status) },
          ],
          rows: state.rows,
          rowKey: (row) => row.id,
          onRowClick: (row) => openBusiness(row),
          emptyText: "No pending businesses.",
        });

        renderPagination({ container: pager, page: state.page, pageSize: PAGE_SIZE, rowCount: state.rows.length, onPageChange: async (next) => { state.page = next; await load(); } });
      } catch (error) {
        toast.error(runtime.normalizeSupabaseError(error, "Unable to load business queue."));
      }
    };

    const updateBusiness = async ({ row, nextApprovalStatus }) => {
      try {
        let changed = null;
        try {
          const rpc = await runtime.client.rpc("admin_review_business", { p_business_id: row.id, p_next_approval_status: nextApprovalStatus });
          if (rpc.error) throw rpc.error;
          changed = rpc.data;
        } catch {
          const update = { approval_status: nextApprovalStatus, updated_at: new Date().toISOString() };
          update.status = nextApprovalStatus === "approved" ? "active" : "inactive";
          const fallback = await runtime.client
            .from("businesses")
            .update(update)
            .eq("id", row.id)
            .eq("approval_status", "pending")
            .select("id")
            .maybeSingle();
          if (fallback.error) throw fallback.error;
          changed = fallback.data;
        }

        if (!changed) toast.warning("No changes applied. Business no longer pending.");
        else {
          toast.success(`Business ${nextApprovalStatus}.`);
          await runtime.logAction({ action: `business_${nextApprovalStatus}`, entity: "businesses", entityId: row.id, before: { approval_status: row.approval_status }, after: { approval_status: nextApprovalStatus } });
        }
        drawer.close();
        await load();
      } catch (error) {
        toast.error(runtime.normalizeSupabaseError(error, "Unable to update business."));
      }
    };

    const openBusiness = (row) => {
      const node = document.createElement("div");
      node.className = "detail-form-wrapper";
      node.innerHTML = `
        <div class="detail-grid">
          <div class="detail-line"><span>ID</span><strong>${escapeHtml(row.id)}</strong></div>
          <div class="detail-line"><span>Name</span><strong>${escapeHtml(row.name || "--")}</strong></div>
          <div class="detail-line"><span>Owner</span><strong>${escapeHtml(row.owner_id || "--")}</strong></div>
          <div class="detail-line"><span>Submitted</span><strong>${escapeHtml(formatDateTime(row.created_at))}</strong></div>
        </div>
        <div class="cta-row">
          <button class="button primary" id="ba-approve">Approve</button>
          <button class="button danger-outline" id="ba-reject">Reject</button>
        </div>
      `;

      node.querySelector("#ba-approve")?.addEventListener("click", () => {
        confirmModal.open({ title: "Approve business", body: `Approve ${row.name}?`, confirmLabel: "Approve", onConfirm: async () => updateBusiness({ row, nextApprovalStatus: "approved" }) });
      });
      node.querySelector("#ba-reject")?.addEventListener("click", () => {
        confirmModal.open({ title: "Reject business", body: `Reject ${row.name}?`, confirmLabel: "Reject", onConfirm: async () => updateBusiness({ row, nextApprovalStatus: "rejected" }) });
      });

      drawer.open({ title: "Business review", content: node });
    };

    const onFilter = debounce(async () => {
      state.page = 0;
      state.filters.search = content.querySelector("#ba-search")?.value || "";
      await load();
    }, 220);

    content.querySelector("#ba-search")?.addEventListener("input", onFilter);
    content.querySelector("#ba-refresh")?.addEventListener("click", load);

    await load();
  },
};
