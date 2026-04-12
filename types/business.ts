export type BusinessRole = "owner" | "admin" | "staff";

export interface Business {
  id: string;
  ownerId: string | null;
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  imageUrl: string;
  categoryKey: string;
  categoryLabel: string;
  offerHighlight: string | null;
  hours: string;
  tags: string[];
  merchantDescriptorAliases: string[];
  latitude: number | null;
  longitude: number | null;
  approvalStatus: string | null;
  status: string | null;
  stripeAccountId: string | null;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
  stripePaymentMethodBrand: string | null;
  stripePaymentMethodLast4: string | null;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  stripeOnboardedAt: string | null;
  stripeOnboarded: boolean;
  stripeGated: boolean;
  commissionRateCents: number | null;
  defaultCashbackRateBps: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface BusinessStripeStatus {
  stripeAccountId: string | null;
  onboardingComplete: boolean;
  hasPaymentMethod: boolean;
  stripeOnboarded: boolean;
  stripeGated: boolean;
}

export interface BusinessInsert {
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  imageUrl?: string | null;
  categoryKey?: string | null;
  categoryLabel?: string | null;
  offerHighlight?: string | null;
  hours?: string | null;
  tags?: string[] | null;
  merchantDescriptorAliases?: string[] | null;
  latitude?: number | null;
  longitude?: number | null;
  approvalStatus?: string | null;
  status?: string | null;
  isOpen?: boolean | null;
  offerHonorPolicyAccepted?: boolean | null;
  offerHonorPolicyVersion?: string | null;
  offerHonorPolicyAcceptedAt?: string | null;
  offerHonorPolicyAcceptedBy?: string | null;
}

export interface BusinessMember {
  id: string;
  userId: string;
  businessId: string;
  role: BusinessRole;
  createdAt: string;
}

export interface BusinessWithRole extends Business {
  role: BusinessRole;
}
