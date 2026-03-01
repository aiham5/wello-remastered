import { createSectionHeader } from "./helpers.js";
import { escapeHtml } from "../lib/format.js";

const percentToBps = (value) => {
  const n = Number(String(value || "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
};

const formatWindow = (promo) => {
  const start = promo?.starts_at ? new Date(promo.starts_at).toLocaleDateString() : "--";
  const end = promo?.ends_at ? new Date(promo.ends_at).toLocaleDateString() : "--";
  if (start === "--" && end === "--") return "Any time";
  return `${start} -> ${end}`;
};

const renderPromoList = ({ container, rows }) => {
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = '<div class="admin-empty">No promo codes yet.</div>';
    return;
  }

  container.innerHTML = rows
    .map((promo) => {
      const rate = ((Number(promo.cashback_rate_bps) || 0) / 100).toFixed(2);
      return `
        <article class="summary-item" data-id="${escapeHtml(promo.id)}">
          <div>
            <h4>${escapeHtml(promo.code || "(code)")}</h4>
            <p>${rate}% · ${promo.active ? "Active" : "Inactive"} · ${escapeHtml(formatWindow(promo))}</p>
            <p class="subtle">Max uses per user: ${promo.max_uses_per_user || "Unlimited"}</p>
          </div>
          <div class="actions-inline">
            <button class="button secondary" data-action="copy" data-id="${escapeHtml(promo.id)}">Copy</button>
            <button class="button outline" data-action="toggle" data-id="${escapeHtml(promo.id)}" data-next="${promo.active ? "false" : "true"}">${promo.active ? "Deactivate" : "Activate"}</button>
          </div>
        </article>
      `;
    })
    .join("");
};

export const promotionsModule = {
  key: "promotions",
  label: "Promotions",
  async mount(ctx) {
    const { content, runtime, toast } = ctx;
    const state = { rows: [] };

    content.innerHTML = `
      ${createSectionHeader({ title: "Promotions and push", subtitle: "Create promo codes, manage status, and send promo notifications.", actions: `<button class="button secondary" id="promo-refresh">Refresh</button>` })}
      <section class="panel-card">
        <h3>Create promo code</h3>
        <div class="form-grid two-col">
          <label class="field"><span>Code</span><input id="promo-code" type="text" placeholder="WELCOME10" /></label>
          <label class="field"><span>Promo rate (%)</span><input id="promo-rate" type="number" min="0.01" step="0.01" placeholder="10" /></label>
          <label class="field"><span>Max uses per user (optional)</span><input id="promo-max" type="number" min="1" step="1" /></label>
          <label class="field"><span>Status</span><select id="promo-active"><option value="true">Active</option><option value="false">Inactive</option></select></label>
          <label class="field"><span>Starts (optional)</span><input id="promo-start" type="date" /></label>
          <label class="field"><span>Ends (optional)</span><input id="promo-end" type="date" /></label>
        </div>
        <div class="cta-row"><button class="button primary" id="promo-create">Create code</button></div>
        <p class="notice" id="promo-status"></p>
      </section>
      <section class="panel-card"><div class="panel-card-header"><h3>Promo codes</h3></div><div id="promo-list"></div></section>
      <section class="panel-card">
        <h3>Send promo push</h3>
        <div class="form-grid two-col">
          <label class="field"><span>Promo code</span><select id="promo-push-code"><option value="">Select code</option></select></label>
          <label class="field"><span>Audience</span><select id="promo-push-audience"><option value="all">All customers</option><option value="new_offer_opt_in">New-offers opt-in users</option></select></label>
          <label class="field"><span>Title</span><input id="promo-push-title" type="text" placeholder="Limited-time promo" /></label>
          <label class="field"><span>Message</span><input id="promo-push-body" type="text" placeholder="Open Wello to apply this code" /></label>
        </div>
        <div class="cta-row"><button class="button secondary" id="promo-send">Send notification</button></div>
        <p class="notice" id="promo-push-status"></p>
      </section>
    `;

    const ui = {
      code: content.querySelector("#promo-code"),
      rate: content.querySelector("#promo-rate"),
      max: content.querySelector("#promo-max"),
      active: content.querySelector("#promo-active"),
      start: content.querySelector("#promo-start"),
      end: content.querySelector("#promo-end"),
      create: content.querySelector("#promo-create"),
      status: content.querySelector("#promo-status"),
      list: content.querySelector("#promo-list"),
      pushCode: content.querySelector("#promo-push-code"),
      pushAudience: content.querySelector("#promo-push-audience"),
      pushTitle: content.querySelector("#promo-push-title"),
      pushBody: content.querySelector("#promo-push-body"),
      send: content.querySelector("#promo-send"),
      pushStatus: content.querySelector("#promo-push-status"),
    };

    const setStatus = (message, isError = false) => {
      ui.status.textContent = message || "";
      ui.status.style.color = isError ? "#B42318" : "#64748B";
    };

    const setPushStatus = (message, isError = false) => {
      ui.pushStatus.textContent = message || "";
      ui.pushStatus.style.color = isError ? "#B42318" : "#64748B";
    };

    const hydratePushCodes = () => {
      const current = ui.pushCode.value;
      ui.pushCode.innerHTML = '<option value="">Select code</option>';
      state.rows.forEach((promo) => {
        const option = document.createElement("option");
        option.value = promo.id;
        option.textContent = promo.code;
        ui.pushCode.appendChild(option);
      });
      if (current) ui.pushCode.value = current;
    };

    const load = async () => {
      const { data, error } = await runtime.client
        .from("promo_codes")
        .select("id,code,cashback_rate_bps,max_uses_per_user,active,starts_at,ends_at,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      state.rows = data || [];
      renderPromoList({ container: ui.list, rows: state.rows });
      hydratePushCodes();
    };

    const createPromo = async () => {
      const code = String(ui.code.value || "").trim().toUpperCase();
      const cashbackRateBps = percentToBps(ui.rate.value);
      const maxRaw = String(ui.max.value || "").trim();
      const active = String(ui.active.value || "true") === "true";
      const startsAt = ui.start.value ? `${ui.start.value}T00:00:00.000Z` : null;
      const endsAt = ui.end.value ? `${ui.end.value}T23:59:59.999Z` : null;

      if (!code) {
        setStatus("Enter a promo code.", true);
        return;
      }
      if (!cashbackRateBps) {
        setStatus("Enter a valid promo rate.", true);
        return;
      }

      const maxUses = maxRaw ? Number(maxRaw) : null;
      if (maxRaw && (!Number.isFinite(maxUses) || maxUses < 1)) {
        setStatus("Max uses per user must be at least 1.", true);
        return;
      }

      ui.create.disabled = true;
      setStatus("Creating promo code...");
      try {
        const { data, error } = await runtime.client
          .from("promo_codes")
          .insert({
            code,
            cashback_rate_bps: cashbackRateBps,
            max_uses_per_user: maxUses,
            active,
            starts_at: startsAt,
            ends_at: endsAt,
          })
          .select("id")
          .maybeSingle();
        if (error) throw error;
        setStatus("Promo code created.");
        await runtime.logAction({ action: "promo_code_created", entity: "promo_codes", entityId: data?.id || null, after: { code, cashback_rate_bps: cashbackRateBps, max_uses_per_user: maxUses, active } });
        ui.code.value = "";
        ui.rate.value = "";
        ui.max.value = "";
        ui.start.value = "";
        ui.end.value = "";
        await load();
      } catch (error) {
        setStatus(runtime.normalizeSupabaseError(error, "Unable to create promo code."), true);
      } finally {
        ui.create.disabled = false;
      }
    };

    const togglePromo = async (promoId, nextActive) => {
      try {
        const current = state.rows.find((row) => row.id === promoId);
        const { data, error } = await runtime.client
          .from("promo_codes")
          .update({ active: nextActive, updated_at: new Date().toISOString() })
          .eq("id", promoId)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          toast.warning("Promo not updated. Refresh and retry.");
          return;
        }
        await runtime.logAction({ action: "promo_code_toggled", entity: "promo_codes", entityId: promoId, before: { active: current?.active }, after: { active: nextActive } });
        toast.success(`Promo ${nextActive ? "activated" : "deactivated"}.`);
        await load();
      } catch (error) {
        toast.error(runtime.normalizeSupabaseError(error, "Unable to update promo code."));
      }
    };

    const sendPromoPush = async () => {
      const promoCodeId = String(ui.pushCode.value || "").trim();
      const audience = String(ui.pushAudience.value || "all");
      const title = String(ui.pushTitle.value || "").trim();
      const body = String(ui.pushBody.value || "").trim();

      if (!promoCodeId || !title || !body) {
        setPushStatus("Select promo and enter title + message.", true);
        return;
      }

      ui.send.disabled = true;
      setPushStatus("Sending push notification...");
      try {
        const result = await runtime.invokeFunction("admin-send-promo-push", { promoCodeId, audience, title, body });
        const sent = Number(result?.sent || 0);
        setPushStatus(`Notification sent to ${sent} user${sent === 1 ? "" : "s"}.`);
        await runtime.logAction({ action: "promo_push_sent", entity: "promo_codes", entityId: promoCodeId, meta: { audience, sent } });
      } catch (error) {
        setPushStatus(runtime.normalizeSupabaseError(error, "Unable to send promo notification."), true);
      } finally {
        ui.send.disabled = false;
      }
    };

    ui.create.addEventListener("click", createPromo);
    ui.send.addEventListener("click", sendPromoPush);
    content.querySelector("#promo-refresh")?.addEventListener("click", async () => {
      try {
        await load();
        toast.success("Promo codes refreshed.");
      } catch (error) {
        toast.error(runtime.normalizeSupabaseError(error, "Unable to refresh promo data."));
      }
    });

    ui.list.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const action = button.getAttribute("data-action");
      const promoId = button.getAttribute("data-id");
      const promo = state.rows.find((row) => row.id === promoId);
      if (!promo) return;

      if (action === "copy") {
        try {
          await navigator.clipboard.writeText(promo.code);
          toast.success("Promo code copied.");
        } catch {
          toast.error("Unable to copy promo code.");
        }
      }

      if (action === "toggle") {
        const nextActive = button.getAttribute("data-next") === "true";
        await togglePromo(promoId, nextActive);
      }
    });

    try {
      await load();
    } catch (error) {
      toast.error(runtime.normalizeSupabaseError(error, "Unable to load promotions module."));
    }
  },
};
