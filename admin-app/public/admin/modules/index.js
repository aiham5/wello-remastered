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
];

export const MODULE_MAP = MODULES.reduce((acc, module) => {
  acc[module.key] = module;
  return acc;
}, {});
