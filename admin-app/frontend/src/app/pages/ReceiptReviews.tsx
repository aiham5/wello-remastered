import { useEffect, useMemo, useState } from "react";
import {
  Search,
  AlertTriangle,
  Eye,
  RefreshCw,
  ImageIcon,
} from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import {
  apiRequest,
  formatCurrencyFromCents,
  formatDateTime,
  summarizeError,
} from "../lib/adminApi";
import { resolveReceiptImage, type SignedReceiptImage } from "../lib/receiptImage";
import { ImageLightbox } from "../components/ImageLightbox";

type ReviewStatus = "pending" | "verified" | "rejected";

interface TradeOwnerDecision {
  id?: string | null;
  response?: string | null;
  dispute_reason?: string | null;
  updated_at?: string | null;
}

interface ReceiptListRow {
  id: string;
  user_id?: string | null;
  business_id?: string | null;
  storage_path?: string | null;
  receipt_total_cents?: number | null;
  review_status?: ReviewStatus | null;
  review_notes?: string | null;
  reviewed_at?: string | null;
  uploaded_at?: string | null;
  retry_allowed?: boolean | null;
  retry_decided_by?: string | null;
  retry_decided_at?: string | null;
  promo_code_id?: string | null;
  promo_code?: {
    id?: string | null;
    code?: string | null;
    cashback_rate_bps?: number | null;
  } | null;
  trade_receipt_owner_responses?: TradeOwnerDecision[] | null;
  business?: {
    id: string;
    name?: string | null;
    category_key?: string | null;
    category_label?: string | null;
  } | null;
}

interface ReceiptDetail extends ReceiptListRow {
  commission_due_cents?: number | null;
}

interface PreviewData {
  commission_cents?: number;
  commission_rate_bps?: number;
  cashback_cents?: number;
  effective_cashback_rate_bps?: number;
  applied_promo_code?: string | null;
  applied_promo_rate_bps?: number | null;
  platform_subsidy_cents?: number;
}

const asDollarsString = (cents?: number | null) => ((Number(cents || 0) / 100).toFixed(2));

const NON_TRADE_CATEGORY_KEYS = new Set(["activity", "restaurant", "drink", "cafe"]);
const NON_TRADE_CATEGORY_ALIASES = new Set([
  "activity",
  "activities",
  "activities-entertainment",
  "entertainment",
  "restaurant",
  "restaurants",
  "restaurant-food",
  "food",
  "drink",
  "drinks",
  "cafe",
  "cafes",
  "coffee",
]);

const normalizeCategoryValue = (value?: string | null) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, "-")
    .replace(/\s+/g, "-");

const isTradeBusinessCategory = (categoryKey?: string | null, categoryLabel?: string | null) => {
  const normalizedKey = normalizeCategoryValue(categoryKey);
  if (normalizedKey && NON_TRADE_CATEGORY_KEYS.has(normalizedKey)) return false;
  const normalizedLabel = normalizeCategoryValue(categoryLabel);
  if (normalizedLabel && NON_TRADE_CATEGORY_ALIASES.has(normalizedLabel)) return false;
  return Boolean(normalizedKey || normalizedLabel);
};

