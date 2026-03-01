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

interface ReceiptAggRow {
  uploaded_at?: string | null;
  receipt_total_cents?: number | null;
  review_status?: string | null;
}

interface ProfileAggRow {
  created_at?: string | null;
}

const monthKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

const monthLabel = (date: Date) =>
  date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });

const getLastMonths = (count: number) => {
  const now = new Date();
  const months: Array<{ key: string; label: string; start: Date }> = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1, 0, 0, 0));
    months.push({ key: monthKey(d), label: monthLabel(d), start: d });
  }
  return months;
};

export function Dashboard() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [events, setEvents] = useState<EventPayload>({});
  const [error, setError] = useState("");
  const [redemptionsData, setRedemptionsData] = useState<
    Array<{ month: string; redemptions: number; revenue: number }>
  >([]);
  const [userGrowthData, setUserGrowthData] = useState<Array<{ month: string; users: number }>>(
    [],
  );

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      const months = getLastMonths(7);
      const startIso = months[0].start.toISOString();

      const [overviewRes, eventsRes, receiptsRes, usersRes] = await Promise.all([
        apiRequest<OverviewData>("/api/admin/overview"),
        apiRequest<EventPayload>("/api/admin/events"),
        apiRequest<ReceiptAggRow[]>("/api/admin/query", {
          method: "POST",
          body: {
            table: "receipt_uploads",
            action: "select",
            select: "uploaded_at,receipt_total_cents,review_status",
            filters: [{ column: "uploaded_at", op: "gte", value: startIso }],
            order: [{ column: "uploaded_at", ascending: true }],
            limit: 5000,
          },
        }),
        apiRequest<ProfileAggRow[]>("/api/admin/query", {
          method: "POST",
          body: {
            table: "profiles",
            action: "select",
            select: "created_at",
            filters: [{ column: "created_at", op: "gte", value: startIso }],
            order: [{ column: "created_at", ascending: true }],
            limit: 5000,
          },
        }),
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

      if (!receiptsRes.error) {
        const map = new Map(
          months.map((m) => [m.key, { month: m.label, redemptions: 0, revenue: 0 }]),
        );
        (receiptsRes.data || []).forEach((row) => {
          const iso = String(row.uploaded_at || "");
          const date = new Date(iso);
          if (Number.isNaN(date.getTime())) return;
          const key = monthKey(date);
          const entry = map.get(key);
          if (!entry) return;
          if (String(row.review_status || "").toLowerCase() === "verified") {
            entry.redemptions += 1;
            entry.revenue += Math.round((Number(row.receipt_total_cents || 0) / 100) * 100) / 100;
          }
        });
        setRedemptionsData(months.map((m) => map.get(m.key) || { month: m.label, redemptions: 0, revenue: 0 }));
      }

      if (!usersRes.error) {
        const increments = new Map(months.map((m) => [m.key, 0]));
        (usersRes.data || []).forEach((row) => {
          const date = new Date(String(row.created_at || ""));
          if (Number.isNaN(date.getTime())) return;
          const key = monthKey(date);
          if (!increments.has(key)) return;
          increments.set(key, Number(increments.get(key) || 0) + 1);
        });

        let running = 0;
        const growth = months.map((m) => {
          running += Number(increments.get(m.key) || 0);
          return { month: m.label, users: running };
        });
        setUserGrowthData(growth);
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
            <LineChart data={redemptionsData.length ? redemptionsData : [{ month: "N/A", redemptions: 0, revenue: 0 }]}>
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
                name="Revenue ($)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-lg p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">User Growth</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={userGrowthData.length ? userGrowthData : [{ month: "N/A", users: 0 }]}>
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
