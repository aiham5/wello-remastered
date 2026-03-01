import { useEffect, useMemo, useState } from "react";
import { Search, RefreshCw, Link2 } from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import { apiRequest, formatDateTime, summarizeError } from "../lib/adminApi";

interface RecipientRow {
  id: string;
  user_id: string;
  provider?: string | null;
  recipient_provider_id?: string | null;
  recipient_status?: string | null;
  bank_summary?: string | null;
  last_synced_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

const statusVariant = (status?: string | null) => {
  const value = String(status || "").toLowerCase();
  if (value === "linked" || value === "approved" || value === "active") return "success" as const;
  if (value === "pending" || value === "reviewing") return "warning" as const;
  if (value === "failed" || value === "rejected") return "danger" as const;
  return "default" as const;
};

export function BankVerification() {
  const [rows, setRows] = useState<RecipientRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    const res = await apiRequest<RecipientRow[]>("/api/admin/query", {
      method: "POST",
      body: {
        table: "cashout_recipients",
        action: "select",
        select: "*",
        order: [{ column: "updated_at", ascending: false }],
        limit: 200,
        filters: [],
      },
    });
    if (res.error) {
      setRows([]);
      setMessage(summarizeError(res.error, "Unable to load bank verification data."));
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
      const user = String(row.user_id || "").toLowerCase();
      const providerId = String(row.recipient_provider_id || "").toLowerCase();
      const bank = String(row.bank_summary || "").toLowerCase();
      return user.includes(q) || providerId.includes(q) || bank.includes(q);
    });
  }, [rows, search]);

  const linkedCount = rows.filter((row) => String(row.recipient_status || "").toLowerCase() === "linked").length;

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
              placeholder="Search linked bank accounts..."
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Linked Accounts</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{linkedCount}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Total Recipients</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{rows.length}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Provider</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">Checkbook</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Provider ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bank Summary</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Sync</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-gray-500">
                    Loading bank verification data...
                  </td>
                </tr>
              ) : filtered.length ? (
                filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {row.user_id}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      <span className="inline-flex items-center gap-2">
                        <Link2 className="w-4 h-4 text-gray-400" />
                        {row.recipient_provider_id || "--"}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {row.bank_summary || "--"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge
                        status={row.recipient_status || "unknown"}
                        variant={statusVariant(row.recipient_status)}
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {formatDateTime(row.last_synced_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {formatDateTime(row.updated_at)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-gray-500">
                    No bank recipients found.
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
