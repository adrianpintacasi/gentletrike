import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from '../api';
import type { User, AdminSubRole } from '../types/auth';
import { Shield, Bike, User as UserIcon, Plus, X, PauseCircle, RotateCcw, Trash2, Filter } from 'lucide-react';

import { AdminLayout, AdminTab } from './admin/AdminLayout';
import { ActionMenu } from './admin/ActionMenu';
import { OverviewPage } from './admin/OverviewPage';
import { ReportsPage } from './admin/ReportsPage';
import { DirectoryPage } from './admin/DirectoryPage';
import { AuditLogPage } from './admin/AuditLogPage';
import { ActivationRequestsPage } from './admin/ActivationRequestsPage';
import { getActivationRequests } from '../api/adminApi';
import { useAuth } from '../context/AuthContext';

type AccountStatus = 'active' | 'suspended' | 'banned';

const STATUS_BADGE: Record<AccountStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  suspended: 'bg-orange-50 text-orange-700 border-orange-200',
  banned: 'bg-red-50 text-red-700 border-red-200',
};

/** Split a stored name when a staff account predates first/last-name fields. */
function firstNameOf(u: any): string {
  if (u.first_name) return u.first_name;
  return String(u.name ?? '').trim().split(/\s+/)[0] ?? '';
}
function lastNameOf(u: any): string {
  if (u.last_name) return u.last_name;
  return String(u.name ?? '').trim().split(/\s+/).slice(1).join(' ');
}

