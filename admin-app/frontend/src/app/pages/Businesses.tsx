import { useState } from "react";
import { 
  Search, 
  Store,
  Filter,
  Download,
  MapPin,
  Tag,
  TrendingUp,
  DollarSign,
  Star,
  Eye,
  Edit,
  Pause,
  Check,
  X
} from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";

const mockBusinesses = [
  {
    id: 1,
    name: "Joe's Coffee House",
    category: "Food & Dining",
    location: "San Francisco, CA",
    status: "Active",
    rating: 4.8,
    offers: 5,
    redemptions: 3842,
    revenue: 82400,
    commission: 12360,
    joinDate: "Jan 2024",
    featured: true,
  },
  {
    id: 2,
    name: "Bella's Pizza",
    category: "Food & Dining",
    location: "Oakland, CA",
    status: "Active",
    rating: 4.6,
    offers: 8,
    redemptions: 3124,
    revenue: 71800,
    commission: 10770,
    joinDate: "Feb 2024",
    featured: true,
  },
  {
    id: 3,
    name: "FitZone Gym",
    category: "Health & Fitness",
    location: "San Jose, CA",
    status: "Active",
    rating: 4.9,
    offers: 3,
    redemptions: 2856,
    revenue: 64200,
    commission: 9630,
    joinDate: "Dec 2023",
    featured: false,
  },
  {
    id: 4,
    name: "Green Grocers",
    category: "Retail",
    location: "Berkeley, CA",
    status: "Active",
    rating: 4.5,
    offers: 12,
    redemptions: 2634,
    revenue: 58900,
    commission: 8835,
    joinDate: "Mar 2024",
    featured: false,
  },
  {
    id: 5,
    name: "Tech Repairs Pro",
    category: "Services",
    location: "Palo Alto, CA",
    status: "Pending",
    rating: 0,
    offers: 0,
    redemptions: 0,
    revenue: 0,
    commission: 0,
    joinDate: "Jul 2024",
    featured: false,
  },
  {
    id: 6,
    name: "Happy Nails Spa",
    category: "Services",
    location: "Mountain View, CA",
    status: "Paused",
    rating: 4.7,
    offers: 4,
    redemptions: 1847,
    revenue: 43200,
    commission: 6480,
    joinDate: "Apr 2024",
    featured: false,
  },
];

export function Businesses() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");

  const filteredBusinesses = mockBusinesses.filter((business) => {
    const matchesSearch = business.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "all" || business.category === selectedCategory;
    const matchesStatus = selectedStatus === "all" || business.status === selectedStatus;
    return matchesSearch && matchesCategory && matchesStatus;
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
              placeholder="Search businesses..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2.5 w-full border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>
        </div>
        
        <div className="flex gap-3 w-full sm:w-auto">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
          >
            <option value="all">All Categories</option>
            <option value="Food & Dining">Food & Dining</option>
            <option value="Retail">Retail</option>
            <option value="Health & Fitness">Health & Fitness</option>
            <option value="Services">Services</option>
          </select>
          
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
          >
            <option value="all">All Status</option>
            <option value="Active">Active</option>
            <option value="Pending">Pending</option>
            <option value="Paused">Paused</option>
          </select>
          
          <button className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
          
          <button className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors">
            <Store className="w-4 h-4" />
            <span className="hidden sm:inline">Add Business</span>
          </button>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Total Businesses</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">1,247</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Active</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">1,142</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Pending Approval</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">28</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Total Commission</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">$143.2K</p>
        </div>
      </div>

      {/* Businesses Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredBusinesses.map((business) => (
          <div key={business.id} className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-lg flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
                  {business.name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900">{business.name}</h3>
                    {business.featured && (
                      <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
                    <Tag className="w-4 h-4" />
                    <span>{business.category}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <MapPin className="w-4 h-4" />
                    <span>{business.location}</span>
                  </div>
                </div>
              </div>
              {business.status === 'Active' && (
                <StatusBadge status="Active" variant="success" />
              )}
              {business.status === 'Pending' && (
                <StatusBadge status="Pending" variant="warning" />
              )}
              {business.status === 'Paused' && (
                <StatusBadge status="Paused" variant="default" />
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
              <div>
                <p className="text-xs text-gray-600 mb-1">Active Offers</p>
                <p className="text-lg font-semibold text-gray-900">{business.offers}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600 mb-1">Redemptions</p>
                <p className="text-lg font-semibold text-gray-900">{business.redemptions.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600 mb-1">Revenue Generated</p>
                <p className="text-lg font-semibold text-gray-900">${business.revenue.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600 mb-1">Commission Earned</p>
                <p className="text-lg font-semibold text-green-600">${business.commission.toLocaleString()}</p>
              </div>
            </div>

            {business.rating > 0 && (
              <div className="flex items-center gap-2 mb-4">
                <div className="flex items-center gap-1">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      className={`w-4 h-4 ${
                        i < Math.floor(business.rating)
                          ? 'text-amber-500 fill-amber-500'
                          : 'text-gray-300'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-sm font-medium text-gray-900">{business.rating}</span>
                <span className="text-sm text-gray-500">rating</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <div className="flex gap-2">
                <button className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                  <Eye className="w-4 h-4" />
                  View
                </button>
                <button className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                  <Edit className="w-4 h-4" />
                  Edit
                </button>
                {business.status === 'Pending' && (
                  <>
                    <button className="flex items-center gap-2 px-3 py-2 text-sm text-green-700 border border-green-300 rounded-lg hover:bg-green-50 transition-colors">
                      <Check className="w-4 h-4" />
                      Approve
                    </button>
                    <button className="flex items-center gap-2 px-3 py-2 text-sm text-red-700 border border-red-300 rounded-lg hover:bg-red-50 transition-colors">
                      <X className="w-4 h-4" />
                      Reject
                    </button>
                  </>
                )}
                {business.status === 'Active' && (
                  <button className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                    <Pause className="w-4 h-4" />
                    Pause
                  </button>
                )}
              </div>
              <span className="text-xs text-gray-500">Joined {business.joinDate}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Showing <span className="font-medium">{filteredBusinesses.length}</span> of <span className="font-medium">{mockBusinesses.length}</span> businesses
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
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
