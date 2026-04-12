import dotenv from "dotenv";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.EDGE_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EDGE_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EDGE_SERVICE_ROLE_KEY ||
  "";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
  console.error("Missing required env vars.", {
    SUPABASE_URL: Boolean(SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    STRIPE_SECRET_KEY: Boolean(STRIPE_SECRET_KEY),
  });
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const asNonEmptyString = (value) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length ? normalized : null;
};

const updateOffersStatusForBusiness = async (businessId, fromStatus, toStatus, activeFlag) => {
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

  if (String(error.code || "") === "42703") {
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

const getPaymentMethodSnapshot = async (customerId) => {
  const customer = await stripe.customers.retrieve(customerId, {
    expand: ["invoice_settings.default_payment_method"],
  });
  if (!customer || customer.deleted) {
    return {
      paymentMethodId: null,
      brand: null,
      last4: null,
    };
  }

  const defaultPaymentMethod = customer.invoice_settings?.default_payment_method;
  if (defaultPaymentMethod) {
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
  }

  const paymentMethods = await stripe.paymentMethods.list({
    customer: customerId,
    type: "card",
    limit: 1,
  });
  const fallbackPaymentMethod = paymentMethods.data?.[0] ?? null;
  return {
    paymentMethodId: asNonEmptyString(fallbackPaymentMethod?.id),
    brand: fallbackPaymentMethod?.card?.brand ?? null,
    last4: fallbackPaymentMethod?.card?.last4 ?? null,
  };
};

const main = async () => {
  const { data, error } = await supabase
    .from("businesses")
    .select(
      "id, name, stripe_account_id, stripe_customer_id, stripe_payment_method_id, stripe_payment_method_brand, stripe_payment_method_last4, stripe_charges_enabled, stripe_payouts_enabled, stripe_onboarded, stripe_gated, stripe_onboarded_at",
    )
    .not("stripe_account_id", "is", null)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message || "Failed to load businesses.");
  }

  const businesses = Array.isArray(data) ? data : [];
  const summary = {
    processed: 0,
    updated: 0,
    paused: 0,
    failed: 0,
  };

  for (const business of businesses) {
    summary.processed += 1;
    const businessId = business.id;
    const stripeAccountId = asNonEmptyString(business.stripe_account_id);
    const stripeCustomerId = asNonEmptyString(business.stripe_customer_id);

    try {
      if (!stripeAccountId) {
        console.warn("Skipping business with missing stripe_account_id", {
          businessId,
          name: business.name,
        });
        continue;
      }

      const account = await stripe.accounts.retrieve(stripeAccountId);
      const stripeOnboarded = Boolean(
        account.details_submitted && account.charges_enabled,
      );

      let paymentMethodSnapshot = {
        paymentMethodId: null,
        brand: null,
        last4: null,
      };
      if (stripeCustomerId) {
        paymentMethodSnapshot = await getPaymentMethodSnapshot(stripeCustomerId);
      }

      const stripeGated =
        stripeOnboarded && Boolean(paymentMethodSnapshot.paymentMethodId);

      const previous = {
        stripeOnboarded: Boolean(business.stripe_onboarded),
        stripeGated: Boolean(business.stripe_gated),
        paymentMethodId: asNonEmptyString(business.stripe_payment_method_id),
      };
      const next = {
        stripeOnboarded,
        stripeGated,
        paymentMethodId: paymentMethodSnapshot.paymentMethodId,
      };

      const { error: updateError } = await supabase
        .from("businesses")
        .update({
          stripe_charges_enabled: Boolean(account.charges_enabled),
          stripe_payouts_enabled: Boolean(account.payouts_enabled),
          stripe_payment_method_id: paymentMethodSnapshot.paymentMethodId,
          stripe_payment_method_brand: paymentMethodSnapshot.brand,
          stripe_payment_method_last4: paymentMethodSnapshot.last4,
          stripe_onboarded: stripeOnboarded,
          stripe_gated: stripeGated,
          stripe_onboarded_at: stripeOnboarded
            ? asNonEmptyString(business.stripe_onboarded_at) || new Date().toISOString()
            : null,
        })
        .eq("id", businessId);

      if (updateError) {
        throw new Error(updateError.message || "Failed to update business.");
      }

      console.log("Backfilled business stripe flags", {
        businessId,
        name: business.name,
        previous,
        next,
      });

      summary.updated += 1;

      if (!stripeGated) {
        await updateOffersStatusForBusiness(businessId, "active", "paused", false);
        summary.paused += 1;
      }
    } catch (syncError) {
      summary.failed += 1;
      console.warn("Failed to backfill business", {
        businessId,
        name: business.name,
        stripeAccountId,
        message: syncError?.message || String(syncError),
      });
    }
  }

  console.log("Stripe flag backfill complete", summary);
};

main().catch((error) => {
  console.error("Stripe flag backfill failed", error);
  process.exit(1);
});
