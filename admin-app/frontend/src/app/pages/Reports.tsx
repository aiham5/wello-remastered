import { useEffect, useMemo, useState } from "react";
import { Download, Calendar, TrendingUp } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { apiRequest, formatCurrencyFromCents, summarizeError } from "../lib/adminApi";

interface ReceiptRow {
  uploaded_at?: string | null;
  receipt_total_cents?: number | null;
  review_status?: string | null;
}

interface CashbackRow {
  created_at?: string | null;
  amount_cents?: number | null;
  status?: string | null;
}

interface ActionRow {
  created_at?: string | null;
}

interface ChartRow {
  month: string;
  revenue: number;
  cashback: number;
  activity: number;
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

export function Reports() {
  const [message, setMessage] = useState("");
  const [chartData, setChartData] = useState<ChartRow[]>([]);
  const [totalRevenueCents, setTotalRevenueCents] = useState(0);
  const [cashbackCents, setCashbackCents] = useState(0);
  const [conversionPercent, setConversionPercent] = useState("0.0");

  const load = async () => {
    const months = getLastMonths(7);
    const startIso = months[0].start.toISOString();

    const [receiptsRes, cashbackRes, actionsRes] = await Promise.all([
      apiRequest<ReceiptRow[]>("/api/admin/query", {
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
      apiRequest<CashbackRow[]>("/api/admin/query", {
        method: "POST",
        body: {
          table: "cashback_events",
          action: "select",
          select: "created_at,amount_cents,status",
          filters: [{ column: "created_at", op: "gte", value: startIso }],
          order: [{ column: "created_at", ascending: true }],
          limit: 5000,
        },
      }),
      apiRequest<ActionRow[]>("/api/admin/query", {
        method: "POST",
        body: {
          table: "admin_action_logs",
          action: "select",
          select: "created_at",
          filters: [{ column: "created_at", op: "gte", value: startIso }],
          order: [{ column: "created_at", ascending: true }],
          limit: 5000,
        },
      }),
    ]);

    if (receiptsRes.error || cashbackRes.error || actionsRes.error) {
      setMessage(
        summarizeError(
          receiptsRes.error || cashbackRes.error || actionsRes.error,
          "Unable to load report data.",
        ),
      );
      return;
    }

    const revenueMap = new Map(months.map((m) => [m.key, 0]));
    const cashbackMap = new Map(months.map((m) => [m.key, 0]));
    const actionMap = new Map(months.map((m) => [m.key, 0]));

    let verifiedCount = 0;
    let totalReceiptCount = 0;
    let revenueTotal = 0;
    (receiptsRes.data || []).forEach((row) => {
      const date = new Date(String(row.uploaded_at || ""));
      if (Number.isNaN(date.getTime())) return;
      const key = monthKey(date);
      if (!revenueMap.has(key)) return;
      totalReceiptCount += 1;
      if (String(row.review_status || "").toLowerCase() === "verified") {
        verifiedCount += 1;
        const cents = Number(row.receipt_total_cents || 0);
        revenueTotal += cents;
        revenueMap.set(key, Number(revenueMap.get(key) || 0) + cents);
      }
    });

    let cashbackTotal = 0;
    (cashbackRes.data || []).forEach((row) => {
      const date = new Date(String(row.created_at || ""));
      if (Number.isNaN(date.getTime())) return;
      const key = monthKey(date);
      if (!cashbackMap.has(key)) return;
      const status = String(row.status || "").toLowerCase();
      if (status === "failed" || status === "rejected") return;
      const cents = Number(row.amount_cents || 0);
      cashbackTotal += cents;
      cashbackMap.set(key, Number(cashbackMap.get(key) || 0) + cents);
    });

    (actionsRes.data || []).forEach((row) => {
      const date = new Date(String(row.created_at || ""));
      if (Number.isNaN(date.getTime())) return;
      const key = monthKey(date);
      if (!actionMap.has(key)) return;
      actionMap.set(key, Number(actionMap.get(key) || 0) + 1);
    });

    setTotalRevenueCents(revenueTotal);
    setCashbackCents(cashbackTotal);
    setConversionPercent(
      totalReceiptCount > 0 ? ((verifiedCount / totalReceiptCount) * 100).toFixed(1) : "0.0",
    );

    setChartData(
      months.map((month) => ({
        month: month.label,
        revenue: Number((Number(revenueMap.get(month.key) || 0) / 100).toFixed(2)),
        cashback: Number((Number(cashbackMap.get(month.key) || 0) / 100).toFixed(2)),
        activity: Number(actionMap.get(month.key) || 0),
      })),
    );

    setMessage("");
  };

  useEffect(() => {
    void load();
  }, []);

  const hasData = useMemo(
    () => chartData.some((row) => row.revenue > 0 || row.cashback > 0 || row.activity > 0),
    [chartData],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          <button
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            onClick={() => void load()}
          >
            <Calendar className="w-4 h-4" />
            Refresh Data
          </button>
        </div>
        <button className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors">
          <Download className="w-4 h-4" />
          Export Report
        </button>
      </div>

      {message ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">
          {message}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg p-6 border border-gray-200">
          <p className="text-sm text-gray-600 mb-2">Verified Receipt Revenue</p>
          <p className="text-3xl font-semibold text-gray-900 mb-2">
            {formatCurrencyFromCents(totalRevenueCents)}
          </p>
          <div className="flex items-center gap-1 text-sm text-green-600">
            <TrendingUp className="w-4 h-4" />
            <span>Real data from verified receipts</span>
          </div>
        </div>
        <div className="bg-white rounded-lg p-6 border border-gray-200">
          <p className="text-sm text-gray-600 mb-2">Cashback Issued</p>
          <p className="text-3xl font-semibold text-gray-900 mb-2">
            {formatCurrencyFromCents(cashbackCents)}
          </p>
          <div className="flex items-center gap-1 text-sm text-green-600">
            <TrendingUp className="w-4 h-4" />
            <span>Real data from cashback events</span>
          </div>
        </div>
        <div className="bg-white rounded-lg p-6 border border-gray-200">
          <p className="text-sm text-gray-600 mb-2">Receipt Verification Rate</p>
          <p className="text-3xl font-semibold text-gray-900 mb-2">{conversionPercent}%</p>
          <div className="flex items-center gap-1 text-sm text-green-600">
            <TrendingUp className="w-4 h-4" />
            <span>Verified receipts / total receipts</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Revenue, Cashback, and Admin Activity
        </h3>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={hasData ? chartData : [{ month: "N/A", revenue: 0, cashback: 0, activity: 0 }]}>
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
            <Line type="monotone" dataKey="revenue" stroke="#fbbf24" strokeWidth={3} name="Revenue ($)" />
            <Line type="monotone" dataKey="cashback" stroke="#10b981" strokeWidth={3} name="Cashback ($)" />
            <Line type="monotone" dataKey="activity" stroke="#3b82f6" strokeWidth={2} name="Admin Actions" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
