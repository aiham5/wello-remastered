import { 
  Users, 
  Store,
  Tag,
  DollarSign,
  ShoppingCart,
  Receipt,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  XCircle
} from "lucide-react";
import { 
  LineChart, 
  Line, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell
} from "recharts";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";

const stats = [
  {
    title: "Total Users",
    value: "48,293",
    change: "+12.5% from last month",
    changeType: "positive" as const,
    icon: Users,
    iconColor: "bg-blue-500",
  },
  {
    title: "Active Users",
    value: "32,147",
    change: "+8.2% from last month",
    changeType: "positive" as const,
    icon: TrendingUp,
    iconColor: "bg-green-500",
  },
  {
    title: "Total Businesses",
    value: "1,247",
    change: "+15 new this week",
    changeType: "positive" as const,
    icon: Store,
    iconColor: "bg-purple-500",
  },
  {
    title: "Active Offers",
    value: "3,892",
    change: "124 expiring soon",
    changeType: "neutral" as const,
    icon: Tag,
    iconColor: "bg-amber-500",
  },
  {
    title: "Total Redemptions",
    value: "127,482",
    change: "+18.3% vs last week",
    changeType: "positive" as const,
    icon: ShoppingCart,
    iconColor: "bg-indigo-500",
  },
  {
    title: "Pending Reviews",
    value: "287",
    change: "42 urgent",
    changeType: "warning" as const,
    icon: Receipt,
    iconColor: "bg-orange-500",
  },
  {
    title: "Pending Payouts",
    value: "$43,287",
    change: "156 requests",
    changeType: "neutral" as const,
    icon: DollarSign,
    iconColor: "bg-red-500",
  },
  {
    title: "Cashback Issued",
    value: "$892,340",
    change: "+22.1% this month",
    changeType: "positive" as const,
    icon: DollarSign,
    iconColor: "bg-teal-500",
  },
];

const redemptionsData = [
  { month: "Jan", redemptions: 8240, revenue: 18200 },
  { month: "Feb", redemptions: 9180, revenue: 21400 },
  { month: "Mar", redemptions: 11250, revenue: 24800 },
  { month: "Apr", redemptions: 13420, revenue: 28300 },
  { month: "May", redemptions: 15680, revenue: 32100 },
  { month: "Jun", redemptions: 18290, revenue: 38500 },
  { month: "Jul", redemptions: 21450, revenue: 42800 },
];

const userGrowthData = [
  { month: "Jan", users: 28400 },
  { month: "Feb", users: 31200 },
  { month: "Mar", users: 34800 },
  { month: "Apr", users: 38200 },
  { month: "May", users: 41600 },
  { month: "Jun", users: 44900 },
  { month: "Jul", users: 48293 },
];

const topBusinesses = [
  { name: "Joe's Coffee", redemptions: 3842, revenue: 8240 },
  { name: "Bella's Pizza", redemptions: 3124, revenue: 7180 },
  { name: "FitZone Gym", redemptions: 2856, revenue: 6420 },
  { name: "Green Grocers", redemptions: 2634, revenue: 5890 },
  { name: "Tech Repairs", redemptions: 2418, revenue: 5320 },
];

const categoryData = [
  { name: "Food & Dining", value: 35, color: "#fbbf24" },
  { name: "Retail", value: 25, color: "#3b82f6" },
  { name: "Health & Fitness", value: 20, color: "#10b981" },
  { name: "Services", value: 12, color: "#8b5cf6" },
  { name: "Entertainment", value: 8, color: "#f59e0b" },
];

const recentActivity = [
  { 
    id: 1,
    user: "Sarah Johnson", 
    action: "Redeemed $15 cashback at Joe's Coffee", 
    time: "2 minutes ago",
    type: "redemption"
  },
  { 
    id: 2,
    user: "Mike Chen", 
    action: "Submitted receipt for verification", 
    time: "8 minutes ago",
    type: "review"
  },
  { 
    id: 3,
    user: "Bella's Pizza", 
    action: "Created new offer: 20% off lunch specials", 
    time: "15 minutes ago",
    type: "offer"
  },
  { 
    id: 4,
    user: "Emma Davis", 
    action: "Requested payout of $47.50", 
    time: "23 minutes ago",
    type: "payout"
  },
  { 
    id: 5,
    user: "Admin Team", 
    action: "Approved 12 pending receipts", 
    time: "1 hour ago",
    type: "admin"
  },
];

