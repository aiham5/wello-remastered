import { createSectionHeader, mapStatusBadge } from "./helpers.js";
import { formatDateTime, escapeHtml } from "../lib/format.js";
import { renderTable } from "../components/table.js";
import { renderPagination } from "../components/pagination.js";
import { debounce } from "../lib/http.js";

const PAGE_SIZE = 30;
const ROLES = ["consumer", "business_owner", "supervisor", "admin"];

export const usersRolesModule = {
  key: "users-roles",
  label: "Users & Roles",
  async mount(ctx) {
    const { content, runtime, toast, drawer, confirmModal, store } = ctx;
    const currentUserId = store.getState()?.session?.user?.id || null;

    const state = {
      page: 0,
      rows: [],
      filters: { role: "all", search: "" },
    };

    content.innerHTML = `
      ${createSectionHeader({ title: "Users and roles", subtitle: "Manage profile role assignments with guarded updates.", actions: `<button class="button secondary" id="users-refresh">Refresh</button>` })}
      <section class="panel-card sticky-filters">
        <div class="filters-grid">
          <label class="field"><span>Role</span><select id="users-role"><option value="all">All roles</option>${ROLES.map((role) => `<option value="${role}">${role}</option>`).join("")}</select></label>
          <label class="field"><span>Search</span><input id="users-search" type="search" placeholder="Email, name, user id" /></label>
        </div>
      </section>
      <section class="panel-card">
        <div class="panel-card-header"><h3>Profiles</h3><p class="notice" id="users-meta"></p></div>
        <div id="users-table"></div>
        <div id="users-pagination"></div>
      </section>
    `;

    const table = content.querySelector("#users-table");
    const pager = content.querySelector("#users-pagination");
    const meta = content.querySelector("#users-meta");

    const load = async () => {
      try {
        let query = runtime.client
          .from("profiles")
          .select("id,email,full_name,role,created_at,updated_at")
          .order("created_at", { ascending: false })
          .range(state.page * PAGE_SIZE, state.page * PAGE_SIZE + PAGE_SIZE - 1);

        if (state.filters.role !== "all") query = query.eq("role", state.filters.role);
        const text = String(state.filters.search || "").trim();
        if (text) {
          const safe = text.replace(/,/g, " ");
          query = query.or(`id.ilike.%${safe}%,email.ilike.%${safe}%,full_name.ilike.%${safe}%`);
        }

        const { data, error } = await query;
        if (error) throw error;
        state.rows = data || [];

        meta.textContent = `${state.rows.length} profile${state.rows.length === 1 ? "" : "s"} loaded`;

        renderTable({
          container: table,
          columns: [
            { label: "Name", render: (row) => escapeHtml(row.full_name || "--") },
            { label: "Email", render: (row) => escapeHtml(row.email || "--") },
            { label: "Role", render: (row) => mapStatusBadge(row.role || "consumer") },
            { label: "Created", render: (row) => escapeHtml(formatDateTime(row.created_at)) },
          ],
          rows: state.rows,
          rowKey: (row) => row.id,
          onRowClick: (row) => openProfile(row),
          emptyText: "No profiles match current filters.",
        });

        renderPagination({ container: pager, page: state.page, pageSize: PAGE_SIZE, rowCount: state.rows.length, onPageChange: async (next) => { state.page = next; await load(); } });
      } catch (error) {
        toast.error(runtime.normalizeSupabaseError(error, "Unable to load profiles."));
      }
    };

    const updateRole = async ({ profile, nextRole }) => {
      if (!ROLES.includes(nextRole)) {
        toast.error("Invalid role selected.");
        return;
      }
      if (profile.id === currentUserId && profile.role !== nextRole) {
        toast.error("Self-role changes are disabled to prevent admin lockout.");
        return;
      }

      try {
        let changed = null;
        try {
          const rpc = await runtime.client.rpc("admin_update_user_role", {
            p_profile_id: profile.id,
            p_expected_role: String(profile.role || "consumer"),
            p_next_role: nextRole,
          });
          if (rpc.error) throw rpc.error;
          changed = rpc.data;
        } catch {
          const fallback = await runtime.client
            .from("profiles")
            .update({ role: nextRole, updated_at: new Date().toISOString() })
            .eq("id", profile.id)
            .eq("role", String(profile.role || "consumer"))
            .select("id")
            .maybeSingle();
          if (fallback.error) throw fallback.error;
          changed = fallback.data;
        }

        if (!changed) {
          toast.warning("Role update not applied. Profile changed by another session.");
        } else {
          toast.success("Role updated.");
          await runtime.logAction({ action: "profile_role_updated", entity: "profiles", entityId: profile.id, before: { role: profile.role }, after: { role: nextRole } });
        }
        drawer.close();
        await load();
      } catch (error) {
        toast.error(runtime.normalizeSupabaseError(error, "Unable to update role."));
      }
    };

    const openProfile = (profile) => {
      const node = document.createElement("div");
      node.className = "detail-form-wrapper";
      node.innerHTML = `
        <div class="detail-grid">
          <div class="detail-line"><span>User ID</span><strong>${escapeHtml(profile.id)}</strong></div>
          <div class="detail-line"><span>Name</span><strong>${escapeHtml(profile.full_name || "--")}</strong></div>
          <div class="detail-line"><span>Email</span><strong>${escapeHtml(profile.email || "--")}</strong></div>
          <div class="detail-line"><span>Current role</span><strong>${escapeHtml(profile.role || "consumer")}</strong></div>
        </div>
        <label class="field"><span>New role</span><select id="users-next-role">${ROLES.map((role) => `<option value="${role}" ${profile.role === role ? "selected" : ""}>${role}</option>`).join("")}</select></label>
        <div class="cta-row"><button class="button primary" id="users-update-role">Update role</button></div>
      `;

      node.querySelector("#users-update-role")?.addEventListener("click", () => {
        const nextRole = node.querySelector("#users-next-role")?.value || profile.role;
        if (nextRole === profile.role) {
          toast.info("No role change detected.");
          return;
        }
        confirmModal.open({
          title: "Update user role",
          body: `Change role from ${profile.role} to ${nextRole}?`,
          confirmLabel: "Apply",
          onConfirm: async () => updateRole({ profile, nextRole }),
        });
      });

      drawer.open({ title: "User profile", content: node });
    };

    const onFilter = debounce(async () => {
      state.page = 0;
      state.filters.role = content.querySelector("#users-role")?.value || "all";
      state.filters.search = content.querySelector("#users-search")?.value || "";
      await load();
    }, 220);

    content.querySelector("#users-role")?.addEventListener("change", onFilter);
    content.querySelector("#users-search")?.addEventListener("input", onFilter);
    content.querySelector("#users-refresh")?.addEventListener("click", load);

    await load();
  },
};
