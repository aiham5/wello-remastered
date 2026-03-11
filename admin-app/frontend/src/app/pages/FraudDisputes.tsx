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
  metadata?: {
    custom_reason?: string | null;
    [key: string]: unknown;
  } | null;
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

interface DisputeEvidence {
  report?: {
    id?: string | null;
    created_at?: string | null;
    status?: string | null;
  } | null;
  receipt?: {
    id?: string | null;
    review_status?: string | null;
    uploaded_at?: string | null;
    receipt_total_cents?: number | null;
    image_hash?: string | null;
    redemption_id?: string | null;
    user_id?: string | null;
  } | null;
  verification?: {
    id?: string | null;
    status?: string | null;
    source?: string | null;
    reason_code?: string | null;
    reason_detail?: string | null;
    expected_amount_cents?: number | null;
    matched_plaid_transaction_id?: string | null;
    matched_plaid_item_id?: string | null;
    matched_amount_cents?: number | null;
    expected_merchant?: string | null;
    matched_posted_on?: string | null;
    expected_posted_on?: string | null;
    matched_merchant?: string | null;
    last_checked_at?: string | null;
    confirmed_at?: string | null;
    rejected_at?: string | null;
    chargeback_flagged?: boolean | null;
    chargeback_flagged_at?: string | null;
  } | null;
  plaidTransaction?: {
    transactionId?: string | null;
    plaidItemId?: string | null;
    requestId?: string | null;
    institutionName?: string | null;
    amount?: number | null;
    date?: string | null;
    authorizedDate?: string | null;
    pending?: boolean | null;
    merchantName?: string | null;
    name?: string | null;
    notFound?: boolean | null;
    account?: {
      name?: string | null;
      officialName?: string | null;
      mask?: string | null;
      subtype?: string | null;
      type?: string | null;
    } | null;
  } | null;
  redemption?: {
    id?: string | null;
    cashback_status?: string | null;
    created_at?: string | null;
    offer?: { title?: string | null } | null;
  } | null;
  cashbackEvent?: {
    id?: string | null;
    amount_cents?: number | null;
    status?: string | null;
    created_at?: string | null;
  } | null;
  userProfile?: {
    id?: string | null;
    full_name?: string | null;
    fraud_score?: number | null;
    fraud_flagged?: boolean | null;
    first_redemption_bonus_paid?: boolean | null;
  } | null;
}

function EvidenceRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-3 py-1.5 border-b border-gray-100 last:border-b-0 ${
        highlight ? "text-red-700" : "text-gray-800"
      }`}
    >
      <span className="text-xs uppercase tracking-wide text-gray-500">{label}</span>
      <span className="text-sm font-medium text-right break-all">{value}</span>
    </div>
  );
}

const reasonToLabel = (reason?: string | null) =>
  String(reason || "report").replace(/_/g, " ");

const getBusinessReasonDetail = (row: ReceiptReport) => {
  const custom = String(row.metadata?.custom_reason || "").trim();
  if (custom) return custom;
  const details = String(row.details || "").trim();
  if (!details) return "No details submitted.";
  const prefixed = details.replace(/^reported from owner receipts screen\s*\([^)]*\)\.\s*/i, "").trim();
  if (prefixed.toLowerCase().startsWith("reason:")) {
    const stripped = prefixed.replace(/^reason:\s*/i, "").trim();
    if (stripped) return stripped;
  }
  return details;
};

export function FraudDisputes() {
  const [rows, setRows] = useState<ReceiptReport[]>([]);
  const [message, setMessage] = useState("");
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [expandedEvidence, setExpandedEvidence] = useState<Record<string, boolean>>({});
  const [evidenceByReportId, setEvidenceByReportId] = useState<Record<string, DisputeEvidence>>({});
  const [loadingEvidenceId, setLoadingEvidenceId] = useState<string | null>(null);
  const [disputeActionId, setDisputeActionId] = useState<string | null>(null);

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
      ["resolved", "dismissed", "disputed"].includes(String(row.status || "").toLowerCase()),
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

  const toggleEvidence = async (row: ReceiptReport) => {
    const reportId = String(row?.id || "").trim();
    if (!reportId) return;
    const currentlyOpen = Boolean(expandedEvidence[reportId]);
    setExpandedEvidence((prev) => ({ ...prev, [reportId]: !currentlyOpen }));
    if (currentlyOpen || evidenceByReportId[reportId] || loadingEvidenceId === reportId) return;
    setLoadingEvidenceId(reportId);
    const res = await apiRequest<DisputeEvidence>(
      `/api/admin/receipt-reports/${encodeURIComponent(reportId)}/evidence`,
    );
    if (res.error || !res.data) {
      setMessage(summarizeError(res.error, "Unable to load dispute evidence."));
    } else {
      setEvidenceByReportId((prev) => ({ ...prev, [reportId]: res.data as DisputeEvidence }));
      setMessage("");
    }
    setLoadingEvidenceId(null);
  };

  const handleDisputeAction = async (
    row: ReceiptReport,
    action: "approve" | "reject",
  ) => {
    const reportId = String(row?.id || "").trim();
    if (!reportId) return;
    const confirmed = window.confirm(
      action === "approve"
        ? "Approve this dispute? This freezes cashback and increases fraud score."
        : "Reject this dispute?",
    );
    if (!confirmed) return;

    setDisputeActionId(`${reportId}:${action}`);
    const res = await apiRequest(
      `/api/admin/receipt-reports/${encodeURIComponent(reportId)}/dispute`,
      { method: "POST", body: { action } },
    );
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to update dispute."));
      setDisputeActionId(null);
      return;
    }

    const nextStatus = String(res.data?.status || "resolved");
    const nextNotes = String(res.data?.resolution_notes || "").trim() || null;
    setRows((prev) =>
      prev.map((item) =>
        item.id === reportId
          ? { ...item, status: nextStatus, resolution_notes: nextNotes }
          : item,
      ),
    );
    if (selectedReport?.id === reportId) {
      setSelectedReport((prev) =>
        prev
          ? { ...prev, status: nextStatus, resolution_notes: nextNotes }
          : prev,
      );
    }
    setMessage(action === "approve" ? "Dispute approved." : "Dispute rejected.");
    setDisputeActionId(null);
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
              const evidenceOpen = Boolean(expandedEvidence[case_.id]);
              const evidenceLoading = loadingEvidenceId === case_.id;
              const evidence = evidenceByReportId[case_.id];
              const fraudScore = Number(evidence?.userProfile?.fraud_score || 0);
              const receiptHash = String(evidence?.receipt?.image_hash || "").trim();
              const receiptHashShort = receiptHash
                ? `...${receiptHash.slice(-8)}`
                : "N/A";
              const verificationReason = String(
                evidence?.verification?.reason_detail ||
                  evidence?.verification?.reason_code ||
                  "N/A",
              );
              const plaidAccountLabel = [
                String(evidence?.plaidTransaction?.account?.officialName || "").trim(),
                String(evidence?.plaidTransaction?.account?.name || "").trim(),
              ].filter(Boolean)[0] || "N/A";
              const plaidAccountMeta = [
                String(evidence?.plaidTransaction?.account?.subtype || "").trim(),
                String(evidence?.plaidTransaction?.account?.mask || "").trim()
                  ? `••••${String(evidence?.plaidTransaction?.account?.mask || "").trim()}`
                  : "",
              ].filter(Boolean).join(" • ") || "N/A";
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
                          Business input: {getBusinessReasonDetail(case_)}
                        </p>
                        <p className="text-xs text-gray-500">{formatRelativeTime(case_.created_at)}</p>
                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={() => void toggleEvidence(case_)}
                            className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-100 transition-colors"
                          >
                            {evidenceOpen ? "Hide evidence" : "View evidence"}
                          </button>
                        </div>
                        {evidenceOpen ? (
                          <div className="mt-3 border border-gray-200 rounded-lg bg-white p-3 space-y-2">
                            {evidenceLoading ? (
                              <p className="text-xs text-gray-500">Loading evidence...</p>
                            ) : (
                              <>
                                <EvidenceRow
                                  label="Verification"
                                  value={String(
                                    evidence?.verification?.source ||
                                      evidence?.verification?.status ||
                                      "Unknown",
                                  )}
                                />
                                <EvidenceRow
                                  label="Verification Reason"
                                  value={verificationReason}
                                />
                                <EvidenceRow
                                  label="Plaid Item"
                                  value={String(
                                    evidence?.verification?.matched_plaid_item_id ||
                                      "N/A",
                                  )}
                                />
                                <EvidenceRow
                                  label="Plaid Txn ID"
                                  value={String(
                                    evidence?.verification?.matched_plaid_transaction_id ||
                                      "N/A",
                                  )}
                                />
                                <EvidenceRow
                                  label="Plaid Txn Name"
                                  value={String(evidence?.plaidTransaction?.name || "N/A")}
                                />
                                <EvidenceRow
                                  label="Plaid Institution"
                                  value={String(evidence?.plaidTransaction?.institutionName || "N/A")}
                                />
                                <EvidenceRow
                                  label="Plaid Account"
                                  value={plaidAccountLabel}
                                />
                                <EvidenceRow
                                  label="Plaid Account Meta"
                                  value={plaidAccountMeta}
                                />
                                <EvidenceRow
                                  label="Plaid Amount"
                                  value={evidence?.plaidTransaction?.amount != null
                                    ? `$${Number(evidence.plaidTransaction.amount || 0).toFixed(2)}`
                                    : evidence?.verification?.matched_amount_cents != null
                                    ? formatCurrencyFromCents(
                                      Number(evidence.verification.matched_amount_cents || 0),
                                    )
                                    : "N/A"}
                                />
                                <EvidenceRow
                                  label="Expected Amount"
                                  value={
                                    evidence?.verification?.expected_amount_cents != null
                                      ? formatCurrencyFromCents(
                                        Number(evidence.verification.expected_amount_cents || 0),
                                      )
                                      : "N/A"
                                  }
                                />
                                <EvidenceRow
                                  label="Plaid Date"
                                  value={String(
                                    evidence?.plaidTransaction?.date ||
                                      evidence?.verification?.matched_posted_on ||
                                      "N/A",
                                  )}
                                />
                                <EvidenceRow
                                  label="Plaid Authorized Date"
                                  value={String(evidence?.plaidTransaction?.authorizedDate || "N/A")}
                                />
                                <EvidenceRow
                                  label="Expected Date"
                                  value={String(evidence?.verification?.expected_posted_on || "N/A")}
                                />
                                <EvidenceRow
                                  label="Plaid Merchant"
                                  value={String(
                                    evidence?.plaidTransaction?.merchantName ||
                                      evidence?.verification?.matched_merchant ||
                                      "N/A",
                                  )}
                                />
                                <EvidenceRow
                                  label="Plaid Pending"
                                  value={evidence?.plaidTransaction?.pending ? "YES" : "No"}
                                />
                                <EvidenceRow
                                  label="Expected Merchant"
                                  value={String(evidence?.verification?.expected_merchant || "N/A")}
                                />
                                <EvidenceRow
                                  label="Plaid Pull Status"
                                  value={evidence?.plaidTransaction?.notFound ? "Not found in Plaid" : "Loaded"}
                                  highlight={Boolean(evidence?.plaidTransaction?.notFound)}
                                />
                                <EvidenceRow
                                  label="Cashback Amount"
                                  value={
                                    evidence?.cashbackEvent?.amount_cents != null
                                      ? formatCurrencyFromCents(
                                        Number(evidence.cashbackEvent.amount_cents || 0),
                                      )
                                      : "N/A"
                                  }
                                />
                                <EvidenceRow
                                  label="Cashback Status"
                                  value={String(evidence?.redemption?.cashback_status || "N/A")}
                                />
                                <EvidenceRow
                                  label="Fraud Score"
                                  value={String(fraudScore)}
                                  highlight={fraudScore >= 30}
                                />
                                <EvidenceRow
                                  label="Account Flagged"
                                  value={evidence?.userProfile?.fraud_flagged ? "YES" : "No"}
                                  highlight={Boolean(evidence?.userProfile?.fraud_flagged)}
                                />
                                <EvidenceRow
                                  label="Chargeback Flagged"
                                  value={evidence?.verification?.chargeback_flagged ? "YES" : "No"}
                                  highlight={Boolean(evidence?.verification?.chargeback_flagged)}
                                />
                                <EvidenceRow
                                  label="Chargeback Flagged At"
                                  value={String(evidence?.verification?.chargeback_flagged_at || "N/A")}
                                />
                                <EvidenceRow
                                  label="First Redemption Bonus"
                                  value={evidence?.userProfile?.first_redemption_bonus_paid ? "YES" : "No"}
                                />
                                <EvidenceRow
                                  label="Receipt Hash"
                                  value={receiptHashShort}
                                />
                                <div className="flex items-center gap-2 pt-2">
                                  <button
                                    type="button"
                                    disabled={disputeActionId === `${case_.id}:approve`}
                                    onClick={() => void handleDisputeAction(case_, "approve")}
                                    className="px-3 py-1.5 text-xs bg-red-50 text-red-700 rounded-md border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-60"
                                  >
                                    Approve Dispute
                                  </button>
                                  <button
                                    type="button"
                                    disabled={disputeActionId === `${case_.id}:reject`}
                                    onClick={() => void handleDisputeAction(case_, "reject")}
                                    className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded-md border border-gray-300 hover:bg-gray-200 transition-colors disabled:opacity-60"
                                  >
                                    Reject Dispute
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        ) : null}
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
                    {getBusinessReasonDetail(selectedReport)}
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