export const AdminDashboard: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  // Pending activation-request count (drives the sidebar badge).
  const [pendingActivations, setPendingActivations] = useState(0);
  useEffect(() => {
    const load = () =>
      getActivationRequests()
        .then((r) => setPendingActivations(r.length))
        .catch(() => {});
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, []);

  // User Management State
  const [users, setUsers] = useState<User[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [userError, setUserError] = useState<string | null>(null);

  // TMO Personnel filters
  const [staffFirst, setStaffFirst] = useState('');
  const [staffLast, setStaffLast] = useState('');
  const [staffStatus, setStaffStatus] = useState('');
  const [staffAccess, setStaffAccess] = useState('');

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    role: 'admin',
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
    if (activeTab !== 'users') return;
    fetchUsers();
    const id = setInterval(fetchUsers, 15000);
    return () => clearInterval(id);
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

  const handleUpdateStatus = async (id: string, name: string, status: AccountStatus) => {
    if (status !== 'active') {
      const verb = status === 'banned' ? 'ban' : 'suspend';
      if (
        !window.confirm(
          `Are you sure you want to ${verb} ${name}? They will be signed out and blocked from signing in.`
        )
      )
        return;
    }
    try {
      await api.updateUserStatus(id, status);
      setUsers(users.map((u) => (u.id === id ? { ...u, account_status: status } : u)));
    } catch (err) {
      alert(err instanceof api.ApiError ? err.message : 'Failed to update user status');
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAdding(true);
    setAddError(null);

    try {
      const newUser = await api.createUser({
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email || undefined,
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
        firstName: '',
        lastName: '',
        email: '',
        password: '',
        role: 'admin',
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
        return <Shield className="w-4 h-4 text-blue-500" />;
      case 'rider':
        return <Bike className="w-4 h-4 text-amber-500" />;
      default:
        return <UserIcon className="w-4 h-4 text-blue-500" />;
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'rider':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      default:
        return 'bg-blue-50 text-blue-700 border-blue-200';
    }
  };

  // Staff only (TMO Personnel), narrowed by the filter bar.
  const visibleStaff = users
    .filter((u) => u.role === 'admin')
    .filter((u) => {
      if (staffFirst && !firstNameOf(u).toLowerCase().includes(staffFirst.toLowerCase())) return false;
      if (staffLast && !lastNameOf(u).toLowerCase().includes(staffLast.toLowerCase())) return false;
      if (staffStatus && (u.account_status ?? 'active') !== staffStatus) return false;
      if (staffAccess && (u.sub_role ?? 'super_admin') !== staffAccess) return false;
      return true;
    });

  return (
    <AdminLayout activeTab={activeTab} onSelectTab={setActiveTab} pendingActivations={pendingActivations}>
      {activeTab === 'overview' && <OverviewPage />}
      {activeTab === 'reports' && <ReportsPage />}
      {activeTab === 'directory' && <DirectoryPage />}
      {activeTab === 'activation' && <ActivationRequestsPage />}
      {activeTab === 'audit' && <AuditLogPage />}

      {activeTab === 'users' && (
        <div className="space-y-6 animate-fadeIn">
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-gray-900">
              <Filter className="w-4 h-4 text-gray-500" />
              <span className="text-xs font-bold">Filter:</span>
            </div>
            <input
              value={staffFirst}
              onChange={(e) => setStaffFirst(e.target.value)}
              placeholder="First name"
              className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-medium text-gray-700 outline-none focus:ring-2 focus:ring-blue-500 w-36"
            />
            <input
              value={staffLast}
              onChange={(e) => setStaffLast(e.target.value)}
              placeholder="Last name"
              className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-medium text-gray-700 outline-none focus:ring-2 focus:ring-blue-500 w-36"
            />
            <select
              value={staffStatus}
              onChange={(e) => setStaffStatus(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-bold text-gray-700 outline-none"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="banned">Banned</option>
            </select>
            <select
              value={staffAccess}
              onChange={(e) => setStaffAccess(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-bold text-gray-700 outline-none"
            >
              <option value="">All Access</option>
              <option value="staff">Staff</option>
              <option value="super_admin">Super Admin</option>
            </select>
            <button
              onClick={() => {
                setStaffFirst('');
                setStaffLast('');
                setStaffStatus('');
                setStaffAccess('');
              }}
              disabled={!(staffFirst || staffLast || staffStatus || staffAccess)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Reset
            </button>
            {currentUser?.sub_role === 'super_admin' && (
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="ml-auto flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition shadow-xs active:scale-95"
              >
                <Plus className="w-4 h-4" />
                Add Staff
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
                      <th className="px-6 py-4">First Name</th>
                      <th className="px-6 py-4">Last Name</th>
                      <th className="px-6 py-4">Employee ID</th>
                      <th className="px-6 py-4 text-center">Role</th>
                      <th className="px-6 py-4 text-center">Status</th>
                      <th className="px-6 py-4 text-center">Joined Date</th>
                      <th className="px-6 py-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visibleStaff.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-6 py-10 text-center text-xs font-bold text-gray-400">
                          No staff accounts found.
                        </td>
                      </tr>
                    )}
                    {visibleStaff.map((user) => (
                      <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 font-bold text-gray-900">{firstNameOf(user)}</td>
                        <td className="px-6 py-4 font-bold text-gray-900">{lastNameOf(user) || '—'}</td>
                        <td className="px-6 py-4 font-mono text-xs text-blue-600">
                          {user.employee_id ?? '—'}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border capitalize ${getRoleBadgeColor(
                              user.role
                            )}`}
                          >
                            {getRoleIcon(user.role)}
                            {user.role} {user.sub_role ? `(${user.sub_role})` : ''}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span
                            className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold border capitalize ${
                              STATUS_BADGE[(user.account_status ?? 'active') as AccountStatus]
                            }`}
                          >
                            {user.account_status ?? 'active'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center text-xs font-medium text-gray-400">
                          {user.created_at ? new Date(user.created_at).toLocaleDateString() : 'Unknown'}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {currentUser?.sub_role === 'super_admin' && user.id !== currentUser?.id && (
                            <ActionMenu
                              items={[
                                (user.account_status ?? 'active') === 'active'
                                  ? {
                                      label: 'Suspend',
                                      tone: 'warning',
                                      icon: <PauseCircle className="w-4 h-4" />,
                                      onClick: () => handleUpdateStatus(user.id, user.name, 'suspended'),
                                    }
                                  : {
                                      label: 'Reactivate',
                                      tone: 'success',
                                      icon: <RotateCcw className="w-4 h-4" />,
                                      onClick: () => handleUpdateStatus(user.id, user.name, 'active'),
                                    },
                                {
                                  label: 'Delete',
                                  tone: 'danger',
                                  icon: <Trash2 className="w-4 h-4" />,
                                  onClick: () => handleDelete(user.id, user.name),
                                },
                              ]}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Add User Modal — portaled to <body> so the page's transformed
              container can't confine the overlay to the content area. */}
          {isAddModalOpen &&
            createPortal(
              <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 overflow-y-auto animate-fadeIn">
              <div className="flex min-h-full items-center justify-center p-4">
                <div className="bg-white rounded-3xl w-full max-w-md shadow-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                  <h3 className="font-bold text-gray-900 flex items-center gap-2">
                    <Plus className="w-4 h-4 text-blue-500" />
                    Add TMO Staff
                  </h3>
                  <button
                    onClick={() => setIsAddModalOpen(false)}
                    className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-full transition"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleAddSubmit} className="p-6 space-y-4">
                  {addError && (
                    <div className="bg-red-50 text-red-600 p-3 rounded-xl border border-red-100 font-bold text-xs">
                      {addError}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">First Name</label>
                      <input
                        type="text"
                        required
                        value={formData.firstName}
                        onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="e.g. Juan"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Last Name</label>
                      <input
                        type="text"
                        required
                        value={formData.lastName}
                        onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="e.g. Dela Cruz"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                      Employee ID (used to sign in)
                    </label>
                    <input
                      type="text"
                      required
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
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Access Level</label>
                    <select
                      value={formData.subRole}
                      onChange={(e) => setFormData({ ...formData, subRole: e.target.value as AdminSubRole })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="staff">Staff (View / Resolve Reports)</option>
                      <option value="super_admin">Super Admin (Full Control &amp; User Management)</option>
                    </select>
                  </div>

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
            </div>,
            document.body
          )}
        </div>
      )}
    </AdminLayout>
  );
};
