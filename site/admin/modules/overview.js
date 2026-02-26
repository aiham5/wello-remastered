import { createSectionHeader, card } from "./helpers.js";
import { renderTable } from "../components/table.js";
import { escapeHtml } from "../lib/format.js";

const safeLoad = async (task) => {
  try {
    const { data, error, count } = await task();
    if (error) throw error;
    return { data: data || [], count: count || 0 };
  } catch {
    return { data: [], count: 0 };
  }
};

export const overviewModule = {
  key: "overview",
  label: "Overview",
  async mount(ctx) {
    const { content, runtime, toast, router } = ctx;

    content.innerHTML = `
      ${createSectionHeader({
        title: "Operations overview",
        subtitle: "Queues, payouts, and recent admin/webhook activity.",
        actions: `<button class="button secondary" id="overview-refresh">Refresh</button>`,
      })}
      <div id="overview-kpis" class="kpi-grid"></div>
      <section class="panel-card">
        <div class="panel-card-header"><h3>Recent operations</h3></div>
        <div id="overview-events"></div>
      </section>
      <section class="panel-card">
        <div class="panel-card-header"><h3>Quick actions</h3></div>
        <div class="quick-actions">
          <button class="button secondary" data-route="receipt-review">Receipt review</button>
          <button class="button secondary" data-route="receipt-reports">Receipt reports</button>
          <button class="button secondary" data-route="business-approvals">Business approvals</button>
          <button class="button secondary" data-route="offer-moderation">Offer moderation</button>
          <button class="button secondary" data-route="cashout-ops">Cashout ops</button>
        </div>
      </section>
    `;

    const kpis = content.querySelector("#overview-kpis");
    const eventsContainer = content.querySelector("#overview-events");

    const load = async () => {
      try {
        const [pendingReceipts, openReports, pendingBusinesses, pendingOffers, pendingCashouts, adminActions, businessAudit, tremendousHooks] = await Promise.all([
          safeLoad(() => runtime.client.from("receipt_uploads").select("id", { count: "exact", head: true }).eq("review_status", "pending")),
          safeLoad(() => runtime.client.from("receipt_reports").select("id", { count: "exact", head: true }).in("status", ["open", "reviewing"])),
          safeLoad(() => runtime.client.from("businesses").select("id", { count: "exact", head: true }).eq("approval_status", "pending")),
          safeLoad(() => runtime.client.from("offers").select("id", { count: "exact", head: true }).eq("approval_status", "pending")),
          safeLoad(() => runtime.client.from("cashout_payouts").select("id", { count: "exact", head: true }).eq("status", "pending")),
          safeLoad(() => runtime.client.from("admin_action_logs").select("id, action, entity, status, created_at").order("created_at", { ascending: false }).limit(20)),
          safeLoad(() => runtime.client.from("business_review_audit_log").select("id, next_approval_status, business_id, changed_at").order("changed_at", { ascending: false }).limit(10)),
          safeLoad(() => runtime.client.from("tremendous_webhook_events").select("id, event_type, processed, created_at").order("created_at", { ascending: false }).limit(10)),
        ]);

        kpis.innerHTML = [
          card({ title: "Pending receipts", value: pendingReceipts.count }),
          card({ title: "Open receipt reports", value: openReports.count }),
          card({ title: "Pending businesses", value: pendingBusinesses.count }),
          card({ title: "Pending offers", value: pendingOffers.count }),
          card({ title: "Pending cashouts", value: pendingCashouts.count }),
        ].join("");

        const rows = [];
        adminActions.data.forEach((row) => rows.push({ id: `a:${row.id}`, created_at: row.created_at, source: "admin_action_logs", summary: `${row.action} - ${row.entity} (${row.status})` }));
        businessAudit.data.forEach((row) => rows.push({ id: `b:${row.id}`, created_at: row.changed_at, source: "business_review_audit_log", summary: `business review -> ${row.next_approval_status}` }));
        tremendousHooks.data.forEach((row) => rows.push({ id: `t:${row.id}`, created_at: row.created_at, source: "tremendous_webhook_events", summary: `${row.event_type} (${row.processed ? "processed" : "pending"})` }));

        rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        renderTable({
          container: eventsContainer,
          columns: [
            { label: "Time", render: (row) => escapeHtml(new Date(row.created_at).toLocaleString()) },
            { label: "Source", render: (row) => escapeHtml(row.source) },
            { label: "Summary", render: (row) => escapeHtml(row.summary) },
          ],
          rows: rows.slice(0, 30),
          rowKey: (row) => row.id,
          emptyText: "No recent events found.",
        });
      } catch (error) {
        toast.error(runtime.normalizeSupabaseError(error, "Unable to load overview."));
      }
    };

    content.querySelector("#overview-refresh")?.addEventListener("click", load);
    content.querySelectorAll("[data-route]").forEach((button) => {
      button.addEventListener("click", () => router.navigate(button.getAttribute("data-route")));
    });

    await load();
  },
};
