import { useEffect, useMemo, useState } from "react";
import { Shield, RefreshCw } from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import { apiRequest, formatDateTime, summarizeError } from "../lib/adminApi";

type UserRole = "consumer" | "business_owner" | "supervisor" | "admin";

interface UserProfile {
  id: string;
  email?: string | null;
  full_name?: string | null;
  role: UserRole;
  created_at?: string | null;
}

const ROLES: UserRole[] = ["consumer", "business_owner", "supervisor", "admin"];

const roleVariant = (role: UserRole) => {
  if (role === "admin") return "success" as const;
  if (role === "supervisor") return "info" as const;
  if (role === "business_owner") return "warning" as const;
  return "default" as const;
};

export function AdminRoles() {
  const [rows, setRows] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    const res = await apiRequest<UserProfile[]>("/api/admin/users?limit=300");
    if (res.error) {
      setRows([]);
      setMessage(summarizeError(res.error, "Unable to load roles."));
    } else {
      setRows(Array.isArray(res.data) ? res.data : []);
      setMessage("");
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const staffRows = useMemo(
    () =>
      rows.filter((row) => row.role === "admin" || row.role === "supervisor"),
    [rows],
  );

  const updateRole = async (row: UserProfile, nextRole: UserRole) => {
    if (nextRole === row.role) return;
    const confirmed = window.confirm(
      `Change role for ${row.full_name || row.email || row.id} from ${row.role} to ${nextRole}?`,
    );
    if (!confirmed) return;
    setWorkingId(row.id);
    const res = await apiRequest(
      `/api/admin/users/${encodeURIComponent(row.id)}/role`,
      {
        method: "POST",
        body: {
          expectedRole: row.role,
          nextRole,
        },
      },
    );
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to update role."));
    } else {
      setRows((prev) =>
        prev.map((item) => (item.id === row.id ? { ...item, role: nextRole } : item)),
      );
      setMessage("Role updated.");
    }
    setWorkingId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Shield className="w-5 h-5 text-amber-500" />
          Admin Roles
        </h3>
        <button
          onClick={() => void load()}
          className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {message ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">
          {message}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Admin Users</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">
            {rows.filter((r) => r.role === "admin").length}
          </p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Supervisors</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">
            {rows.filter((r) => r.role === "supervisor").length}
          </p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Total Staff</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{staffRows.length}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Profile</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Current Role</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Joined</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Change Role</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-gray-500">
                    Loading staff roles...
                  </td>
                </tr>
              ) : staffRows.length ? (
                staffRows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900">{row.full_name || "Unnamed user"}</p>
                      <p className="text-sm text-gray-500">{row.email || row.id}</p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge status={row.role} variant={roleVariant(row.role)} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <select
                        disabled={workingId === row.id}
                        value={row.role}
                        onChange={(e) => void updateRole(row, e.target.value as UserRole)}
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-gray-500">
                    No staff roles found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
