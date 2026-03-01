import { createHashRouter } from "react-router";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Users } from "./pages/Users";
import { Businesses } from "./pages/Businesses";
import { Offers } from "./pages/Offers";
import { Redemptions } from "./pages/Redemptions";
import { ReceiptReviews } from "./pages/ReceiptReviews";
import { BankVerification } from "./pages/BankVerification";
import { CashbackPayouts } from "./pages/CashbackPayouts";
import { FraudDisputes } from "./pages/FraudDisputes";
import { Notifications } from "./pages/Notifications";
import { SupportTickets } from "./pages/SupportTickets";
import { Reports } from "./pages/Reports";
import { Settings } from "./pages/Settings";
import { AdminRoles } from "./pages/AdminRoles";

export const router = createHashRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Dashboard },
      { path: "users", Component: Users },
      { path: "businesses", Component: Businesses },
      { path: "offers", Component: Offers },
      { path: "redemptions", Component: Redemptions },
      { path: "receipt-reviews", Component: ReceiptReviews },
      { path: "bank-verification", Component: BankVerification },
      { path: "cashback-payouts", Component: CashbackPayouts },
      { path: "fraud-disputes", Component: FraudDisputes },
      { path: "notifications", Component: Notifications },
      { path: "support-tickets", Component: SupportTickets },
      { path: "reports", Component: Reports },
      { path: "settings", Component: Settings },
      { path: "admin-roles", Component: AdminRoles },
    ],
  },
]);
