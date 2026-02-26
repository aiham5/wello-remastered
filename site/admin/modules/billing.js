import { createSectionHeader } from "./helpers.js";
import { formatCurrencyFromCents } from "../lib/format.js";

const getPeriodBounds = (dateValue) => {
  const date = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 1)),
  };
};

export const billingModule = {
  key: "billing",
  label: "Billing",
  async mount(ctx) {
    const { content, runtime, toast } = ctx;

    const state = { businesses: [] };

    content.innerHTML = `
      ${createSectionHeader({ title: "Billing and invoices", subtitle: "Inspect commission totals and run Stripe invoice workflows." })}
      <section class="panel-card">
        <div class="form-grid two-col">
          <label class="field"><span>Business</span><select id="bill-business"><option value="">Select business</option></select></label>
          <label class="field"><span>Billing date</span><input id="bill-date" type="date" /></label>
        </div>
        <div class="test-metrics">
          <div><span class="test-label">Pending</span><span id="bill-pending">$0.00</span></div>
          <div><span class="test-label">Invoiced</span><span id="bill-invoiced">$0.00</span></div>
          <div><span class="test-label">Paid</span><span id="bill-paid">$0.00</span></div>
        </div>
        <div class="cta-row"><button class="button primary" id="bill-charge-now">Run monthly invoice</button></div>
        <p class="notice" id="bill-status"></p>
      </section>
      <section class="panel-card">
        <h3>Add single commission to Stripe invoice</h3>
        <div class="form-grid two-col">
          <label class="field"><span>Business</span><select id="bill-single-business"><option value="">Select business</option></select></label>
          <label class="field"><span>Redemption ID</span><input id="bill-redemption" type="text" placeholder="UUID" /></label>
          <label class="field"><span>Event date (optional)</span><input id="bill-event-date" type="date" /></label>
        </div>
        <div class="cta-row"><button class="button secondary" id="bill-add-single">Add commission to Stripe invoice</button></div>
        <p class="notice" id="bill-single-status"></p>
      </section>
    `;

    const ui = {
      business: content.querySelector("#bill-business"),
      singleBusiness: content.querySelector("#bill-single-business"),
      date: content.querySelector("#bill-date"),
      pending: content.querySelector("#bill-pending"),
      invoiced: content.querySelector("#bill-invoiced"),
      paid: content.querySelector("#bill-paid"),
      run: content.querySelector("#bill-charge-now"),
      status: content.querySelector("#bill-status"),
      redemptionId: content.querySelector("#bill-redemption"),
      eventDate: content.querySelector("#bill-event-date"),
      addSingle: content.querySelector("#bill-add-single"),
      singleStatus: content.querySelector("#bill-single-status"),
    };

    const setStatus = (message, isError = false) => {
      ui.status.textContent = message || "";
      ui.status.style.color = isError ? "#B42318" : "#64748B";
    };
    const setSingleStatus = (message, isError = false) => {
      ui.singleStatus.textContent = message || "";
      ui.singleStatus.style.color = isError ? "#B42318" : "#64748B";
    };

    const loadBusinesses = async () => {
      const { data, error } = await runtime.client.from("businesses").select("id,name,approval_status").order("name", { ascending: true }).limit(500);
      if (error) throw error;
      state.businesses = data || [];
      [ui.business, ui.singleBusiness].forEach((select) => {
        const current = select.value;
        select.innerHTML = '<option value="">Select business</option>';
        state.businesses.forEach((row) => {
          const option = document.createElement("option");
          option.value = row.id;
          option.textContent = `${row.name}${row.approval_status !== "approved" ? " (not approved)" : ""}`;
          select.appendChild(option);
        });
        if (current) select.value = current;
      });
    };

    const loadTotals = async () => {
      const businessId = ui.business.value;
      if (!businessId) {
        ui.pending.textContent = "$0.00";
        ui.invoiced.textContent = "$0.00";
        ui.paid.textContent = "$0.00";
        return;
      }

      const bounds = getPeriodBounds(ui.date.value);
      if (!bounds) return;

      const { data, error } = await runtime.client
        .from("commission_events")
        .select("amount_cents,status,created_at")
        .eq("business_id", businessId)
        .gte("created_at", bounds.start.toISOString())
        .lt("created_at", bounds.end.toISOString())
        .in("status", ["pending", "invoiced", "paid"])
        .limit(2000);

      if (error) throw error;

      const rows = data || [];
      const pendingCents = rows.filter((row) => row.status === "pending").reduce((sum, row) => sum + (Number(row.amount_cents) || 0), 0);
      const invoicedCents = rows.filter((row) => row.status === "invoiced").reduce((sum, row) => sum + (Number(row.amount_cents) || 0), 0);
      const paidCents = rows.filter((row) => row.status === "paid").reduce((sum, row) => sum + (Number(row.amount_cents) || 0), 0);

      ui.pending.textContent = formatCurrencyFromCents(pendingCents);
      ui.invoiced.textContent = formatCurrencyFromCents(invoicedCents);
      ui.paid.textContent = formatCurrencyFromCents(paidCents);
    };

    const runInvoice = async () => {
      const businessId = ui.business.value;
      if (!businessId) {
        setStatus("Select a business first.", true);
        return;
      }
      const bounds = getPeriodBounds(ui.date.value);
      if (!bounds) {
        setStatus("Invalid billing date.", true);
        return;
      }

      ui.run.disabled = true;
      setStatus("Running monthly invoice...");
      try {
        const result = await runtime.invokeFunction("admin-run-monthly-invoices", {
          businessId,
          periodStart: bounds.start.toISOString(),
          periodEnd: bounds.end.toISOString(),
        });
        if (result?.error) setStatus(result.error, true);
        else if (result?.totalCents === 0) setStatus("No pending charges for selected period.");
        else {
          setStatus(`Invoice processed: ${formatCurrencyFromCents(result?.totalCents || 0)}.`);
          await runtime.logAction({ action: "billing_run_monthly_invoice", entity: "commission_invoices", entityId: String(result?.invoiceId || ""), meta: result });
        }
        await loadTotals();
      } catch (error) {
        setStatus(runtime.normalizeSupabaseError(error, "Unable to run monthly invoice."), true);
      } finally {
        ui.run.disabled = false;
      }
    };

    const addSingle = async () => {
      const businessId = ui.singleBusiness.value;
      const redemptionId = String(ui.redemptionId.value || "").trim();
      const eventDate = String(ui.eventDate.value || "").trim();
      if (!businessId || !redemptionId) {
        setSingleStatus("Select business and redemption ID.", true);
        return;
      }

      ui.addSingle.disabled = true;
      setSingleStatus("Adding commission event to Stripe...");
      try {
        const result = await runtime.invokeFunction("admin-add-commission-to-stripe", { businessId, redemptionId, eventDate: eventDate || undefined });
        if (result?.error) setSingleStatus(result.error, true);
        else {
          setSingleStatus("Commission synced to Stripe draft invoice.");
          await runtime.logAction({ action: "billing_add_commission_to_stripe", entity: "commission_events", entityId: redemptionId, meta: result });
        }
        await loadTotals();
      } catch (error) {
        setSingleStatus(runtime.normalizeSupabaseError(error, "Unable to add commission to Stripe."), true);
      } finally {
        ui.addSingle.disabled = false;
      }
    };

    ui.date.valueAsDate = new Date();
    ui.eventDate.valueAsDate = new Date();
    ui.business.addEventListener("change", loadTotals);
    ui.date.addEventListener("change", loadTotals);
    ui.run.addEventListener("click", runInvoice);
    ui.addSingle.addEventListener("click", addSingle);

    try {
      await loadBusinesses();
      await loadTotals();
    } catch (error) {
      toast.error(runtime.normalizeSupabaseError(error, "Unable to initialize billing module."));
    }
  },
};
