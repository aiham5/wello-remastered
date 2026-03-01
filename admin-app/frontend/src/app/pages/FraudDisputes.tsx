import { useEffect, useMemo, useState } from "react";
import { Shield, User, Store } from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import { apiRequest, formatRelativeTime, summarizeError } from "../lib/adminApi";

interface ReceiptReport {
  id: string;
  reason?: string | null;
  details?: string | null;
  status?: string | null;
  created_at?: string | null;
  business?: {
    id: string;
    name?: string | null;
  } | null;
}

const reasonToLabel = (reason?: string | null) =>
  String(reason || "report").replace(/_/g, " ");

export function FraudDisputes() {
  const [rows, setRows] = useState<ReceiptReport[]>([]);
  const [message, setMessage] = useState("");
  const [workingId, setWorkingId] = useState<string | null>(null);

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

  const updateStatus = async (row: ReceiptReport, nextStatus: "reviewing" | "resolved" | "dismissed") => {
    const confirmed = window.confirm(`Move report ${row.id.slice(0, 8)} to ${nextStatus}?`);
    if (!confirmed) return;
    setWorkingId(row.id);
    const note = window.prompt("Resolution notes (optional)", "") || null;
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
        prev.map((item) => (item.id === row.id ? { ...item, status: nextStatus } : item)),
      );
      setMessage(`Report moved to ${nextStatus}.`);
    }
    setWorkingId(null);
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
                          <StatusBadge
                            status={kind}
                            variant={kind === "User" ? "info" : "default"}
                          />
                          <div
                            className={`flex items-center gap-1 px-2 py-1 rounded ${
                              highRisk
                                ? "bg-red-100 text-red-800"
                                : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            <Shield className="w-3 h-3" />
                            <span className="text-xs font-medium">
                              {highRisk ? "High" : "Medium"} risk
                            </span>
                          </div>
                        </div>
                        <p className="text-sm text-gray-600 mb-2">
                          {reasonToLabel(case_.reason)}
                        </p>
                        <p className="text-sm text-gray-500 mb-2">
                          {case_.details || "No details submitted."}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatRelativeTime(case_.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
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
    </div>
  );
}
