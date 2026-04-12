import { supabase } from "./supabase";
import type {
  Business,
  BusinessInsert,
  BusinessRole,
  BusinessStripeStatus,
  BusinessWithRole,
} from "../types/business";

type BusinessRow = Record<string, unknown>;

const toNullableString = (value: unknown) => {
  const normalized = String(value ?? "").trim();
  return normalized || null;
};

const toOptionalNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const toBusiness = (row: BusinessRow): Business => ({
  id: String(row.id || ""),
  ownerId: toNullableString(row.owner_id),
  name: String(row.name || ""),
  address: String(row.address || ""),
  city: String(row.city || ""),
  state: String(row.state || ""),
  postalCode: String(row.postal_code || ""),
  phone: String(row.phone || ""),
  imageUrl: String(row.image_url || ""),
  categoryKey: String(row.category_key || ""),
  categoryLabel: String(row.category_label || ""),
  offerHighlight: toNullableString(row.offer_highlight),
  hours: String(row.hours || ""),
  tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
  merchantDescriptorAliases: Array.isArray(row.merchant_descriptor_aliases)
    ? row.merchant_descriptor_aliases.map(String)
    : [],
  latitude: toOptionalNumber(row.latitude),
  longitude: toOptionalNumber(row.longitude),
  approvalStatus: toNullableString(row.approval_status),
  status: toNullableString(row.status),
  stripeAccountId: toNullableString(row.stripe_account_id),
  stripeCustomerId: toNullableString(row.stripe_customer_id),
  stripePaymentMethodId: toNullableString(row.stripe_payment_method_id),
  stripePaymentMethodBrand: toNullableString(row.stripe_payment_method_brand),
  stripePaymentMethodLast4: toNullableString(row.stripe_payment_method_last4),
  stripeChargesEnabled: Boolean(row.stripe_charges_enabled),
  stripePayoutsEnabled: Boolean(row.stripe_payouts_enabled),
  stripeOnboardedAt: toNullableString(row.stripe_onboarded_at),
  stripeOnboarded: Boolean(row.stripe_onboarded),
  stripeGated: Boolean(row.stripe_gated),
  commissionRateCents: toOptionalNumber(row.commission_rate_cents),
  defaultCashbackRateBps: toOptionalNumber(row.default_cashback_rate_bps),
  createdAt: toNullableString(row.created_at),
  updatedAt: toNullableString(row.updated_at),
});

const toBusinessInsertPayload = (userId: string, data: BusinessInsert) => ({
  owner_id: userId,
  name: String(data.name || "").trim(),
  address: toNullableString(data.address) || "",
  city: toNullableString(data.city),
  state: toNullableString(data.state),
  postal_code: toNullableString(data.postalCode),
  phone: toNullableString(data.phone),
  image_url: toNullableString(data.imageUrl),
  category_key: toNullableString(data.categoryKey),
  category_label: toNullableString(data.categoryLabel),
  offer_highlight: toNullableString(data.offerHighlight),
  hours: toNullableString(data.hours),
  tags: Array.isArray(data.tags) ? data.tags.filter(Boolean) : [],
  merchant_descriptor_aliases: Array.isArray(data.merchantDescriptorAliases)
    ? data.merchantDescriptorAliases.filter(Boolean)
    : [],
  latitude: toOptionalNumber(data.latitude),
  longitude: toOptionalNumber(data.longitude),
  approval_status: toNullableString(data.approvalStatus) || "pending",
  status: toNullableString(data.status) || "active",
  is_open: data.isOpen ?? true,
  offer_honor_policy_accepted: data.offerHonorPolicyAccepted ?? true,
  offer_honor_policy_version: toNullableString(data.offerHonorPolicyVersion),
  offer_honor_policy_accepted_at: toNullableString(data.offerHonorPolicyAcceptedAt),
  offer_honor_policy_accepted_by: toNullableString(data.offerHonorPolicyAcceptedBy),
});

export async function getUserBusinesses(
  userId: string,
): Promise<BusinessWithRole[]> {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return [];

  const { data, error } = await supabase
    .from("business_members")
    .select("role, business:businesses!inner(*)")
    .eq("user_id", normalizedUserId);

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((entry) => {
      const business = entry?.business as BusinessRow | null;
      const role = String(entry?.role || "").trim() as BusinessRole;
      if (!business?.id || !role) return null;
      return {
        ...toBusiness(business),
        role,
      } as BusinessWithRole;
    })
    .filter(Boolean) as BusinessWithRole[];
}

export async function createBusiness(
  userId: string,
  data: BusinessInsert,
): Promise<Business> {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    throw new Error("A signed-in user is required.");
  }

  const payload = toBusinessInsertPayload(normalizedUserId, data);
  const { data: insertedRow, error: insertError } = await supabase
    .from("businesses")
    .insert(payload)
    .select("*")
    .maybeSingle();

  if (insertError || !insertError && !insertedRow) {
    throw insertError || new Error("Unable to create business.");
  }

  const { error: memberError } = await supabase.from("business_members").upsert(
    {
      user_id: normalizedUserId,
      business_id: insertedRow.id,
      role: "owner",
    },
    { onConflict: "user_id,business_id" },
  );

  if (memberError) {
    await supabase.from("businesses").delete().eq("id", insertedRow.id);
    throw memberError;
  }

  return toBusiness(insertedRow as BusinessRow);
}

export async function getBusinessStripeStatus(
  businessId: string,
): Promise<BusinessStripeStatus> {
  const normalizedBusinessId = String(businessId || "").trim();
  if (!normalizedBusinessId) {
    return {
      stripeAccountId: null,
      onboardingComplete: false,
      hasPaymentMethod: false,
      stripeOnboarded: false,
      stripeGated: false,
    };
  }

  const { data, error } = await supabase
    .from("businesses")
    .select(
      [
        "stripe_account_id",
        "stripe_payment_method_id",
        "stripe_charges_enabled",
        "stripe_onboarded",
        "stripe_gated",
      ].join(","),
    )
    .eq("id", normalizedBusinessId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const stripeAccountId = toNullableString(data?.stripe_account_id);
  const hasPaymentMethod = Boolean(toNullableString(data?.stripe_payment_method_id));
  const stripeOnboarded =
    Boolean(data?.stripe_onboarded) ||
    (Boolean(stripeAccountId) && Boolean(data?.stripe_charges_enabled));
  const stripeGated =
    Boolean(data?.stripe_gated) ||
    (stripeOnboarded && hasPaymentMethod);

  return {
    stripeAccountId,
    onboardingComplete: stripeOnboarded,
    hasPaymentMethod,
    stripeOnboarded,
    stripeGated,
  };
}
