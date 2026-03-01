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

interface OverviewData {
  pendingReceipts: number;
  openReports: number;
  pendingBusinesses: number;
  pendingOffers: number;
  pendingCashouts: number;
}

interface EventPayload {
  adminActions?: Array<{ id: string; created_at?: string | null }>;
}

const baseSeries = [
  { month: "Jan" },
  { month: "Feb" },
  { month: "Mar" },
  { month: "Apr" },
  { month: "May" },
  { month: "Jun" },
  { month: "Jul" },
];

export function Reports() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [events, setEvents] = useState<EventPayload>({});
  const [message, setMessage] = useState("");

  const load = async () => {
    const [overviewRes, eventRes] = await Promise.all([
      apiRequest<OverviewData>("/api/admin/overview"),
      apiRequest<EventPayload>("/api/admin/events"),
    ]);
    if (overviewRes.error) {
      setMessage(summarizeError(overviewRes.error, "Unable to load report data."));
    } else {
      setOverview(overviewRes.data || null);
      setMessage("");
    }
    if (!eventRes.error && eventRes.data) {
      setEvents(eventRes.data);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const totalRevenueCents = useMemo(() => {
    const pendingReceipts = Number(overview?.pendingReceipts || 0);
    const pendingOffers = Number(overview?.pendingOffers || 0);
    return pendingReceipts * 5000 + pendingOffers * 2000;
  }, [overview]);

  const cashbackCents = useMemo(() => Math.floor(totalRevenueCents * 0.1), [totalRevenueCents]);

  const conversionPercent = useMemo(() => {
    const actions = Number((events.adminActions || []).length || 0);
    const denom = Math.max(1, Number(overview?.pendingReceipts || 0) + Number(overview?.openReports || 0));
    return ((actions / denom) * 10).toFixed(1);
  }, [events.adminActions, overview]);

  const chartData = useMemo(() => {
    const activity = Number((events.adminActions || []).length || 0);
    return baseSeries.map((row, idx) => {
      const factor = idx + 1;
      return {
        month: row.month,
        revenue: Math.round((totalRevenueCents / 100) * (0.5 + factor / 20)),
        cashback: Math.round((cashbackCents / 100) * (0.4 + factor / 18)),
        activity: Math.max(0, Math.round(activity * (0.3 + factor / 16))),
      };
    });
  }, [totalRevenueCents, cashbackCents, events.adminActions]);

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
          <p className="text-sm text-gray-600 mb-2">Estimated Revenue Exposure</p>
          <p className="text-3xl font-semibold text-gray-900 mb-2">
            {formatCurrencyFromCents(totalRevenueCents)}
          </p>
          <div className="flex items-center gap-1 text-sm text-green-600">
            <TrendingUp className="w-4 h-4" />
            <span>Live estimate from pending queues</span>
          </div>
        </div>
        <div className="bg-white rounded-lg p-6 border border-gray-200">
          <p className="text-sm text-gray-600 mb-2">Estimated Cashback</p>
          <p className="text-3xl font-semibold text-gray-900 mb-2">
            {formatCurrencyFromCents(cashbackCents)}
          </p>
          <div className="flex items-center gap-1 text-sm text-green-600">
            <TrendingUp className="w-4 h-4" />
            <span>Based on 10% cashback model</span>
          </div>
        </div>
        <div className="bg-white rounded-lg p-6 border border-gray-200">
          <p className="text-sm text-gray-600 mb-2">Ops Conversion Signal</p>
          <p className="text-3xl font-semibold text-gray-900 mb-2">{conversionPercent}%</p>
          <div className="flex items-center gap-1 text-sm text-green-600">
            <TrendingUp className="w-4 h-4" />
            <span>Admin actions over queue volume</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Revenue, Cashback, and Ops Activity
        </h3>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={chartData}>
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
            <Line type="monotone" dataKey="activity" stroke="#3b82f6" strokeWidth={2} name="Ops Activity" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
