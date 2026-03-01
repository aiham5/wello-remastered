import { useState } from "react";
import { Save, DollarSign, Shield, Bell, Sliders } from "lucide-react";

export function Settings() {
  const [activeTab, setActiveTab] = useState("platform");

  const tabs = [
    { id: "platform", label: "Platform Settings", icon: Sliders },
    { id: "cashback", label: "Cashback Rules", icon: DollarSign },
    { id: "fraud", label: "Fraud Detection", icon: Shield },
    { id: "notifications", label: "Notifications", icon: Bell },
  ];

  return (
    <div className="space-y-6">
      {/* Tabs */}
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
          {activeTab === "platform" && <PlatformSettings />}
          {activeTab === "cashback" && <CashbackSettings />}
          {activeTab === "fraud" && <FraudSettings />}
          {activeTab === "notifications" && <NotificationSettings />}
        </div>
      </div>
    </div>
  );
}

function PlatformSettings() {
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
              defaultValue="15"
              className="w-full max-w-xs px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <p className="text-sm text-gray-500 mt-1">Commission charged on business revenue</p>
          </div>
        </div>
      </div>

      <div className="pt-6 border-t border-gray-200">
        <button className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors">
          <Save className="w-4 h-4" />
          Save Changes
        </button>
      </div>
    </div>
  );
}

function CashbackSettings() {
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
              defaultValue="25"
              className="w-full max-w-xs px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Maximum Cashback per Transaction (%)
            </label>
            <input
              type="number"
              defaultValue="50"
              className="w-full max-w-xs px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        </div>
      </div>

      <div className="pt-6 border-t border-gray-200">
        <button className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors">
          <Save className="w-4 h-4" />
          Save Changes
        </button>
      </div>
    </div>
  );
}

function FraudSettings() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Detection Rules</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium text-gray-900">Duplicate Receipt Detection</p>
              <p className="text-sm text-gray-600">Flag receipts submitted multiple times</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" defaultChecked />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium text-gray-900">Unusual Pattern Detection</p>
              <p className="text-sm text-gray-600">Monitor for suspicious redemption patterns</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" defaultChecked />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>
        </div>
      </div>

      <div className="pt-6 border-t border-gray-200">
        <button className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors">
          <Save className="w-4 h-4" />
          Save Changes
        </button>
      </div>
    </div>
  );
}

function NotificationSettings() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Admin Notifications</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium text-gray-900">New Business Applications</p>
              <p className="text-sm text-gray-600">Get notified of new business sign-ups</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" defaultChecked />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium text-gray-900">Fraud Alerts</p>
              <p className="text-sm text-gray-600">Immediate alerts for suspicious activity</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" defaultChecked />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>
        </div>
      </div>

      <div className="pt-6 border-t border-gray-200">
        <button className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors">
          <Save className="w-4 h-4" />
          Save Changes
        </button>
      </div>
    </div>
  );
}
