import { useState } from "react";
import { Search, Filter, CheckCircle, XCircle, AlertTriangle, Eye, Download } from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";

const mockReceipts = [
  {
    id: 12847,
    user: "Sarah Johnson",
    business: "Joe's Coffee House",
    amount: 15.50,
    expectedCashback: 3.10,
    submittedAt: "2 hours ago",
    status: "Pending",
    flags: ["Suspicious amount"],
    verificationMethod: "Receipt Upload",
  },
  {
    id: 12846,
    user: "Michael Chen",
    business: "Bella's Pizza",
    amount: 42.30,
    expectedCashback: 6.35,
    submittedAt: "3 hours ago",
    status: "Pending",
    flags: [],
    verificationMethod: "Receipt Upload",
  },
  {
    id: 12845,
    user: "Emma Davis",
    business: "Green Grocers",
    amount: 28.75,
    expectedCashback: 2.88,
    submittedAt: "5 hours ago",
    status: "Flagged",
    flags: ["Duplicate receipt", "Unusual pattern"],
    verificationMethod: "Receipt Upload",
  },
  {
    id: 12844,
    user: "James Wilson",
    business: "FitZone Gym",
    amount: 89.99,
    expectedCashback: 22.50,
    submittedAt: "6 hours ago",
    status: "Approved",
    flags: [],
    verificationMethod: "Bank Linked",
  },
  {
    id: 12843,
    user: "Olivia Martinez",
    business: "Tech Repairs Pro",
    amount: 150.00,
    expectedCashback: 75.00,
    submittedAt: "8 hours ago",
    status: "Rejected",
    flags: ["Invalid receipt"],
    verificationMethod: "Receipt Upload",
  },
];

export function ReceiptReviews() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");

  const filteredReceipts = mockReceipts.filter((receipt) => {
    const matchesSearch =
      receipt.user.toLowerCase().includes(searchQuery.toLowerCase()) ||
      receipt.business.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = selectedStatus === "all" || receipt.status === selectedStatus;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
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
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
          >
            <option value="all">All Status</option>
            <option value="Pending">Pending</option>
            <option value="Flagged">Flagged</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
          </select>

          <button className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Filters</span>
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Pending Review</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">287</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Flagged</p>
          <p className="text-2xl font-semibold text-red-600 mt-1">42</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Approved Today</p>
          <p className="text-2xl font-semibold text-green-600 mt-1">156</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Avg Review Time</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">4.2 min</p>
        </div>
      </div>

      {/* Receipt Queue */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Receipt ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Business</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cashback</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredReceipts.map((receipt) => (
                <tr key={receipt.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <p className="font-medium text-gray-900">#{receipt.id}</p>
                      <p className="text-xs text-gray-500">{receipt.submittedAt}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <p className="text-sm text-gray-900">{receipt.user}</p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <p className="text-sm text-gray-900">{receipt.business}</p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <p className="font-medium text-gray-900">${receipt.amount.toFixed(2)}</p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <p className="font-medium text-green-600">${receipt.expectedCashback.toFixed(2)}</p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <StatusBadge
                      status={receipt.verificationMethod}
                      variant={receipt.verificationMethod === "Bank Linked" ? "info" : "default"}
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="space-y-1">
                      {receipt.status === "Pending" && <StatusBadge status="Pending" variant="warning" />}
                      {receipt.status === "Flagged" && <StatusBadge status="Flagged" variant="danger" />}
                      {receipt.status === "Approved" && <StatusBadge status="Approved" variant="success" />}
                      {receipt.status === "Rejected" && <StatusBadge status="Rejected" variant="danger" />}
                      {receipt.flags.length > 0 && (
                        <div className="flex items-center gap-1 text-xs text-red-600 mt-1">
                          <AlertTriangle className="w-3 h-3" />
                          <span>{receipt.flags[0]}</span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <button className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition-colors">
                        <Eye className="w-4 h-4" />
                        Review
                      </button>
                      {receipt.status === "Pending" && (
                        <>
                          <button className="p-1.5 bg-green-50 text-green-700 rounded hover:bg-green-100 transition-colors" title="Approve">
                            <CheckCircle className="w-4 h-4" />
                          </button>
                          <button className="p-1.5 bg-red-50 text-red-700 rounded hover:bg-red-100 transition-colors" title="Reject">
                            <XCircle className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
