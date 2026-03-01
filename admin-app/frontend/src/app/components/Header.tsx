import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Bell, Search, Settings, ChevronDown, LogOut } from "lucide-react";

const pageTitles: Record<string, string> = {
  "/": "Dashboard Overview",
  "/users": "User Management",
  "/businesses": "Business Management",
  "/offers": "Offers Management",
  "/redemptions": "Redemptions",
  "/receipt-reviews": "Receipt Reviews",
  "/bank-verification": "Bank Verification",
  "/cashback-payouts": "Cashback Payouts",
  "/fraud-disputes": "Fraud & Disputes",
  "/notifications": "Notifications Center",
  "/support-tickets": "Support Tickets",
  "/reports": "Reports & Analytics",
  "/settings": "Settings",
  "/admin-roles": "Admin Roles",
  "/help": "Help",
};

const quickNavTargets: Array<{ path: string; label: string }> = [
  { path: "/", label: "Dashboard" },
  { path: "/users", label: "Users" },
  { path: "/businesses", label: "Businesses" },
  { path: "/offers", label: "Offers" },
  { path: "/redemptions", label: "Redemptions" },
  { path: "/receipt-reviews", label: "Receipt Reviews" },
  { path: "/bank-verification", label: "Bank Verification" },
  { path: "/cashback-payouts", label: "Cashback Payouts" },
  { path: "/fraud-disputes", label: "Fraud & Disputes" },
  { path: "/notifications", label: "Notifications" },
  { path: "/support-tickets", label: "Support Tickets" },
  { path: "/reports", label: "Reports" },
  { path: "/settings", label: "Settings" },
  { path: "/admin-roles", label: "Admin Roles" },
  { path: "/help", label: "Help" },
];

const findBestRoute = (query: string) => {
  const normalized = query.toLowerCase().trim();
  if (!normalized) return null;
  const exact = quickNavTargets.find(
    (item) =>
      item.label.toLowerCase() === normalized || item.path.replace("/", "") === normalized,
  );
  if (exact) return exact;
  return quickNavTargets.find(
    (item) =>
      item.label.toLowerCase().includes(normalized) ||
      item.path.replace("/", "").includes(normalized),
  );
};

export function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const pageTitle = pageTitles[location.pathname] || "Wello Admin";

  const runQuickNav = () => {
    const target = findBestRoute(searchQuery);
    if (!target) return;
    setSearchQuery("");
    navigate(target.path);
  };

  const signOut = () => {
    window.location.assign("/cdn-cgi/access/logout");
  };

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{pageTitle}</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Quick navigate..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  runQuickNav();
                }
              }}
              className="pl-10 pr-4 py-2 w-80 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-gray-50"
            />
          </div>
          
          <button
            type="button"
            onClick={() => navigate("/notifications")}
            className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Bell className="w-5 h-5 text-gray-600" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full"></span>
          </button>
          
          <button
            type="button"
            onClick={() => navigate("/settings")}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Settings className="w-5 h-5 text-gray-600" />
          </button>
          
          <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
            <div className="w-9 h-9 bg-gradient-to-br from-amber-400 to-amber-600 rounded-full flex items-center justify-center">
              <span className="text-white font-medium text-sm">AD</span>
            </div>
            <div className="text-left">
              <p className="text-sm font-medium text-gray-900">Admin User</p>
              <p className="text-xs text-gray-500">Super Admin</p>
            </div>
            <ChevronDown className="w-4 h-4 text-gray-400" />
          </div>

          <button
            type="button"
            onClick={signOut}
            className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
