type StripeLike = {
  customers: {
    retrieve: (customerId: string) => Promise<unknown>;
    create: (params: Record<string, unknown>) => Promise<unknown>;
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

type ResolveStripeBusinessCustomerArgs = {
  stripe: StripeLike;
  currentCustomerId: unknown;
  businessName?: unknown;
  email?: unknown;
  businessId?: unknown;
  context: string;
};

const customerLooksReusable = (
  customer: Record<string, unknown>,
  desiredBusinessId: string,
  desiredEmail: string,
) => {
  const existingBusinessId = normalizeSpace(
    (customer.metadata as Record<string, unknown> | undefined)?.business_id,
  );
  const existingEmail = normalizeEmail(customer.email);

  if (existingBusinessId && desiredBusinessId && existingBusinessId !== desiredBusinessId) {
    return false;
  }
  if (!existingBusinessId && desiredEmail && existingEmail && existingEmail !== desiredEmail) {
    return false;
  }
  return true;
};

export const resolveStripeBusinessCustomer = async ({
  stripe,
  currentCustomerId,
  businessName,
  email,
  businessId,
  context,
}: ResolveStripeBusinessCustomerArgs): Promise<string> => {
  const desiredBusinessId = normalizeSpace(businessId);
  const desiredName = normalizeSpace(businessName);
  const desiredEmail = normalizeEmail(email);
  const normalizedCustomerId = normalizeStripeCustomerId(currentCustomerId);

  if (normalizedCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(normalizedCustomerId);
      const existingRecord =
        existing && typeof existing === "object"
          ? (existing as Record<string, unknown>)
          : null;
      const deleted = Boolean(existingRecord?.deleted);
      if (
        existingRecord &&
        !deleted &&
        customerLooksReusable(existingRecord, desiredBusinessId, desiredEmail)
      ) {
        return normalizedCustomerId;
      }
    } catch (error) {
      const message = String(error?.message || "").toLowerCase();
      const code = String(error?.code || "").toLowerCase();
      const type = String(error?.type || "").toLowerCase();
      const noAccess = message.includes("does not have access to customer");
      const isMissing =
        code === "resource_missing" || message.includes("no such customer");
      const isInvalid =
        code === "customer_invalid" || noAccess || type === "stripepermissionerror";
      if (!isMissing && !isInvalid) {
        throw error;
      }
      console.warn("stripe-customer-resolve retrieve failed", {
        context,
        businessId: desiredBusinessId || null,
        customerId: normalizedCustomerId,
        error: error?.message || String(error),
      });
    }
  }

  const created = await stripe.customers.create({
    ...(desiredName ? { name: desiredName } : {}),
    ...(desiredEmail ? { email: desiredEmail } : {}),
    ...(desiredBusinessId
      ? { metadata: { business_id: desiredBusinessId } }
      : {}),
  });
  const createdId = normalizeStripeCustomerId((created as { id?: unknown })?.id);
  if (!createdId) {
    throw new Error("Stripe customer creation did not return a valid customer id.");
  }
  return createdId;
};
