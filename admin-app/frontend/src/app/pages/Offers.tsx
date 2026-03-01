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
  X,
  Save,
} from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import { apiRequest, formatDateTime, summarizeError } from "../lib/adminApi";

interface OfferRow {
  id: string;
  business_id: string;
  title?: string | null;
  description?: string | null;
  offer_type?: string | null;
  active?: boolean | null;
  approval_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  business?: {
    id: string;
    name?: string | null;
  } | null;
}

type DrawerMode = "view" | "edit";

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

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>("view");
  const [selectedOffer, setSelectedOffer] = useState<OfferRow | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editType, setEditType] = useState("");
  const [editActive, setEditActive] = useState(false);

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
      if (selectedOffer?.id === offer.id) {
        setSelectedOffer((prev) =>
          prev
            ? {
                ...prev,
                approval_status: nextApprovalStatus,
                active: nextApprovalStatus === "approved",
              }
            : prev,
        );
      }
    }
    setWorkingId(null);
  };

  const openDrawer = (offer: OfferRow, mode: DrawerMode) => {
    setSelectedOffer(offer);
    setDrawerMode(mode);
    setEditTitle(String(offer.title || ""));
    setEditDescription(String(offer.description || ""));
    setEditType(String(offer.offer_type || "cashback"));
    setEditActive(Boolean(offer.active));
    setDrawerOpen(true);
  };

  const saveOfferEdit = async () => {
    if (!selectedOffer) return;
    const title = editTitle.trim();
    if (!title) {
      setMessage("Offer title is required.");
      return;
    }
    setWorkingId(selectedOffer.id);
    const res = await apiRequest<OfferRow>("/api/admin/query", {
      method: "POST",
      body: {
        table: "offers",
        action: "update",
        body: {
          title,
          description: editDescription.trim() || null,
          offer_type: editType.trim() || "cashback",
          active: editActive,
          updated_at: new Date().toISOString(),
        },
        filters: [{ column: "id", op: "eq", value: selectedOffer.id }],
        select: "id,business_id,title,description,offer_type,active,approval_status,created_at,updated_at",
        single: "maybe",
      },
    });

    if (res.error || !res.data) {
      setMessage(summarizeError(res.error, "Unable to save offer changes."));
      setWorkingId(null);
      return;
    }

    const updated = res.data;
    setRows((prev) =>
      prev.map((row) =>
        row.id === selectedOffer.id
          ? {
              ...row,
              ...updated,
              business: row.business,
            }
          : row,
      ),
    );
    setSelectedOffer((prev) =>
      prev
        ? {
            ...prev,
            ...updated,
            business: prev.business,
          }
        : prev,
    );
    setDrawerMode("view");
    setMessage("Offer updated.");
    setWorkingId(null);
  };

  const duplicateOffer = async (offer: OfferRow) => {
    setWorkingId(offer.id);
    const res = await apiRequest<OfferRow>("/api/admin/query", {
      method: "POST",
      body: {
        table: "offers",
        action: "insert",
        body: {
          business_id: offer.business_id,
          title: `${offer.title || "Offer"} (Copy)`,
          description: offer.description || null,
          offer_type: offer.offer_type || "cashback",
          active: false,
          approval_status: "pending",
        },
        select: "id,business_id,title,description,offer_type,active,approval_status,created_at,updated_at",
        single: "maybe",
      },
    });
    if (res.error || !res.data) {
      setMessage(summarizeError(res.error, "Unable to duplicate offer."));
    } else {
      setRows((prev) => [{ ...res.data, business: offer.business }, ...prev]);
      setMessage("Offer duplicated as pending.");
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
                          <button
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            title="View"
                            onClick={() => openDrawer(offer, "view")}
                          >
                            <Eye className="w-4 h-4 text-gray-600" />
                          </button>
                          <button
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Edit"
                            onClick={() => openDrawer(offer, "edit")}
                          >
                            <Edit className="w-4 h-4 text-gray-600" />
                          </button>
                          <button
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Duplicate"
                            onClick={() => void duplicateOffer(offer)}
                            disabled={workingId === offer.id}
                          >
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

      {drawerOpen && selectedOffer ? (
        <div className="fixed inset-0 z-40 bg-black/30 flex justify-end">
          <div className="w-full max-w-xl h-full bg-white shadow-xl border-l border-gray-200 flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {drawerMode === "edit" ? "Edit Offer" : "Offer Details"}
              </h3>
              <button
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                onClick={() => setDrawerOpen(false)}
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {drawerMode === "view" ? (
                <>
                  <div className="space-y-2">
                    <p className="text-sm text-gray-500">Title</p>
                    <p className="font-semibold text-gray-900">{selectedOffer.title || "--"}</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm text-gray-500">Description</p>
                    <p className="text-gray-800 whitespace-pre-wrap">
                      {selectedOffer.description || "No description"}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-500">Business</p>
                      <p className="font-medium text-gray-900">
                        {selectedOffer.business?.name || selectedOffer.business_id}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Type</p>
                      <p className="font-medium text-gray-900">{selectedOffer.offer_type || "--"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Approval</p>
                      <p className="font-medium text-gray-900">
                        {selectedOffer.approval_status || "pending"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Created</p>
                      <p className="font-medium text-gray-900">
                        {formatDateTime(selectedOffer.created_at)}
                      </p>
                    </div>
                  </div>

                  <button
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    onClick={() => setDrawerMode("edit")}
                  >
                    Switch to Edit
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                    <textarea
                      rows={5}
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
                      <input
                        value={editType}
                        onChange={(e) => setEditType(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Active</label>
                      <select
                        value={editActive ? "true" : "false"}
                        onChange={(e) => setEditActive(e.target.value === "true")}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                      >
                        <option value="true">True</option>
                        <option value="false">False</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      className="flex-1 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                      onClick={() => void saveOfferEdit()}
                      disabled={workingId === selectedOffer.id}
                    >
                      <Save className="w-4 h-4" />
                      Save
                    </button>
                    <button
                      className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                      onClick={() => setDrawerMode("view")}
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
    </div>
  );
}
