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
  Save,
} from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import {
  apiRequest,
  formatDateTime,
  summarizeError,
} from "../lib/adminApi";
import { downloadCsv, type CsvColumn } from "../lib/csv";

interface BusinessRow {
  id: string;
  name: string;
  category_label?: string | null;
  approval_status?: string | null;
  status?: string | null;
  commission_rate_cents?: number | null;
  default_cashback_rate_bps?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

type DrawerMode = "view" | "edit";
type RatePresetKey = "10" | "15" | "20" | "custom";

interface RateDraft {
  presetKey: RatePresetKey;
  commissionRateCents: number;
  defaultCashbackRateBps: number;
  customCommissionPercentInput: string;
  customCashbackPercentInput: string;
}

const BUSINESS_RATE_PRESET_OPTIONS: Array<{
  key: RatePresetKey;
  label: string;
  commissionRateCents: number | null;
  defaultCashbackRateBps: number | null;
}> = [
  { key: "10", label: "10%", commissionRateCents: 100, defaultCashbackRateBps: 600 },
  { key: "15", label: "15%", commissionRateCents: 150, defaultCashbackRateBps: 1000 },
  { key: "20", label: "20%", commissionRateCents: 200, defaultCashbackRateBps: 1500 },
  { key: "custom", label: "Custom Rate", commissionRateCents: null, defaultCashbackRateBps: null },
];

const BUSINESS_RATE_PRESET_BY_COMMISSION = new Map(
  BUSINESS_RATE_PRESET_OPTIONS
    .filter((option) => Number.isFinite(option.commissionRateCents))
    .map((option) => [option.commissionRateCents as number, option]),
);

const formatPercentLabel = (value?: number | null) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  const rounded = Math.round(numeric * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(/\.0$/, "");
};

const sanitizePercentInputText = (value: string) => {
  let text = String(value ?? "").replace(/[^0-9.]/g, "");
  const firstDotIndex = text.indexOf(".");
  if (firstDotIndex >= 0) {
    text =
      text.slice(0, firstDotIndex + 1) +
      text.slice(firstDotIndex + 1).replace(/\./g, "");
  }
  return text;
};

const parsePercentInputToScaledInt = (value: string, scale: number) => {
  const text = sanitizePercentInputText(value);
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? Math.round(numeric * scale) : null;
};

const normalizeBusinessCommissionRateCents = (value: unknown, fallback = 150) => {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.max(10, Math.min(1000, Math.round(numeric)));
  }
  return Math.max(10, Math.min(1000, Math.round(Number(fallback) || 150)));
};

const deriveDefaultCashbackRateBpsFromCommission = (value: unknown) => {
  const normalizedCommission = normalizeBusinessCommissionRateCents(value);
  const preset = BUSINESS_RATE_PRESET_BY_COMMISSION.get(normalizedCommission);
  if (preset?.defaultCashbackRateBps != null) return preset.defaultCashbackRateBps;
  return Math.max(0, Math.min(normalizedCommission * 10, (normalizedCommission - 50) * 10));
};

const normalizeBusinessDefaultCashbackRateBps = (
  cashbackRateBps: unknown,
  commissionRateCents: unknown,
) => {
  const maxCashbackRateBps = normalizeBusinessCommissionRateCents(commissionRateCents) * 10;
  const numeric = Number(cashbackRateBps);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.min(maxCashbackRateBps, Math.round(numeric)));
  }
  return deriveDefaultCashbackRateBpsFromCommission(commissionRateCents);
};

const createBusinessRateDraft = (
  commissionRateCents: unknown,
  defaultCashbackRateBps: unknown = null,
): RateDraft => {
  const normalizedCommission = normalizeBusinessCommissionRateCents(commissionRateCents);
  const normalizedCashback = normalizeBusinessDefaultCashbackRateBps(
    defaultCashbackRateBps,
    normalizedCommission,
  );
  const preset =
    BUSINESS_RATE_PRESET_OPTIONS.find(
      (option) =>
        option.commissionRateCents === normalizedCommission &&
        option.defaultCashbackRateBps === normalizedCashback,
    )?.key || "custom";
  return {
    presetKey: preset,
    commissionRateCents: normalizedCommission,
    defaultCashbackRateBps: normalizedCashback,
    customCommissionPercentInput: formatPercentLabel(normalizedCommission / 10),
    customCashbackPercentInput: formatPercentLabel(normalizedCashback / 100),
  };
};

