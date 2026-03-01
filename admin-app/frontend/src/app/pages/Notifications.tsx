import { useEffect, useMemo, useState } from "react";
import { Bell, Send, RefreshCw } from "lucide-react";
import { apiRequest, formatDateTime, summarizeError } from "../lib/adminApi";

interface PromoRow {
  id: string;
  code?: string | null;
  active?: boolean | null;
  cashback_rate_bps?: number | null;
  created_at?: string | null;
}

interface EventPayload {
  adminActions?: Array<{
    id: string;
    action?: string | null;
    entity?: string | null;
    created_at?: string | null;
  }>;
}

export function Notifications() {
  const [promotions, setPromotions] = useState<PromoRow[]>([]);
  const [events, setEvents] = useState<EventPayload>({});
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [selectedPromoId, setSelectedPromoId] = useState("");
  const [audience, setAudience] = useState("all");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    const [promoRes, eventRes] = await Promise.all([
      apiRequest<PromoRow[]>("/api/admin/promotions"),
      apiRequest<EventPayload>("/api/admin/events"),
    ]);
    if (promoRes.error) {
      setPromotions([]);
      setMessage(summarizeError(promoRes.error, "Unable to load promotions."));
    } else {
      setPromotions(Array.isArray(promoRes.data) ? promoRes.data : []);
      setMessage("");
    }
    if (!eventRes.error && eventRes.data) setEvents(eventRes.data);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const selectedPromo = useMemo(
    () => promotions.find((promo) => promo.id === selectedPromoId) || null,
    [promotions, selectedPromoId],
  );

  const sendPush = async () => {
    if (!title.trim() || !body.trim()) {
      setMessage("Enter notification title and message.");
      return;
    }
    if (!selectedPromoId) {
      setMessage("Select a promo code to send.");
      return;
    }

    setSending(true);
    const res = await apiRequest<{ sent?: number }>(`/api/admin/promotions/push`, {
      method: "POST",
      body: {
        promoCodeId: selectedPromoId,
        audience,
        title: title.trim(),
        body: body.trim(),
      },
    });
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to send push notification."));
    } else {
      const sent = Number(res.data?.sent || 0);
      setMessage(`Notification sent to ${sent} users.`);
      setTitle("");
      setBody("");
    }
    setSending(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Bell className="w-5 h-5 text-amber-500" />
          Notifications Center
        </h3>
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

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h4 className="font-semibold text-gray-900 mb-4">Send Promo Push</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Promo Code</label>
            <select
              value={selectedPromoId}
              onChange={(e) => setSelectedPromoId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
            >
              <option value="">Select promo</option>
              {promotions.map((promo) => (
                <option key={promo.id} value={promo.id}>
                  {promo.code || promo.id} {promo.active ? "(active)" : "(inactive)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Audience</label>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
            >
              <option value="all">All Customers</option>
              <option value="new_offer_opt_in">New-offers Opt-in</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Limited-time promo"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="Open Wello to redeem this offer."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        </div>
        <button
          disabled={sending}
          onClick={() => void sendPush()}
          className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-60"
        >
          <Send className="w-4 h-4" />
          {sending ? "Sending..." : "Send Notification"}
        </button>
        {selectedPromo ? (
          <p className="text-xs text-gray-500 mt-3">
            Selected promo: {selectedPromo.code || selectedPromo.id} · Rate{" "}
            {(Number(selectedPromo.cashback_rate_bps || 0) / 100).toFixed(2)}%
          </p>
        ) : null}
      </div>

      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h4 className="font-semibold text-gray-900">Recent Notification-Relevant Events</h4>
        </div>
        <div className="divide-y divide-gray-200">
          {loading ? (
            <div className="p-6 text-sm text-gray-500">Loading events...</div>
          ) : (events.adminActions || []).length ? (
            (events.adminActions || []).slice(0, 20).map((event) => (
              <div key={event.id} className="p-6 hover:bg-gray-50 transition-colors">
                <p className="text-sm font-medium text-gray-900">
                  {event.action || "action"} on {event.entity || "entity"}
                </p>
                <p className="text-xs text-gray-500 mt-1">{formatDateTime(event.created_at)}</p>
              </div>
            ))
          ) : (
            <div className="p-6 text-sm text-gray-500">No recent events.</div>
          )}
        </div>
      </div>
    </div>
  );
}
