import { useEffect, useMemo, useState } from "react";
import { RefreshCw, AlertCircle } from "lucide-react";
import { apiRequest, formatDateTime, summarizeError } from "../lib/adminApi";

interface EventPayload {
  adminAuthEvents?: Array<{
    id: string;
    event_name?: string | null;
    actor_email?: string | null;
    actor_role?: string | null;
    outcome?: string | null;
    reason?: string | null;
    endpoint?: string | null;
    status_code?: number | null;
    created_at?: string | null;
  }>;
}

export function SupportTickets() {
  const [events, setEvents] = useState<EventPayload>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    const res = await apiRequest<EventPayload>("/api/admin/events");
    if (res.error) {
      setEvents({});
      setMessage(summarizeError(res.error, "Unable to load support data."));
    } else {
      setEvents(res.data || {});
      setMessage("");
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const ticketLikeRows = useMemo(
    () =>
      (events.adminAuthEvents || []).filter((row) => String(row.outcome || "") !== "success"),
    [events.adminAuthEvents],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Support Tickets</h3>
        <button
          onClick={() => void load()}
          className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {message ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">
          {message}
        </div>
      ) : null}

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h4 className="font-semibold text-gray-900">Operational Support Queue</h4>
          <p className="text-sm text-gray-600 mt-1">
            Derived from recent admin auth/access failures until a dedicated support table is added.
          </p>
        </div>
        <div className="divide-y divide-gray-200">
          {loading ? (
            <div className="p-6 text-sm text-gray-500">Loading support queue...</div>
          ) : ticketLikeRows.length ? (
            ticketLikeRows.slice(0, 40).map((row) => (
              <div key={row.id} className="p-6 hover:bg-gray-50 transition-colors">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      {row.event_name || "auth_event"} · {row.status_code || "--"}
                    </p>
                    <p className="text-sm text-gray-600 mt-1">
                      {row.actor_email || "unknown user"} ({row.actor_role || "unknown role"}) ·{" "}
                      {row.endpoint || "/api/admin"}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {row.reason || "No reason provided"} · {formatDateTime(row.created_at)}
                    </p>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="p-6 text-sm text-gray-500">No support issues detected.</div>
          )}
        </div>
      </div>
    </div>
  );
}
