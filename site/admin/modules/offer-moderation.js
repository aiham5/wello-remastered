import { createSectionHeader, mapStatusBadge } from "./helpers.js";
import { formatDateTime, escapeHtml } from "../lib/format.js";
import { renderPagination } from "../components/pagination.js";
import { debounce } from "../lib/http.js";

const PAGE_SIZE = 30;

const renderOffersTable = ({ container, rows, selectedIds, onToggle, onOpen }) => {
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = '<div class="admin-empty">No pending offers.</div>';
    return;
  }

  container.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th><input type="checkbox" id="offers-select-all" /></th>
          <th>Title</th>
          <th>Business</th>
          <th>Created</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
          <tr data-id="${escapeHtml(row.id)}">
            <td><input type="checkbox" data-select-id="${escapeHtml(row.id)}" ${selectedIds.has(row.id) ? "checked" : ""} /></td>
            <td>${escapeHtml(row.title || "--")}</td>
            <td>${escapeHtml(row.business?.name || "--")}</td>
            <td>${escapeHtml(formatDateTime(row.created_at))}</td>
            <td>${mapStatusBadge(row.approval_status)}</td>
          </tr>
        `,
          )
          .join("")}
      </tbody>
    </table>
  `;

  const allCheckbox = container.querySelector("#offers-select-all");
  if (allCheckbox) {
    allCheckbox.checked = rows.length > 0 && rows.every((row) => selectedIds.has(row.id));
    allCheckbox.addEventListener("change", () => {
      const checked = allCheckbox.checked;
      rows.forEach((row) => onToggle(row.id, checked));
    });
  }

  container.querySelectorAll("input[data-select-id]").forEach((box) => {
    box.addEventListener("change", (event) => {
      event.stopPropagation();
      const id = box.getAttribute("data-select-id");
      onToggle(id, box.checked);
    });
  });

  container.querySelectorAll("tbody tr[data-id]").forEach((tr) => {
    tr.addEventListener("click", (event) => {
      if (event.target instanceof HTMLInputElement) return;
      const id = tr.getAttribute("data-id");
      const row = rows.find((item) => item.id === id);
      if (row) onOpen(row);
    });
  });
};

