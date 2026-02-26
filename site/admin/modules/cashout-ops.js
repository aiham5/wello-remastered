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
      filters: { status: "all", provider: "all", search: "" },
    };

    content.innerHTML = `
      ${createSectionHeader({ title: "Cashout operations", subtitle: "Monitor payout lifecycle and pending risk.", actions: `<button class="button secondary" id="co-refresh">Refresh</button>` })}
      <section class="panel-card sticky-filters">
        <div class="filters-grid">
          <label class="field"><span>Status</span><select id="co-status"><option value="all">All</option><option value="pending">Pending</option><option value="paid">Paid</option><option value="failed">Failed</option></select></label>
          <label class="field"><span>Provider</span><select id="co-provider"><option value="all">All</option><option value="tremendous">Tremendous</option><option value="stripe">Stripe</option></select></label>
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
        let query = runtime.client
          .from("cashout_payouts")
          .select("id,user_id,amount_cents,status,provider,provider_status,provider_order_id,provider_reward_id,provider_claim_url,stripe_transfer_id,stripe_payout_id,created_at,updated_at")
          .order("created_at", { ascending: false })
          .range(state.page * PAGE_SIZE, state.page * PAGE_SIZE + PAGE_SIZE - 1);

        if (state.filters.status !== "all") query = query.eq("status", state.filters.status);
        if (state.filters.provider !== "all") query = query.eq("provider", state.filters.provider);
        const text = String(state.filters.search || "").trim();
        if (text) {
          const safe = text.replace(/,/g, " ");
          query = query.or(`id.ilike.%${safe}%,user_id.ilike.%${safe}%,provider_order_id.ilike.%${safe}%,provider_reward_id.ilike.%${safe}%`);
        }

        const { data, error } = await query;
        if (error) throw error;
        state.rows = data || [];

        const stuckCount = state.rows.filter((row) => isStuck(row)).length;
        meta.textContent = `${state.rows.length} payout${state.rows.length === 1 ? "" : "s"} loaded${stuckCount ? ` · ${stuckCount} stuck > ${STUCK_HOURS}h` : ""}`;

        renderTable({
          container: table,
          columns: [
            { label: "Created", render: (row) => escapeHtml(formatDateTime(row.created_at)) },
            { label: "User", render: (row) => escapeHtml(row.user_id || "--") },
            { label: "Amount", render: (row) => escapeHtml(formatCurrencyFromCents(row.amount_cents || 0)) },
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

    const openPayout = (row) => {
      const node = document.createElement("div");
      node.className = "detail-form-wrapper";
      node.innerHTML = `
        <div class="detail-grid">
          <div class="detail-line"><span>Payout ID</span><strong>${escapeHtml(row.id)}</strong></div>
          <div class="detail-line"><span>User</span><strong>${escapeHtml(row.user_id || "--")}</strong></div>
          <div class="detail-line"><span>Amount</span><strong>${escapeHtml(formatCurrencyFromCents(row.amount_cents || 0))}</strong></div>
          <div class="detail-line"><span>Status</span><strong>${escapeHtml(row.status || "--")}</strong></div>
          <div class="detail-line"><span>Provider</span><strong>${escapeHtml(row.provider || "--")}</strong></div>
          <div class="detail-line"><span>Provider status</span><strong>${escapeHtml(row.provider_status || "--")}</strong></div>
          <div class="detail-line"><span>Order ID</span><strong>${escapeHtml(row.provider_order_id || "--")}</strong></div>
          <div class="detail-line"><span>Reward ID</span><strong>${escapeHtml(row.provider_reward_id || "--")}</strong></div>
          <div class="detail-line"><span>Stripe transfer</span><strong>${escapeHtml(row.stripe_transfer_id || "--")}</strong></div>
          <div class="detail-line"><span>Stripe payout</span><strong>${escapeHtml(row.stripe_payout_id || "--")}</strong></div>
        </div>
        <div class="cta-row">
          <button class="button secondary" id="co-copy-order">Copy order ID</button>
          <button class="button secondary" id="co-copy-reward">Copy reward ID</button>
          <button class="button primary" id="co-open-claim" ${row.provider_claim_url ? "" : "disabled"}>Open claim link</button>
        </div>
      `;

      node.querySelector("#co-copy-order")?.addEventListener("click", async () => {
        const text = String(row.provider_order_id || "");
        if (!text) return;
        await navigator.clipboard.writeText(text);
        toast.success("Order ID copied.");
      });

      node.querySelector("#co-copy-reward")?.addEventListener("click", async () => {
        const text = String(row.provider_reward_id || "");
        if (!text) return;
        await navigator.clipboard.writeText(text);
        toast.success("Reward ID copied.");
      });

      node.querySelector("#co-open-claim")?.addEventListener("click", () => {
        if (!row.provider_claim_url) return;
        window.open(row.provider_claim_url, "_blank", "noopener,noreferrer");
      });

      drawer.open({ title: "Cashout payout detail", content: node });
    };

    const onFilter = debounce(async () => {
      state.page = 0;
      state.filters.status = content.querySelector("#co-status")?.value || "all";
      state.filters.provider = content.querySelector("#co-provider")?.value || "all";
      state.filters.search = content.querySelector("#co-search")?.value || "";
      await load();
    }, 220);

    ["#co-status", "#co-provider", "#co-search"].forEach((selector) => {
      content.querySelector(selector)?.addEventListener("change", onFilter);
      content.querySelector(selector)?.addEventListener("input", onFilter);
    });
    content.querySelector("#co-refresh")?.addEventListener("click", load);

    await load();
  },
};