const alerts = [
  {
    id: 1,
    title: "Suspicious Activity Detected",
    description: "User #48291 has submitted 5 duplicate receipts",
    severity: "high",
    time: "10 minutes ago"
  },
  {
    id: 2,
    title: "Failed Payout",
    description: "Bank transfer failed for user Emma Davis ($47.50)",
    severity: "high",
    time: "25 minutes ago"
  },
  {
    id: 3,
    title: "Flagged Receipt",
    description: "Receipt #12847 flagged for manual review",
    severity: "medium",
    time: "1 hour ago"
  },
  {
    id: 4,
    title: "New Support Ticket",
    description: "Business owner reports issue with dashboard access",
    severity: "low",
    time: "2 hours ago"
  },
];

export function Dashboard() {
  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <StatCard key={stat.title} {...stat} />
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Redemptions Over Time */}
        <div className="bg-white rounded-lg p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Redemptions & Revenue</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={redemptionsData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="month" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px'
                }}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="redemptions" 
                stroke="#fbbf24" 
                strokeWidth={3}
                name="Redemptions"
              />
              <Line 
                type="monotone" 
                dataKey="revenue" 
                stroke="#3b82f6" 
                strokeWidth={3}
                name="Revenue ($100s)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* User Growth */}
        <div className="bg-white rounded-lg p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">User Growth</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={userGrowthData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="month" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px'
                }}
              />
              <Bar dataKey="users" fill="#10b981" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Middle Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Performing Businesses */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Top Performing Businesses</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Business</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Redemptions</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Revenue</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {topBusinesses.map((business, index) => (
                  <tr key={business.name} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-amber-600 rounded-full flex items-center justify-center text-white font-medium text-sm">
                          {index + 1}
                        </div>
                        <span className="font-medium text-gray-900">{business.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{business.redemptions.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">${business.revenue.toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <StatusBadge status="Active" variant="success" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Category Distribution */}
        <div className="bg-white rounded-lg p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Redemptions by Category</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={categoryData}
                cx="50%"
                cy="50%"
                outerRadius={80}
                dataKey="value"
                label={({ name, value }) => `${name}: ${value}%`}
              >
                {categoryData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Recent Activity</h3>
          </div>
          <div className="divide-y divide-gray-200">
            {recentActivity.map((activity) => (
              <div key={activity.id} className="p-6 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">{activity.user}</p>
                    <p className="text-sm text-gray-600 mt-1">{activity.action}</p>
                  </div>
                  <span className="text-xs text-gray-500 whitespace-nowrap ml-4">{activity.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Alerts */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-6 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Alerts & Issues</h3>
            <span className="px-2.5 py-0.5 bg-red-100 text-red-800 rounded-full text-xs font-medium">
              {alerts.filter(a => a.severity === 'high').length} High Priority
            </span>
          </div>
          <div className="divide-y divide-gray-200">
            {alerts.map((alert) => (
              <div key={alert.id} className="p-6 hover:bg-gray-50 transition-colors">
                <div className="flex items-start gap-3">
                  {alert.severity === 'high' && (
                    <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  )}
                  {alert.severity === 'medium' && (
                    <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                  )}
                  {alert.severity === 'low' && (
                    <Clock className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">{alert.title}</p>
                    <p className="text-sm text-gray-600 mt-1">{alert.description}</p>
                    <p className="text-xs text-gray-500 mt-2">{alert.time}</p>
                  </div>
                  <button className="text-sm text-amber-600 hover:text-amber-700 font-medium whitespace-nowrap">
                    Review
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
