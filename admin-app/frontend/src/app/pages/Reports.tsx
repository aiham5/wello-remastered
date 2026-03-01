import { Download, Calendar, TrendingUp } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const revenueData = [
  { month: "Jan", revenue: 18200, cashback: 3640 },
  { month: "Feb", revenue: 21400, cashback: 4280 },
  { month: "Mar", revenue: 24800, cashback: 4960 },
  { month: "Apr", revenue: 28300, cashback: 5660 },
  { month: "May", revenue: 32100, cashback: 6420 },
  { month: "Jun", revenue: 38500, cashback: 7700 },
  { month: "Jul", revenue: 42800, cashback: 8560 },
];

export function Reports() {
  return (
    <div className="space-y-6">
      {/* Date Range Filter */}
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          <button className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            <Calendar className="w-4 h-4" />
            Last 30 Days
          </button>
        </div>
        <button className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors">
          <Download className="w-4 h-4" />
          Export Report
        </button>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg p-6 border border-gray-200">
          <p className="text-sm text-gray-600 mb-2">Total Revenue</p>
          <p className="text-3xl font-semibold text-gray-900 mb-2">$206,100</p>
          <div className="flex items-center gap-1 text-sm text-green-600">
            <TrendingUp className="w-4 h-4" />
            <span>+23.5% from last period</span>
          </div>
        </div>
        <div className="bg-white rounded-lg p-6 border border-gray-200">
          <p className="text-sm text-gray-600 mb-2">Cashback Issued</p>
          <p className="text-3xl font-semibold text-gray-900 mb-2">$41,220</p>
          <div className="flex items-center gap-1 text-sm text-green-600">
            <TrendingUp className="w-4 h-4" />
            <span>+18.2% from last period</span>
          </div>
        </div>
        <div className="bg-white rounded-lg p-6 border border-gray-200">
          <p className="text-sm text-gray-600 mb-2">Avg Conversion</p>
          <p className="text-3xl font-semibold text-gray-900 mb-2">34.2%</p>
          <div className="flex items-center gap-1 text-sm text-green-600">
            <TrendingUp className="w-4 h-4" />
            <span>+5.1% from last period</span>
          </div>
        </div>
      </div>

      {/* Revenue Chart */}
      <div className="bg-white rounded-lg p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Revenue & Cashback Trends</h3>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={revenueData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="month" stroke="#9ca3af" />
            <YAxis stroke="#9ca3af" />
            <Tooltip
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '8px'
              }}
            />
            <Legend />
            <Line type="monotone" dataKey="revenue" stroke="#fbbf24" strokeWidth={3} name="Revenue ($)" />
            <Line type="monotone" dataKey="cashback" stroke="#10b981" strokeWidth={3} name="Cashback ($)" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
