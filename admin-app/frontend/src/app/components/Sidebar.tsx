import { NavLink, useNavigate } from "react-router";
import { 
  LayoutDashboard, 
  Users, 
  Store,
  Tag,
  ShoppingCart,
  Receipt,
  CreditCard,
  DollarSign,
  ShieldAlert,
  Bell,
  MessageSquare,
  BarChart3,
  Settings,
  UserCog,
  LifeBuoy
} from "lucide-react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/users", icon: Users, label: "Users" },
  { to: "/businesses", icon: Store, label: "Businesses" },
  { to: "/offers", icon: Tag, label: "Offers" },
  { to: "/redemptions", icon: ShoppingCart, label: "Redemptions" },
  { to: "/receipt-reviews", icon: Receipt, label: "Receipt Reviews" },
  { to: "/bank-verification", icon: CreditCard, label: "Bank Verification" },
  { to: "/cashback-payouts", icon: DollarSign, label: "Cashback Payouts" },
  { to: "/fraud-disputes", icon: ShieldAlert, label: "Fraud & Disputes" },
  { to: "/notifications", icon: Bell, label: "Notifications" },
  { to: "/support-tickets", icon: MessageSquare, label: "Support Tickets" },
  { to: "/reports", icon: BarChart3, label: "Reports" },
  { to: "/settings", icon: Settings, label: "Settings" },
  { to: "/admin-roles", icon: UserCog, label: "Admin Roles" },
  { to: "/help", icon: LifeBuoy, label: "Help" },
];

export function Sidebar() {
  const navigate = useNavigate();
  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <img
            src="/assets/wello-mark.png"
            alt="Wello"
            className="w-8 h-8 object-contain"
          />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Wello</h1>
            <p className="text-xs text-gray-500">Admin Dashboard</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 transition-all ${
                isActive
                  ? "bg-amber-50 text-amber-900 font-medium"
                  : "text-gray-700 hover:bg-gray-50"
              }`
            }
          >
            <item.icon className="w-5 h-5" />
            <span className="text-sm">{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-gray-200">
        <div className="bg-gradient-to-br from-yellow-50 to-amber-50 rounded-lg p-4 border border-amber-200">
          <p className="text-xs font-medium text-gray-900 mb-1">Need help?</p>
          <p className="text-xs text-gray-600 mb-3">Check our documentation</p>
          <button
            type="button"
            onClick={() => navigate("/help")}
            className="w-full px-3 py-1.5 bg-amber-500 text-white rounded-md text-xs hover:bg-amber-600 transition-colors"
          >
            View Docs
          </button>
        </div>
      </div>
    </aside>
  );
}
