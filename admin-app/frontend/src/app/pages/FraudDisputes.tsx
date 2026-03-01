import { useEffect, useMemo, useState } from "react";
import { Shield, User, Store, X, ImageIcon } from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import {
  apiRequest,
  formatRelativeTime,
  formatCurrencyFromCents,
  summarizeError,
} from "../lib/adminApi";
import { resolveReceiptImage, type SignedReceiptImage } from "../lib/receiptImage";
import { ImageLightbox } from "../components/ImageLightbox";

interface ReceiptReport {
  id: string;
  receipt_upload_id?: string | null;
  reason?: string | null;
  details?: string | null;
  status?: string | null;
  resolution_notes?: string | null;
  created_at?: string | null;
  business?: {
    id: string;
    name?: string | null;
  } | null;
  receipt?: {
    id?: string | null;
    review_status?: string | null;
    uploaded_at?: string | null;
    receipt_total_cents?: number | null;
  } | null;
}

interface ReceiptDetail {
  id: string;
  storage_path?: string | null;
  review_status?: string | null;
  receipt_total_cents?: number | null;
  uploaded_at?: string | null;
  user_id?: string | null;
  business?: { name?: string | null } | null;
}

const reasonToLabel = (reason?: string | null) =>
  String(reason || "report").replace(/_/g, " ");

