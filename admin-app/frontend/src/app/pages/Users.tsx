import { useState } from "react";
import { 
  Search, 
  UserPlus, 
  Filter,
  Download,
  Mail,
  Phone,
  Calendar,
  DollarSign,
  ShoppingCart,
  Ban,
  CheckCircle,
  Eye,
  MoreVertical
} from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";

const mockUsers = [
  {
    id: 1,
    name: "Sarah Johnson",
    email: "sarah.johnson@email.com",
    phone: "+1 (555) 123-4567",
    signupDate: "Jan 15, 2024",
    redemptions: 47,
    cashbackEarned: 287.50,
    payoutStatus: "Active",
    accountStatus: "Active",
    bankLinked: true,
    referrals: 3,
  },
  {
    id: 2,
    name: "Michael Chen",
    email: "michael.chen@email.com",
    phone: "+1 (555) 234-5678",
    signupDate: "Feb 3, 2024",
    redemptions: 82,
    cashbackEarned: 534.25,
    payoutStatus: "Active",
    accountStatus: "Active",
    bankLinked: true,
    referrals: 7,
  },
  {
    id: 3,
    name: "Emma Davis",
    email: "emma.davis@email.com",
    phone: "+1 (555) 345-6789",
    signupDate: "Feb 18, 2024",
    redemptions: 23,
    cashbackEarned: 142.00,
    payoutStatus: "Pending",
    accountStatus: "Active",
    bankLinked: false,
    referrals: 1,
  },
  {
    id: 4,
    name: "James Wilson",
    email: "james.wilson@email.com",
    phone: "+1 (555) 456-7890",
    signupDate: "Mar 5, 2024",
    redemptions: 156,
    cashbackEarned: 892.75,
    payoutStatus: "Active",
    accountStatus: "Active",
    bankLinked: true,
    referrals: 12,
  },
  {
    id: 5,
    name: "Olivia Martinez",
    email: "olivia.m@email.com",
    phone: "+1 (555) 567-8901",
    signupDate: "Apr 12, 2024",
    redemptions: 12,
    cashbackEarned: 67.50,
    payoutStatus: "Active",
    accountStatus: "Suspended",
    bankLinked: true,
    referrals: 0,
  },
  {
    id: 6,
    name: "David Lee",
    email: "david.lee@email.com",
    phone: "+1 (555) 678-9012",
    signupDate: "May 8, 2024",
    redemptions: 64,
    cashbackEarned: 378.25,
    payoutStatus: "Active",
    accountStatus: "Active",
    bankLinked: true,
    referrals: 5,
  },
];

export function Users() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");

  const filteredUsers = mockUsers.filter((user) => {
    const matchesSearch = 
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = selectedStatus === "all" || user.accountStatus === selectedStatus;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex-1 w-full sm:w-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search users by name or email..."
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
            <option value="Suspended">Suspended</option>
            <option value="Pending">Pending</option>
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
            <UserPlus className="w-4 h-4" />
            <span className="hidden sm:inline">Add User</span>
          </button>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Total Users</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">48,293</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Active This Month</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">32,147</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Bank Linked</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">38,492</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Total Cashback</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">$892.3K</p>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contact</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Joined</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Activity</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cashback</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bank</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-amber-600 rounded-full flex items-center justify-center text-white font-medium">
                        {user.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{user.name}</p>
                        <p className="text-sm text-gray-500">ID: #{user.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Mail className="w-4 h-4 text-gray-400" />
                        <span>{user.email}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Phone className="w-4 h-4 text-gray-400" />
                        <span>{user.phone}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <span>{user.signupDate}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm">
                        <ShoppingCart className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-900 font-medium">{user.redemptions}</span>
                        <span className="text-gray-500">redemptions</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        {user.referrals} referrals
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-green-500" />
                      <span className="font-medium text-gray-900">${user.cashbackEarned.toFixed(2)}</span>
                    </div>
                    <div className="mt-1">
                      {user.payoutStatus === 'Pending' ? (
                        <StatusBadge status="Payout Pending" variant="warning" />
                      ) : (
                        <StatusBadge status="Paid" variant="success" />
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {user.bankLinked ? (
                      <StatusBadge status="Linked" variant="success" />
                    ) : (
                      <StatusBadge status="Not Linked" variant="warning" />
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {user.accountStatus === 'Active' ? (
                      <StatusBadge status="Active" variant="success" />
                    ) : (
                      <StatusBadge status="Suspended" variant="danger" />
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="View Details">
                        <Eye className="w-4 h-4 text-gray-600" />
                      </button>
                      <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Verify">
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      </button>
                      <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Suspend">
                        <Ban className="w-4 h-4 text-red-600" />
                      </button>
                      <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                        <MoreVertical className="w-4 h-4 text-gray-600" />
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
          Showing <span className="font-medium">{filteredUsers.length}</span> of <span className="font-medium">{mockUsers.length}</span> results
        </p>
        <div className="flex gap-2">
          <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            Previous
          </button>
          <button className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors">
            1
          </button>
          <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            2
          </button>
          <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            3
          </button>
          <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
