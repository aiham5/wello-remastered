import { useEffect, useMemo, useState } from "react";
import { Bell, Send, RefreshCw, PlusCircle, Copy, Power } from "lucide-react";
import { apiRequest, formatDateTime, summarizeError } from "../lib/adminApi";

interface PromoRow {
  id: string;
  code?: string | null;
  active?: boolean | null;
  cashback_rate_bps?: number | null;
  created_at?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  max_uses_per_user?: number | null;
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
  const [creating, setCreating] = useState(false);
  const [updatingPromoId, setUpdatingPromoId] = useState("");
  const [message, setMessage] = useState("");
  const [promoCodeDraft, setPromoCodeDraft] = useState("");
  const [promoRateDraft, setPromoRateDraft] = useState("");
  const [promoMaxUsesDraft, setPromoMaxUsesDraft] = useState("");
  const [promoActiveDraft, setPromoActiveDraft] = useState("true");
  const [promoStartDraft, setPromoStartDraft] = useState("");
  const [promoEndDraft, setPromoEndDraft] = useState("");

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

  const formatPromoWindow = (promo: PromoRow) => {
    const start = promo?.starts_at ? new Date(promo.starts_at).toLocaleDateString() : "--";
    const end = promo?.ends_at ? new Date(promo.ends_at).toLocaleDateString() : "--";
    if (start === "--" && end === "--") return "Any time";
    return `${start} -> ${end}`;
  };

  const createPromo = async () => {
    const code = promoCodeDraft.trim().toUpperCase();
    const ratePct = Number(String(promoRateDraft || "").trim());
    const maxUsesRaw = String(promoMaxUsesDraft || "").trim();
    const maxUses = maxUsesRaw ? Number(maxUsesRaw) : null;

    if (!code) {
      setMessage("Enter a promo code.");
      return;
    }
    if (!Number.isFinite(ratePct) || ratePct <= 0) {
      setMessage("Enter a valid promo rate.");
      return;
    }
    if (maxUsesRaw && (!Number.isFinite(maxUses) || maxUses < 1)) {
      setMessage("Max uses per user must be at least 1.");
      return;
    }

    setCreating(true);
    const cashbackRateBps = Math.round(ratePct * 100);
    const startsAt = promoStartDraft ? `${promoStartDraft}T00:00:00.000Z` : null;
    const endsAt = promoEndDraft ? `${promoEndDraft}T23:59:59.999Z` : null;

    const res = await apiRequest<PromoRow>("/api/admin/promotions", {
      method: "POST",
      body: {
        code,
        cashback_rate_bps: cashbackRateBps,
        max_uses_per_user: maxUses,
        active: promoActiveDraft === "true",
        starts_at: startsAt,
        ends_at: endsAt,
      },
    });

    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to create promo code."));
    } else {
      setMessage("Promo code created.");
      setPromoCodeDraft("");
      setPromoRateDraft("");
      setPromoMaxUsesDraft("");
      setPromoActiveDraft("true");
      setPromoStartDraft("");
      setPromoEndDraft("");
      await load();
    }
    setCreating(false);
  };

  const togglePromoStatus = async (promo: PromoRow, nextActive: boolean) => {
    const promoId = String(promo.id || "").trim();
    if (!promoId) return;
    setUpdatingPromoId(promoId);
    const res = await apiRequest<PromoRow>(`/api/admin/promotions/${encodeURIComponent(promoId)}/status`, {
      method: "POST",
      body: { active: nextActive },
    });
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to update promo code."));
    } else {
      setMessage(`Promo ${nextActive ? "activated" : "deactivated"}.`);
      await load();
    }
    setUpdatingPromoId("");
  };

  const copyPromoCode = async (promo: PromoRow) => {
    try {
      await navigator.clipboard.writeText(String(promo.code || "").trim());
      setMessage("Promo code copied.");
    } catch {
      setMessage("Unable to copy promo code.");
    }
  };

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
        <h4 className="font-semibold text-gray-900 mb-4">Create Promo Code</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Code</label>
            <input
              value={promoCodeDraft}
              onChange={(e) => setPromoCodeDraft(e.target.value)}
              placeholder="WELCOME10"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Promo Rate (%)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={promoRateDraft}
              onChange={(e) => setPromoRateDraft(e.target.value)}
              placeholder="10"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Max Uses Per User</label>
            <input
              type="number"
              min="1"
              step="1"
              value={promoMaxUsesDraft}
              onChange={(e) => setPromoMaxUsesDraft(e.target.value)}
              placeholder="Optional"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
            <select
              value={promoActiveDraft}
              onChange={(e) => setPromoActiveDraft(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Starts</label>
            <input
              type="date"
              value={promoStartDraft}
              onChange={(e) => setPromoStartDraft(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Ends</label>
            <input
              type="date"
              value={promoEndDraft}
              onChange={(e) => setPromoEndDraft(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        </div>
        <button
          disabled={creating}
          onClick={() => void createPromo()}
          className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-60"
        >
          <PlusCircle className="w-4 h-4" />
          {creating ? "Creating..." : "Create Promo Code"}
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h4 className="font-semibold text-gray-900 mb-4">Promo Codes</h4>
        <div className="space-y-3">
          {promotions.length ? (
            promotions.map((promo) => {
              const promoId = String(promo.id || "");
              const ratePct = (Number(promo.cashback_rate_bps || 0) / 100).toFixed(2);
              const busy = updatingPromoId === promoId;
              return (
                <div
                  key={promoId}
                  className="border border-gray-200 rounded-lg px-4 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="font-semibold text-gray-900">{promo.code || promoId}</p>
                    <p className="text-sm text-gray-500">
                      {ratePct}% · {promo.active ? "Active" : "Inactive"} · {formatPromoWindow(promo)}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      Max uses per user: {promo.max_uses_per_user || "Unlimited"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void copyPromoCode(promo)}
                      className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <Copy className="w-4 h-4" />
                      Copy
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void togglePromoStatus(promo, !promo.active)}
                      className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60"
                    >
                      <Power className="w-4 h-4" />
                      {busy ? "Saving..." : promo.active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-sm text-gray-500">No promo codes yet.</div>
          )}
        </div>
      </div>

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
