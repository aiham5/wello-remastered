import { useState } from "react";
import { 
  Search, 
  Plus, 
  Filter, 
  MoreVertical,
  Eye,
  Edit,
  Trash2,
  Calendar,
  User
} from "lucide-react";

const mockPosts = [
  {
    id: 1,
    title: "Getting Started with React Admin Panels",
    author: "John Doe",
    status: "Published",
    category: "Tutorial",
    views: 1243,
    date: "Mar 1, 2026",
    thumbnail: "bg-blue-500",
  },
  {
    id: 2,
    title: "10 Best Practices for Web Development",
    author: "Jane Smith",
    status: "Published",
    category: "Guide",
    views: 2156,
    date: "Feb 28, 2026",
    thumbnail: "bg-green-500",
  },
  {
    id: 3,
    title: "Understanding Modern CSS Frameworks",
    author: "Mike Johnson",
    status: "Draft",
    category: "Tutorial",
    views: 0,
    date: "Feb 27, 2026",
    thumbnail: "bg-purple-500",
  },
  {
    id: 4,
    title: "Building Scalable Applications",
    author: "Sarah Williams",
    status: "Published",
    category: "Article",
    views: 3421,
    date: "Feb 26, 2026",
    thumbnail: "bg-orange-500",
  },
  {
    id: 5,
    title: "Introduction to TypeScript",
    author: "Tom Brown",
    status: "Review",
    category: "Tutorial",
    views: 892,
    date: "Feb 25, 2026",
    thumbnail: "bg-pink-500",
  },
];

const statusColors = {
  Published: "bg-green-100 text-green-800",
  Draft: "bg-gray-100 text-gray-800",
  Review: "bg-yellow-100 text-yellow-800",
};

export function Content() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");

  const filteredPosts = mockPosts.filter((post) => {
    const matchesSearch = post.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = selectedStatus === "all" || post.status === selectedStatus;
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
              placeholder="Search content..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
        
        <div className="flex gap-3 w-full sm:w-auto">
          <button className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            <Filter className="w-4 h-4" />
            Filter
          </button>
          
          <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            <Plus className="w-4 h-4" />
            New Post
          </button>
        </div>
      </div>

      {/* Status Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {["all", "Published", "Draft", "Review"].map((status) => (
          <button
            key={status}
            onClick={() => setSelectedStatus(status)}
            className={`px-4 py-2 border-b-2 transition-colors ${
              selectedStatus === status
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            {status === "all" ? "All Posts" : status}
            {status === "all" && (
              <span className="ml-2 px-2 py-0.5 bg-gray-100 rounded-full text-xs">
                {mockPosts.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Posts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredPosts.map((post) => (
          <div key={post.id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
            <div className={`h-32 ${post.thumbnail}`}></div>
            <div className="p-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded">
                  {post.category}
                </span>
                <span className={`text-xs px-2 py-1 rounded-full ${statusColors[post.status as keyof typeof statusColors]}`}>
                  {post.status}
                </span>
              </div>
              
              <h3 className="text-lg font-semibold text-gray-900 mb-3 line-clamp-2">
                {post.title}
              </h3>
              
              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <User className="w-4 h-4" />
                  <span>{post.author}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Calendar className="w-4 h-4" />
                  <span>{post.date}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Eye className="w-4 h-4" />
                  <span>{post.views.toLocaleString()} views</span>
                </div>
              </div>
              
              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <button className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700">
                  <Eye className="w-4 h-4" />
                  View
                </button>
                <button className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-700">
                  <Edit className="w-4 h-4" />
                  Edit
                </button>
                <button className="flex items-center gap-2 text-sm text-red-600 hover:text-red-700">
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
                <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                  <MoreVertical className="w-4 h-4 text-gray-600" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Showing {filteredPosts.length} of {mockPosts.length} posts
        </p>
        <div className="flex gap-2">
          <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm">
            Previous
          </button>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm">
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
