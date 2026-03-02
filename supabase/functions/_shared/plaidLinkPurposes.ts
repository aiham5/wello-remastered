import { HttpError } from "./auth.ts";

export type PlaidLinkPurpose = "cashout" | "receipt_verification";

const VALID_PURPOSES: PlaidLinkPurpose[] = ["cashout", "receipt_verification"];

export const normalizePlaidLinkPurposes = (
  value: unknown,
): PlaidLinkPurpose[] => {
  const raw = Array.isArray(value) ? value : [value];
  const set = new Set<PlaidLinkPurpose>();
  raw.forEach((entry) => {
    const normalized = String(entry || "").trim().toLowerCase();
    if (normalized === "cashout" || normalized === "receipt_verification") {
      set.add(normalized);
    }
  });
  return [...set];
};

export const parsePlaidLinkPurpose = (
  value: unknown,
  {
    allowLegacyBoth = true,
    field = "purpose",
  }: { allowLegacyBoth?: boolean; field?: string } = {},
): PlaidLinkPurpose[] => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized && allowLegacyBoth) return [...VALID_PURPOSES];
  if (normalized === "cashout") return ["cashout"];
  if (normalized === "receipt_verification") return ["receipt_verification"];
  throw new HttpError(`Invalid ${field}.`, 400, {
    reason: "invalid_link_purpose",
    allowedPurposes: VALID_PURPOSES,
  });
};

export const mergePlaidLinkPurposes = (
  existing: unknown,
  incoming: PlaidLinkPurpose[],
): PlaidLinkPurpose[] => {
  const merged = new Set<PlaidLinkPurpose>(normalizePlaidLinkPurposes(existing));
  incoming.forEach((purpose) => merged.add(purpose));
  const values = [...merged];
  return values.length > 0 ? values : [...VALID_PURPOSES];
};

export const hasPlaidLinkPurpose = (
  value: unknown,
  purpose: PlaidLinkPurpose,
): boolean => {
  return normalizePlaidLinkPurposes(value).includes(purpose);
};
