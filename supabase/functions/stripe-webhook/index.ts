import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL =
  Deno.env.get("EDGE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("EDGE_SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("EDGE_SERVICE_ROLE_KEY") ??
  "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const STRIPE_WEBHOOK_TOLERANCE_SECONDS = Number(
  Deno.env.get("STRIPE_WEBHOOK_TOLERANCE_SECONDS") ?? "300",
);
const BREVO_API_KEY = (Deno.env.get("BREVO_API_KEY") ?? "").trim();
const BREVO_FROM_EMAIL = (Deno.env.get("BREVO_FROM_EMAIL") ?? "support@wellopartners.com")
  .trim();
const RESEND_API_KEY = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
const RESEND_FROM_EMAIL = (Deno.env.get("RESEND_FROM_EMAIL") ?? "Wello <noreply@wellopartners.com>")
  .trim();
const WITHDRAWAL_ADMIN_EMAIL = (
  Deno.env.get("WITHDRAWAL_ADMIN_EMAIL") ?? "admin@wellopartners.com"
).trim();

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const asNonEmptyString = (value: unknown): string | null => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
};

const moneyLabelFromCents = (amountCents: unknown) => {
  const value = Number(amountCents);
  if (!Number.isFinite(value)) return "0.00";
  return (value / 100).toFixed(2);
};

const getExternalBankSnapshot = (account: Stripe.Account) => {
  const accountWithExternals = account as Stripe.Account & {
    default_external_account?: string | null;
    external_accounts?: { data?: Array<Record<string, unknown>> };
  };
  const externalAccounts = Array.isArray(accountWithExternals.external_accounts?.data)
    ? accountWithExternals.external_accounts?.data || []
    : [];
  const bankAccounts = externalAccounts.filter((item) =>
    String(item?.object || "").trim().toLowerCase() === "bank_account"
  );
  const defaultExternalId = String(
    accountWithExternals.default_external_account || "",
  ).trim();
  const selectedBank = (defaultExternalId
    ? bankAccounts.find((item) => String(item?.id || "").trim() === defaultExternalId)
    : null) || bankAccounts[0] || null;
  const externalAccountId = String(
    selectedBank?.id || defaultExternalId || "",
  ).trim() || null;
  const bankName = String(selectedBank?.bank_name || "Bank account").trim();
  const last4 = String(selectedBank?.last4 || "").trim();
  const label = externalAccountId
    ? `${bankName}${last4 ? ` ••••${last4}` : ""}`
    : null;
  return { externalAccountId, label };
};

const getPaymentMethodSnapshot = async (
  customerId: string,
): Promise<{
  paymentMethodId: string | null;
  brand: string | null;
  last4: string | null;
}> => {
  const customer = await stripe.customers.retrieve(customerId, {
    expand: ["invoice_settings.default_payment_method"],
  });
  if (!customer || "deleted" in customer) {
    return {
      paymentMethodId: null,
      brand: null,
      last4: null,
    };
  }

  const defaultPaymentMethod = customer.invoice_settings?.default_payment_method;
  if (!defaultPaymentMethod) {
    return {
      paymentMethodId: null,
      brand: null,
      last4: null,
    };
  }

  if (typeof defaultPaymentMethod === "string") {
    const paymentMethod = await stripe.paymentMethods.retrieve(defaultPaymentMethod);
    return {
      paymentMethodId: asNonEmptyString(paymentMethod.id),
      brand: paymentMethod.card?.brand ?? null,
      last4: paymentMethod.card?.last4 ?? null,
    };
  }

  return {
    paymentMethodId: asNonEmptyString(defaultPaymentMethod.id),
    brand: defaultPaymentMethod.card?.brand ?? null,
    last4: defaultPaymentMethod.card?.last4 ?? null,
  };
};

const pauseActiveOffersForBusinesses = async (
  supabase: any,
  businessIds: string[],
) => {
  if (businessIds.length === 0) return;
  const { error } = await supabase
    .from("offers")
    .update({ active: false })
    .in("business_id", businessIds)
    .eq("active", true);
  if (error) {
    throw new Error(error.message || "Failed to pause offers after payment update.");
  }
};

