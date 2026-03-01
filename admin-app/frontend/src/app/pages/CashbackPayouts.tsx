import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Filter,
  Download,
  DollarSign,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import {
  apiRequest,
  formatCurrencyFromCents,
  formatDateTime,
  summarizeError,
} from "../lib/adminApi";

interface CashoutRow {
  id: string;
  user_id: string;
  amount_cents?: number | null;
  status?: string | null;
  provider?: string | null;
  method_type?: string | null;
  approval_status?: string | null;
  bank_summary?: string | null;
  provider_claim_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

const normalizeStatus = (row: CashoutRow) => String(row.status || "pending").toLowerCase();

export function CashbackPayouts() {
  const [rows, setRows] = useState<CashoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [message, setMessage] = useState("");

  const loadCashouts = async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: "0",
      limit: "200",
      status: selectedStatus === "all" ? "all" : selectedStatus.toLowerCase(),
    });
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    const res = await apiRequest<CashoutRow[]>(`/api/admin/cashouts?${params.toString()}`);
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to load payouts."));
      setRows([]);
    } else {
      setRows(Array.isArray(res.data) ? res.data : []);
      setMessage("");
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadCashouts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStatus]);

  const filteredPayouts = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const query = searchQuery.toLowerCase();
    return rows.filter((payout) => {
      const user = String(payout.user_id || "").toLowerCase();
      const id = String(payout.id || "").toLowerCase();
      const provider = String(payout.provider || "").toLowerCase();
      return user.includes(query) || id.includes(query) || provider.includes(query);
    });
  }, [rows, searchQuery]);

  const stats = useMemo(() => {
    const pending = rows.filter((row) => normalizeStatus(row) === "pending");
    const paid = rows.filter((row) => normalizeStatus(row) === "paid");
    const failed = rows.filter((row) => normalizeStatus(row) === "failed");
    const processing = rows.filter((row) => normalizeStatus(row) === "processing");

    const sum = (list: CashoutRow[]) =>
      list.reduce((acc, row) => acc + Number(row.amount_cents || 0), 0);

    return {
      pendingAmount: sum(pending),
      pendingCount: pending.length,
      processingAmount: sum(processing),
      processingCount: processing.length,
      paidAmount: sum(paid),
      paidCount: paid.length,
      failedAmount: sum(failed),
      failedCount: failed.length,
    };
  }, [rows]);

  const decideBankTransfer = async (row: CashoutRow, action: "approve" | "reject") => {
    const isPendingBankApproval =
      String(row.method_type || "").toLowerCase() === "bank_transfer" &&
      String(row.approval_status || "").toLowerCase() === "pending" &&
      String(row.status || "").toLowerCase() === "pending";
    if (!isPendingBankApproval) {
      setMessage("Only pending bank transfers can be approved/rejected.");
      return;
    }

    const confirmed = window.confirm(
      `${action === "approve" ? "Approve" : "Reject"} bank transfer payout ${row.id.slice(0, 8)}?`,
    );
    if (!confirmed) return;

    setWorkingId(row.id);
    const res = await apiRequest(
      `/api/admin/cashouts/${encodeURIComponent(row.id)}/${action}`,
      {
        method: "POST",
        body: {
          expectedStatus: normalizeStatus(row),
          expectedApprovalStatus: String(row.approval_status || "pending").toLowerCase(),
        },
      },
    );
    if (res.error) {
      setMessage(summarizeError(res.error, `Unable to ${action} payout.`));
    } else {
      setMessage(`Bank transfer ${action}d.`);
      void loadCashouts();
    }
    setWorkingId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex-1 w-full sm:w-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search payouts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2.5 w-full border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="flex gap-3 w-full sm:w-auto">
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="paid">Completed</option>
            <option value="failed">Failed</option>
          </select>

          <button
            onClick={() => void loadCashouts()}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>

          <button
            disabled
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-500/60 text-white rounded-lg cursor-not-allowed"
          >
            <CheckCircle className="w-4 h-4" />
            <span className="hidden sm:inline">Process Batch</span>
          </button>
        </div>
      </div>

      {message ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">
          {message}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Pending Payouts</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">
            {formatCurrencyFromCents(stats.pendingAmount)}
          </p>
          <p className="text-xs text-gray-500 mt-1">{stats.pendingCount} requests</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Processing</p>
          <p className="text-2xl font-semibold text-blue-600 mt-1">
            {formatCurrencyFromCents(stats.processingAmount)}
          </p>
          <p className="text-xs text-gray-500 mt-1">{stats.processingCount} requests</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Completed</p>
          <p className="text-2xl font-semibold text-green-600 mt-1">
            {formatCurrencyFromCents(stats.paidAmount)}
          </p>
          <p className="text-xs text-gray-500 mt-1">{stats.paidCount} requests</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Failed</p>
          <p className="text-2xl font-semibold text-red-600 mt-1">
            {formatCurrencyFromCents(stats.failedAmount)}
          </p>
          <p className="text-xs text-gray-500 mt-1">{stats.failedCount} requests</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  <input type="checkbox" className="rounded" />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payout ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Requested</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-gray-500">
                    Loading payouts...
                  </td>
                </tr>
              ) : filteredPayouts.length ? (
                filteredPayouts.map((payout) => {
                  const isPendingBankApproval =
                    String(payout.provider || "").toLowerCase() === "checkbook" &&
                    String(payout.method_type || "").toLowerCase() === "bank_transfer" &&
                    String(payout.status || "").toLowerCase() === "pending" &&
                    String(payout.approval_status || "").toLowerCase() === "pending";

                  return (
                    <tr key={payout.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <input type="checkbox" className="rounded" />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <p className="font-medium text-gray-900">#{payout.id.slice(0, 8)}</p>
                      </td>
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium text-gray-900">{payout.user_id || "--"}</p>
                          <p className="text-sm text-gray-500">{payout.provider || "--"}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-green-500" />
                          <span className="font-semibold text-gray-900">
                            {formatCurrencyFromCents(Number(payout.amount_cents || 0))}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <p className="text-sm text-gray-900">
                            {String(payout.method_type || "gift_card").replace("_", " ")}
                          </p>
                          {payout.bank_summary ? (
                            <p className="text-xs text-gray-500">{payout.bank_summary}</p>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <p className="text-sm text-gray-600">{formatDateTime(payout.created_at)}</p>
                          {payout.updated_at ? (
                            <p className="text-xs text-gray-500">
                              Updated {formatDateTime(payout.updated_at)}
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {normalizeStatus(payout) === "pending" && (
                          <StatusBadge status="Pending" variant="warning" />
                        )}
                        {normalizeStatus(payout) === "processing" && (
                          <StatusBadge status="Processing" variant="info" />
                        )}
                        {normalizeStatus(payout) === "paid" && (
                          <StatusBadge status="Completed" variant="success" />
                        )}
                        {normalizeStatus(payout) === "failed" && (
                          <StatusBadge status="Failed" variant="danger" />
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {isPendingBankApproval && (
                            <>
                              <button
                                disabled={workingId === payout.id}
                                onClick={() => void decideBankTransfer(payout, "approve")}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-50 text-green-700 rounded hover:bg-green-100 transition-colors disabled:opacity-60"
                              >
                                <CheckCircle className="w-4 h-4" />
                                Approve
                              </button>
                              <button
                                disabled={workingId === payout.id}
                                onClick={() => void decideBankTransfer(payout, "reject")}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-red-50 text-red-700 rounded hover:bg-red-100 transition-colors disabled:opacity-60"
                              >
                                <XCircle className="w-4 h-4" />
                                Reject
                              </button>
                            </>
                          )}
                          {normalizeStatus(payout) === "failed" && (
                            <button className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition-colors">
                              <Clock className="w-4 h-4" />
                              Retry
                            </button>
                          )}
                          {payout.provider_claim_url ? (
                            <button
                              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-50 text-gray-700 rounded hover:bg-gray-100 transition-colors"
                              onClick={() => window.open(payout.provider_claim_url || "", "_blank", "noopener,noreferrer")}
                            >
                              Claim
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-gray-500">
                    No payouts match current filters.
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
