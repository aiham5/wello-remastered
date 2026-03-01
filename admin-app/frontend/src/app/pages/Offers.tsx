import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  Filter,
  Download,
  Calendar,
  Percent,
  Eye,
  Edit,
  Copy,
  Pause,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import {
  apiRequest,
  formatDateTime,
  summarizeError,
} from "../lib/adminApi";

interface OfferRow {
  id: string;
  business_id: string;
  title?: string | null;
  description?: string | null;
  offer_type?: string | null;
  active?: boolean | null;
  approval_status?: string | null;
  created_at?: string | null;
  business?: {
    id: string;
    name?: string | null;
  } | null;
}

const normalizeStatus = (offer: OfferRow) => {
  const approval = String(offer.approval_status || "").toLowerCase();
  if (approval === "pending") return "Pending";
  if (approval === "rejected") return "Rejected";
  return offer.active ? "Active" : "Inactive";
};

export function Offers() {
  const [rows, setRows] = useState<OfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [message, setMessage] = useState("");

  const loadOffers = async () => {
    setLoading(true);
    const res = await apiRequest<OfferRow[]>("/api/admin/offers?limit=300");
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to load offers."));
      setRows([]);
    } else {
      setRows(Array.isArray(res.data) ? res.data : []);
      setMessage("");
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadOffers();
  }, []);

  const filteredOffers = useMemo(
    () =>
      rows.filter((offer) => {
        const title = String(offer.title || "");
        const businessName = String(offer.business?.name || "");
        const matchesSearch =
          title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          businessName.toLowerCase().includes(searchQuery.toLowerCase());
        const status = normalizeStatus(offer);
        const matchesStatus = selectedStatus === "all" || status === selectedStatus;
        return matchesSearch && matchesStatus;
      }),
    [rows, searchQuery, selectedStatus],
  );

  const stats = useMemo(
    () => ({
      total: rows.length,
      active: rows.filter((row) => normalizeStatus(row) === "Active").length,
      pending: rows.filter((row) => normalizeStatus(row) === "Pending").length,
      rejected: rows.filter((row) => normalizeStatus(row) === "Rejected").length,
    }),
    [rows],
  );

  const updateReview = async (offer: OfferRow, nextApprovalStatus: "approved" | "rejected") => {
    if (String(offer.approval_status || "").toLowerCase() !== "pending") return;
    const confirmed = window.confirm(
      `${nextApprovalStatus === "approved" ? "Approve" : "Reject"} offer "${offer.title || offer.id}"?`,
    );
    if (!confirmed) return;

    setWorkingId(offer.id);
    const res = await apiRequest<OfferRow>(
      `/api/admin/offers/${encodeURIComponent(offer.id)}/review`,
      {
        method: "POST",
        body: { nextApprovalStatus },
      },
    );
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to update offer."));
    } else {
      setRows((prev) =>
        prev.map((row) =>
          row.id === offer.id
            ? {
                ...row,
                approval_status: nextApprovalStatus,
                active: nextApprovalStatus === "approved",
              }
            : row,
        ),
      );
      setMessage(`Offer ${nextApprovalStatus}.`);
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
              placeholder="Search offers..."
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
            <option value="Active">Active</option>
            <option value="Pending">Pending</option>
            <option value="Rejected">Rejected</option>
            <option value="Inactive">Inactive</option>
          </select>

          <button
            type="button"
            onClick={() => void loadOffers()}
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
            title="Offer creation is handled by business app workflow."
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Create Offer</span>
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
          <p className="text-sm text-gray-600">Total Offers</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.total}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Active</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.active}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Pending</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.pending}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Rejected</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.rejected}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Offer</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Business</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Redemptions</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-gray-500">
                    Loading offers...
                  </td>
                </tr>
              ) : filteredOffers.length ? (
                filteredOffers.map((offer) => {
                  const status = normalizeStatus(offer);
                  return (
                    <tr key={offer.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium text-gray-900">{offer.title || "Untitled offer"}</p>
                          <p className="text-sm text-gray-600 mt-1">
                            {offer.description || "No description"}
                          </p>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <p className="text-sm text-gray-900">{offer.business?.name || "--"}</p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Percent className="w-4 h-4 text-amber-500" />
                          <span className="font-semibold text-amber-600">
                            {offer.offer_type || "cashback"}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <Calendar className="w-4 h-4 text-gray-400" />
                            <span>{formatDateTime(offer.created_at)}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <p className="font-medium text-gray-900">Live in reports</p>
                          <p className="text-sm text-gray-500">Use Reports page for totals</p>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {status === "Active" && <StatusBadge status="Active" variant="success" />}
                        {status === "Pending" && <StatusBadge status="Pending" variant="warning" />}
                        {status === "Rejected" && <StatusBadge status="Rejected" variant="danger" />}
                        {status === "Inactive" && <StatusBadge status="Inactive" variant="default" />}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="View">
                            <Eye className="w-4 h-4 text-gray-600" />
                          </button>
                          <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Edit">
                            <Edit className="w-4 h-4 text-gray-600" />
                          </button>
                          <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Duplicate">
                            <Copy className="w-4 h-4 text-gray-600" />
                          </button>
                          {status === "Pending" ? (
                            <>
                              <button
                                disabled={workingId === offer.id}
                                className="p-2 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-60"
                                title="Approve"
                                onClick={() => void updateReview(offer, "approved")}
                              >
                                <CheckCircle className="w-4 h-4 text-green-600" />
                              </button>
                              <button
                                disabled={workingId === offer.id}
                                className="p-2 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-60"
                                title="Reject"
                                onClick={() => void updateReview(offer, "rejected")}
                              >
                                <XCircle className="w-4 h-4 text-red-600" />
                              </button>
                            </>
                          ) : (
                            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Pause">
                              <Pause className="w-4 h-4 text-gray-600" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-gray-500">
                    No offers match current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Showing <span className="font-medium">{filteredOffers.length}</span> of{" "}
          <span className="font-medium">{rows.length}</span> offers
        </p>
      </div>
    </div>
  );
}