const businessCsvColumns: CsvColumn<BusinessRow>[] = [
  { key: "id", label: "Business ID" },
  { key: "name", label: "Name" },
  { key: "category_label", label: "Category", format: (value) => String(value || "") },
  { key: "approval_status", label: "Approval Status", format: (value) => String(value || "") },
  { key: "status", label: "Status", format: (value) => String(value || "") },
  { key: "created_at", label: "Created At", format: (value) => String(value || "") },
  { key: "updated_at", label: "Updated At", format: (value) => String(value || "") },
];

const formatApproval = (value?: string | null) => String(value || "pending").toLowerCase();

export function Businesses() {
  const [rows, setRows] = useState<BusinessRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>("view");
  const [selectedBusiness, setSelectedBusiness] = useState<BusinessRow | null>(null);
  const [editPayload, setEditPayload] = useState("");
  const [rateModalBusiness, setRateModalBusiness] = useState<BusinessRow | null>(null);
  const [rateDraft, setRateDraft] = useState<RateDraft | null>(null);

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

  const submitDecision = async (
    business: BusinessRow,
    nextStatus: "approved" | "rejected",
    nextRateDraft?: RateDraft | null,
  ) => {
    const confirmed = window.confirm(
      `${nextStatus === "approved" ? "Approve" : "Reject"} business "${business.name}"?`,
    );
    if (!confirmed) return;
    setWorkingId(business.id);
    const normalizedRateDraft =
      nextStatus === "approved"
        ? createBusinessRateDraft(
            nextRateDraft?.commissionRateCents ?? business.commission_rate_cents ?? 150,
            nextRateDraft?.defaultCashbackRateBps ?? business.default_cashback_rate_bps ?? null,
          )
        : null;
    const res = await apiRequest<BusinessRow>(
      `/api/admin/businesses/${encodeURIComponent(business.id)}/review`,
      {
        method: "POST",
        body: {
          nextApprovalStatus: nextStatus,
          ...(normalizedRateDraft != null
            ? {
                commissionRateCents: normalizedRateDraft.commissionRateCents,
                defaultCashbackRateBps:
                  normalizedRateDraft.defaultCashbackRateBps,
              }
            : {}),
        },
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
                ...(normalizedRateDraft != null
                  ? {
                      commission_rate_cents:
                        normalizedRateDraft.commissionRateCents,
                      default_cashback_rate_bps:
                        normalizedRateDraft.defaultCashbackRateBps,
                    }
                  : {}),
              }
            : row,
        ),
      );
      setSelectedBusiness((prev) =>
        prev?.id === business.id
          ? {
              ...prev,
              approval_status: nextStatus,
              status: nextStatus === "approved" ? "active" : "inactive",
              ...(normalizedRateDraft != null
                ? {
                    commission_rate_cents:
                      normalizedRateDraft.commissionRateCents,
                    default_cashback_rate_bps:
                      normalizedRateDraft.defaultCashbackRateBps,
                  }
                : {}),
            }
          : prev,
      );
      setMessage(`Business ${nextStatus}.`);
    }
    setWorkingId(null);
  };

  const updateDecision = async (business: BusinessRow, nextStatus: "approved" | "rejected") => {
    if (nextStatus === "approved") {
      setRateModalBusiness(business);
      setRateDraft(
        createBusinessRateDraft(
          business.commission_rate_cents ?? 150,
          business.default_cashback_rate_bps ?? null,
        ),
      );
      return;
    }
    await submitDecision(business, nextStatus, null);
  };

  const openDrawer = (business: BusinessRow, mode: DrawerMode) => {
    setSelectedBusiness(business);
    setDrawerMode(mode);
    const editable = { ...business };
    delete editable.id;
    delete editable.created_at;
    delete editable.updated_at;
    setEditPayload(JSON.stringify(editable, null, 2));
    setDrawerOpen(true);
  };

  const saveBusiness = async () => {
    if (!selectedBusiness) return;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(editPayload || "{}");
    } catch {
      setMessage("Invalid JSON in business editor.");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setMessage("Business editor must be a JSON object.");
      return;
    }
    setWorkingId(selectedBusiness.id);
    const res = await apiRequest<BusinessRow>(
      `/api/admin/businesses/${encodeURIComponent(selectedBusiness.id)}/update`,
      {
        method: "POST",
        body: parsed,
      },
    );
    if (res.error || !res.data) {
      setMessage(summarizeError(res.error, "Unable to update business."));
      setWorkingId(null);
      return;
    }

    setRows((prev) =>
      prev.map((row) => (row.id === selectedBusiness.id ? { ...row, ...res.data } : row)),
    );
    setSelectedBusiness((prev) => (prev ? { ...prev, ...res.data } : prev));
    setDrawerMode("view");
    setMessage("Business updated.");
    setWorkingId(null);
  };

  const archiveBusiness = async (business: BusinessRow) => {
    const confirmed = window.confirm(`Archive business "${business.name}"?`);
    if (!confirmed) return;
    setWorkingId(business.id);
    const res = await apiRequest<BusinessRow>(
      `/api/admin/businesses/${encodeURIComponent(business.id)}/archive`,
      { method: "POST" },
    );
    if (res.error || !res.data) {
      setMessage(summarizeError(res.error, "Unable to archive business."));
    } else {
      setRows((prev) =>
        prev.map((row) =>
          row.id === business.id ? { ...row, ...res.data, status: "inactive" } : row,
        ),
      );
      setSelectedBusiness((prev) =>
        prev?.id === business.id ? { ...prev, ...res.data, status: "inactive" } : prev,
      );
      setMessage("Business archived.");
    }
    setWorkingId(null);
  };

  const exportBusinesses = () => {
    downloadCsv("businesses-export.csv", filteredBusinesses, businessCsvColumns);
    setMessage(`Exported ${filteredBusinesses.length} businesses.`);
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

          <button
            type="button"
            onClick={exportBusinesses}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
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
                <div>
                  <p className="text-xs text-gray-600 mb-1">Commission</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatPercentLabel(
                      normalizeBusinessCommissionRateCents(
                        business.commission_rate_cents,
                      ) / 10,
                    )}
                    %
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Cashback</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatPercentLabel(
                      normalizeBusinessDefaultCashbackRateBps(
                        business.default_cashback_rate_bps,
                        business.commission_rate_cents,
                      ) / 100,
                    )}
                    %
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
                  <button
                    type="button"
                    onClick={() => openDrawer(business, "view")}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => openDrawer(business, "edit")}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
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
                    <button
                      type="button"
                      onClick={() => void archiveBusiness(business)}
                      disabled={workingId === business.id}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60"
                    >
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

      {drawerOpen && selectedBusiness ? (
        <div className="fixed inset-0 z-40 bg-black/30 flex justify-end">
          <div className="w-full max-w-xl h-full bg-white shadow-xl border-l border-gray-200 flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {drawerMode === "edit" ? "Edit Business" : "Business Details"}
              </h3>
              <button
                type="button"
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                onClick={() => setDrawerOpen(false)}
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {drawerMode === "view" ? (
                <>
                  <div>
                    <p className="text-sm text-gray-500">Name</p>
                    <p className="font-semibold text-gray-900">{selectedBusiness.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Category</p>
                    <p className="font-medium text-gray-900">
                      {selectedBusiness.category_label || "Uncategorized"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Business ID</p>
                    <p className="font-medium text-gray-900 break-all">{selectedBusiness.id}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-500">Approval</p>
                      <p className="font-medium text-gray-900">{selectedBusiness.approval_status}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Status</p>
                      <p className="font-medium text-gray-900">{selectedBusiness.status || "--"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Created</p>
                      <p className="font-medium text-gray-900">{formatDateTime(selectedBusiness.created_at)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Updated</p>
                      <p className="font-medium text-gray-900">{formatDateTime(selectedBusiness.updated_at)}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    onClick={() => setDrawerMode("edit")}
                  >
                    Switch to Edit
                  </button>
                </>
              ) : (
                <>
                  <label className="block">
                    <span className="text-sm font-medium text-gray-700">
                      Full business details (JSON)
                    </span>
                    <textarea
                      rows={18}
                      value={editPayload}
                      onChange={(event) => setEditPayload(event.target.value)}
                      className="mt-1 w-full px-3 py-2 font-mono text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </label>
                  <p className="text-xs text-gray-500">
                    Edit any business field here. Immutable fields (`id`, `created_at`, `updated_at`) are excluded automatically.
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => void saveBusiness()}
                      disabled={workingId === selectedBusiness.id}
                      className="flex-1 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2"
                    >
                      <Save className="w-4 h-4" />
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrawerMode("view")}
                      className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {rateModalBusiness && rateDraft ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Approve Business</h3>
                <p className="text-sm text-gray-500">{rateModalBusiness.name}</p>
              </div>
              <button
                type="button"
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                onClick={() => {
                  setRateModalBusiness(null);
                  setRateDraft(null);
                }}
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <p className="text-sm font-medium text-gray-900 mb-3">Choose a rate</p>
                <div className="grid grid-cols-2 gap-3">
                  {BUSINESS_RATE_PRESET_OPTIONS.map((option) => {
                    const selected = rateDraft.presetKey === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() =>
                          setRateDraft((current) =>
                            option.key === "custom"
                              ? { ...(current || rateDraft), presetKey: "custom" }
                              : createBusinessRateDraft(
                                  option.commissionRateCents,
                                  option.defaultCashbackRateBps,
                                ),
                          )
                        }
                        className={`px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                          selected
                            ? "border-amber-500 bg-amber-50 text-amber-900"
                            : "border-gray-300 text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {rateDraft.presetKey === "custom" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      Commission %
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={rateDraft.customCommissionPercentInput}
                      onChange={(e) => {
                        const sanitized = sanitizePercentInputText(e.target.value);
                        const parsed = parsePercentInputToScaledInt(sanitized, 10);
                        setRateDraft((current) => {
                          const base = current || rateDraft;
                          const nextCommission =
                            parsed == null
                              ? base.commissionRateCents
                              : normalizeBusinessCommissionRateCents(parsed, base.commissionRateCents);
                          const nextCashback = normalizeBusinessDefaultCashbackRateBps(
                            base.defaultCashbackRateBps,
                            nextCommission,
                          );
                          return {
                            ...base,
                            presetKey: "custom",
                            customCommissionPercentInput: sanitized,
                            commissionRateCents: nextCommission,
                            defaultCashbackRateBps: nextCashback,
                            customCashbackPercentInput: formatPercentLabel(nextCashback / 100),
                          };
                        });
                      }}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      Cashback %
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={rateDraft.customCashbackPercentInput}
                      onChange={(e) => {
                        const sanitized = sanitizePercentInputText(e.target.value);
                        const parsed = parsePercentInputToScaledInt(sanitized, 100);
                        setRateDraft((current) => {
                          const base = current || rateDraft;
                          const nextCashback =
                            parsed == null
                              ? base.defaultCashbackRateBps
                              : normalizeBusinessDefaultCashbackRateBps(
                                  parsed,
                                  base.commissionRateCents,
                                );
                          return {
                            ...base,
                            presetKey: "custom",
                            customCashbackPercentInput: sanitized,
                            defaultCashbackRateBps: nextCashback,
                            customCommissionPercentInput: formatPercentLabel(
                              base.commissionRateCents / 10,
                            ),
                          };
                        });
                      }}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                </div>
              ) : null}

              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Business pays {formatPercentLabel(rateDraft.commissionRateCents / 10)}%, users get{" "}
                {formatPercentLabel(rateDraft.defaultCashbackRateBps / 100)}%, Wello keeps{" "}
                {formatPercentLabel(
                  Math.max(
                    rateDraft.commissionRateCents / 10 -
                      rateDraft.defaultCashbackRateBps / 100,
                    0,
                  ),
                )}
                %.
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
              <button
                type="button"
                className="px-4 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  setRateModalBusiness(null);
                  setRateDraft(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={workingId === rateModalBusiness.id}
                className="px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-60"
                onClick={async () => {
                  await submitDecision(rateModalBusiness, "approved", rateDraft);
                  setRateModalBusiness(null);
                  setRateDraft(null);
                }}
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
