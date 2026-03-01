import { Shield, AlertTriangle, User, Store } from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";

const flaggedCases = [
  {
    id: 1,
    type: "User",
    name: "John Suspicious",
    issue: "5 duplicate receipts submitted",
    riskScore: 85,
    status: "Under Review",
    flaggedAt: "2 hours ago",
  },
  {
    id: 2,
    type: "User",
    name: "Jane Pattern",
    issue: "Unusual redemption pattern detected",
    riskScore: 72,
    status: "Under Review",
    flaggedAt: "5 hours ago",
  },
  {
    id: 3,
    type: "Business",
    name: "Fake Store Inc",
    issue: "Suspicious business verification",
    riskScore: 92,
    status: "Escalated",
    flaggedAt: "1 day ago",
  },
];

export function FraudDisputes() {
  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Active Cases</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">47</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">High Risk</p>
          <p className="text-2xl font-semibold text-red-600 mt-1">12</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Resolved Today</p>
          <p className="text-2xl font-semibold text-green-600 mt-1">28</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Fraud Rate</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">0.34%</p>
        </div>
      </div>

      {/* Flagged Cases */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Flagged Cases</h3>
        </div>
        <div className="divide-y divide-gray-200">
          {flaggedCases.map((case_) => (
            <div key={case_.id} className="p-6 hover:bg-gray-50 transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className={`p-3 rounded-lg ${case_.type === 'User' ? 'bg-blue-100' : 'bg-purple-100'}`}>
                    {case_.type === 'User' ? (
                      <User className="w-6 h-6 text-blue-600" />
                    ) : (
                      <Store className="w-6 h-6 text-purple-600" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h4 className="font-semibold text-gray-900">{case_.name}</h4>
                      <StatusBadge status={case_.type} variant={case_.type === 'User' ? 'info' : 'default'} />
                      <div className={`flex items-center gap-1 px-2 py-1 rounded ${
                        case_.riskScore >= 80 ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        <Shield className="w-3 h-3" />
                        <span className="text-xs font-medium">Risk: {case_.riskScore}</span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mb-2">{case_.issue}</p>
                    <p className="text-xs text-gray-500">{case_.flaggedAt}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="px-4 py-2 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors">
                    Investigate
                  </button>
                  <button className="px-4 py-2 text-sm bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors">
                    Freeze
                  </button>
                  <button className="px-4 py-2 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors">
                    Clear
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
