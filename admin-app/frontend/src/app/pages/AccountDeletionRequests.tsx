import { useEffect, useMemo, useState } from "react";
import { Search, Check, X, RefreshCw, Eye } from "lucide-react";
import { apiRequest, formatCurrencyFromCents, formatDateTime, summarizeError } from "../lib/adminApi";
import { StatusBadge } from "../components/StatusBadge";

type RequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "completed"
  | "cancelled";

interface AccountDeletionRequestRow {
  id: string;
  user_id: string | null;
  request_status: RequestStatus;
  confirm_forfeit_cashback: boolean | null;
  forfeited_cashback_cents: number | null;
  forfeited_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const statusBadgeVariant = (
  status: string,
): "default" | "success" | "warning" | "danger" | "info" => {
  const normalized = String(status || "").toLowerCase();
  switch (normalized) {
    case "approved":
      return "success";
    case "rejected":
    case "cancelled":
      return "danger";
    case "pending":
      return "warning";
    case "completed":
      return "info";
    default:
      return "default";
  }
};

const statusLabel = (status: string) => {
  const normalized = String(status || "pending").toLowerCase();
  switch (normalized) {
    case "pending":
      return "Pending";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return normalized || "Unknown";
  }
};

export function AccountDeletionRequests() {
  const [rows, setRows] = useState<AccountDeletionRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [requestStatusFilter, setRequestStatusFilter] = useState<RequestStatus | "all">("pending");
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");

  const loadRequests = async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: "0",
      limit: "100",
      requestStatus: requestStatusFilter,
    });
    if (searchQuery.trim()) params.set("search", searchQuery.trim());

    const res = await apiRequest<AccountDeletionRequestRow[]>(
      `/api/admin/account-deletion-requests?${params.toString()}`,
    );
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to load account deletion requests."));
      setRows([]);
      setSelectedId(null);
    } else {
      const list = Array.isArray(res.data) ? res.data : [];
      setRows(list);
      setMessage("");
      if (list.length && !list.some((row) => row.id === selectedId)) {
        setSelectedId(list[0].id);
      }
      if (!list.length) {
        setSelectedId(null);
      }
    }
    setLoading(false);
  };

  const submitDecision = async (action: "approve" | "reject", requestIdParam?: string) => {
    if (working) return;
    const targetId = requestIdParam || selectedId;
    if (!targetId) return;
    const selected = rows.find((row) => row.id === targetId);
    if (!selected || String(selected.request_status).toLowerCase() !== "pending") return;

    setWorking(true);
    const res = await apiRequest<AccountDeletionRequestRow>(
      `/api/admin/account-deletion-requests/${encodeURIComponent(targetId)}/decision`,
      {
        method: "POST",
        body: {
          action,
          expectedStatus: selected.request_status,
          reviewNotes: reviewNotes.trim() || null,
        },
      },
    );

    if (res.error || !res.data) {
      setMessage(
        summarizeError(
          res.error,
          `Unable to ${action === "approve" ? "approve" : "reject"} request.`,
        ),
      );
      setWorking(false);
      return;
    }

    setRows((prev) =>
      prev.map((row) => (row.id === res.data!.id ? { ...row, ...res.data! } : row)),
    );
    setMessage(`Request ${action}ed.`);
    setWorking(false);
  };

  useEffect(() => {
    void loadRequests();
  }, [requestStatusFilter]);

  useEffect(() => {
    const selected = rows.find((row) => row.id === selectedId);
    if (!selected) {
      setReviewNotes("");
      return;
    }
    setReviewNotes(selected.review_notes || "");
  }, [selectedId, rows]);

  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const query = searchQuery.toLowerCase();
    return rows.filter((row) => {
      const id = String(row.id).toLowerCase();
      const userId = String(row.user_id || "").toLowerCase();
      const notes = String(row.review_notes || "").toLowerCase();
      return id.includes(query) || userId.includes(query) || notes.includes(query);
    });
  }, [rows, searchQuery]);

  const selectedRequest = rows.find((row) => row.id === selectedId) || null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex-1 w-full sm:w-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by request id, user id, notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2.5 w-full border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="flex gap-3 w-full sm:w-auto">
          <select
            value={requestStatusFilter}
            onChange={(e) => {
              setRequestStatusFilter(e.target.value as RequestStatus | "all");
            }}
            className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button
            onClick={() => void loadRequests()}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {message ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">
          {message}
        </div>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Request</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Forfeit</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Requested</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-gray-500">
                      Loading requests...
                    </td>
                  </tr>
                ) : filteredRows.length ? (
                  filteredRows.map((row) => {
                    const isSelected = selectedId === row.id;
                    return (
                      <tr
                        key={row.id}
                        className={`transition-colors ${isSelected ? "bg-amber-50" : "hover:bg-gray-50"}`}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <p className="font-medium text-gray-900">#{row.id.slice(0, 8)}</p>
                          <p className="text-xs text-gray-500">Updated {formatDateTime(row.updated_at)}</p>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {row.user_id || "--"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <StatusBadge status={statusLabel(row.request_status)} variant={statusBadgeVariant(row.request_status)} />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <div>{formatCurrencyFromCents(Number(row.forfeited_cashback_cents || 0))}</div>
                          <div className="text-xs text-gray-500">
                            {row.confirm_forfeit_cashback ? "User confirmed" : "No confirmation"}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatDateTime(row.created_at)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition-colors"
                              onClick={() => setSelectedId(row.id)}
                            >
                              <Eye className="w-4 h-4" />
                              Review
                            </button>
                            {String(row.request_status).toLowerCase() === "pending" ? (
                              <>
                                <button
                                  type="button"
                              onClick={() => {
                                    void submitDecision("approve", row.id);
                                    setSelectedId(row.id);
                                  }}
                                  className="px-2.5 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                                  disabled={working}
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void submitDecision("reject", row.id);
                                    setSelectedId(row.id);
                                  }}
                                  className="px-2.5 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                                  disabled={working}
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-gray-500">
                      No requests match current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col gap-4 min-h-[540px]">
          <h3 className="text-lg font-semibold text-gray-900">Request Review</h3>
          {!selectedRequest ? (
            <p className="text-sm text-gray-500">Select a request to review.</p>
          ) : (
            <>
              <div>
                <p className="text-sm text-gray-500">Request</p>
                <p className="font-medium text-gray-900 break-all">{selectedRequest.id}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">User</p>
                <p className="font-medium text-gray-900 break-all">{selectedRequest.user_id || "--"}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Status</p>
                <p className="font-medium text-gray-900">{statusLabel(selectedRequest.request_status)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Forfeited Cashback</p>
                <p className="font-medium text-gray-900">
                  {formatCurrencyFromCents(Number(selectedRequest.forfeited_cashback_cents || 0))}
                </p>
              </div>
              <label className="block">
                <span className="text-sm text-gray-700">Review notes</span>
                <textarea
                  rows={4}
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  disabled={working || String(selectedRequest.request_status).toLowerCase() !== "pending"}
                />
              </label>
              <div className="text-xs text-gray-500">
                Reviewed at: {formatDateTime(selectedRequest.reviewed_at)}
                {selectedRequest.reviewed_by ? ` · by ${selectedRequest.reviewed_by}` : ""}
              </div>
              <div className="flex gap-2">
                <button
                  disabled={
                    working ||
                    String(selectedRequest.request_status).toLowerCase() !== "pending"
                  }
                  onClick={() => void submitDecision("approve", selectedRequest.id)}
                  className="flex-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-60"
                >
                  Approve
                </button>
                <button
                  disabled={
                    working ||
                    String(selectedRequest.request_status).toLowerCase() !== "pending"
                  }
                  onClick={() => void submitDecision("reject", selectedRequest.id)}
                  className="flex-1 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60"
                >
                  Reject
                </button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
