import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  Search,
  UserPlus,
  Filter,
  Download,
  Mail,
  Calendar,
  DollarSign,
  ShoppingCart,
  Ban,
  CheckCircle,
  Eye,
  MoreVertical,
  X,
  Copy,
  Link2,
} from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import { downloadCsv, type CsvColumn } from "../lib/csv";
import {
  apiRequest,
  formatDateTime,
  formatCurrencyFromCents,
  summarizeError,
} from "../lib/adminApi";

type UserRole = "consumer" | "business_owner" | "supervisor" | "admin";

interface UserProfile {
  id: string;
  email?: string | null;
  full_name?: string | null;
  role: UserRole;
  created_at?: string | null;
  updated_at?: string | null;
}

const roleBadge = (role: string): { label: string; variant: "success" | "info" | "warning" | "default" } => {
  if (role === "admin") return { label: "Admin", variant: "success" };
  if (role === "supervisor") return { label: "Supervisor", variant: "info" };
  if (role === "business_owner") return { label: "Business Owner", variant: "warning" };
  return { label: "Consumer", variant: "default" };
};

const userCsvColumns: CsvColumn<UserProfile>[] = [
  { key: "id", label: "User ID" },
  { key: "full_name", label: "Full Name", format: (value) => String(value || "") },
  { key: "email", label: "Email", format: (value) => String(value || "") },
  { key: "role", label: "Role" },
  { key: "created_at", label: "Created At", format: (value) => String(value || "") },
  { key: "updated_at", label: "Updated At", format: (value) => String(value || "") },
];

