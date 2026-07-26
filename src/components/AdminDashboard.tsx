import React, { useEffect, useState } from 'react';
import * as api from '../api';
import type { User, AdminSubRole } from '../types/auth';
import { Users, Shield, Bike, User as UserIcon, Calendar, Trash2, Plus, X } from 'lucide-react';
import { AdminLayout, AdminTab } from './admin/AdminLayout';
import { OverviewPage } from './admin/OverviewPage';
import { RejectionsPage } from './admin/RejectionsPage';
import { ReportsPage } from './admin/ReportsPage';
import { DirectoryPage } from './admin/DirectoryPage';
import { AuditLogPage } from './admin/AuditLogPage';
import { AiInsightsPage } from './admin/AiInsightsPage';
import { useAuth } from '../context/AuthContext';

export const AdminDashboard: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  // User Management State
  const [users, setUsers] = useState<User[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [userError, setUserError] = useState<string | null>(null);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'passenger',
    unitNumber: '',
    employeeId: '',
    department: '',
    subRole: 'staff' as AdminSubRole,
  });

  const fetchUsers = () => {
    api
      .listUsers()
      .then((data) => {
        setUsers(data);
        setIsLoadingUsers(false);
      })
      .catch((err) => {
        setUserError(err instanceof api.ApiError ? err.message : 'Failed to load users');
        setIsLoadingUsers(false);
      });
  };

  useEffect(() => {
    if (activeTab === 'users') {
      fetchUsers();
    }
  }, [activeTab]);

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete ${name}? This action cannot be undone.`)) {
      return;
    }

    try {
      await api.deleteUser(id);
      setUsers(users.filter((u) => u.id !== id));
    } catch (err) {
      alert(err instanceof api.ApiError ? err.message : 'Failed to delete user');
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAdding(true);
    setAddError(null);

    try {
      const newUser = await api.createUser({
        name: formData.name,
        email: formData.email,
        password: formData.password,
        role: formData.role as 'passenger' | 'rider' | 'admin',
        unitNumber: formData.role === 'rider' ? formData.unitNumber : undefined,
        employeeId: formData.employeeId || undefined,
        department: formData.department || undefined,
        subRole: formData.role === 'admin' ? formData.subRole : undefined,
      });
      setUsers([newUser, ...users]);
      setIsAddModalOpen(false);
      setFormData({
        name: '',
        email: '',
        password: '',
        role: 'passenger',
        unitNumber: '',
        employeeId: '',
        department: '',
        subRole: 'staff',
      });
    } catch (err) {
      setAddError(err instanceof api.ApiError ? err.message : 'Failed to create user');
    } finally {
      setIsAdding(false);
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'admin':
        return <Shield className="w-4 h-4 text-purple-500" />;
      case 'rider':
        return <Bike className="w-4 h-4 text-amber-500" />;
      default:
        return <UserIcon className="w-4 h-4 text-blue-500" />;
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'rider':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      default:
        return 'bg-blue-50 text-blue-700 border-blue-200';
    }
  };

  return (
    <AdminLayout activeTab={activeTab} onSelectTab={setActiveTab}>
      {activeTab === 'overview' && <OverviewPage />}
      {activeTab === 'rejections' && <RejectionsPage />}
      {activeTab === 'reports' && <ReportsPage />}
      {activeTab === 'directory' && <DirectoryPage />}
      {activeTab === 'ai' && <AiInsightsPage />}
      {activeTab === 'audit' && <AuditLogPage />}

      {activeTab === 'users' && (
        <div className="space-y-6 animate-fadeIn">
          <div className="flex items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-gray-200 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gray-900 text-white rounded-xl shadow-xs">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900 tracking-tight">User Management</h3>
                <p className="text-xs text-gray-500 font-medium">Manage passengers, riders, and TMO officer accounts</p>
              </div>
            </div>
            {currentUser?.sub_role === 'super_admin' && (
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition shadow-xs active:scale-95"
              >
                <Plus className="w-4 h-4" />
                Add User
              </button>
            )}
          </div>

          {userError ? (
            <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 font-bold text-sm">
              {userError}
            </div>
          ) : isLoadingUsers ? (
            <div className="p-8 text-center text-xs font-bold text-gray-400 animate-pulse">Loading users...</div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-gray-600">
                  <thead className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wider font-bold">
                    <tr>
                      <th className="px-6 py-4">Name</th>
                      <th className="px-6 py-4">Email / ID</th>
                      <th className="px-6 py-4">Role</th>
                      <th className="px-6 py-4">Department</th>
                      <th className="px-6 py-4">Joined Date</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {users.map((user) => (
                      <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 font-bold text-gray-900">{user.name}</td>
                        <td className="px-6 py-4 font-medium text-gray-500">
                          <div>{user.email}</div>
                          {user.employee_id && (
                            <span className="text-[11px] font-mono text-purple-600">ID: {user.employee_id}</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border capitalize ${getRoleBadgeColor(
                              user.role
                            )}`}
                          >
                            {getRoleIcon(user.role)}
                            {user.role} {user.sub_role ? `(${user.sub_role})` : ''}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs font-medium text-gray-600">
                          {user.department ?? 'N/A'}
                        </td>
                        <td className="px-6 py-4 text-xs font-medium text-gray-400">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5" />
                            {user.created_at
                              ? new Date(user.created_at).toLocaleDateString(undefined, {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                })
                              : 'Unknown'}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          {currentUser?.sub_role === 'super_admin' && (
                            <button
                              onClick={() => handleDelete(user.id, user.name)}
                              className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                              title="Delete User"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Add User Modal */}
          {isAddModalOpen && (
            <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-fadeIn">
              <div className="bg-white rounded-3xl w-full max-w-md shadow-xl overflow-hidden flex flex-col max-h-full">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                  <h3 className="font-bold text-gray-900 flex items-center gap-2">
                    <Plus className="w-4 h-4 text-blue-500" />
                    Add New User
                  </h3>
                  <button
                    onClick={() => setIsAddModalOpen(false)}
                    className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-full transition"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleAddSubmit} className="p-6 space-y-4 overflow-y-auto">
                  {addError && (
                    <div className="bg-red-50 text-red-600 p-3 rounded-xl border border-red-100 font-bold text-xs">
                      {addError}
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Full Name</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="e.g. Officer Juan Dela Cruz"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Email Address</label>
                    <input
                      type="email"
                      required
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="e.g. officer@dumaguete.gov.ph"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Employee ID (Optional)</label>
                    <input
                      type="text"
                      value={formData.employeeId}
                      onChange={(e) => setFormData({ ...formData, employeeId: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="e.g. TMO-104"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Password</label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="Min 8 characters"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Role</label>
                    <select
                      value={formData.role}
                      onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="passenger">Passenger</option>
                      <option value="rider">Rider</option>
                      <option value="admin">TMO Admin</option>
                    </select>
                  </div>

                  {formData.role === 'admin' && (
                    <div className="space-y-1 animate-fadeIn">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Admin Sub-Role</label>
                      <select
                        value={formData.subRole}
                        onChange={(e) => setFormData({ ...formData, subRole: e.target.value as AdminSubRole })}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                      >
                        <option value="staff">Staff (View / Resolve Reports)</option>
                        <option value="super_admin">Super Admin (Full Control & User Management)</option>
                      </select>
                    </div>
                  )}

                  {formData.role === 'rider' && (
                    <div className="space-y-1 animate-fadeIn">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Pedicab Unit Number</label>
                      <input
                        type="text"
                        required
                        value={formData.unitNumber}
                        onChange={(e) => setFormData({ ...formData, unitNumber: e.target.value })}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="e.g. 1234"
                      />
                    </div>
                  )}

                  <div className="pt-4">
                    <button
                      type="submit"
                      disabled={isAdding}
                      className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-black py-3 rounded-xl transition shadow-xs"
                    >
                      {isAdding ? 'Creating Account...' : 'Create Account'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </AdminLayout>
  );
};
