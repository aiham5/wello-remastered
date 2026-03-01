const usdFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const formatCurrencyFromCents = (cents) => usdFormatter.format((Number(cents) || 0) / 100);

export const formatDate = (value) => {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString();
};

export const formatDateTime = (value) => {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
};

export const centsFromDollars = (value) => {
  const text = String(value ?? "").replace(/[$,\s]/g, "").trim();
  if (!text) return null;
  const amount = Number(text);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
};

export const dollarsFromCents = (cents) => ((Number(cents) || 0) / 100).toFixed(2);

export const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => {
  switch (char) {
    case "&": return "&amp;";
    case "<": return "&lt;";
    case ">": return "&gt;";
    case '"': return "&quot;";
    case "'": return "&#39;";
    default: return char;
  }
});

export const toUserFacingError = (message, fallback = "Something went wrong.") => {
  const raw = String(message || "").trim();
  if (!raw) return fallback;
  const lower = raw.toLowerCase();
  if (lower.includes("jwt") || lower.includes("session") || lower.includes("token")) return "Session expired. Please sign in again.";
  if (lower.includes("permission") || lower.includes("forbidden") || lower.includes("not authorized")) return "You do not have permission for this action.";
  if (lower.includes("duplicate") || lower.includes("already exists") || lower.includes("23505")) return "This action was already completed.";
  if (lower.includes("network") || lower.includes("failed to fetch") || lower.includes("timeout")) return "Network issue. Please try again.";
  return fallback;
};
