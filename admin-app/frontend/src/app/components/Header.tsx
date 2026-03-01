import { useLocation } from "react-router";
import { Bell, Search, Settings, ChevronDown } from "lucide-react";

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
};

export function Header() {
  const location = useLocation();
  const pageTitle = pageTitles[location.pathname] || "Wello Admin";

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
              placeholder="Search..."
              className="pl-10 pr-4 py-2 w-80 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-gray-50"
            />
          </div>
          
          <button className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <Bell className="w-5 h-5 text-gray-600" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full"></span>
          </button>
          
          <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
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
        </div>
      </div>
    </header>
  );
}
