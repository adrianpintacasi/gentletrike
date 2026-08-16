import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import * as adminApi from '../../api/adminApi';
import { Filter, CheckCircle2, XCircle, X, User, Phone, Mail, FileText } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const STATUS_BADGE: Record<string, string> = {
  suspended: 'bg-sunset-coral/15 text-sunset-coral border-sunset-coral/30',
  banned: 'bg-sunset-coral text-white border-sunset-coral',
};

function nameOf(r: adminApi.ActivationRequest): { first: string; last: string } {
  if (r.first_name || r.last_name) return { first: r.first_name ?? '', last: r.last_name ?? '' };
  const parts = String(r.name ?? '').trim().split(/\s+/);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

function formatDateTime(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

const Field: React.FC<{ icon: React.ReactNode; label: string; value?: React.ReactNode; full?: boolean }> = ({
  icon,
  label,
  value,
  full,
}) => (
  <div className={`flex items-start gap-3 ${full ? 'sm:col-span-2' : ''}`}>
    <div className="mt-0.5 p-2 rounded-card bg-trike-gold/20 text-trust-slate shrink-0">{icon}</div>
    <div className="min-w-0">
      <p className="kicker-label">{label}</p>
      <p className="text-sm font-sans font-semibold text-trust-slate break-words">{value || '—'}</p>
    </div>
  </div>
);

export const ActivationRequestsPage: React.FC = () => {
  const { user } = useAuth();
  const isSuper = (user?.sub_role ?? 'super_admin') === 'super_admin';

  const [requests, setRequests] = useState<adminApi.ActivationRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [firstFilter, setFirstFilter] = useState('');
  const [lastFilter, setLastFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const [selected, setSelected] = useState<adminApi.ActivationRequest | null>(null);

  // Anchor the modal over the content panel (matches the Reports/Directory modals).
  const [contentBox, setContentBox] = useState<
    { left: number; top: number; width: number; height: number } | null
  >(null);
  useEffect(() => {
    if (!selected) return;
    const measure = () => {
      const el = document.getElementById('admin-main');
      if (!el) return setContentBox(null);
      const r = el.getBoundingClientRect();
      const top = Math.max(r.top, 0);
      const bottom = Math.min(r.bottom, window.innerHeight);
      setContentBox({ left: r.left, top, width: r.width, height: Math.max(0, bottom - top) });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [selected]);

  const fetchRequests = useCallback(() => {
    adminApi
      .getActivationRequests()
      .then(setRequests)
      .catch((err) => console.error(err))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    fetchRequests();
    const id = setInterval(fetchRequests, 15000);
    return () => clearInterval(id);
  }, [fetchRequests]);

  const handleResolve = async (r: adminApi.ActivationRequest, action: 'approve' | 'dismiss') => {
    const verb = action === 'approve' ? 'reactivate' : 'dismiss the appeal from';
    if (!window.confirm(`Are you sure you want to ${verb} ${r.name}?`)) return;
    try {
      await adminApi.resolveActivationRequest(r.id, action);
      setRequests((list) => list.filter((x) => x.id !== r.id));
      setSelected(null);
    } catch (err: any) {
      alert(err.message || 'Failed to resolve request');
    }
  };

  const hasFilters = !!(firstFilter || lastFilter || statusFilter || typeFilter);
  const visible = requests.filter((r) => {
    const { first, last } = nameOf(r);
    if (firstFilter && !first.toLowerCase().includes(firstFilter.toLowerCase())) return false;
    if (lastFilter && !last.toLowerCase().includes(lastFilter.toLowerCase())) return false;
    if (statusFilter && r.account_status !== statusFilter) return false;
    if (typeFilter && r.role !== typeFilter) return false;
    return true;
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-12">
        <p className="text-xs font-display font-bold text-cream-500 animate-pulse">Loading activation requests...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn font-sans text-trust-slate">
      {/* Filter bar */}
      <div className="bg-cream-50 p-4 rounded-card border border-cream-300 shadow-sm flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-trust-slate">
          <Filter className="w-4 h-4 text-cream-500" />
          <span className="text-xs font-display font-bold">Filter:</span>
        </div>
        <input
          value={firstFilter}
          onChange={(e) => setFirstFilter(e.target.value)}
          placeholder="First name"
          className="bg-cream-50 border border-cream-300 rounded-pill px-3.5 py-1.5 text-xs font-sans text-trust-slate placeholder:text-cream-400 outline-none focus:ring-2 focus:ring-trike-gold w-36"
        />
        <input
          value={lastFilter}
          onChange={(e) => setLastFilter(e.target.value)}
          placeholder="Last name"
          className="bg-cream-50 border border-cream-300 rounded-pill px-3.5 py-1.5 text-xs font-sans text-trust-slate placeholder:text-cream-400 outline-none focus:ring-2 focus:ring-trike-gold w-36"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-cream-50 border border-cream-300 rounded-pill px-3.5 py-1.5 text-xs font-display font-bold text-trust-slate outline-none"
        >
          <option value="">All Statuses</option>
          <option value="suspended">Suspended</option>
          <option value="banned">Banned</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-cream-50 border border-cream-300 rounded-pill px-3.5 py-1.5 text-xs font-display font-bold text-trust-slate outline-none"
        >
          <option value="">All Types</option>
          <option value="passenger">Passenger</option>
          <option value="rider">Rider</option>
          <option value="admin">Staff</option>
        </select>
        <button
          onClick={() => {
            setFirstFilter('');
            setLastFilter('');
            setStatusFilter('');
            setTypeFilter('');
          }}
          disabled={!hasFilters}
          className="ml-auto px-3.5 py-1.5 rounded-pill text-xs font-display font-bold border border-cream-300 bg-cream-200 text-trust-slate hover:bg-cream-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Reset
        </button>
      </div>

      {/* Table */}
      <div className="bg-cream-50 rounded-card border border-cream-300 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-cream-700 font-sans">
            <thead className="bg-cream-200/50 border-b border-cream-300 text-xs font-display text-trust-slate uppercase tracking-wider font-bold">
              <tr>
                <th className="px-6 py-4">First Name</th>
                <th className="px-6 py-4">Last Name</th>
                <th className="px-6 py-4 text-center">Type</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4">Requested</th>
                <th className="px-6 py-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-300/60">
              {visible.map((r) => {
                const { first, last } = nameOf(r);
                return (
                  <tr key={r.id} className="hover:bg-cream-100/70 transition">
                    <td className="px-6 py-4 font-bold text-trust-slate">{first || '—'}</td>
                    <td className="px-6 py-4 font-bold text-trust-slate">{last || '—'}</td>
                    <td className="px-6 py-4 text-center capitalize font-medium text-cream-700">
                      {r.role === 'admin' ? 'Staff' : r.role}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-pill text-[11px] font-display font-bold capitalize border ${
                          STATUS_BADGE[r.account_status] ?? STATUS_BADGE.suspended
                        }`}
                      >
                        {r.account_status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs font-medium text-cream-500 whitespace-nowrap">
                      {formatDateTime(r.activation_requested_at)}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => setSelected(r)}
                        className="px-3.5 py-1.5 bg-cream-200 hover:bg-trike-gold/30 text-trust-slate font-display font-bold text-xs rounded-pill transition border border-cream-300 shadow-2xs"
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-xs font-sans font-bold text-cream-400">
                    {hasFilters ? 'No requests match the filters.' : 'No activation requests right now.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Review Modal */}
      {selected &&
        createPortal(
          <div
            className="fixed z-50 bg-trust-slate/70 backdrop-blur-xs overflow-y-auto"
            style={
              contentBox
                ? { left: contentBox.left, top: contentBox.top, width: contentBox.width, height: contentBox.height }
                : { inset: 0 }
            }
            onClick={() => setSelected(null)}
          >
            <div className="flex min-h-full items-center justify-center p-4">
              <div
                className="bg-cream-50 rounded-[28px] w-full max-w-lg shadow-2xl border border-cream-300 overflow-hidden animate-scaleUp"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="px-6 py-4 border-b border-cream-300 bg-cream-100/40 flex items-start justify-between gap-4">
                  <div>
                    <p className="kicker-label">Reactivation Appeal</p>
                    <h3 className="text-lg font-display font-black text-trust-slate">
                      {(() => {
                        const { first, last } = nameOf(selected);
                        return `${first} ${last}`.trim() || selected.name;
                      })()}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs font-sans font-semibold text-cream-600 capitalize">
                        {selected.role === 'admin' ? 'Staff' : selected.role}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-pill text-[10px] font-display font-bold capitalize border ${
                          STATUS_BADGE[selected.account_status] ?? STATUS_BADGE.suspended
                        }`}
                      >
                        {selected.account_status}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="p-1.5 text-cream-500 hover:text-trust-slate hover:bg-cream-200 rounded-full transition"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-5 font-sans">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
                    <Field icon={<Phone className="w-4 h-4" />} label="Contact" value={selected.contact_number} />
                    <Field icon={<Mail className="w-4 h-4" />} label="Email" value={selected.email} />
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 text-cream-600 mb-2">
                      <FileText className="w-4 h-4 text-trike-gold" />
                      <h4 className="kicker-label">Reason</h4>
                    </div>
                    <p className="p-3.5 bg-cream-100/60 rounded-card border border-cream-300 text-sm font-medium text-trust-slate leading-relaxed whitespace-pre-wrap break-words">
                      {selected.activation_request}
                    </p>
                  </div>

                  <p className="text-xs font-medium text-cream-500">
                    Filed {formatDateTime(selected.activation_requested_at)}
                  </p>
                </div>

                {/* Footer actions */}
                {isSuper && (
                  <div className="px-6 py-4 border-t border-cream-300 bg-cream-100/50 flex gap-3">
                    <button
                      onClick={() => handleResolve(selected, 'approve')}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 bg-sampaguita-green hover:bg-sampaguita-green/90 text-white font-display font-bold text-sm rounded-pill shadow-xs transition"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Approve (reactivate)
                    </button>
                    <button
                      onClick={() => handleResolve(selected, 'dismiss')}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 bg-cream-200 hover:bg-cream-300 text-trust-slate font-display font-bold text-sm rounded-pill border border-cream-300 shadow-2xs transition"
                    >
                      <XCircle className="w-4 h-4" />
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
