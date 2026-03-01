import { useEffect, useMemo, useState } from "react";
import { Search, RefreshCw } from "lucide-react";
import {
  apiRequest,
  formatDateTime,
  formatCurrencyFromCents,
  summarizeError,
} from "../lib/adminApi";

interface RedemptionRow {
  id?: string;
  user_id?: string | null;
  offer_id?: string | null;
  business_id?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  amount_cents?: number | null;
  cashback_cents?: number | null;
  [key: string]: unknown;
}

export function Redemptions() {
  const [rows, setRows] = useState<RedemptionRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    const res = await apiRequest<RedemptionRow[]>("/api/admin/query", {
      method: "POST",
      body: {
        table: "redemptions",
        action: "select",
        select: "*",
        order: [{ column: "created_at", ascending: false }],
        limit: 150,
        filters: [],
      },
    });
    if (res.error) {
      setRows([]);
      setMessage(summarizeError(res.error, "Unable to load redemptions."));
    } else {
      setRows(Array.isArray(res.data) ? res.data : []);
      setMessage("");
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((row) => {
      const id = String(row.id || "").toLowerCase();
      const user = String(row.user_id || "").toLowerCase();
      const offer = String(row.offer_id || "").toLowerCase();
      return id.includes(q) || user.includes(q) || offer.includes(q);
    });
  }, [rows, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex-1 w-full sm:w-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search redemptions..."
              className="pl-10 pr-4 py-2.5 w-full border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>
        </div>
        <button
          onClick={() => void load()}
          className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {message ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">
          {message}
        </div>
      ) : null}

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Redemption ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Offer</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cashback</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-gray-500">
                    Loading redemptions...
                  </td>
                </tr>
              ) : filtered.length ? (
                filtered.map((row, idx) => (
                  <tr key={`${row.id || "row"}-${idx}`} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {String(row.id || "--")}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {String(row.user_id || "--")}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {String(row.offer_id || "--")}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrencyFromCents(Number(row.amount_cents || 0))}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-700">
                      {formatCurrencyFromCents(Number(row.cashback_cents || 0))}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {String(row.status || "--")}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {formatDateTime((row.created_at as string) || null)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-gray-500">
                    No redemptions found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
