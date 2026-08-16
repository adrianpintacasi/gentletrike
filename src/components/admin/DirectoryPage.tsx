import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import * as adminApi from '../../api/adminApi';
import { updateUserStatus, ApiError } from '../../api';
import { ActionMenu, type ActionTone, type ActionItem } from './ActionMenu';
import {
  Search,
  Bike,
  User as UserIcon,
  Phone,
  Mail,
  MapPin,
  Cake,
  X,
  PauseCircle,
  Ban,
  RotateCcw,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

type VerificationStatus = 'pending' | 'verified' | 'suspended' | 'declined';
type AccountStatus = 'active' | 'suspended' | 'banned';

const ACCOUNT_BADGE: Record<AccountStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  suspended: 'bg-orange-50 text-orange-700 border-orange-200',
  banned: 'bg-red-50 text-red-700 border-red-200',
};

/** Account-level moderation buttons (passengers, and rider account ban). */
function accountActions(status: AccountStatus): { label: string; next: AccountStatus; tone: string }[] {
  switch (status) {
    case 'active':
      return [
        { label: 'Suspend', next: 'suspended', tone: 'bg-orange-50 hover:bg-orange-100 text-orange-700' },
        { label: 'Ban', next: 'banned', tone: 'bg-red-50 hover:bg-red-100 text-red-700' },
      ];
    case 'suspended':
      return [
        { label: 'Reactivate', next: 'active', tone: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
        { label: 'Ban', next: 'banned', tone: 'bg-red-50 hover:bg-red-100 text-red-700' },
      ];
    case 'banned':
      return [{ label: 'Reactivate', next: 'active', tone: 'bg-emerald-600 hover:bg-emerald-700 text-white' }];
    default:
      return [];
  }
}

const STATUS_STYLES: Record<VerificationStatus, string> = {
  verified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  suspended: 'bg-orange-50 text-orange-700 border-orange-200',
  declined: 'bg-red-50 text-red-700 border-red-200',
};

const STATUS_FILTERS: { id: 'all' | VerificationStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'verified', label: 'Verified' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'declined', label: 'Declined' },
];

