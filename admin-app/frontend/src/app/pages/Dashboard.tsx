import { useEffect, useMemo, useState } from "react";
import {
  Users,
  Store,
  Tag,
  DollarSign,
  ShoppingCart,
  Receipt,
  TrendingUp,
  AlertTriangle,
  Clock,
  XCircle,
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
} from "recharts";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { apiRequest, formatRelativeTime } from "../lib/adminApi";

interface OverviewData {
  pendingReceipts: number;
  openReports: number;
  pendingBusinesses: number;
  pendingOffers: number;
  pendingCashouts: number;
}

interface EventPayload {
  adminActions?: Array<{
    id: string;
    action: string;
    entity: string;
    status: string;
    entity_id?: string | null;
    created_at?: string | null;
  }>;
  plaidEvents?: Array<{
    id: string;
    event_name?: string | null;
    severity?: string | null;
    created_at?: string | null;
  }>;
}

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

export function Dashboard() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [events, setEvents] = useState<EventPayload>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      const [overviewRes, eventsRes] = await Promise.all([
        apiRequest<OverviewData>("/api/admin/overview"),
        apiRequest<EventPayload>("/api/admin/events"),
      ]);

      if (!mounted) return;
      if (overviewRes.error) {
        setError(overviewRes.error.message);
      } else {
        setOverview({
          pendingReceipts: Number(overviewRes.data?.pendingReceipts || 0),
          openReports: Number(overviewRes.data?.openReports || 0),
          pendingBusinesses: Number(overviewRes.data?.pendingBusinesses || 0),
          pendingOffers: Number(overviewRes.data?.pendingOffers || 0),
          pendingCashouts: Number(overviewRes.data?.pendingCashouts || 0),
        });
      }

      if (!eventsRes.error && eventsRes.data) {
        setEvents(eventsRes.data);
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, []);

  const stats = useMemo(
    () => [
      {
        title: "Pending Receipts",
        value: String(overview?.pendingReceipts ?? 0),
        change: "Needs review",
        changeType: "warning" as const,
        icon: Receipt,
        iconColor: "bg-orange-500",
      },
      {
        title: "Open Reports",
        value: String(overview?.openReports ?? 0),
        change: "Fraud/dispute queue",
        changeType: "warning" as const,
        icon: AlertTriangle,
        iconColor: "bg-red-500",
      },
      {
        title: "Pending Businesses",
        value: String(overview?.pendingBusinesses ?? 0),
        change: "Awaiting approval",
        changeType: "neutral" as const,
        icon: Store,
        iconColor: "bg-purple-500",
      },
      {
        title: "Pending Offers",
        value: String(overview?.pendingOffers ?? 0),
        change: "Awaiting moderation",
        changeType: "neutral" as const,
        icon: Tag,
        iconColor: "bg-amber-500",
      },
      {
        title: "Pending Cashouts",
        value: String(overview?.pendingCashouts ?? 0),
        change: "Payout queue",
        changeType: "neutral" as const,
        icon: DollarSign,
        iconColor: "bg-teal-500",
      },
      {
        title: "Admin Actions",
        value: String((events.adminActions || []).length),
        change: "Recent operations",
        changeType: "positive" as const,
        icon: ShoppingCart,
        iconColor: "bg-indigo-500",
      },
      {
        title: "Event Logs",
        value: String((events.plaidEvents || []).length),
        change: "Webhook + sync events",
        changeType: "neutral" as const,
        icon: TrendingUp,
        iconColor: "bg-blue-500",
      },
      {
        title: "System Health",
        value: error ? "Warning" : "Healthy",
        change: error || "Admin APIs responding",
        changeType: error ? ("warning" as const) : ("positive" as const),
        icon: Users,
        iconColor: error ? "bg-yellow-500" : "bg-green-500",
      },
    ],
    [overview, events, error],
  );

  const recentActivity = useMemo(
    () =>
      (events.adminActions || []).slice(0, 8).map((item) => ({
        id: item.id,
        user: item.entity || "admin",
        action: `${item.action} (${item.status || "success"})`,
        time: formatRelativeTime(item.created_at),
      })),
    [events.adminActions],
  );

  const alerts = useMemo(
    () =>
      (events.plaidEvents || []).slice(0, 8).map((item) => ({
        id: item.id,
        title: item.event_name || "System event",
        description: `Severity: ${item.severity || "info"}`,
        severity:
          String(item.severity || "").toLowerCase() === "error"
            ? "high"
            : String(item.severity || "").toLowerCase() === "warning"
              ? "medium"
              : "low",
        time: formatRelativeTime(item.created_at),
      })),
    [events.plaidEvents],
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <StatCard key={stat.title} {...stat} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Redemptions & Revenue
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={redemptionsData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="month" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
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
                name="Revenue"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-lg p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">User Growth</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={userGrowthData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="month" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                }}
              />
              <Bar dataKey="users" fill="#10b981" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Recent Activity</h3>
          </div>
          <div className="divide-y divide-gray-200">
            {recentActivity.length ? (
              recentActivity.map((activity) => (
                <div
                  key={activity.id}
                  className="p-6 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{activity.user}</p>
                      <p className="text-sm text-gray-600 mt-1">{activity.action}</p>
                    </div>
                    <span className="text-xs text-gray-500 whitespace-nowrap ml-4">
                      {activity.time}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-6 text-sm text-gray-500">No recent activity.</div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-6 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Alerts & Issues</h3>
            <span className="px-2.5 py-0.5 bg-red-100 text-red-800 rounded-full text-xs font-medium">
              {alerts.filter((a) => a.severity === "high").length} High Priority
            </span>
          </div>
          <div className="divide-y divide-gray-200">
            {alerts.length ? (
              alerts.map((alert) => (
                <div key={alert.id} className="p-6 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start gap-3">
                    {alert.severity === "high" && (
                      <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    )}
                    {alert.severity === "medium" && (
                      <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                    )}
                    {alert.severity === "low" && (
                      <Clock className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{alert.title}</p>
                      <p className="text-sm text-gray-600 mt-1">{alert.description}</p>
                      <p className="text-xs text-gray-500 mt-2">{alert.time}</p>
                    </div>
                    <StatusBadge
                      status={alert.severity}
                      variant={
                        alert.severity === "high"
                          ? "danger"
                          : alert.severity === "medium"
                            ? "warning"
                            : "info"
                      }
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="p-6 text-sm text-gray-500">No alerts.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
