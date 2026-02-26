import { createSectionHeader } from "./helpers.js";
import { formatDateTime, escapeHtml } from "../lib/format.js";
import { renderTable } from "../components/table.js";

const safeLoad = async (task) => {
  try {
    const { data, error } = await task();
    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
};

export const auditEventsModule = {
  key: "audit-events",
  label: "Audit & Events",
  async mount(ctx) {
    const { content, runtime, drawer } = ctx;

    content.innerHTML = `
      ${createSectionHeader({ title: "Audit and event logs", subtitle: "Unified timeline across admin actions and webhook/event streams.", actions: `<button class="button secondary" id="audit-refresh">Refresh</button>` })}
      <section class="panel-card sticky-filters">
        <div class="filters-grid">
          <label class="field"><span>Source</span><select id="audit-source"><option value="all">All</option><option value="admin_action_logs">Admin actions</option><option value="business_review_audit_log">Business review audit</option><option value="stripe_webhook_events">Stripe webhooks</option><option value="plaid_webhook_events">Plaid webhooks</option><option value="tremendous_webhook_events">Tremendous webhooks</option><option value="plaid_event_logs">Plaid event logs</option></select></label>
        </div>
      </section>
      <section class="panel-card"><div class="panel-card-header"><h3>Events</h3><p class="notice" id="audit-meta"></p></div><div id="audit-table"></div></section>
    `;

    const table = content.querySelector("#audit-table");
    const meta = content.querySelector("#audit-meta");
    let rows = [];

    const openRaw = (row) => {
      const node = document.createElement("div");
      node.className = "detail-form-wrapper";
      node.innerHTML = `
        <div class="detail-grid">
          <div class="detail-line"><span>Source</span><strong>${escapeHtml(row.source)}</strong></div>
          <div class="detail-line"><span>Type</span><strong>${escapeHtml(row.type || "--")}</strong></div>
          <div class="detail-line"><span>Time</span><strong>${escapeHtml(formatDateTime(row.created_at))}</strong></div>
        </div>
        <label class="field"><span>Raw payload</span><textarea rows="18" readonly>${escapeHtml(JSON.stringify(row.raw, null, 2))}</textarea></label>
      `;
      drawer.open({ title: "Event details", content: node });
    };

    const applyFilter = () => {
      const source = content.querySelector("#audit-source")?.value || "all";
      const filtered = source === "all" ? rows : rows.filter((row) => row.source === source);
      meta.textContent = `${filtered.length} event${filtered.length === 1 ? "" : "s"}`;
      renderTable({
        container: table,
        columns: [
          { label: "Time", render: (row) => escapeHtml(formatDateTime(row.created_at)) },
          { label: "Source", render: (row) => escapeHtml(row.source) },
          { label: "Type", render: (row) => escapeHtml(row.type || "--") },
          { label: "Detail", render: (row) => escapeHtml(row.detail || "--") },
        ],
        rows: filtered.slice(0, 500),
        rowKey: (row) => row.id,
        onRowClick: openRaw,
        emptyText: "No matching events.",
      });
    };

    const load = async () => {
      const [adminActions, businessAudit, stripeHooks, plaidHooks, tremendousHooks, plaidEvents] = await Promise.all([
        safeLoad(() => runtime.client.from("admin_action_logs").select("id,action,entity,status,entity_id,meta,created_at").order("created_at", { ascending: false }).limit(100)),
        safeLoad(() => runtime.client.from("business_review_audit_log").select("id,previous_approval_status,next_approval_status,business_id,changed_at").order("changed_at", { ascending: false }).limit(100)),
        safeLoad(() => runtime.client.from("stripe_webhook_events").select("id,stripe_event_id,event_type,processed,processed_at,created_at").order("created_at", { ascending: false }).limit(100)),
        safeLoad(() => runtime.client.from("plaid_webhook_events").select("id,webhook_type,webhook_code,plaid_item_id,created_at").order("created_at", { ascending: false }).limit(100)),
        safeLoad(() => runtime.client.from("tremendous_webhook_events").select("id,event_uuid,event_type,processed,processed_at,created_at").order("created_at", { ascending: false }).limit(100)),
        safeLoad(() => runtime.client.from("plaid_event_logs").select("id,source_function,event_name,severity,user_id,plaid_item_id,created_at,metadata").order("created_at", { ascending: false }).limit(100)),
      ]);

      rows = [
        ...adminActions.map((row) => ({ id: `a:${row.id}`, source: "admin_action_logs", created_at: row.created_at, type: row.action, detail: `${row.entity}${row.entity_id ? `:${row.entity_id}` : ""}`, raw: row })),
        ...businessAudit.map((row) => ({ id: `b:${row.id}`, source: "business_review_audit_log", created_at: row.changed_at, type: "business_review_change", detail: `${row.previous_approval_status || "--"} -> ${row.next_approval_status || "--"}`, raw: row })),
        ...stripeHooks.map((row) => ({ id: `s:${row.id}`, source: "stripe_webhook_events", created_at: row.created_at, type: row.event_type, detail: `${row.stripe_event_id} (${row.processed ? "processed" : "pending"})`, raw: row })),
        ...plaidHooks.map((row) => ({ id: `p:${row.id}`, source: "plaid_webhook_events", created_at: row.created_at, type: `${row.webhook_type || "PLAID"}.${row.webhook_code || "UNKNOWN"}`, detail: row.plaid_item_id || "--", raw: row })),
        ...tremendousHooks.map((row) => ({ id: `t:${row.id}`, source: "tremendous_webhook_events", created_at: row.created_at, type: row.event_type, detail: `${row.event_uuid} (${row.processed ? "processed" : "pending"})`, raw: row })),
        ...plaidEvents.map((row) => ({ id: `l:${row.id}`, source: "plaid_event_logs", created_at: row.created_at, type: `${row.source_function}:${row.event_name}`, detail: row.severity, raw: row })),
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      applyFilter();
    };

    content.querySelector("#audit-source")?.addEventListener("change", applyFilter);
    content.querySelector("#audit-refresh")?.addEventListener("click", load);

    await load();
  },
};