const makeInviteLink = (email: string) => {
  const token = `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const url = new URL("https://www.wellopartners.com/referral");
  url.searchParams.set("invite", token);
  if (email.trim()) url.searchParams.set("email", email.trim());
  return url.toString();
};

export function Users() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [message, setMessage] = useState("");

  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [menuOpenUserId, setMenuOpenUserId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState("");

  const loadUsers = async () => {
    setLoading(true);
    const res = await apiRequest<UserProfile[]>("/api/admin/users?limit=300");
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to load users."));
      setRows([]);
    } else {
      setRows(Array.isArray(res.data) ? res.data : []);
      setMessage("");
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadUsers();
  }, []);

  const filteredUsers = useMemo(
    () =>
      rows.filter((user) => {
        const name = String(user.full_name || "");
        const email = String(user.email || "");
        const matchesSearch =
          name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          email.toLowerCase().includes(searchQuery.toLowerCase()) ||
          user.id.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = selectedStatus === "all" || user.role === selectedStatus;
        return matchesSearch && matchesStatus;
      }),
    [rows, searchQuery, selectedStatus],
  );

  const counts = useMemo(
    () => ({
      total: rows.length,
      consumers: rows.filter((u) => u.role === "consumer").length,
      staff: rows.filter((u) => u.role === "admin" || u.role === "supervisor").length,
      businessOwners: rows.filter((u) => u.role === "business_owner").length,
    }),
    [rows],
  );

  const changeRole = async (user: UserProfile, nextRole: UserRole) => {
    if (nextRole === user.role) return;
    const confirmed = window.confirm(
      `Change role for ${user.full_name || user.email || user.id} from ${user.role} to ${nextRole}?`,
    );
    if (!confirmed) return;

    setUpdatingUserId(user.id);
    const res = await apiRequest<UserProfile>(`/api/admin/users/${encodeURIComponent(user.id)}/role`, {
      method: "POST",
      body: {
        expectedRole: user.role,
        nextRole,
      },
    });
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to update role."));
    } else {
      setRows((prev) =>
        prev.map((row) => (row.id === user.id ? { ...row, role: nextRole } : row)),
      );
      setSelectedUser((prev) => (prev?.id === user.id ? { ...prev, role: nextRole } : prev));
      setMessage("Role updated.");
    }
    setUpdatingUserId(null);
  };

  const exportUsers = () => {
    downloadCsv("users-export.csv", filteredUsers, userCsvColumns);
    setMessage(`Exported ${filteredUsers.length} users.`);
  };

  const openInviteModal = () => {
    setInviteEmail("");
    setInviteLink(makeInviteLink(""));
    setInviteOpen(true);
  };

  const generateInviteLink = () => {
    setInviteLink(makeInviteLink(inviteEmail));
  };

  const copyText = async (value: string, successMessage: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setMessage(successMessage);
    } catch {
      setMessage("Unable to copy. Clipboard permission denied.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex-1 w-full sm:w-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search users by name, email, or id..."
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
            <option value="all">All Roles</option>
            <option value="consumer">Consumer</option>
            <option value="business_owner">Business Owner</option>
            <option value="supervisor">Supervisor</option>
            <option value="admin">Admin</option>
          </select>

          <button
            type="button"
            onClick={() => void loadUsers()}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button
            type="button"
            onClick={exportUsers}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>

          <button
            type="button"
            onClick={openInviteModal}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            <span className="hidden sm:inline">Add User</span>
          </button>
        </div>
      </div>

      {message ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">
          {message}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Total Users</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{counts.total}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Consumers</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{counts.consumers}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Staff</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{counts.staff}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Business Owners</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{counts.businessOwners}</p>
        </div>
      </div>

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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-gray-500">
                    Loading users...
                  </td>
                </tr>
              ) : filteredUsers.length ? (
                filteredUsers.map((user) => {
                  const badge = roleBadge(user.role);
                  return (
                    <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-amber-600 rounded-full flex items-center justify-center text-white font-medium">
                            {(user.full_name || user.email || "U").slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{user.full_name || "Unnamed user"}</p>
                            <p className="text-sm text-gray-500">ID: {user.id.slice(0, 8)}...</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <Mail className="w-4 h-4 text-gray-400" />
                            <span>{user.email || "--"}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Calendar className="w-4 h-4 text-gray-400" />
                          <span>{formatDateTime(user.created_at)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-sm">
                            <ShoppingCart className="w-4 h-4 text-gray-400" />
                            <span className="text-gray-500">Live metrics in Reports</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-green-500" />
                          <span className="font-medium text-gray-900">
                            {formatCurrencyFromCents(0)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusBadge status={badge.label} variant={badge.variant} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {user.role === "admin" || user.role === "supervisor" ? (
                          <StatusBadge status="Staff" variant="success" />
                        ) : (
                          <StatusBadge status="Active" variant="default" />
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="relative flex items-center gap-1">
                          <button
                            type="button"
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            title="View Details"
                            onClick={() => {
                              setSelectedUser(user);
                              setMenuOpenUserId(null);
                            }}
                          >
                            <Eye className="w-4 h-4 text-gray-600" />
                          </button>
                          <button
                            type="button"
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Promote to Supervisor"
                            disabled={updatingUserId === user.id}
                            onClick={() => void changeRole(user, "supervisor")}
                          >
                            <CheckCircle className="w-4 h-4 text-green-600" />
                          </button>
                          <button
                            type="button"
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Set Consumer Role"
                            disabled={updatingUserId === user.id}
                            onClick={() => void changeRole(user, "consumer")}
                          >
                            <Ban className="w-4 h-4 text-red-600" />
                          </button>
                          <button
                            type="button"
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            title="More"
                            onClick={() =>
                              setMenuOpenUserId((prev) => (prev === user.id ? null : user.id))
                            }
                          >
                            <MoreVertical className="w-4 h-4 text-gray-600" />
                          </button>
                          {menuOpenUserId === user.id ? (
                            <div className="absolute right-0 top-10 z-20 w-52 bg-white border border-gray-200 rounded-lg shadow-lg p-1">
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 rounded-md"
                                onClick={() => void copyText(user.id, "User ID copied.")}
                              >
                                <span className="inline-flex items-center gap-2">
                                  <Copy className="w-4 h-4" />
                                  Copy User ID
                                </span>
                              </button>
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 rounded-md"
                                onClick={() =>
                                  void copyText(String(user.email || ""), "User email copied.")
                                }
                              >
                                <span className="inline-flex items-center gap-2">
                                  <Mail className="w-4 h-4" />
                                  Copy Email
                                </span>
                              </button>
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 rounded-md"
                                onClick={() => {
                                  setMenuOpenUserId(null);
                                  navigate("/admin-roles");
                                }}
                              >
                                <span className="inline-flex items-center gap-2">
                                  <Link2 className="w-4 h-4" />
                                  Open Admin Roles
                                </span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-gray-500">
                    No users match current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Showing <span className="font-medium">{filteredUsers.length}</span> of{" "}
          <span className="font-medium">{rows.length}</span> results
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void loadUsers()}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {inviteOpen ? (
        <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded-lg border border-gray-200 shadow-xl">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Invite User</h3>
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <label className="block">
                <span className="text-sm text-gray-700">Optional email</span>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="user@example.com"
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={generateInviteLink}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Generate Link
                </button>
                <button
                  type="button"
                  onClick={() => void copyText(inviteLink, "Invite link copied.")}
                  className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                >
                  Copy Link
                </button>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700 break-all">
                {inviteLink}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedUser ? (
        <div className="fixed inset-0 z-40 bg-black/30 flex justify-end">
          <div className="w-full max-w-lg h-full bg-white shadow-xl border-l border-gray-200 flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">User Details</h3>
              <button
                type="button"
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                onClick={() => setSelectedUser(null)}
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4 text-sm">
              <div>
                <p className="text-gray-500">Full name</p>
                <p className="font-medium text-gray-900">{selectedUser.full_name || "Unnamed user"}</p>
              </div>
              <div>
                <p className="text-gray-500">Email</p>
                <p className="font-medium text-gray-900">{selectedUser.email || "--"}</p>
              </div>
              <div>
                <p className="text-gray-500">User ID</p>
                <p className="font-medium text-gray-900 break-all">{selectedUser.id}</p>
              </div>
              <div>
                <p className="text-gray-500">Role</p>
                <p className="font-medium text-gray-900">{selectedUser.role}</p>
              </div>
              <div>
                <p className="text-gray-500">Created</p>
                <p className="font-medium text-gray-900">{formatDateTime(selectedUser.created_at)}</p>
              </div>
              <div>
                <p className="text-gray-500">Updated</p>
                <p className="font-medium text-gray-900">{formatDateTime(selectedUser.updated_at)}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