/** The buttons a TMO officer sees for a driver, based on their current status. */
function actionsFor(status: VerificationStatus): { label: string; next: VerificationStatus; tone: string }[] {
  switch (status) {
    case 'pending':
      return [
        { label: 'Approve', next: 'verified', tone: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
        { label: 'Decline', next: 'declined', tone: 'bg-red-50 hover:bg-red-100 text-red-700' },
      ];
    case 'verified':
      return [{ label: 'Suspend', next: 'suspended', tone: 'bg-orange-50 hover:bg-orange-100 text-orange-700' }];
    case 'suspended':
      return [
        { label: 'Reinstate', next: 'verified', tone: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
        { label: 'Decline', next: 'declined', tone: 'bg-red-50 hover:bg-red-100 text-red-700' },
      ];
    case 'declined':
      return [{ label: 'Approve', next: 'verified', tone: 'bg-emerald-600 hover:bg-emerald-700 text-white' }];
    default:
      return [];
  }
}

// One badge per rider: a banned/suspended account overrides the verification
// state, so we never show two conflicting statuses.
const BADGE_STYLES: Record<string, string> = {
  verified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  suspended: 'bg-orange-50 text-orange-700 border-orange-200',
  declined: 'bg-red-50 text-red-700 border-red-200',
  banned: 'bg-red-100 text-red-800 border-red-300',
};

function effectiveStatus(d: any): string {
  const acct = (d.account_status as string) ?? 'active';
  if (acct === 'banned') return 'banned';
  if (acct === 'suspended') return 'suspended';
  return (d.verification_status as string) ?? 'verified';
}

/** Older riders may not have first/last name stored — fall back to their full name. */
function firstNameOf(d: any): string {
  if (d.first_name) return d.first_name;
  return String(d.name ?? '').trim().split(/\s+/)[0] ?? '';
}
function lastNameOf(d: any): string {
  if (d.last_name) return d.last_name;
  const parts = String(d.name ?? '').trim().split(/\s+/);
  return parts.slice(1).join(' ');
}
function ageFrom(birthdate?: string | null): string {
  if (!birthdate) return '—';
  const d = new Date(birthdate + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return String(age);
}

/**
 * Retired vehicle types stay here on purpose.
 *
 * Only the pedicab can be registered now, but rows written before that still
 * say `habal_habal` or `multicab`, and this is an administrative record — a
 * screen whose job is to show what is actually in the database. Dropping the
 * old labels would print the raw enum at an officer reviewing a real rider's
 * file, which is worse than naming a vehicle the app no longer signs up.
 */
const VEHICLE_LABELS: Record<string, string> = {
  pedicab_standard: 'Pedicab',
  habal_habal: 'Motorcycle (Habal-Habal)',
  multicab: 'EasyRide (Multicab)',
};

/** One labelled field (with icon) in the profile's personal-details grid. */
const Detail: React.FC<{
  icon: React.ReactNode;
  label: string;
  value?: string | null;
  capitalize?: boolean;
  full?: boolean;
}> = ({ icon, label, value, capitalize, full }) => (
  <div className={`flex items-start gap-3 ${full ? 'sm:col-span-2' : ''}`}>
    <div className="mt-0.5 p-2 rounded-lg bg-blue-50 text-blue-600 shrink-0">{icon}</div>
    <div className="min-w-0">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-semibold text-gray-900 break-words ${capitalize ? 'capitalize' : ''}`}>
        {value || '—'}
      </p>
    </div>
  </div>
);

const OP_ICON: Record<string, React.ReactNode> = {
  Approve: <CheckCircle2 className="w-4 h-4" />,
  Reinstate: <RotateCcw className="w-4 h-4" />,
  Suspend: <PauseCircle className="w-4 h-4" />,
  Decline: <XCircle className="w-4 h-4" />,
};

export const DirectoryPage: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'drivers' | 'riders'>('drivers');
  const [drivers, setDrivers] = useState<any[]>([]);
  const [riders, setRiders] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | VerificationStatus>('all');
  const [isLoading, setIsLoading] = useState(true);

  // Profile Modal State
  const [selectedDriver, setSelectedDriver] = useState<any | null>(null);
  const [profileData, setProfileData] = useState<{ reports: any[] } | null>(null);
  // The modal overlay is anchored over the dashboard content panel (not the
  // whole screen) so the sidebar and filters stay visible and un-dimmed.
  const [contentBox, setContentBox] = useState<
    { left: number; top: number; width: number; height: number } | null
  >(null);

  useEffect(() => {
    if (!selectedDriver) return;
    const measure = () => {
      const el = document.getElementById('admin-main');
      if (!el) return setContentBox(null);
      const r = el.getBoundingClientRect();
      // Clamp to the visible viewport so a tall content panel can't push the
      // modal off-screen.
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
  }, [selectedDriver]);

  // Refetch the active list. Doesn't toggle the loading spinner so the 15s
  // auto-refresh never flashes the table.
  const fetchDirectory = useCallback(() => {
    if (activeSubTab === 'drivers') {
      adminApi
        .getAdminDrivers(search)
        .then(setDrivers)
        .catch((err) => console.error(err))
        .finally(() => setIsLoading(false));
    } else {
      adminApi
        .getAdminRiders(search)
        .then(setRiders)
        .catch((err) => console.error(err))
        .finally(() => setIsLoading(false));
    }
  }, [activeSubTab, search]);

  // Initial load + live auto-refresh.
  useEffect(() => {
    fetchDirectory();
    const id = setInterval(fetchDirectory, 15000);
    return () => clearInterval(id);
  }, [fetchDirectory]);

  const statusOf = (d: any): VerificationStatus =>
    (d.verification_status as VerificationStatus) ?? 'verified';

  const visibleDrivers =
    statusFilter === 'all' ? drivers : drivers.filter((d) => statusOf(d) === statusFilter);

  const pendingCount = drivers.filter((d) => statusOf(d) === 'pending').length;

  const handleSetStatus = async (driverId: string, next: VerificationStatus, name?: string) => {
    // Suspending or declining a rider blocks them from working — confirm first
    // so a stray click on the wrong profile can't wrongly punish someone.
    if (next === 'suspended' || next === 'declined') {
      const verb = next === 'suspended' ? 'suspend' : 'decline';
      if (!window.confirm(`Are you sure you want to ${verb} ${name ?? 'this rider'}?`)) return;
    }
    try {
      await adminApi.updateDriverVerification(driverId, next);
      setDrivers(drivers.map((d) => (d.id === driverId ? { ...d, verification_status: next } : d)));
      setSelectedDriver((cur: any) =>
        cur && cur.id === driverId ? { ...cur, verification_status: next } : cur
      );
    } catch (err: any) {
      alert(err.message || 'Failed to update rider status');
    }
  };

  // Account-level moderation (blocks login). Used by the passengers list and by
  // the rider profile's account-ban action. `userId` is the users-table id
  // (a passenger's id, or a rider's claimed_by).
  const accountOf = (x: any): AccountStatus => (x?.account_status as AccountStatus) ?? 'active';

  const handleAccountStatus = async (userId: string, name: string, next: AccountStatus) => {
    if (next !== 'active') {
      const verb = next === 'banned' ? 'ban' : 'suspend';
      if (
        !window.confirm(
          `Are you sure you want to ${verb} ${name}? They will be signed out and blocked from signing in.`
        )
      )
        return;
    }
    try {
      await updateUserStatus(userId, next);
      setRiders((list) => list.map((r) => (r.id === userId ? { ...r, account_status: next } : r)));
      setDrivers((list) => list.map((d) => (d.claimed_by === userId ? { ...d, account_status: next } : d)));
      setSelectedDriver((cur: any) =>
        cur && cur.claimed_by === userId ? { ...cur, account_status: next } : cur
      );
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to update account status');
    }
  };

  const handleOpenProfile = async (driver: any) => {
    setSelectedDriver(driver);
    setProfileData(null);
    try {
      const data = await adminApi.getDriverProfile(driver.id);
      // The profile endpoint returns the driver enriched with personal details.
      setSelectedDriver(data.driver);
      setProfileData({ reports: data.reports });
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Directory Sub-tab Header & Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-xl w-full sm:w-auto">
          <button
            onClick={() => setActiveSubTab('drivers')}
            className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition w-1/2 sm:w-auto ${
              activeSubTab === 'drivers' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <Bike className="w-4 h-4 text-amber-500" />
            Pedicab Drivers
          </button>
          <button
            onClick={() => setActiveSubTab('riders')}
            className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition w-1/2 sm:w-auto ${
              activeSubTab === 'riders' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <UserIcon className="w-4 h-4 text-blue-500" />
            Passengers
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users..."
            className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Verification status filter (drivers only) */}
      {activeSubTab === 'drivers' && (
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((f) => {
            const isActive = statusFilter === f.id;
            const showBadge = f.id === 'pending' && pendingCount > 0;
            return (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition ${
                  isActive
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {f.label}
                {showBadge && (
                  <span
                    className={`px-1.5 rounded-full text-[10px] font-black ${
                      isActive ? 'bg-white/25 text-white' : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Directory Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-xs font-bold text-gray-400 animate-pulse">Loading directory...</div>
        ) : activeSubTab === 'drivers' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider font-bold">
                <tr>
                  <th className="px-6 py-4">First Name</th>
                  <th className="px-6 py-4">Last Name</th>
                  <th className="px-6 py-4">Unit #</th>
                  <th className="px-6 py-4">Contact</th>
                  <th className="px-6 py-4 text-center">Declines</th>
                  <th className="px-6 py-4 text-center">Status</th>
                  <th className="px-6 py-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleDrivers.map((driver) => {
                  const eff = effectiveStatus(driver);
                  const declines = driver.decline_count ?? 0;
                  return (
                    <tr key={driver.id} className="hover:bg-gray-50 transition">
                      <td className="px-6 py-4 font-bold text-gray-900">{firstNameOf(driver)}</td>
                      <td className="px-6 py-4 font-bold text-gray-900">{lastNameOf(driver) || '—'}</td>
                      <td className="px-6 py-4 font-mono text-gray-600">{driver.unit_number}</td>
                      <td className="px-6 py-4 font-medium text-gray-600">{driver.contact_number ?? '—'}</td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`font-bold ${declines >= 10 ? 'text-red-600' : declines > 0 ? 'text-orange-600' : 'text-gray-400'}`}
                        >
                          {declines}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold capitalize border ${BADGE_STYLES[eff]}`}
                        >
                          {eff}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => handleOpenProfile(driver)}
                          className="px-3 py-1 bg-gray-100 text-gray-700 hover:bg-gray-200 font-bold text-xs rounded-lg transition"
                        >
                          View Profile
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {visibleDrivers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-xs font-bold text-gray-400">
                      No {statusFilter === 'all' ? '' : statusFilter} drivers found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider font-bold">
                <tr>
                  <th className="px-6 py-4">First Name</th>
                  <th className="px-6 py-4">Last Name</th>
                  <th className="px-6 py-4">Email</th>
                  <th className="px-6 py-4">Contact</th>
                  <th className="px-6 py-4 text-center">Cancellations</th>
                  <th className="px-6 py-4 text-center">Status</th>
                  <th className="px-6 py-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {riders.map((rider) => {
                  const acct = accountOf(rider);
                  const cancels = rider.passenger_cancellations ?? 0;
                  return (
                    <tr key={rider.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-bold text-gray-900">{firstNameOf(rider)}</td>
                      <td className="px-6 py-4 font-bold text-gray-900">{lastNameOf(rider) || '—'}</td>
                      <td className="px-6 py-4 font-medium text-gray-500">{rider.email ?? '—'}</td>
                      <td className="px-6 py-4 font-medium text-gray-600">{rider.contact_number ?? '—'}</td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`font-bold ${cancels >= 5 ? 'text-red-600' : cancels > 0 ? 'text-orange-600' : 'text-gray-400'}`}
                        >
                          {cancels}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold capitalize border ${ACCOUNT_BADGE[acct]}`}
                        >
                          {acct}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <ActionMenu
                          items={accountActions(acct).map(
                            (a): { label: string; tone: ActionTone; icon: React.ReactNode; onClick: () => void } => ({
                              label: a.label,
                              tone: a.next === 'banned' ? 'danger' : a.next === 'suspended' ? 'warning' : 'success',
                              icon:
                                a.next === 'banned' ? (
                                  <Ban className="w-4 h-4" />
                                ) : a.next === 'suspended' ? (
                                  <PauseCircle className="w-4 h-4" />
                                ) : (
                                  <RotateCcw className="w-4 h-4" />
                                ),
                              onClick: () => handleAccountStatus(rider.id, rider.name, a.next),
                            })
                          )}
                        />
                      </td>
                    </tr>
                  );
                })}
                {riders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-xs font-bold text-gray-400">
                      No passengers found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Driver Profile Modal — portaled to <body> so the transformed page
          ancestor (animate-fadeIn) can't offset the fixed overlay. */}
      {selectedDriver &&
        createPortal(
          <div
            className="fixed z-50 bg-slate-900/30 flex items-center justify-center p-4"
            style={
              contentBox
                ? {
                    left: contentBox.left,
                    top: contentBox.top,
                    width: contentBox.width,
                    height: contentBox.height,
                  }
                : { inset: 0 }
            }
            onClick={() => setSelectedDriver(null)}
          >
            <div
              className="bg-white rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-full animate-scaleUp"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header — neutral, with the operating-status actions on the right */}
              <div className="relative px-6 py-5 border-b border-gray-200">
                <button
                  onClick={() => setSelectedDriver(null)}
                  className="absolute top-3 right-3 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>

                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 md:pr-8">
                  {/* Left: identity */}
                  <div className="flex items-center gap-4 min-w-0">
                    {selectedDriver.avatar ? (
                      <img
                        src={selectedDriver.avatar}
                        alt={selectedDriver.name}
                        className="w-16 h-16 rounded-2xl object-cover ring-2 ring-gray-200 shrink-0"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-2xl bg-gray-100 ring-2 ring-gray-200 flex items-center justify-center text-gray-400 shrink-0">
                        <UserIcon className="w-8 h-8" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3 className="text-xl font-black text-gray-900 tracking-tight truncate">
                        {firstNameOf(selectedDriver)} {lastNameOf(selectedDriver)}
                      </h3>
                      <div className="flex items-center gap-1.5 text-gray-500 text-xs font-semibold mt-0.5">
                        <Bike className="w-3.5 h-3.5" />
                        <span className="truncate">
                          {VEHICLE_LABELS[selectedDriver.vehicle_type] ?? selectedDriver.vehicle_type} · Unit{' '}
                          {selectedDriver.unit_number}
                        </span>
                      </div>
                      <span
                        className={`inline-block mt-2 px-2.5 py-0.5 rounded-full text-[10px] font-bold capitalize border ${
                          BADGE_STYLES[effectiveStatus(selectedDriver)]
                        }`}
                      >
                        {effectiveStatus(selectedDriver)}
                      </span>
                    </div>
                  </div>

                  {/* Right: operating-status actions (compact dropdown, so they
                      don't crowd the rider's name/details). */}
                  <div className="shrink-0 flex items-center gap-2 self-start md:self-auto">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                      Operating Status
                    </span>
                    <ActionMenu
                      items={[
                        ...actionsFor(statusOf(selectedDriver)).map(
                          (a): ActionItem => ({
                            label: a.label,
                            tone:
                              a.next === 'verified'
                                ? 'success'
                                : a.next === 'declined'
                                ? 'danger'
                                : a.next === 'suspended'
                                ? 'warning'
                                : 'default',
                            icon: OP_ICON[a.label],
                            onClick: () => handleSetStatus(selectedDriver.id, a.next, selectedDriver.name),
                          })
                        ),
                        accountOf(selectedDriver) === 'banned'
                          ? {
                              label: 'Reactivate account',
                              tone: 'success',
                              icon: <RotateCcw className="w-4 h-4" />,
                              onClick: () =>
                                handleAccountStatus(selectedDriver.claimed_by, selectedDriver.name, 'active'),
                            }
                          : {
                              label: 'Ban account',
                              tone: 'danger',
                              icon: <Ban className="w-4 h-4" />,
                              onClick: () =>
                                handleAccountStatus(selectedDriver.claimed_by, selectedDriver.name, 'banned'),
                            },
                      ]}
                    />
                  </div>
                </div>
              </div>

              {/* Scrollable body */}
              <div className="overflow-y-auto px-6 py-5 space-y-6">
                <div>
                  <h4 className="font-bold text-xs text-gray-500 uppercase tracking-wider mb-3">Personal Details</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
                    <Detail icon={<Cake className="w-4 h-4" />} label="Age" value={ageFrom(selectedDriver.birthdate)} />
                    <Detail icon={<UserIcon className="w-4 h-4" />} label="Sex" value={selectedDriver.sex} capitalize />
                    <Detail icon={<Phone className="w-4 h-4" />} label="Contact" value={selectedDriver.contact_number} />
                    <Detail icon={<Mail className="w-4 h-4" />} label="Email" value={selectedDriver.email} />
                    <Detail icon={<MapPin className="w-4 h-4" />} label="Address" value={selectedDriver.address} full />
                  </div>
                </div>

                <div>
                  <h4 className="font-bold text-xs text-gray-500 uppercase tracking-wider mb-3">Complaint History</h4>
                  {profileData === null ? (
                    <p className="text-xs text-gray-400 font-medium animate-pulse">Loading…</p>
                  ) : profileData.reports.length ? (
                    <div className="space-y-2">
                      {profileData.reports.map((rep) => (
                        <div key={rep.id} className="p-3 bg-red-50 rounded-xl border border-red-100 text-xs">
                          <span className="font-bold text-red-800 capitalize">
                            {rep.violation_type.replace('_', ' ')}
                          </span>
                          <p className="text-gray-700 mt-1">{rep.details}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2.5">
                      <UserIcon className="w-4 h-4" />
                      Clean record — 0 complaints filed.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