export function ReceiptReviews() {
  const [rows, setRows] = useState<ReceiptListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<ReviewStatus>("pending");
  const [message, setMessage] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  const [image, setImage] = useState<SignedReceiptImage | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [totalInput, setTotalInput] = useState("0.00");
  const [notesInput, setNotesInput] = useState("");
  const [rejectAllowRetry, setRejectAllowRetry] = useState(true);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState("");
  const [viewerTitle, setViewerTitle] = useState("Receipt Image");
  const [tradeOverrideEnabled, setTradeOverrideEnabled] = useState(false);

  const loadReceipts = async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: "0",
      pageSize: "200",
      status: selectedStatus,
    });
    if (searchQuery.trim()) params.set("search", searchQuery.trim());

    const res = await apiRequest<ReceiptListRow[]>(`/api/admin/receipts?${params.toString()}`);
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to load receipts."));
      setRows([]);
    } else {
      const list = Array.isArray(res.data) ? res.data : [];
      setRows(list);
      setMessage("");
      if (list.length && !list.some((row) => row.id === selectedId)) {
        setSelectedId(list[0].id);
      }
      if (!list.length) {
        setSelectedId(null);
        setDetail(null);
        setImage(null);
      }
    }
    setLoading(false);
  };

  const loadDetail = async (receiptId: string) => {
    const res = await apiRequest<ReceiptDetail>(
      `/api/admin/receipts/${encodeURIComponent(receiptId)}/detail`,
    );
    if (res.error || !res.data) {
      setMessage(summarizeError(res.error, "Unable to load receipt detail."));
      return;
    }
    setDetail(res.data);
    setTotalInput(asDollarsString(res.data.receipt_total_cents));
    setNotesInput(String(res.data.review_notes || ""));
    setRejectAllowRetry(
      String(res.data.review_status || "").toLowerCase() === "pending"
        ? true
        : Boolean(res.data.retry_allowed),
    );
    setTradeOverrideEnabled(false);
    setPreview(null);
    setPreviewError("");

    const signed = await resolveReceiptImage(String(res.data.storage_path || ""));
    setImage(signed);
  };

  useEffect(() => {
    void loadReceipts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStatus]);

  useEffect(() => {
    if (!selectedId) return;
    void loadDetail(selectedId);
  }, [selectedId]);

  useEffect(() => {
    const current = detail;
    if (!current?.id) return;
    const status = String(current.review_status || "").toLowerCase();
    if (status !== "pending" && status !== "verified") return;

    const parsed = Number(totalInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setPreview(null);
      setPreviewError("");
      return;
    }

    const timeout = setTimeout(async () => {
      setPreviewLoading(true);
      const res = await apiRequest<PreviewData>(
        `/api/admin/receipts/${encodeURIComponent(current.id)}/preview`,
        {
          method: "POST",
          body: { receiptTotalCents: Math.round(parsed * 100) },
        },
      );
      if (res.error) {
        setPreview(null);
        setPreviewError(summarizeError(res.error, "Unable to calculate preview."));
      } else {
        setPreview(res.data || null);
        setPreviewError("");
      }
      setPreviewLoading(false);
    }, 250);

    return () => clearTimeout(timeout);
  }, [totalInput, detail?.id, detail?.review_status]);

  const filteredReceipts = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const query = searchQuery.toLowerCase();
    return rows.filter((receipt) => {
      const business = String(receipt.business?.name || "").toLowerCase();
      const user = String(receipt.user_id || "").toLowerCase();
      const id = String(receipt.id || "").toLowerCase();
      const promo = String(receipt.promo_code?.code || receipt.promo_code_id || "").toLowerCase();
      return business.includes(query) || user.includes(query) || id.includes(query) || promo.includes(query);
    });
  }, [rows, searchQuery]);

  const detailTradeDecision = useMemo(() => {
    const row = Array.isArray(detail?.trade_receipt_owner_responses)
      ? detail?.trade_receipt_owner_responses?.[0] || null
      : null;
    const response = String(row?.response || "").trim().toLowerCase();
    return row && response
      ? {
          ...row,
          response,
        }
      : null;
  }, [detail?.trade_receipt_owner_responses]);

  const isDetailTradeReceipt = useMemo(
    () => isTradeBusinessCategory(detail?.business?.category_key, detail?.business?.category_label),
    [detail?.business?.category_key, detail?.business?.category_label],
  );

  const tradeInputLocked = useMemo(
    () => isDetailTradeReceipt && !detailTradeDecision?.response && !tradeOverrideEnabled,
    [detailTradeDecision?.response, isDetailTradeReceipt, tradeOverrideEnabled],
  );

  const stats = useMemo(
    () => ({
      pending: rows.filter((row) => String(row.review_status) === "pending").length,
      flagged: rows.filter(
        (row) => Number(row.receipt_total_cents || 0) > 10000 || !!String(row.review_notes || "").trim(),
      ).length,
      approved: rows.filter((row) => String(row.review_status) === "verified").length,
      avgReviewText: "Live queue",
    }),
    [rows],
  );

  const submitDecision = async (action: "verify" | "reject" | "edit") => {
    if (!detail?.id) return;

    const parsed = Number(totalInput);
    const receiptTotalCents = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
    if ((action === "verify" || action === "edit") && tradeInputLocked) {
      setMessage("Trade receipt total is locked until the business answers or you override it.");
      return;
    }
    if ((action === "verify" || action === "edit") && receiptTotalCents <= 0) {
      setMessage("Enter a valid receipt total before approving.");
      return;
    }

    const expectedStatus = String(detail.review_status || "pending");
    const expectedReviewedAt = detail.reviewed_at || null;
    setWorking(true);
    const res = await apiRequest<ReceiptDetail>(
      `/api/admin/receipts/${encodeURIComponent(detail.id)}/decision`,
      {
        method: "POST",
        body: {
          action,
          receiptTotalCents,
          reviewNotes: notesInput.trim() || null,
          expectedStatus,
          expectedReviewedAt,
          retryAllowed: action === "reject" ? rejectAllowRetry : false,
        },
      },
    );
    if (res.error || !res.data) {
      setMessage(summarizeError(res.error, "Unable to update receipt decision."));
      setWorking(false);
      return;
    }

    const updated = res.data;
    setRows((prev) =>
      prev.map((row) =>
        row.id === updated.id
          ? {
              ...row,
              review_status: updated.review_status,
              review_notes: updated.review_notes,
              reviewed_at: updated.reviewed_at,
              receipt_total_cents: updated.receipt_total_cents,
              retry_allowed: updated.retry_allowed,
            }
          : row,
      ),
    );
    setDetail(updated);
    setMessage(
      action === "verify"
        ? "Receipt verified."
        : action === "reject"
          ? updated.retry_allowed
            ? "Receipt rejected. Retry upload is allowed."
            : "Receipt rejected. Retry upload is disabled."
          : "Receipt updated.",
    );
    setWorking(false);
  };

  const openReceiptImage = async (row: ReceiptListRow) => {
    const signed = await resolveReceiptImage(String(row.storage_path || ""));
    if (!signed.signedUrl) {
      setMessage(`Unable to open image. ${signed.errorReason || "No image available."}`);
      return;
    }
    setViewerTitle(`Receipt ${row.id.slice(0, 8)}`);
    setViewerUrl(signed.signedUrl);
    setViewerOpen(true);
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
            onChange={(e) => setSelectedStatus(e.target.value as ReviewStatus)}
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

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Receipt ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Business</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Promo</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-gray-500">
                      Loading receipts...
                    </td>
                  </tr>
                ) : filteredReceipts.length ? (
                  filteredReceipts.map((receipt) => {
                    const status = String(receipt.review_status || "pending");
                    const amountCents = Number(receipt.receipt_total_cents || 0);
                    const isSelected = selectedId === receipt.id;
                    const isTradeReceipt = isTradeBusinessCategory(
                      receipt.business?.category_key,
                      receipt.business?.category_label,
                    );
                    return (
                      <tr
                        key={receipt.id}
                        className={`transition-colors ${
                          isTradeReceipt
                            ? isSelected
                              ? "bg-red-50"
                              : "hover:bg-red-50/60"
                            : isSelected
                              ? "bg-amber-50"
                              : "hover:bg-gray-50"
                        }`}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <p className="font-medium text-gray-900">#{receipt.id.slice(0, 8)}</p>
                            <p className="text-xs text-gray-500">{formatDateTime(receipt.uploaded_at)}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <p className="text-sm text-gray-900">{receipt.user_id || "--"}</p>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <p className={`text-sm ${isTradeReceipt ? "font-semibold text-red-700" : "text-gray-900"}`}>
                            {receipt.business?.name || receipt.business_id || "--"}
                          </p>
                          {isTradeReceipt ? (
                            <p className="text-xs font-medium uppercase tracking-wide text-red-600">
                              Trade receipt
                            </p>
                          ) : null}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <p className="font-medium text-gray-900">
                            {formatCurrencyFromCents(amountCents)}
                          </p>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <p className="text-sm text-gray-900">
                            {receipt.promo_code?.code || receipt.promo_code_id || "None"}
                          </p>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {status === "pending" && <StatusBadge status="Pending" variant="warning" />}
                          {status === "verified" && <StatusBadge status="Approved" variant="success" />}
                          {status === "rejected" && <StatusBadge status="Rejected" variant="danger" />}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <button
                              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition-colors"
                              onClick={() => setSelectedId(receipt.id)}
                            >
                              <Eye className="w-4 h-4" />
                              Review
                            </button>
                            <button
                              type="button"
                              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-50 text-gray-700 rounded hover:bg-gray-100 transition-colors"
                              onClick={() => void openReceiptImage(receipt)}
                              disabled={!String(receipt.storage_path || "").trim()}
                              title={
                                String(receipt.storage_path || "").trim()
                                  ? "Open full-size image"
                                  : "Image unavailable"
                              }
                            >
                              <ImageIcon className="w-4 h-4" />
                              Open image
                            </button>
                            {status === "pending" && (
                              <span className="text-xs text-gray-500">Use sidebar actions</span>
                            )}
                            {amountCents > 10000 && (
                              <span className="inline-flex items-center gap-1 text-xs text-red-600">
                                <AlertTriangle className="w-3 h-3" />
                                High
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-gray-500">
                      No receipts match current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col gap-4 min-h-[540px]">
          <h3 className="text-lg font-semibold text-gray-900">Receipt Verification</h3>
          {!detail ? (
            <p className="text-sm text-gray-500">Select a receipt to review details.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-gray-500">Receipt</p>
                  <p className="font-medium text-gray-900">{detail.id}</p>
                </div>
                <div>
                  <p className="text-gray-500">Status</p>
                  <p className="font-medium text-gray-900">{detail.review_status || "pending"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Business</p>
                  <p className="font-medium text-gray-900">
                    {detail.business?.name || detail.business_id || "--"}
                  </p>
                </div>
                {isDetailTradeReceipt ? (
                  <div>
                    <p className="text-gray-500">Trade owner answer</p>
                    <p className="font-medium text-red-700">
                      {detailTradeDecision?.response === "accepted"
                        ? "Accepted"
                        : detailTradeDecision?.response === "disputed"
                          ? "Disputed"
                          : "Awaiting response"}
                    </p>
                  </div>
                ) : null}
                <div>
                  <p className="text-gray-500">User</p>
                  <p className="font-medium text-gray-900">{detail.user_id || "--"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Promo</p>
                  <p className="font-medium text-gray-900">
                    {detail.promo_code?.code || detail.promo_code_id || "None"}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Uploaded</p>
                  <p className="font-medium text-gray-900">
                    {formatDateTime(detail.uploaded_at)}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Reviewed</p>
                  <p className="font-medium text-gray-900">
                    {formatDateTime(detail.reviewed_at)}
                  </p>
                </div>
              </div>

              {isDetailTradeReceipt && detailTradeDecision?.response === "disputed" && detailTradeDecision.dispute_reason ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                  <span className="font-semibold">Dispute reason:</span> {detailTradeDecision.dispute_reason}
                </div>
              ) : null}

              {isDetailTradeReceipt ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-900 space-y-2">
                  <p className="font-semibold">Trade receipt controls</p>
                  <p>
                    Receipt total stays locked until the business answers Accept or Dispute. You can override
                    that lock if you need to process it early.
                  </p>
                  <button
                    type="button"
                    onClick={() => setTradeOverrideEnabled((prev) => !prev)}
                    className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      tradeOverrideEnabled
                        ? "bg-red-700 text-white hover:bg-red-800"
                        : "bg-white text-red-700 border border-red-300 hover:bg-red-100"
                    }`}
                  >
                    {tradeOverrideEnabled ? "Disable override" : "Override business decision lock"}
                  </button>
                </div>
              ) : null}

              <label className="block">
                <span className="text-sm text-gray-700">Receipt total (USD)</span>
                <input
                  value={totalInput}
                  onChange={(e) => setTotalInput(e.target.value)}
                  disabled={tradeInputLocked}
                  className={`mt-1 w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                    tradeInputLocked
                      ? "border-red-200 bg-red-50 text-red-700 cursor-not-allowed focus:ring-red-200"
                      : "border-gray-300 focus:ring-amber-500"
                  }`}
                />
              </label>
              {tradeInputLocked ? (
                <p className="text-xs text-red-600">
                  Locked until the trade business answers Accept or Dispute, unless you use the override.
                </p>
              ) : null}

              <label className="block">
                <span className="text-sm text-gray-700">Review notes</span>
                <textarea
                  rows={3}
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </label>
              {String(detail.review_status || "").toLowerCase() === "pending" ? (
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={rejectAllowRetry}
                    onChange={(e) => setRejectAllowRetry(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                    disabled={working}
                  />
                  Allow user to retry receipt upload if rejected
                </label>
              ) : null}
              {String(detail.review_status || "").toLowerCase() === "rejected" ? (
                <p className="text-xs text-gray-500">
                  Retry upload: {detail.retry_allowed ? "Allowed" : "Disabled"}
                </p>
              ) : null}

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-2">
                  <p className="text-gray-500">Commission</p>
                  <p className="font-semibold text-gray-900">
                    {preview ? formatCurrencyFromCents(Number(preview.commission_cents || 0)) : "--"}
                  </p>
                  <p className="text-gray-500">
                    {preview?.commission_rate_bps
                      ? `${(Number(preview.commission_rate_bps) / 100).toFixed(2)}%`
                      : ""}
                  </p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-2">
                  <p className="text-gray-500">Cashback</p>
                  <p className="font-semibold text-gray-900">
                    {preview ? formatCurrencyFromCents(Number(preview.cashback_cents || 0)) : "--"}
                  </p>
                  <p className="text-gray-500">
                    {preview?.effective_cashback_rate_bps
                      ? `${(Number(preview.effective_cashback_rate_bps) / 100).toFixed(2)}%`
                      : ""}
                  </p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-2">
                  <p className="text-gray-500">Promo</p>
                  <p className="font-semibold text-gray-900">{preview?.applied_promo_code || "None"}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-2">
                  <p className="text-gray-500">Platform Subsidy</p>
                  <p className="font-semibold text-gray-900">
                    {preview
                      ? formatCurrencyFromCents(Number(preview.platform_subsidy_cents || 0))
                      : "--"}
                  </p>
                </div>
              </div>

              <p className="text-xs text-gray-500">
                {previewLoading
                  ? "Calculating preview..."
                  : previewError || "Preview updates as you edit totals."}
              </p>

              <div className="border border-gray-200 rounded-lg p-2 bg-gray-50">
                {image?.signedUrl ? (
                  <div className="space-y-2">
                    <img
                      src={image.signedUrl}
                      alt="Receipt"
                      className="w-full max-h-64 object-contain rounded"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setViewerTitle(`Receipt ${detail.id.slice(0, 8)}`);
                        setViewerUrl(image.signedUrl);
                        setViewerOpen(true);
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors text-sm"
                    >
                      Open full size
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">
                    Unable to load image. {image?.errorReason || "No image path available."}
                  </p>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                {String(detail.review_status || "").toLowerCase() === "pending" ? (
                  <>
                    <button
                      disabled={working || tradeInputLocked}
                      onClick={() => void submitDecision("verify")}
                      className="flex-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-60"
                    >
                      Verify
                    </button>
                    <button
                      disabled={working}
                      onClick={() => void submitDecision("reject")}
                      className="flex-1 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </>
                ) : String(detail.review_status || "").toLowerCase() === "verified" ? (
                  <button
                    disabled={working || tradeInputLocked}
                    onClick={() => void submitDecision("edit")}
                    className="w-full px-3 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-60"
                  >
                    Save Correction
                  </button>
                ) : (
                  <p className="text-xs text-gray-500">
                    Rejected receipts are read-only here.
                  </p>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
      <ImageLightbox
        open={viewerOpen}
        imageUrl={viewerUrl}
        title={viewerTitle}
        onClose={() => setViewerOpen(false)}
      />
    </div>
  );
}