export function FraudDisputes() {
  const [rows, setRows] = useState<ReceiptReport[]>([]);
  const [message, setMessage] = useState("");
  const [workingId, setWorkingId] = useState<string | null>(null);

  const [selectedReport, setSelectedReport] = useState<ReceiptReport | null>(null);
  const [receiptDetail, setReceiptDetail] = useState<ReceiptDetail | null>(null);
  const [receiptImage, setReceiptImage] = useState<SignedReceiptImage | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState("");

  const load = async () => {
    const res = await apiRequest<ReceiptReport[]>("/api/admin/receipt-reports?limit=120");
    if (res.error) {
      setRows([]);
      setMessage(summarizeError(res.error, "Unable to load fraud/dispute queue."));
    } else {
      setRows(Array.isArray(res.data) ? res.data : []);
      setMessage("");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const stats = useMemo(() => {
    const open = rows.filter((row) => String(row.status || "").toLowerCase() === "open").length;
    const highRisk = rows.filter((row) =>
      ["suspicious_activity", "duplicate_receipt"].includes(String(row.reason || "").toLowerCase()),
    ).length;
    const resolved = rows.filter((row) =>
      ["resolved", "dismissed"].includes(String(row.status || "").toLowerCase()),
    ).length;
    const fraudRate = rows.length ? ((highRisk / rows.length) * 100).toFixed(2) : "0.00";
    return { open, highRisk, resolved, fraudRate };
  }, [rows]);

  const updateStatus = async (
    row: ReceiptReport,
    nextStatus: "reviewing" | "resolved" | "dismissed",
  ) => {
    const confirmed = window.confirm(`Move report ${row.id.slice(0, 8)} to ${nextStatus}?`);
    if (!confirmed) return;
    setWorkingId(row.id);
    const note = window.prompt("Resolution notes (optional)", row.resolution_notes || "") || null;
    const res = await apiRequest(
      `/api/admin/receipt-reports/${encodeURIComponent(row.id)}/status`,
      {
        method: "POST",
        body: {
          status: nextStatus,
          resolutionNotes: note,
        },
      },
    );
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to update report status."));
    } else {
      setRows((prev) =>
        prev.map((item) =>
          item.id === row.id
            ? { ...item, status: nextStatus, resolution_notes: note || item.resolution_notes }
            : item,
        ),
      );
      setMessage(`Report moved to ${nextStatus}.`);
      if (selectedReport?.id === row.id) {
        setSelectedReport((prev) =>
          prev ? { ...prev, status: nextStatus, resolution_notes: note || prev.resolution_notes } : prev,
        );
      }
    }
    setWorkingId(null);
  };

  const openReportReceipt = async (row: ReceiptReport) => {
    setSelectedReport(row);
    setReceiptDetail(null);
    setReceiptImage(null);
    const receiptId = String(row.receipt_upload_id || row.receipt?.id || "").trim();
    if (!receiptId) return;

    const res = await apiRequest<ReceiptDetail>(
      `/api/admin/receipts/${encodeURIComponent(receiptId)}/detail`,
    );
    if (res.error || !res.data) {
      setMessage(summarizeError(res.error, "Unable to load reported receipt detail."));
      return;
    }

    setReceiptDetail(res.data);
    const signed = await resolveReceiptImage(String(res.data.storage_path || ""));
    setReceiptImage(signed);
  };

  const openFullSize = () => {
    if (!receiptImage?.signedUrl) {
      setMessage("Unable to open image: no signed receipt URL available.");
      return;
    }
    setViewerUrl(receiptImage.signedUrl);
    setViewerOpen(true);
  };

  return (
    <div className="space-y-6">
      {message ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">
          {message}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Active Cases</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.open}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">High Risk</p>
          <p className="text-2xl font-semibold text-red-600 mt-1">{stats.highRisk}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Resolved</p>
          <p className="text-2xl font-semibold text-green-600 mt-1">{stats.resolved}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Fraud Rate</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.fraudRate}%</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Flagged Cases</h3>
          <button
            onClick={() => void load()}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Refresh
          </button>
        </div>
        <div className="divide-y divide-gray-200">
          {rows.length ? (
            rows.slice(0, 80).map((case_) => {
              const highRisk =
                String(case_.reason || "").toLowerCase() === "suspicious_activity" ||
                String(case_.reason || "").toLowerCase() === "duplicate_receipt";
              const kind = case_.business?.name ? "Business" : "User";
              const name = case_.business?.name || "Receipt reporter";
              const reportedReceiptId = case_.receipt_upload_id || case_.receipt?.id || "--";
              return (
                <div key={case_.id} className="p-6 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div
                        className={`p-3 rounded-lg ${
                          kind === "User" ? "bg-blue-100" : "bg-purple-100"
                        }`}
                      >
                        {kind === "User" ? (
                          <User className="w-6 h-6 text-blue-600" />
                        ) : (
                          <Store className="w-6 h-6 text-purple-600" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h4 className="font-semibold text-gray-900">{name}</h4>
                          <StatusBadge status={kind} variant={kind === "User" ? "info" : "default"} />
                          <div
                            className={`flex items-center gap-1 px-2 py-1 rounded ${
                              highRisk ? "bg-red-100 text-red-800" : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            <Shield className="w-3 h-3" />
                            <span className="text-xs font-medium">
                              {highRisk ? "High" : "Medium"} risk
                            </span>
                          </div>
                        </div>
                        <p className="text-sm text-gray-600 mb-1">
                          Reason: <span className="font-medium">{reasonToLabel(case_.reason)}</span>
                        </p>
                        <p className="text-sm text-gray-600 mb-1">
                          Reported receipt: <span className="font-medium">{reportedReceiptId}</span>
                        </p>
                        <p className="text-sm text-gray-500 mb-2">
                          Business input: {case_.details || "No details submitted."}
                        </p>
                        <p className="text-xs text-gray-500">{formatRelativeTime(case_.created_at)}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => void openReportReceipt(case_)}
                        className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
                      >
                        View receipt
                      </button>
                      <button
                        disabled={workingId === case_.id}
                        onClick={() => void updateStatus(case_, "reviewing")}
                        className="px-4 py-2 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-60"
                      >
                        Investigate
                      </button>
                      <button
                        disabled={workingId === case_.id}
                        onClick={() => void updateStatus(case_, "dismissed")}
                        className="px-4 py-2 text-sm bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-60"
                      >
                        Dismiss
                      </button>
                      <button
                        disabled={workingId === case_.id}
                        onClick={() => void updateStatus(case_, "resolved")}
                        className="px-4 py-2 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-60"
                      >
                        Resolve
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-6 text-sm text-gray-500">No disputes in queue.</div>
          )}
        </div>
      </div>

      {selectedReport ? (
        <div className="fixed inset-0 z-40 bg-black/30 flex justify-end">
          <div className="w-full max-w-2xl h-full bg-white shadow-xl border-l border-gray-200 flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Reported Receipt Detail</h3>
              <button
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                onClick={() => setSelectedReport(null)}
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Report ID</p>
                  <p className="font-medium text-gray-900">{selectedReport.id}</p>
                </div>
                <div>
                  <p className="text-gray-500">Status</p>
                  <p className="font-medium text-gray-900">{selectedReport.status || "--"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Business</p>
                  <p className="font-medium text-gray-900">
                    {selectedReport.business?.name || "--"}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Reason</p>
                  <p className="font-medium text-gray-900">{reasonToLabel(selectedReport.reason)}</p>
                </div>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Business typed details (including Other)</p>
                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 text-sm text-gray-800 whitespace-pre-wrap">
                  {selectedReport.details || "No details provided."}
                </div>
              </div>

              {receiptDetail ? (
                <>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500">Receipt ID</p>
                      <p className="font-medium text-gray-900">{receiptDetail.id}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Receipt status</p>
                      <p className="font-medium text-gray-900">{receiptDetail.review_status || "--"}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Amount</p>
                      <p className="font-medium text-gray-900">
                        {formatCurrencyFromCents(Number(receiptDetail.receipt_total_cents || 0))}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Uploaded</p>
                      <p className="font-medium text-gray-900">{formatRelativeTime(receiptDetail.uploaded_at)}</p>
                    </div>
                  </div>
                  <div className="border border-gray-200 rounded-lg p-2 bg-gray-50">
                    {receiptImage?.signedUrl ? (
                      <div className="space-y-2">
                        <img
                          src={receiptImage.signedUrl}
                          alt="Reported receipt"
                          className="w-full max-h-[420px] object-contain rounded"
                        />
                        <button
                          type="button"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors text-sm inline-flex items-center justify-center gap-2"
                          onClick={openFullSize}
                        >
                          <ImageIcon className="w-4 h-4" />
                          Open image
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500">
                        Unable to load receipt image. {receiptImage?.errorReason || ""}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-500">
                  Receipt detail unavailable for this report.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
      <ImageLightbox
        open={viewerOpen}
        imageUrl={viewerUrl}
        title="Reported receipt"
        onClose={() => setViewerOpen(false)}
      />
    </div>
  );
}