const syncBusinessPaymentMethodFromCustomer = async (
  supabase: any,
  customerId: string,
) => {
  const snapshot = await getPaymentMethodSnapshot(customerId);
  const { data, error } = await supabase
    .from("businesses")
    .update({
      stripe_payment_method_id: snapshot.paymentMethodId,
      stripe_payment_method_brand: snapshot.brand,
      stripe_payment_method_last4: snapshot.last4,
    })
    .eq("stripe_customer_id", customerId)
    .select("id");
  if (error) {
    throw new Error(error.message || "Failed to sync business payment method.");
  }

  if (!snapshot.paymentMethodId) {
    const businessIds = Array.isArray(data)
      ? data
        .map((row) => asNonEmptyString((row as { id?: string | null }).id))
        .filter((value): value is string => Boolean(value))
      : [];
    await pauseActiveOffersForBusinesses(supabase, businessIds);
  }
};

const clearBusinessPaymentMethodFromCustomer = async (
  supabase: any,
  customerId: string,
) => {
  const { data, error } = await supabase
    .from("businesses")
    .update({
      stripe_payment_method_id: null,
      stripe_payment_method_brand: null,
      stripe_payment_method_last4: null,
    })
    .eq("stripe_customer_id", customerId)
    .select("id");
  if (error) {
    throw new Error(error.message || "Failed to clear business payment method.");
  }

  const businessIds = Array.isArray(data)
    ? data
      .map((row) => asNonEmptyString((row as { id?: string | null }).id))
      .filter((value): value is string => Boolean(value))
    : [];
  await pauseActiveOffersForBusinesses(supabase, businessIds);
};

const clearBusinessPaymentMethodByPaymentMethodId = async (
  supabase: any,
  paymentMethodId: string,
) => {
  const { data, error } = await supabase
    .from("businesses")
    .update({
      stripe_payment_method_id: null,
      stripe_payment_method_brand: null,
      stripe_payment_method_last4: null,
    })
    .eq("stripe_payment_method_id", paymentMethodId)
    .select("id");
  if (error) {
    throw new Error(
      error.message || "Failed to clear business payment method by payment method id.",
    );
  }

  const businessIds = Array.isArray(data)
    ? data
      .map((row) => asNonEmptyString((row as { id?: string | null }).id))
      .filter((value): value is string => Boolean(value))
    : [];
  await pauseActiveOffersForBusinesses(supabase, businessIds);
};

type BusinessNotificationTarget = {
  id: string;
  name: string;
  email: string | null;
};

const loadBusinessNotificationTarget = async (
  supabase: any,
  invoiceCustomerId: string | null,
  businessIdHint: string | null,
): Promise<BusinessNotificationTarget | null> => {
  let businessRow: { id?: string | null; name?: string | null; owner_id?: string | null } | null =
    null;

  if (businessIdHint) {
    const { data } = await supabase
      .from("businesses")
      .select("id, name, owner_id")
      .eq("id", businessIdHint)
      .maybeSingle();
    businessRow = data || null;
  }

  if (!businessRow && invoiceCustomerId) {
    const { data } = await supabase
      .from("businesses")
      .select("id, name, owner_id")
      .eq("stripe_customer_id", invoiceCustomerId)
      .maybeSingle();
    businessRow = data || null;
  }

  const businessId = asNonEmptyString(businessRow?.id);
  if (!businessId) return null;

  const ownerId = asNonEmptyString(businessRow?.owner_id);
  let email: string | null = null;
  if (ownerId) {
    const { data: ownerProfile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", ownerId)
      .maybeSingle();
    email = asNonEmptyString(ownerProfile?.email);
  }

  return {
    id: businessId,
    name: asNonEmptyString(businessRow?.name) || "Wello business",
    email,
  };
};

const updateOffersStatusForBusiness = async (
  supabase: any,
  businessId: string,
  fromStatus: string,
  toStatus: string,
  activeFlag: boolean,
) => {
  const payload = {
    status: toStatus,
    active: activeFlag,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("offers")
    .update(payload)
    .eq("business_id", businessId)
    .eq("status", fromStatus);
  if (!error) return;

  // Fallback for environments where status column migration is not yet applied.
  const code = String((error as { code?: string } | null)?.code || "");
  if (code === "42703") {
    const fallback = await supabase
      .from("offers")
      .update({ active: activeFlag, updated_at: new Date().toISOString() })
      .eq("business_id", businessId)
      .eq("active", !activeFlag);
    if (!fallback.error) return;
    throw new Error(fallback.error.message || "Failed to update offers state.");
  }
  throw new Error(error.message || "Failed to update offers state.");
};

const insertBusinessPaymentEvent = async (
  supabase: any,
  row: {
    business_id: string;
    stripe_customer_id: string | null;
    stripe_invoice_id: string;
    event_type: string;
    amount: number;
    status: string;
  },
) => {
  const { error } = await supabase.from("business_payment_events").insert(row);
  if (error) {
    console.warn("stripe-webhook business_payment_events insert failed", {
      message: error.message,
      code: (error as { code?: string } | null)?.code || null,
      eventType: row.event_type,
      businessId: row.business_id,
    });
  }
};

const sendBrevoEmail = async (
  payload: { to: string | null; subject: string; html: string },
) => {
  const recipient = asNonEmptyString(payload.to);
  if (!recipient || !BREVO_API_KEY) return { delivered: false };
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { email: BREVO_FROM_EMAIL, name: "Wello" },
        to: [{ email: recipient }],
        subject: payload.subject,
        htmlContent: payload.html,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn("stripe-webhook brevo email failed", {
        status: response.status,
        responseText: text.slice(0, 500),
      });
      return { delivered: false };
    }
    return { delivered: true };
  } catch (error) {
    console.warn("stripe-webhook brevo email exception", error);
    return { delivered: false };
  }
};

