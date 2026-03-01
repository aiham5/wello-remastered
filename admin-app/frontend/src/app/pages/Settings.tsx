import { useState } from "react";
import { Save, DollarSign, Shield, Bell, Sliders } from "lucide-react";
import { apiRequest, summarizeError } from "../lib/adminApi";

export function Settings() {
  const [activeTab, setActiveTab] = useState("platform");
  const [message, setMessage] = useState("");
  const [savingTab, setSavingTab] = useState<string | null>(null);

  const tabs = [
    { id: "platform", label: "Platform Settings", icon: Sliders },
    { id: "cashback", label: "Cashback Rules", icon: DollarSign },
    { id: "fraud", label: "Fraud Detection", icon: Shield },
    { id: "notifications", label: "Notifications", icon: Bell },
  ];

  const saveTab = async (tabId: string, payload: Record<string, unknown>) => {
    setSavingTab(tabId);
    const res = await apiRequest<{ logged?: boolean }>("/api/admin/log-action", {
      method: "POST",
      body: {
        action: `settings_saved_${tabId}`,
        entity: "settings",
        status: "success",
        meta: payload,
      },
    });
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to save settings."));
    } else {
      setMessage("Settings saved and audit logged.");
    }
    setSavingTab(null);
  };

  return (
    <div className="space-y-6">
      {message ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">
          {message}
        </div>
      ) : null}

      <div className="bg-white rounded-lg border border-gray-200">
        <div className="border-b border-gray-200 px-6">
          <div className="flex gap-6 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 py-4 border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? "border-amber-500 text-amber-600"
                    : "border-transparent text-gray-600 hover:text-gray-900"
                }`}
              >
                <tab.icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="p-6">
          {activeTab === "platform" && (
            <PlatformSettings
              saving={savingTab === "platform"}
              onSave={(payload) => void saveTab("platform", payload)}
            />
          )}
          {activeTab === "cashback" && (
            <CashbackSettings
              saving={savingTab === "cashback"}
              onSave={(payload) => void saveTab("cashback", payload)}
            />
          )}
          {activeTab === "fraud" && (
            <FraudSettings
              saving={savingTab === "fraud"}
              onSave={(payload) => void saveTab("fraud", payload)}
            />
          )}
          {activeTab === "notifications" && (
            <NotificationSettings
              saving={savingTab === "notifications"}
              onSave={(payload) => void saveTab("notifications", payload)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function PlatformSettings({
  onSave,
  saving,
}: {
  onSave: (payload: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [commissionRate, setCommissionRate] = useState("15");
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Commission Settings</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Default Commission Rate (%)
            </label>
            <input
              type="number"
              value={commissionRate}
              onChange={(e) => setCommissionRate(e.target.value)}
              className="w-full max-w-xs px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <p className="text-sm text-gray-500 mt-1">Commission charged on business revenue</p>
          </div>
        </div>
      </div>
      <div className="pt-6 border-t border-gray-200">
        <button
          onClick={() => onSave({ defaultCommissionRate: Number(commissionRate || 0) })}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-60"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

function CashbackSettings({
  onSave,
  saving,
}: {
  onSave: (payload: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [minPayout, setMinPayout] = useState("25");
  const [maxCashback, setMaxCashback] = useState("50");
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Payout Thresholds</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Minimum Payout Amount ($)
            </label>
            <input
              type="number"
              value={minPayout}
              onChange={(e) => setMinPayout(e.target.value)}
              className="w-full max-w-xs px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Maximum Cashback per Transaction (%)
            </label>
            <input
              type="number"
              value={maxCashback}
              onChange={(e) => setMaxCashback(e.target.value)}
              className="w-full max-w-xs px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        </div>
      </div>
      <div className="pt-6 border-t border-gray-200">
        <button
          onClick={() =>
            onSave({
              minPayout: Number(minPayout || 0),
              maxCashbackPct: Number(maxCashback || 0),
            })
          }
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-60"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

function FraudSettings({
  onSave,
  saving,
}: {
  onSave: (payload: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [duplicateDetection, setDuplicateDetection] = useState(true);
  const [patternDetection, setPatternDetection] = useState(true);
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Detection Rules</h3>
        <div className="space-y-4">
          <ToggleCard
            title="Duplicate Receipt Detection"
            description="Flag receipts submitted multiple times"
            checked={duplicateDetection}
            onChange={setDuplicateDetection}
          />
          <ToggleCard
            title="Unusual Pattern Detection"
            description="Monitor for suspicious redemption patterns"
            checked={patternDetection}
            onChange={setPatternDetection}
          />
        </div>
      </div>
      <div className="pt-6 border-t border-gray-200">
        <button
          onClick={() =>
            onSave({
              duplicateDetection,
              patternDetection,
            })
          }
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-60"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

function NotificationSettings({
  onSave,
  saving,
}: {
  onSave: (payload: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [newBusiness, setNewBusiness] = useState(true);
  const [fraudAlerts, setFraudAlerts] = useState(true);
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Admin Notifications</h3>
        <div className="space-y-4">
          <ToggleCard
            title="New Business Applications"
            description="Get notified of new business sign-ups"
            checked={newBusiness}
            onChange={setNewBusiness}
          />
          <ToggleCard
            title="Fraud Alerts"
            description="Immediate alerts for suspicious activity"
            checked={fraudAlerts}
            onChange={setFraudAlerts}
          />
        </div>
      </div>
      <div className="pt-6 border-t border-gray-200">
        <button
          onClick={() => onSave({ newBusiness, fraudAlerts })}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-60"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

function ToggleCard({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
      <div>
        <p className="font-medium text-gray-900">{title}</p>
        <p className="text-sm text-gray-600">{description}</p>
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
      </label>
    </div>
  );
}
