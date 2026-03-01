import { useState } from "react";
import { Search, Plus, Filter, Download, Calendar, Percent, Eye, Edit, Copy, Pause } from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";

const mockOffers = [
  {
    id: 1,
    business: "Joe's Coffee House",
    title: "20% Off Morning Coffee",
    description: "Get 20% cashback on all coffee orders before 11 AM",
    cashbackPercent: 20,
    status: "Active",
    startDate: "Jan 1, 2024",
    endDate: "Dec 31, 2024",
    redemptions: 3842,
    maxRedemptions: 10000,
  },
  {
    id: 2,
    business: "Bella's Pizza",
    title: "15% Off Family Meals",
    description: "Enjoy 15% cashback on family meal deals",
    cashbackPercent: 15,
    status: "Active",
    startDate: "Feb 15, 2024",
    endDate: "Aug 15, 2024",
    redemptions: 2124,
    maxRedemptions: 5000,
  },
  {
    id: 3,
    business: "FitZone Gym",
    title: "25% Off Annual Membership",
    description: "Get 25% cashback on annual gym memberships",
    cashbackPercent: 25,
    status: "Active",
    startDate: "Mar 1, 2024",
    endDate: "Mar 31, 2024",
    redemptions: 856,
    maxRedemptions: 1000,
  },
  {
    id: 4,
    business: "Green Grocers",
    title: "10% Off Fresh Produce",
    description: "10% cashback on all fresh fruits and vegetables",
    cashbackPercent: 10,
    status: "Active",
    startDate: "Apr 1, 2024",
    endDate: "Sep 30, 2024",
    redemptions: 4234,
    maxRedemptions: null,
  },
  {
    id: 5,
    business: "Joe's Coffee House",
    title: "Buy 2 Get 1 Free - Summer Special",
    description: "30% cashback on every third coffee purchase",
    cashbackPercent: 30,
    status: "Scheduled",
    startDate: "Jun 1, 2024",
    endDate: "Aug 31, 2024",
    redemptions: 0,
    maxRedemptions: 5000,
  },
  {
    id: 6,
    business: "Tech Repairs Pro",
    title: "Free Screen Protection",
    description: "Get 50% cashback on phone repairs",
    cashbackPercent: 50,
    status: "Expired",
    startDate: "Jan 1, 2024",
    endDate: "Feb 28, 2024",
    redemptions: 347,
    maxRedemptions: 500,
  },
];

export function Offers() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");

  const filteredOffers = mockOffers.filter((offer) => {
    const matchesSearch =
      offer.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      offer.business.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = selectedStatus === "all" || offer.status === selectedStatus;
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
              placeholder="Search offers..."
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
            <option value="Active">Active</option>
            <option value="Scheduled">Scheduled</option>
            <option value="Expired">Expired</option>
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
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Create Offer</span>
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Total Offers</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">3,892</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Active</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">2,847</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Expiring Soon</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">124</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Scheduled</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">87</p>
        </div>
      </div>

      {/* Offers Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Offer</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Business</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cashback</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Redemptions</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredOffers.map((offer) => (
                <tr key={offer.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-medium text-gray-900">{offer.title}</p>
                      <p className="text-sm text-gray-600 mt-1">{offer.description}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <p className="text-sm text-gray-900">{offer.business}</p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Percent className="w-4 h-4 text-amber-500" />
                      <span className="font-semibold text-amber-600">{offer.cashbackPercent}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <span>{offer.startDate}</span>
                      </div>
                      <div className="text-sm text-gray-500">to {offer.endDate}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <p className="font-medium text-gray-900">{offer.redemptions.toLocaleString()}</p>
                      {offer.maxRedemptions && (
                        <p className="text-sm text-gray-500">
                          of {offer.maxRedemptions.toLocaleString()} max
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {offer.status === "Active" && <StatusBadge status="Active" variant="success" />}
                    {offer.status === "Scheduled" && <StatusBadge status="Scheduled" variant="info" />}
                    {offer.status === "Expired" && <StatusBadge status="Expired" variant="default" />}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="View">
                        <Eye className="w-4 h-4 text-gray-600" />
                      </button>
                      <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Edit">
                        <Edit className="w-4 h-4 text-gray-600" />
                      </button>
                      <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Duplicate">
                        <Copy className="w-4 h-4 text-gray-600" />
                      </button>
                      <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Pause">
                        <Pause className="w-4 h-4 text-gray-600" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Showing <span className="font-medium">{filteredOffers.length}</span> of <span className="font-medium">{mockOffers.length}</span> offers
        </p>
        <div className="flex gap-2">
          <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            Previous
          </button>
          <button className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors">
            1
          </button>
          <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