const sendResendEmail = async (
  payload: { to: string | null; subject: string; html: string },
) => {
  const recipient = asNonEmptyString(payload.to);
  if (!recipient || !RESEND_API_KEY) return { delivered: false };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [recipient],
        subject: payload.subject,
        html: payload.html,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn("stripe-webhook resend email failed", {
        status: response.status,
        responseText: text.slice(0, 500),
      });
      return { delivered: false };
    }
    return { delivered: true };
  } catch (error) {
    console.warn("stripe-webhook resend email exception", error);
    return { delivered: false };
  }
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
    return new Response("Missing server configuration.", { status: 500 });
  }

  const signature =
    req.headers.get("Stripe-Signature") ??
    req.headers.get("stripe-signature");
  const webhookSecrets = STRIPE_WEBHOOK_SECRET.split(",")
    .map((entry) =>
      entry
        .trim()
        .replace(/\s+/g, "")
        .replace(/^['"]|['"]$/g, ""),
    )
    .filter(Boolean);
  if (!signature || webhookSecrets.length === 0) {
    return new Response(
      JSON.stringify({
        error: "Missing webhook signature.",
        signaturePresent: Boolean(signature),
        secretCount: webhookSecrets.length,
      }),
      { status: 400 },
    );
  }

  const body = await req.text();
  let event: Stripe.Event | null = null;
  let lastError: unknown = null;
  for (const secret of webhookSecrets) {
    try {
      event = await stripe.webhooks.constructEventAsync(
        body,
        signature,
        secret,
        Number.isFinite(STRIPE_WEBHOOK_TOLERANCE_SECONDS)
          ? STRIPE_WEBHOOK_TOLERANCE_SECONDS
          : undefined,
      );
      break;
    } catch (_error) {
      // Try next secret.
      lastError = _error;
    }
  }
  if (!event) {
    return new Response(
      JSON.stringify({
        error: "Invalid signature",
        secretCount: webhookSecrets.length,
        invalidReason:
          (lastError as { message?: string } | null)?.message ?? null,
      }),
      { status: 400 },
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode === "setup") {
      const customerId = session.customer as string | null;
      const setupIntentId = session.setup_intent as string | null;
      if (customerId && setupIntentId) {
        const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
        const paymentMethodId = setupIntent.payment_method as string | null;
        if (paymentMethodId) {
          const paymentMethod = await stripe.paymentMethods.retrieve(
            paymentMethodId,
          );
          const attachedCustomerId = typeof paymentMethod.customer === "string"
            ? paymentMethod.customer
            : asNonEmptyString(paymentMethod.customer?.id);
          if (attachedCustomerId && attachedCustomerId !== customerId) {
            throw new Error(
              "Setup payment method is attached to a different Stripe customer.",
            );
          }
          if (!attachedCustomerId) {
            await stripe.paymentMethods.attach(paymentMethodId, {
              customer: customerId,
            });
          }
          await stripe.customers.update(customerId, {
            invoice_settings: { default_payment_method: paymentMethodId },
          });
          await syncBusinessPaymentMethodFromCustomer(supabase, customerId);
        }
      }
    }
  }

  if (
    event.type === "customer.updated" ||
    event.type === "payment_method.attached" ||
    event.type === "payment_method.detached"
  ) {
    let customerId: string | null = null;
    if (event.type === "customer.updated") {
      const customer = event.data.object as Stripe.Customer;
      customerId = asNonEmptyString(customer.id);
    } else {
      const paymentMethod = event.data.object as Stripe.PaymentMethod;
      if (event.type === "payment_method.attached") {
        const paymentMethodId = asNonEmptyString(paymentMethod.id);
        const attachedCustomerId = typeof paymentMethod.customer === "string"
          ? asNonEmptyString(paymentMethod.customer)
          : asNonEmptyString(paymentMethod.customer?.id);
        if (paymentMethodId && attachedCustomerId) {
          await stripe.customers.update(attachedCustomerId, {
            invoice_settings: { default_payment_method: paymentMethodId },
          });
        }
      }
      if (event.type === "payment_method.detached") {
        console.log("stripe-webhook payment_method.detached", {
          paymentMethodId: asNonEmptyString(paymentMethod.id),
          paymentMethodCustomer:
            typeof paymentMethod.customer === "string"
              ? asNonEmptyString(paymentMethod.customer)
              : asNonEmptyString(paymentMethod.customer?.id),
          rawCustomerType:
            paymentMethod.customer === null
              ? "null"
              : Array.isArray(paymentMethod.customer)
                ? "array"
                : typeof paymentMethod.customer,
        });
      }
      customerId = typeof paymentMethod.customer === "string"
        ? asNonEmptyString(paymentMethod.customer)
        : asNonEmptyString(paymentMethod.customer?.id);
      if (!customerId && event.type === "payment_method.detached") {
        const paymentMethodId = asNonEmptyString(paymentMethod.id);
        if (paymentMethodId) {
          await clearBusinessPaymentMethodByPaymentMethodId(
            supabase,
            paymentMethodId,
          );
        }
      }
    }
    if (customerId) {
      await syncBusinessPaymentMethodFromCustomer(supabase, customerId);
    }
  }

  if (event.type === "customer.deleted") {
    const customer = event.data.object as Stripe.DeletedCustomer;
    const customerId = asNonEmptyString(customer.id);
    if (customerId) {
      await clearBusinessPaymentMethodFromCustomer(supabase, customerId);
    }
  }

  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const purpose = account.metadata?.purpose;
    const cashoutUserId = account.metadata?.user_id;
    if (purpose === "consumer_cashout" && cashoutUserId) {
      const bankSnapshot = getExternalBankSnapshot(account);
      const syncedAt = new Date().toISOString();
      await supabase
        .from("profiles")
        .update({
          stripe_cashout_payouts_enabled: account.payouts_enabled ?? false,
          stripe_cashout_onboarded_at: account.payouts_enabled
            ? syncedAt
            : null,
          stripe_cashout_external_account_id: bankSnapshot.externalAccountId,
          stripe_cashout_account_label: bankSnapshot.label,
          stripe_cashout_bank_synced_at: syncedAt,
        })
        .eq("id", cashoutUserId);
    } else {
      const nowIso = new Date().toISOString();
      const businessUpdate = {
        stripe_charges_enabled: account.charges_enabled ?? false,
        stripe_payouts_enabled: account.payouts_enabled ?? false,
        stripe_onboarded_at: account.charges_enabled
          ? nowIso
          : null,
        ...(account.charges_enabled
          ? {
              stripe_account_id: account.id,
              stripe_pending_account_id: null,
            }
          : {}),
      };

      await supabase
        .from("businesses")
        .update(businessUpdate)
        .or(
          `stripe_account_id.eq.${account.id},stripe_pending_account_id.eq.${account.id}`,
        );
    }
  }

  if (
    event.type === "account.external_account.created" ||
    event.type === "account.external_account.updated" ||
    event.type === "account.external_account.deleted"
  ) {
    const connectedAccountId = String(event.account || "").trim();
    if (connectedAccountId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("stripe_cashout_account_id", connectedAccountId)
        .maybeSingle();
      if (profile?.id) {
        try {
          const account = await stripe.accounts.retrieve(connectedAccountId);
          const bankSnapshot = getExternalBankSnapshot(account);
          const syncedAt = new Date().toISOString();
          await supabase
            .from("profiles")
            .update({
              stripe_cashout_external_account_id: bankSnapshot.externalAccountId,
              stripe_cashout_account_label: bankSnapshot.label,
              stripe_cashout_bank_synced_at: syncedAt,
              stripe_cashout_payouts_enabled: account.payouts_enabled ?? false,
              stripe_cashout_onboarded_at: account.payouts_enabled
                ? syncedAt
                : null,
            })
            .eq("id", profile.id);
        } catch (externalSyncError) {
          console.warn(
            "stripe-webhook external account sync failed",
            externalSyncError,
          );
        }
      }
    }
  }

  if (
    event.type === "invoice.created" ||
    event.type === "invoice.finalized" ||
    event.type === "invoice.payment_succeeded" ||
    event.type === "invoice.payment_failed" ||
    event.type === "invoice.payment_action_required" ||
    event.type === "invoice.voided"
  ) {
    const invoice = event.data.object as Stripe.Invoice;
    const invoiceId = invoice.id;
    const customerId = invoice.customer as string | null;
    const businessIdFromMeta = invoice.metadata?.business_id;
    let businessId = businessIdFromMeta || null;
    if (!businessId && customerId) {
      const { data: business } = await supabase
        .from("businesses")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      businessId = business?.id ?? null;
    }

    if (businessId && invoiceId) {
      const amountCents =
        typeof invoice.amount_due === "number"
          ? invoice.amount_due
          : typeof invoice.total === "number"
            ? invoice.total
            : 0;
      const periodStart = invoice.metadata?.period_start || null;
      const periodEnd = invoice.metadata?.period_end || null;
      await supabase.from("commission_invoices").upsert(
        {
          business_id: businessId,
          stripe_invoice_id: invoiceId,
          period_start: periodStart,
          period_end: periodEnd,
          amount_cents: amountCents,
          status: invoice.status || "open",
        },
        { onConflict: "stripe_invoice_id" },
      );

      const hasPeriod = Boolean(periodStart && periodEnd);
      if (event.type === "invoice.payment_succeeded") {
        const updateQuery = supabase
          .from("commission_events")
          .update({ status: "paid" })
          .eq("business_id", businessId)
          .eq("status", "invoiced");
        if (hasPeriod) {
          await updateQuery
            .gte("created_at", `${periodStart}T00:00:00.000Z`)
            .lt("created_at", `${periodEnd}T00:00:00.000Z`);
        } else {
          await updateQuery;
        }
      }

      if (event.type === "invoice.payment_failed") {
        const updateQuery = supabase
          .from("commission_events")
          .update({ status: "failed" })
          .eq("business_id", businessId)
          .eq("status", "invoiced");
        if (hasPeriod) {
          await updateQuery
            .gte("created_at", `${periodStart}T00:00:00.000Z`)
            .lt("created_at", `${periodEnd}T00:00:00.000Z`);
        } else {
          await updateQuery;
        }
      }

      if (event.type === "invoice.voided") {
        const updateQuery = supabase
          .from("commission_events")
          .update({ status: "failed" })
          .eq("business_id", businessId)
          .eq("status", "invoiced");
        if (hasPeriod) {
          await updateQuery
            .gte("created_at", `${periodStart}T00:00:00.000Z`)
            .lt("created_at", `${periodEnd}T00:00:00.000Z`);
        } else {
          await updateQuery;
        }
      }

      try {
        const paymentBusiness = await loadBusinessNotificationTarget(
          supabase,
          asNonEmptyString(customerId),
          asNonEmptyString(businessId),
        );
        if (!paymentBusiness) {
          return new Response(JSON.stringify({ received: true }), { status: 200 });
        }

        if (event.type === "invoice.payment_failed") {
          await updateOffersStatusForBusiness(
            supabase,
            paymentBusiness.id,
            "active",
            "paused",
            false,
          );
          await insertBusinessPaymentEvent(supabase, {
            business_id: paymentBusiness.id,
            stripe_customer_id: asNonEmptyString(customerId),
            stripe_invoice_id: invoiceId,
            event_type: "payment_failed",
            amount: Number((Number(invoice.amount_due || 0) / 100).toFixed(2)),
            status: "failed",
          });
          await sendBrevoEmail({
            to: paymentBusiness.email,
            subject: "Action Required - Your Wello Offers Have Been Paused",
            html: `
              <p>Hi ${paymentBusiness.name},</p>
              <p>We were unable to process your recent Wello invoice of <strong>$${moneyLabelFromCents(invoice.amount_due || 0)}</strong>.</p>
              <p>Your active offers on Wello have been temporarily paused and are no longer visible to users.</p>
              <p>To reactivate your offers, please update your payment method in your Wello business dashboard.</p>
              <p>Once payment is processed, your offers will be automatically reactivated within minutes.</p>
              <p>Questions? Email us at support@wellopartners.com</p>
              <p>- The Wello Team</p>
            `,
          });
          await sendResendEmail({
            to: WITHDRAWAL_ADMIN_EMAIL,
            subject: `[Wello] Payment Failed - ${paymentBusiness.name}`,
            html: `
              <p>Business: ${paymentBusiness.name}</p>
              <p>Business ID: ${paymentBusiness.id}</p>
              <p>Stripe Customer: ${asNonEmptyString(customerId) || ""}</p>
              <p>Invoice ID: ${invoiceId}</p>
              <p>Amount: $${moneyLabelFromCents(invoice.amount_due || 0)}</p>
              <p>Their offers have been automatically paused.</p>
            `,
          });
        }

        if (event.type === "invoice.payment_succeeded") {
          const { data: priorFailure } = await supabase
            .from("business_payment_events")
            .select("id")
            .eq("business_id", paymentBusiness.id)
            .eq("event_type", "payment_failed")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (priorFailure?.id) {
            await updateOffersStatusForBusiness(
              supabase,
              paymentBusiness.id,
              "paused",
              "active",
              true,
            );
            await insertBusinessPaymentEvent(supabase, {
              business_id: paymentBusiness.id,
              stripe_customer_id: asNonEmptyString(customerId),
              stripe_invoice_id: invoiceId,
              event_type: "payment_recovered",
              amount: Number((Number(invoice.amount_paid || 0) / 100).toFixed(2)),
              status: "paid",
            });
            await sendBrevoEmail({
              to: paymentBusiness.email,
              subject: "Payment Confirmed - Your Wello Offers Are Live Again",
              html: `
                <p>Hi ${paymentBusiness.name},</p>
                <p>Your payment has been processed successfully.</p>
                <p>Your offers are now active again and visible to Wello users.</p>
                <p>Thank you for being a Wello partner.</p>
                <p>- The Wello Team</p>
              `,
            });
          }
        }

        if (event.type === "invoice.payment_action_required") {
          await insertBusinessPaymentEvent(supabase, {
            business_id: paymentBusiness.id,
            stripe_customer_id: asNonEmptyString(customerId),
            stripe_invoice_id: invoiceId,
            event_type: "payment_action_required",
            amount: Number((Number(invoice.amount_due || 0) / 100).toFixed(2)),
            status: "action_required",
          });
          await sendBrevoEmail({
            to: paymentBusiness.email,
            subject: "Action Required - Complete Your Wello Payment",
            html: `
              <p>Hi ${paymentBusiness.name},</p>
              <p>Your recent Wello payment requires additional authentication to complete.</p>
              <p>Please log into your Wello business dashboard and complete the payment verification.</p>
              <p>Your offers will remain active while you complete this step.</p>
              <p>Questions? Email us at support@wellopartners.com</p>
              <p>- The Wello Team</p>
            `,
          });
        }
      } catch (paymentStateError) {
        console.warn("stripe-webhook payment lifecycle extension failed", {
          invoiceId,
          customerId,
          eventType: event.type,
          message: (paymentStateError as { message?: string } | null)?.message ||
            String(paymentStateError),
        });
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
