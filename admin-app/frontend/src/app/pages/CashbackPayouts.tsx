import { useState } from "react";
import { Search, Filter, Download, DollarSign, CheckCircle, XCircle, Clock, AlertCircle } from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";

const mockPayouts = [
  {
    id: 10234,
    user: "Sarah Johnson",
    email: "sarah.johnson@email.com",
    amount: 287.50,
    method: "Bank Transfer",
    bankLast4: "4532",
    status: "Pending",
    requestedAt: "2 hours ago",
    processedAt: null,
  },
  {
    id: 10233,
    user: "Michael Chen",
    email: "michael.chen@email.com",
    amount: 534.25,
    method: "PayPal",
    bankLast4: null,
    status: "Processing",
    requestedAt: "5 hours ago",
    processedAt: "1 hour ago",
  },
  {
    id: 10232,
    user: "Emma Davis",
    email: "emma.davis@email.com",
    amount: 47.50,
    method: "Bank Transfer",
    bankLast4: "7829",
    status: "Failed",
    requestedAt: "1 day ago",
    processedAt: "8 hours ago",
  },
  {
    id: 10231,
    user: "James Wilson",
    email: "james.wilson@email.com",
    amount: 892.75,
    method: "Bank Transfer",
    bankLast4: "1234",
    status: "Completed",
    requestedAt: "2 days ago",
    processedAt: "1 day ago",
  },
  {
    id: 10230,
    user: "Olivia Martinez",
    email: "olivia.m@email.com",
    amount: 156.00,
    method: "Venmo",
    bankLast4: null,
    status: "Pending",
    requestedAt: "3 hours ago",
    processedAt: null,
  },
];

export function CashbackPayouts() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");

  const filteredPayouts = mockPayouts.filter((payout) => {
    const matchesSearch =
      payout.user.toLowerCase().includes(searchQuery.toLowerCase()) ||
      payout.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = selectedStatus === "all" || payout.status === selectedStatus;
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
              placeholder="Search payouts..."
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
            <option value="Processing">Processing</option>
            <option value="Completed">Completed</option>
            <option value="Failed">Failed</option>
          </select>

          <button className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Filters</span>
          </button>

          <button className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>

          <button className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors">
            <CheckCircle className="w-4 h-4" />
            <span className="hidden sm:inline">Process Batch</span>
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Pending Payouts</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">$43,287</p>
          <p className="text-xs text-gray-500 mt-1">156 requests</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Processing</p>
          <p className="text-2xl font-semibold text-blue-600 mt-1">$28,450</p>
          <p className="text-xs text-gray-500 mt-1">89 requests</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Completed Today</p>
          <p className="text-2xl font-semibold text-green-600 mt-1">$127,340</p>
          <p className="text-xs text-gray-500 mt-1">342 requests</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Failed</p>
          <p className="text-2xl font-semibold text-red-600 mt-1">$2,180</p>
          <p className="text-xs text-gray-500 mt-1">12 requests</p>
        </div>
      </div>

      {/* Payouts Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  <input type="checkbox" className="rounded" />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payout ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Requested</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredPayouts.map((payout) => (
                <tr key={payout.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <input type="checkbox" className="rounded" />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <p className="font-medium text-gray-900">#{payout.id}</p>
                  </td>
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-medium text-gray-900">{payout.user}</p>
                      <p className="text-sm text-gray-500">{payout.email}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-green-500" />
                      <span className="font-semibold text-gray-900">${payout.amount.toFixed(2)}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <p className="text-sm text-gray-900">{payout.method}</p>
                      {payout.bankLast4 && (
                        <p className="text-xs text-gray-500">••••{payout.bankLast4}</p>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <p className="text-sm text-gray-600">{payout.requestedAt}</p>
                      {payout.processedAt && (
                        <p className="text-xs text-gray-500">Processed {payout.processedAt}</p>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {payout.status === "Pending" && (
                      <StatusBadge status="Pending" variant="warning" />
                    )}
                    {payout.status === "Processing" && (
                      <StatusBadge status="Processing" variant="info" />
                    )}
                    {payout.status === "Completed" && (
                      <StatusBadge status="Completed" variant="success" />
                    )}
                    {payout.status === "Failed" && (
                      <StatusBadge status="Failed" variant="danger" />
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {payout.status === "Pending" && (
                        <>
                          <button className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-50 text-green-700 rounded hover:bg-green-100 transition-colors">
                            <CheckCircle className="w-4 h-4" />
                            Approve
                          </button>
                          <button className="flex items-center gap-1 px-3 py-1.5 text-sm bg-red-50 text-red-700 rounded hover:bg-red-100 transition-colors">
                            <XCircle className="w-4 h-4" />
                            Reject
                          </button>
                        </>
                      )}
                      {payout.status === "Failed" && (
                        <button className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition-colors">
                          <Clock className="w-4 h-4" />
                          Retry
                        </button>
                      )}
                      {payout.status === "Completed" && (
                        <button className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-50 text-gray-700 rounded hover:bg-gray-100 transition-colors">
                          View
                        </button>
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
