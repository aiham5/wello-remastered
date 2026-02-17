type StripeLike = {
  customers: {
    update: (customerId: string, params: Record<string, unknown>) => Promise<unknown>;
  };
};

const normalizeSpace = (value: unknown) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeEmail = (value: unknown) => {
  const email = normalizeSpace(value).toLowerCase();
  if (!email || !email.includes("@")) return "";
  return email;
};

const normalizeStripeCustomerId = (value: unknown) => {
  const customerId = normalizeSpace(value);
  return /^cus_[A-Za-z0-9]+$/.test(customerId) ? customerId : "";
};

type SyncStripeCustomerIdentityArgs = {
  stripe: StripeLike;
  customerId: unknown;
  businessName?: unknown;
  email?: unknown;
  context: string;
  businessId?: unknown;
};

export const syncStripeCustomerIdentity = async ({
  stripe,
  customerId,
  businessName,
  email,
  context,
  businessId,
}: SyncStripeCustomerIdentityArgs) => {
  const normalizedCustomerId = normalizeStripeCustomerId(customerId);
  if (!normalizedCustomerId) return;

  const name = normalizeSpace(businessName);
  const normalizedEmail = normalizeEmail(email);
  const update: Record<string, unknown> = {};
  if (name) update.name = name;
  if (normalizedEmail) update.email = normalizedEmail;
  if (!Object.keys(update).length) return;

  try {
    await stripe.customers.update(normalizedCustomerId, update);
  } catch (error) {
    console.warn("stripe-customer-sync failed", {
      context,
      businessId: businessId ? String(businessId) : null,
      customerId: normalizedCustomerId,
      error: error?.message || String(error),
    });
  }
};
