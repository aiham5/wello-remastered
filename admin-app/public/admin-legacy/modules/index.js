import { overviewModule } from "./overview.js";
import { receiptReviewModule } from "./receipt-review.js";
import { receiptReportsModule } from "./receipt-reports.js";
import { businessApprovalsModule } from "./business-approvals.js";
import { offerModerationModule } from "./offer-moderation.js";
import { cashoutOpsModule } from "./cashout-ops.js";
import { billingModule } from "./billing.js";
import { promotionsModule } from "./promotions.js";
import { usersRolesModule } from "./users-roles.js";
import { auditEventsModule } from "./audit-events.js";

const MODULE_META = {
  overview: {
    group: "Control Center",
    icon: "OV",
    description: "Operational KPIs, queue pressure, and recent activity.",
  },
  "receipt-review": {
    group: "Moderation",
    icon: "RV",
    description: "Review receipt uploads, validate totals, and finalize decisions.",
  },
  "receipt-reports": {
    group: "Moderation",
    icon: "RP",
    description: "Resolve receipt disputes reported by business owners.",
  },
  "business-approvals": {
    group: "Moderation",
    icon: "BA",
    description: "Approve or reject pending business profiles.",
  },
  "offer-moderation": {
    group: "Moderation",
    icon: "OF",
    description: "Moderate offer submissions and run bulk actions.",
  },
  "cashout-ops": {
    group: "Payouts & Billing",
    icon: "CO",
    description: "Track payout provider status and cashout failures.",
  },
  billing: {
    group: "Payouts & Billing",
    icon: "BL",
    description: "Invoice operations and commission reconciliation.",
  },
  promotions: {
    group: "Growth",
    icon: "PR",
    description: "Manage promo programs and push campaigns.",
  },
  "users-roles": {
    group: "Access & Security",
    icon: "UR",
    description: "Manage staff access and role changes safely.",
  },
  "audit-events": {
    group: "Access & Security",
    icon: "AU",
    description: "Audit logs, webhook traffic, and incident signals.",
  },
};

export const MODULES = [
  overviewModule,
  receiptReviewModule,
  receiptReportsModule,
  businessApprovalsModule,
  offerModerationModule,
  cashoutOpsModule,
  billingModule,
  promotionsModule,
  usersRolesModule,
  auditEventsModule,
].map((module) => ({
  ...module,
  ...(MODULE_META[module.key] || {}),
}));

export const MODULE_MAP = MODULES.reduce((acc, module) => {
  acc[module.key] = module;
  return acc;
}, {});