export const offerModerationModule = {
  key: "offer-moderation",
  label: "Offer Moderation",
  async mount(ctx) {
    const { content, runtime, toast, drawer, confirmModal } = ctx;

    const state = {
      page: 0,
      rows: [],
      selectedIds: new Set(),
      filters: { search: "" },
    };

    content.innerHTML = `
      ${createSectionHeader({
        title: "Offer moderation",
        subtitle: "Review and approve/reject pending offers.",
        actions: `
          <button class="button secondary" id="offers-refresh">Refresh</button>
          <button class="button primary" id="offers-bulk-approve">Bulk approve</button>
          <button class="button danger-outline" id="offers-bulk-reject">Bulk reject</button>
        `,
      })}
      <section class="panel-card sticky-filters">
        <div class="filters-grid">
          <label class="field"><span>Search</span><input id="offers-search" type="search" placeholder="Offer title or description" /></label>
        </div>
      </section>
      <section class="panel-card">
        <div class="panel-card-header"><h3>Pending offers</h3><p id="offers-meta" class="notice"></p></div>
        <div id="offers-table"></div>
        <div id="offers-pagination"></div>
      </section>
    `;

    const meta = content.querySelector("#offers-meta");
    const tableContainer = content.querySelector("#offers-table");
    const paginationContainer = content.querySelector("#offers-pagination");

    const load = async () => {
      try {
        let query = runtime.client
          .from("offers")
          .select("id,business_id,title,description,offer_type,active,approval_status,created_at,business:businesses(id,name)")
          .eq("approval_status", "pending")
          .order("created_at", { ascending: true })
          .range(state.page * PAGE_SIZE, state.page * PAGE_SIZE + PAGE_SIZE - 1);

        const text = String(state.filters.search || "").trim();
        if (text) {
          const safe = text.replace(/,/g, " ");
          query = query.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`);
        }

        const { data, error } = await query;
        if (error) throw error;

        state.rows = data || [];
        state.selectedIds = new Set([...state.selectedIds].filter((id) => state.rows.some((row) => row.id === id)));

        meta.textContent = `${state.rows.length} pending offer${state.rows.length === 1 ? "" : "s"} · ${state.selectedIds.size} selected`;

        renderOffersTable({
          container: tableContainer,
          rows: state.rows,
          selectedIds: state.selectedIds,
          onToggle: (id, checked) => {
            if (checked) state.selectedIds.add(id);
            else state.selectedIds.delete(id);
            meta.textContent = `${state.rows.length} pending offer${state.rows.length === 1 ? "" : "s"} · ${state.selectedIds.size} selected`;
          },
          onOpen: (row) => openOffer(row),
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
      } catch (error) {
        toast.error(runtime.normalizeSupabaseError(error, "Unable to load offers."));
      }
    };

    const updateOffer = async ({ offer, nextApprovalStatus }) => {
      try {
        let changed = null;
        try {
          const rpc = await runtime.client.rpc("admin_review_offer", {
            p_offer_id: offer.id,
            p_next_approval_status: nextApprovalStatus,
          });
          if (rpc.error) throw rpc.error;
          changed = rpc.data;
        } catch {
          const fallback = await runtime.client
            .from("offers")
            .update({
              approval_status: nextApprovalStatus,
              active: nextApprovalStatus === "approved",
              updated_at: new Date().toISOString(),
            })
            .eq("id", offer.id)
            .eq("approval_status", "pending")
            .select("id")
            .maybeSingle();
          if (fallback.error) throw fallback.error;
          changed = fallback.data;
        }

        if (!changed) {
          toast.warning(`Offer ${offer.title} was already reviewed.`);
        } else {
          await runtime.logAction({
            action: `offer_${nextApprovalStatus}`,
            entity: "offers",
            entityId: offer.id,
            before: { approval_status: offer.approval_status },
            after: { approval_status: nextApprovalStatus },
          });
        }
      } catch (error) {
        toast.error(runtime.normalizeSupabaseError(error, `Unable to ${nextApprovalStatus} offer.`));
      }
    };

    const runBulk = async (nextApprovalStatus) => {
      const ids = [...state.selectedIds];
      if (!ids.length) {
        toast.warning("Select at least one offer first.");
        return;
      }
      confirmModal.open({
        title: `Bulk ${nextApprovalStatus}`,
        body: `${nextApprovalStatus === "approved" ? "Approve" : "Reject"} ${ids.length} selected offers?`,
        confirmLabel: "Run",
        onConfirm: async () => {
          let success = 0;
          for (const id of ids) {
            const row = state.rows.find((offer) => offer.id === id);
            if (!row) continue;
            // eslint-disable-next-line no-await-in-loop
            await updateOffer({ offer: row, nextApprovalStatus });
            success += 1;
          }
          state.selectedIds.clear();
          toast.success(`Bulk action completed (${success}/${ids.length}).`);
          await load();
        },
      });
    };

    const openOffer = (offer) => {
      const node = document.createElement("div");
      node.className = "detail-form-wrapper";
      node.innerHTML = `
        <div class="detail-grid">
          <div class="detail-line"><span>ID</span><strong>${escapeHtml(offer.id)}</strong></div>
          <div class="detail-line"><span>Business</span><strong>${escapeHtml(offer.business?.name || "--")}</strong></div>
          <div class="detail-line"><span>Type</span><strong>${escapeHtml(offer.offer_type || "--")}</strong></div>
          <div class="detail-line"><span>Created</span><strong>${escapeHtml(formatDateTime(offer.created_at))}</strong></div>
        </div>
        <label class="field"><span>Title</span><input type="text" readonly value="${escapeHtml(offer.title || "")}"/></label>
        <label class="field"><span>Description</span><textarea rows="5" readonly>${escapeHtml(offer.description || "")}</textarea></label>
        <div class="cta-row">
          <button class="button primary" id="offer-approve">Approve</button>
          <button class="button danger-outline" id="offer-reject">Reject</button>
        </div>
      `;

      node.querySelector("#offer-approve")?.addEventListener("click", () => {
        confirmModal.open({ title: "Approve offer", body: `Approve '${offer.title}'?`, confirmLabel: "Approve", onConfirm: async () => { await updateOffer({ offer, nextApprovalStatus: "approved" }); drawer.close(); await load(); } });
      });

      node.querySelector("#offer-reject")?.addEventListener("click", () => {
        confirmModal.open({ title: "Reject offer", body: `Reject '${offer.title}'?`, confirmLabel: "Reject", onConfirm: async () => { await updateOffer({ offer, nextApprovalStatus: "rejected" }); drawer.close(); await load(); } });
      });

      drawer.open({ title: "Offer moderation", content: node });
    };

    const onFilter = debounce(async () => {
      state.page = 0;
      state.filters.search = content.querySelector("#offers-search")?.value || "";
      await load();
    }, 220);

    content.querySelector("#offers-search")?.addEventListener("input", onFilter);
    content.querySelector("#offers-refresh")?.addEventListener("click", load);
    content.querySelector("#offers-bulk-approve")?.addEventListener("click", () => runBulk("approved"));
    content.querySelector("#offers-bulk-reject")?.addEventListener("click", () => runBulk("rejected"));

    await load();
  },
};
