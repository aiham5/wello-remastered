import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Filter,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Eye,
} from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import {
  apiRequest,
  formatCurrencyFromCents,
  formatRelativeTime,
  summarizeError,
} from "../lib/adminApi";

type ReviewStatus = "pending" | "verified" | "rejected";

interface ReceiptRow {
  id: string;
  user_id?: string | null;
  business_id?: string | null;
  receipt_total_cents?: number | null;
  review_status?: ReviewStatus | null;
  review_notes?: string | null;
  reviewed_at?: string | null;
  uploaded_at?: string | null;
  business?: { id: string; name?: string | null } | null;
}

const toStatusLabel = (status?: string | null) => {
  const normalized = String(status || "pending").toLowerCase();
  if (normalized === "verified") return "Approved";
  if (normalized === "rejected") return "Rejected";
  return "Pending";
};

export function ReceiptReviews() {
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("pending");
  const [message, setMessage] = useState("");

  const loadReceipts = async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: "0",
      pageSize: "200",
      status: selectedStatus,
    });
    if (searchQuery.trim()) params.set("search", searchQuery.trim());

    const res = await apiRequest<ReceiptRow[]>(`/api/admin/receipts?${params.toString()}`);
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to load receipts."));
      setRows([]);
    } else {
      setRows(Array.isArray(res.data) ? res.data : []);
      setMessage("");
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadReceipts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStatus]);

  const filteredReceipts = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const query = searchQuery.toLowerCase();
    return rows.filter((receipt) => {
      const business = String(receipt.business?.name || "").toLowerCase();
      const user = String(receipt.user_id || "").toLowerCase();
      const id = String(receipt.id || "").toLowerCase();
      return business.includes(query) || user.includes(query) || id.includes(query);
    });
  }, [rows, searchQuery]);

  const stats = useMemo(
    () => ({
      pending: rows.filter((row) => String(row.review_status) === "pending").length,
      flagged: rows.filter((row) =>
        (Number(row.receipt_total_cents || 0) > 10000) ||
        String(row.review_notes || "").trim().length > 0,
      ).length,
      approved: rows.filter((row) => String(row.review_status) === "verified").length,
      avgReviewText: "Live queue",
    }),
    [rows],
  );

  const applyDecision = async (receipt: ReceiptRow, action: "verify" | "reject") => {
    const expectedStatus = String(receipt.review_status || "pending");
    if (expectedStatus !== "pending") return;

    let receiptTotalCents = Number(receipt.receipt_total_cents || 0);
    const defaultDollars = (receiptTotalCents / 100).toFixed(2);
    if (action === "verify") {
      const amount = window.prompt("Receipt total (USD)", defaultDollars);
      if (amount == null) return;
      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setMessage("Enter a valid receipt amount.");
        return;
      }
      receiptTotalCents = Math.round(parsed * 100);
    }
    const reviewNotes = window.prompt(
      action === "reject" ? "Rejection reason" : "Review notes (optional)",
      String(receipt.review_notes || ""),
    );
    if (reviewNotes === null && action === "reject") return;

    setWorkingId(receipt.id);
    const res = await apiRequest<ReceiptRow>(
      `/api/admin/receipts/${encodeURIComponent(receipt.id)}/decision`,
      {
        method: "POST",
        body: {
          action,
          receiptTotalCents,
          reviewNotes: reviewNotes || null,
          expectedStatus,
          expectedReviewedAt: receipt.reviewed_at || null,
        },
      },
    );
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to update receipt."));
    } else {
      const nextStatus: ReviewStatus = action === "verify" ? "verified" : "rejected";
      setRows((prev) =>
        prev.map((row) =>
          row.id === receipt.id
            ? {
                ...row,
                review_status: nextStatus,
                receipt_total_cents: receiptTotalCents,
                review_notes: reviewNotes || null,
                reviewed_at: new Date().toISOString(),
              }
            : row,
        ),
      );
      setMessage(`Receipt ${action === "verify" ? "approved" : "rejected"}.`);
    }
    setWorkingId(null);
  };

  const openDetail = async (receiptId: string) => {
    const res = await apiRequest<ReceiptRow>(
      `/api/admin/receipts/${encodeURIComponent(receiptId)}/detail`,
    );
    if (res.error || !res.data) {
      setMessage(summarizeError(res.error, "Unable to load receipt detail."));
      return;
    }
    const row = res.data;
    window.alert(
      [
        `Receipt: ${row.id}`,
        `Business: ${row.business?.name || row.business_id || "--"}`,
        `User: ${row.user_id || "--"}`,
        `Status: ${row.review_status || "pending"}`,
        `Amount: ${formatCurrencyFromCents(Number(row.receipt_total_cents || 0))}`,
        `Notes: ${row.review_notes || "None"}`,
      ].join("\n"),
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex-1 w-full sm:w-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search receipts..."
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
            <option value="pending">Pending</option>
            <option value="verified">Approved</option>
            <option value="rejected">Rejected</option>
          </select>

          <button
            onClick={() => void loadReceipts()}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
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
          <p className="text-sm text-gray-600">Pending Review</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.pending}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Flagged</p>
          <p className="text-2xl font-semibold text-red-600 mt-1">{stats.flagged}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Approved</p>
          <p className="text-2xl font-semibold text-green-600 mt-1">{stats.approved}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Avg Review Time</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.avgReviewText}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Receipt ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Business</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cashback</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-gray-500">
                    Loading receipts...
                  </td>
                </tr>
              ) : filteredReceipts.length ? (
                filteredReceipts.map((receipt) => {
                  const status = String(receipt.review_status || "pending");
                  const amountCents = Number(receipt.receipt_total_cents || 0);
                  const expectedCashback = Math.floor(amountCents * 0.1);
                  return (
                    <tr key={receipt.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <p className="font-medium text-gray-900">#{receipt.id.slice(0, 8)}</p>
                          <p className="text-xs text-gray-500">{formatRelativeTime(receipt.uploaded_at)}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <p className="text-sm text-gray-900">{receipt.user_id || "--"}</p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <p className="text-sm text-gray-900">
                          {receipt.business?.name || receipt.business_id || "--"}
                        </p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <p className="font-medium text-gray-900">{formatCurrencyFromCents(amountCents)}</p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <p className="font-medium text-green-600">
                          {formatCurrencyFromCents(expectedCashback)}
                        </p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusBadge status="Receipt Upload" variant="default" />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="space-y-1">
                          {status === "pending" && <StatusBadge status="Pending" variant="warning" />}
                          {status === "verified" && <StatusBadge status="Approved" variant="success" />}
                          {status === "rejected" && <StatusBadge status="Rejected" variant="danger" />}
                          {Number(amountCents) > 10000 && (
                            <div className="flex items-center gap-1 text-xs text-red-600 mt-1">
                              <AlertTriangle className="w-3 h-3" />
                              <span>High amount</span>
                            </div>
                          )}
                          {receipt.review_notes ? (
                            <div className="flex items-center gap-1 text-xs text-amber-700 mt-1">
                              <AlertTriangle className="w-3 h-3" />
                              <span>{receipt.review_notes}</span>
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition-colors"
                            onClick={() => void openDetail(receipt.id)}
                          >
                            <Eye className="w-4 h-4" />
                            Review
                          </button>
                          {status === "pending" && (
                            <>
                              <button
                                disabled={workingId === receipt.id}
                                onClick={() => void applyDecision(receipt, "verify")}
                                className="p-1.5 bg-green-50 text-green-700 rounded hover:bg-green-100 transition-colors disabled:opacity-60"
                                title="Approve"
                              >
                                <CheckCircle className="w-4 h-4" />
                              </button>
                              <button
                                disabled={workingId === receipt.id}
                                onClick={() => void applyDecision(receipt, "reject")}
                                className="p-1.5 bg-red-50 text-red-700 rounded hover:bg-red-100 transition-colors disabled:opacity-60"
                                title="Reject"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-gray-500">
                    No receipts match current filters.
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
