import { createSectionHeader, mapStatusBadge } from "./helpers.js";
import { formatCurrencyFromCents, formatDateTime, escapeHtml } from "../lib/format.js";
import { renderTable } from "../components/table.js";
import { renderPagination } from "../components/pagination.js";
import { debounce } from "../lib/http.js";

const PAGE_SIZE = 30;
const STUCK_HOURS = 24;

const isStuck = (row) => {
  if (String(row?.status || "") !== "pending") return false;
  const created = new Date(row?.created_at || 0).getTime();
  if (!created) return false;
  return Date.now() - created > STUCK_HOURS * 60 * 60 * 1000;
};

export const cashoutOpsModule = {
  key: "cashout-ops",
  label: "Cashout Ops",
  async mount(ctx) {
    const { content, runtime, toast, drawer } = ctx;
    const state = {
      page: 0,
      rows: [],
      filters: { status: "all", provider: "all", approvalStatus: "all", search: "" },
    };

    content.innerHTML = `
      ${createSectionHeader({ title: "Cashout operations", subtitle: "Monitor payout lifecycle and bank-transfer approvals.", actions: `<button class="button secondary" id="co-refresh">Refresh</button>` })}
      <section class="panel-card sticky-filters">
        <div class="filters-grid">
          <label class="field"><span>Status</span><select id="co-status"><option value="all">All</option><option value="pending">Pending</option><option value="paid">Paid</option><option value="failed">Failed</option></select></label>
          <label class="field"><span>Provider</span><select id="co-provider"><option value="all">All</option><option value="reloadly">Reloadly</option><option value="checkbook">Checkbook</option><option value="stripe">Stripe (legacy)</option><option value="tremendous">Tremendous (legacy)</option><option value="dots">Dots (legacy)</option><option value="giftbit">Giftbit (legacy)</option></select></label>
          <label class="field"><span>Approval</span><select id="co-approval"><option value="all">All</option><option value="pending">Pending approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="not_required">Not required</option></select></label>
          <label class="field"><span>Search</span><input id="co-search" type="search" placeholder="Payout id, user id, order id" /></label>
        </div>
      </section>
      <section class="panel-card">
        <div class="panel-card-header"><h3>Payouts</h3><p class="notice" id="co-meta"></p></div>
        <div id="co-table"></div>
        <div id="co-pagination"></div>
      </section>
    `;

    const table = content.querySelector("#co-table");
    const pager = content.querySelector("#co-pagination");
    const meta = content.querySelector("#co-meta");

    const load = async () => {
      try {
        const params = new URLSearchParams({
          page: String(state.page),
          limit: String(PAGE_SIZE),
        });
        if (state.filters.status !== "all") params.set("status", state.filters.status);
        if (state.filters.provider !== "all") params.set("provider", state.filters.provider);
        if (state.filters.approvalStatus !== "all") params.set("approvalStatus", state.filters.approvalStatus);
        if (state.filters.search) params.set("search", state.filters.search);

        const response = await runtime.apiRequest(`/api/admin/cashouts?${params.toString()}`);
        if (response.error) throw response.error;
        state.rows = Array.isArray(response.data) ? response.data : [];

        const stuckCount = state.rows.filter((row) => isStuck(row)).length;
        meta.textContent = `${state.rows.length} payout${state.rows.length === 1 ? "" : "s"} loaded${stuckCount ? ` · ${stuckCount} stuck > ${STUCK_HOURS}h` : ""}`;

        renderTable({
          container: table,
          columns: [
            { label: "Created", render: (row) => escapeHtml(formatDateTime(row.created_at)) },
            { label: "User", render: (row) => escapeHtml(row.user_id || "--") },
            { label: "Amount", render: (row) => escapeHtml(formatCurrencyFromCents(row.amount_cents || 0)) },
            { label: "Method", render: (row) => escapeHtml(String(row.method_type || "gift_card").replace("_", " ")) },
            { label: "Provider", render: (row) => escapeHtml(row.provider || "--") },
            { label: "Status", render: (row) => mapStatusBadge(row.status) },
          ],
          rows: state.rows,
          rowKey: (row) => row.id,
          onRowClick: (row) => openPayout(row),
          emptyText: "No payout rows match current filters.",
        });

        renderPagination({ container: pager, page: state.page, pageSize: PAGE_SIZE, rowCount: state.rows.length, onPageChange: async (next) => { state.page = next; await load(); } });
      } catch (error) {
        toast.error(runtime.normalizeSupabaseError(error, "Unable to load cashout payouts."));
      }
    };

    const submitDecision = async (row, action) => {
      try {
        const endpoint = action === "approve" ? "approve" : "reject";
        const response = await runtime.apiRequest(`/api/admin/cashouts/${encodeURIComponent(row.id)}/${endpoint}`, {
          method: "POST",
          body: {
            expectedStatus: String(row.status || "pending").toLowerCase(),
            expectedApprovalStatus: String(row.approval_status || "pending").toLowerCase(),
          },
        });
        if (response.error) throw response.error;
        toast.success(action === "approve" ? "Bank transfer approved." : "Bank transfer rejected.");
        drawer.close();
        await load();
      } catch (error) {
        toast.error(runtime.normalizeSupabaseError(error, `Unable to ${action} payout.`));
      }
    };

    const openPayout = (row) => {
      const isPendingBankApproval =
        String(row.provider || "").toLowerCase() === "checkbook" &&
        String(row.method_type || "").toLowerCase() === "bank_transfer" &&
        String(row.status || "").toLowerCase() === "pending" &&
        String(row.approval_status || "").toLowerCase() === "pending";

      const node = document.createElement("div");
      node.className = "detail-form-wrapper";
      node.innerHTML = `
        <div class="detail-grid">
          <div class="detail-line"><span>Payout ID</span><strong>${escapeHtml(row.id)}</strong></div>
          <div class="detail-line"><span>User</span><strong>${escapeHtml(row.user_id || "--")}</strong></div>
          <div class="detail-line"><span>Amount</span><strong>${escapeHtml(formatCurrencyFromCents(row.amount_cents || 0))}</strong></div>
          <div class="detail-line"><span>Method</span><strong>${escapeHtml(String(row.method_type || "gift_card").replace("_", " "))}</strong></div>
          <div class="detail-line"><span>Approval status</span><strong>${escapeHtml(row.approval_status || "--")}</strong></div>
          <div class="detail-line"><span>Provider</span><strong>${escapeHtml(row.provider || "--")}</strong></div>
          <div class="detail-line"><span>Provider status</span><strong>${escapeHtml(row.provider_status || "--")}</strong></div>
          <div class="detail-line"><span>Provider order ID</span><strong>${escapeHtml(row.provider_order_id || "--")}</strong></div>
          <div class="detail-line"><span>Provider transfer/reference ID</span><strong>${escapeHtml(row.provider_reward_id || "--")}</strong></div>
          <div class="detail-line"><span>Bank summary</span><strong>${escapeHtml(row.bank_summary || "--")}</strong></div>
          <div class="detail-line"><span>Legacy Stripe transfer ID</span><strong>${escapeHtml(row.stripe_transfer_id || "--")}</strong></div>
        </div>
        <div class="cta-row" id="co-actions">
          <button class="button secondary" id="co-copy-order">Copy provider order ID</button>
          <button class="button secondary" id="co-copy-reward">Copy transfer/reference ID</button>
          <button class="button primary" id="co-open-claim" ${row.provider_claim_url ? "" : "disabled"}>Open claim link</button>
        </div>
      `;

      node.querySelector("#co-copy-order")?.addEventListener("click", async () => {
        const text = String(row.provider_order_id || "");
        if (!text) return;
        await navigator.clipboard.writeText(text);
        toast.success("Provider order ID copied.");
      });

      node.querySelector("#co-copy-reward")?.addEventListener("click", async () => {
        const text = String(row.provider_reward_id || "");
        if (!text) return;
        await navigator.clipboard.writeText(text);
        toast.success("Transfer/reference ID copied.");
      });

      node.querySelector("#co-open-claim")?.addEventListener("click", () => {
        if (!row.provider_claim_url) return;
        window.open(row.provider_claim_url, "_blank", "noopener,noreferrer");
      });

      if (isPendingBankApproval) {
        const actions = node.querySelector("#co-actions");
        const approveBtn = document.createElement("button");
        approveBtn.className = "button primary";
        approveBtn.textContent = "Approve bank transfer";
        approveBtn.addEventListener("click", () => submitDecision(row, "approve"));

        const rejectBtn = document.createElement("button");
        rejectBtn.className = "button secondary";
        rejectBtn.textContent = "Reject";
        rejectBtn.addEventListener("click", () => submitDecision(row, "reject"));

        actions?.appendChild(approveBtn);
        actions?.appendChild(rejectBtn);
      }

      drawer.open({ title: "Cashout payout detail", content: node });
    };

    const onFilter = debounce(async () => {
      state.page = 0;
      state.filters.status = content.querySelector("#co-status")?.value || "all";
      state.filters.provider = content.querySelector("#co-provider")?.value || "all";
      state.filters.approvalStatus = content.querySelector("#co-approval")?.value || "all";
      state.filters.search = content.querySelector("#co-search")?.value || "";
      await load();
    }, 220);

    ["#co-status", "#co-provider", "#co-approval", "#co-search"].forEach((selector) => {
      content.querySelector(selector)?.addEventListener("change", onFilter);
      content.querySelector(selector)?.addEventListener("input", onFilter);
    });
    content.querySelector("#co-refresh")?.addEventListener("click", load);

    await load();
  },
};
