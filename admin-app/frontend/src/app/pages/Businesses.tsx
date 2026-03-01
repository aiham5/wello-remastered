import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Store,
  Download,
  MapPin,
  Tag,
  TrendingUp,
  Eye,
  Edit,
  Pause,
  Check,
  X,
} from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import {
  apiRequest,
  formatDateTime,
  summarizeError,
} from "../lib/adminApi";

interface BusinessRow {
  id: string;
  name: string;
  category_label?: string | null;
  approval_status?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

const formatApproval = (value?: string | null) => String(value || "pending").toLowerCase();

export function Businesses() {
  const [rows, setRows] = useState<BusinessRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const loadBusinesses = async () => {
    setLoading(true);
    const res = await apiRequest<BusinessRow[]>("/api/admin/businesses?limit=300");
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to load businesses."));
      setRows([]);
    } else {
      setRows(Array.isArray(res.data) ? res.data : []);
      setMessage("");
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadBusinesses();
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((row) => {
      if (row.category_label) set.add(row.category_label);
    });
    return Array.from(set).sort();
  }, [rows]);

  const filteredBusinesses = useMemo(
    () =>
      rows.filter((business) => {
        const matchesSearch = String(business.name || "")
          .toLowerCase()
          .includes(searchQuery.toLowerCase());
        const matchesCategory =
          selectedCategory === "all" || business.category_label === selectedCategory;
        const currentStatus = formatApproval(business.approval_status);
        const matchesStatus =
          selectedStatus === "all" || currentStatus === selectedStatus.toLowerCase();
        return matchesSearch && matchesCategory && matchesStatus;
      }),
    [rows, searchQuery, selectedCategory, selectedStatus],
  );

  const stats = useMemo(
    () => ({
      total: rows.length,
      active: rows.filter((b) => formatApproval(b.approval_status) === "approved").length,
      pending: rows.filter((b) => formatApproval(b.approval_status) === "pending").length,
      rejected: rows.filter((b) => formatApproval(b.approval_status) === "rejected").length,
    }),
    [rows],
  );

  const updateDecision = async (business: BusinessRow, nextStatus: "approved" | "rejected") => {
    const confirmed = window.confirm(
      `${nextStatus === "approved" ? "Approve" : "Reject"} business "${business.name}"?`,
    );
    if (!confirmed) return;
    setWorkingId(business.id);
    const res = await apiRequest<BusinessRow>(
      `/api/admin/businesses/${encodeURIComponent(business.id)}/review`,
      {
        method: "POST",
        body: { nextApprovalStatus: nextStatus },
      },
    );
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to update business review."));
    } else {
      setRows((prev) =>
        prev.map((row) =>
          row.id === business.id
            ? {
                ...row,
                approval_status: nextStatus,
                status: nextStatus === "approved" ? "active" : "inactive",
              }
            : row,
        ),
      );
      setMessage(`Business ${nextStatus}.`);
    }
    setWorkingId(null);
  };

  const statusBadge = (approval?: string | null) => {
    const normalized = formatApproval(approval);
    if (normalized === "approved") return <StatusBadge status="Approved" variant="success" />;
    if (normalized === "rejected") return <StatusBadge status="Rejected" variant="danger" />;
    return <StatusBadge status="Pending" variant="warning" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex-1 w-full sm:w-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search businesses..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2.5 w-full border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="flex gap-3 w-full sm:w-auto">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
          >
            <option value="all">All Categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
          >
            <option value="all">All Status</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="rejected">Rejected</option>
          </select>

          <button className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>

          <button
            type="button"
            onClick={() => void loadBusinesses()}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
          >
            <Store className="w-4 h-4" />
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
          <p className="text-sm text-gray-600">Total Businesses</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.total}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Approved</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.active}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Pending Approval</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.pending}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Rejected</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.rejected}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {loading ? (
          <div className="bg-white rounded-lg border border-gray-200 p-6 text-gray-500">
            Loading businesses...
          </div>
        ) : filteredBusinesses.length ? (
          filteredBusinesses.map((business) => (
            <div
              key={business.id}
              className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-lg flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
                    {business.name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900">{business.name}</h3>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
                      <Tag className="w-4 h-4" />
                      <span>{business.category_label || "Uncategorized"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <MapPin className="w-4 h-4" />
                      <span>Location managed in app profile</span>
                    </div>
                  </div>
                </div>
                {statusBadge(business.approval_status)}
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-xs text-gray-600 mb-1">Business ID</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {business.id.slice(0, 8)}...
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Review State</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatApproval(business.approval_status)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Created</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatDateTime(business.created_at)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Updated</p>
                  <p className="text-sm font-semibold text-green-600">
                    {formatDateTime(business.updated_at)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-500">
                  Operational metrics are available in Reports.
                </span>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <div className="flex gap-2 flex-wrap">
                  <button className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                    <Eye className="w-4 h-4" />
                    View
                  </button>
                  <button className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                    <Edit className="w-4 h-4" />
                    Edit
                  </button>
                  {formatApproval(business.approval_status) === "pending" ? (
                    <>
                      <button
                        disabled={workingId === business.id}
                        onClick={() => void updateDecision(business, "approved")}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-green-700 border border-green-300 rounded-lg hover:bg-green-50 transition-colors disabled:opacity-60"
                      >
                        <Check className="w-4 h-4" />
                        Approve
                      </button>
                      <button
                        disabled={workingId === business.id}
                        onClick={() => void updateDecision(business, "rejected")}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-red-700 border border-red-300 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-60"
                      >
                        <X className="w-4 h-4" />
                        Reject
                      </button>
                    </>
                  ) : (
                    <button className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                      <Pause className="w-4 h-4" />
                      Archive
                    </button>
                  )}
                </div>
                <span className="text-xs text-gray-500">
                  {business.status || "unknown"} state
                </span>
              </div>
            </div>
          ))
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 p-6 text-gray-500">
            No businesses match current filters.
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Showing <span className="font-medium">{filteredBusinesses.length}</span> of{" "}
          <span className="font-medium">{rows.length}</span> businesses
        </p>
      </div>
    </div>
  );
}
