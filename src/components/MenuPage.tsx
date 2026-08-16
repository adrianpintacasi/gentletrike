import React from 'react';
import {
  ArrowLeft,
  ChevronRight,
  History,
  FileText,
  Settings,
  LogOut,
  UserCheck,
  CreditCard,
  Phone,
  KeyRound,
  Wallet,
} from 'lucide-react';
import * as api from '../api';
import type { Driver } from '../types';
import { vehicleDetail } from '../../shared/transport';
import type { HistoryRide, MyReport, TodayTotals } from '../api';

/**
 * The Menu, and the pages behind it.
 *
 * Sign out sits at the root, not inside Settings: it is the one action people
 * come to a menu looking for, and burying it a level down is how a menu starts
 * hiding the thing it exists to offer.
 *
 * There is no Details page. The card at the top already carries who you are and
 * how to reach you; a page repeating it was a second door to the same room.
 */

type MenuScreen = 'root' | 'history' | 'reports' | 'transactions' | 'settings';

interface MenuPageProps {
  user: { name: string; role: 'passenger' | 'rider' | 'admin'; contact_number?: string };
  driver: Driver | null;
  today: TodayTotals | null;
  history: HistoryRide[];
  reports: MyReport[];
  isLoading: boolean;
  canUseRiderMode: boolean;
  isDriverMode: boolean;
  onToggleDriverMode: () => void;
  onLogout: () => void;
  /** Lets the rest of the app show the new number without a reload. */
  onContactChanged?: (contactNumber: string) => void;
  initialScreen?: MenuScreen;
  onScreenChange?: (screen: MenuScreen) => void;
  /** Returns to the map/home view when invoked */
  onBackToHome?: () => void;
  /**
   * The rider's figures for today, rendered by the caller.
   *
   * They belong here rather than on the Drive tab: worth knowing, not worth the
   * top third of the screen a rider reads while deciding whether to take a trip.
   */
  riderToday?: React.ReactNode;
  /** Sets how many this rider's own unit seats. Omit to hide the control. */
  onSeatCapacityChange?: (seats: number) => void;
}

const formatWhen = (iso: string) => {
  const date = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const REPORT_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending review', className: 'bg-amber-100 text-amber-900' },
  reviewing: { label: 'Under review', className: 'bg-blue-100 text-blue-900' },
  resolved: { label: 'Resolved', className: 'bg-emerald-100 text-emerald-900' },
  dismissed: { label: 'Dismissed', className: 'bg-gray-200 text-gray-700' },
};

export const MenuPage: React.FC<MenuPageProps> = ({
  user,
  driver,
  today,
  history,
  reports,
  isLoading,
  canUseRiderMode,
  isDriverMode,
  onToggleDriverMode,
  onLogout,
  onContactChanged,
  initialScreen = 'root',
  onScreenChange,
  onBackToHome,
  riderToday,
  onSeatCapacityChange,
}) => {
  const [screen, setScreen] = React.useState<MenuScreen>(initialScreen);

  // The class ceiling is the franchise limit; the rider picks within it.
  const seatCeiling = driver ? vehicleDetail(driver.vehicleType).maxPassengers : 0;
  const currentSeats = driver?.seatCapacity ?? seatCeiling;

  /** Which account form is open, if any. Only one at a time. */
  const [editing, setEditing] = React.useState<'contact' | 'password' | null>(null);
  const [contact, setContact] = React.useState(user.contact_number ?? '');
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);

  const closeForm = () => {
    setEditing(null);
    setFormError(null);
    setCurrentPassword('');
    setNewPassword('');
  };

  const submitContact = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const updated = await api.updateContactNumber(contact);
      onContactChanged?.(updated.contact_number ?? contact);
      setSaved('Contact number updated.');
      closeForm();
    } catch (err) {
      setFormError(err instanceof api.ApiError ? err.message : 'Could not save that number.');
    } finally {
      setSaving(false);
    }
  };

  const submitPassword = async () => {
    setSaving(true);
    setFormError(null);
    try {
      await api.changePassword(currentPassword, newPassword);
      setSaved('Password changed.');
      closeForm();
    } catch (err) {
      setFormError(err instanceof api.ApiError ? err.message : 'Could not change the password.');
    } finally {
      setSaving(false);
    }
  };

  React.useEffect(() => setScreen(initialScreen), [initialScreen]);

  const go = (next: MenuScreen) => {
    setScreen(next);
    onScreenChange?.(next);
  };

  const Header: React.FC<{ title: string }> = ({ title }) => (
    <div className="mb-3 flex items-center gap-2">
      <button
        onClick={() => go('root')}
        aria-label="Back to menu"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cream-300 bg-cream-50 text-trust-slate transition active:scale-95 hover:bg-cream-200 shadow-xs"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <h1 className="text-lg font-display font-bold tracking-tight text-trust-slate">{title}</h1>
    </div>
  );

  if (screen === 'history') {
    return (
      <div className="space-y-2.5 pb-2">
        <Header title="Trip History" />
        {isLoading && <p className="py-6 text-center text-xs font-sans font-semibold text-cream-400">Loading…</p>}
        {!isLoading && history.length === 0 && (
          <div className="rounded-card border border-dashed border-cream-300 bg-cream-100 p-8 text-center">
            <p className="text-sm font-display font-semibold text-trust-slate">No finished trips yet</p>
          </div>
        )}
        {history.map((ride) => (
          <div key={ride.id} className="rounded-card border border-cream-300 bg-cream-50 p-3.5 shadow-xs">
            <div className="flex items-start gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-cream-200 text-sm">
                🛺
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-display font-bold text-trust-slate">
                  {ride.pickupLocation.name}
                </p>
                <p className="truncate text-xs font-display font-bold text-trike-gold">
                  → {ride.dropoffLocation.name}
                </p>
                <p className="mt-0.5 truncate text-[11px] font-sans text-cream-600">
                  {formatWhen(ride.createdAt)} · {ride.distanceKm} km ·{' '}
                  {ride.role === 'driver' ? 'you drove' : 'you rode'}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-display font-extrabold text-trust-slate">₱{ride.totalFare}</p>
                <p
                  className={`text-[10px] font-sans font-bold uppercase ${
                    ride.status === 'completed' ? 'text-sampaguita-green' : 'text-cream-500'
                  }`}
                >
                  {ride.status === 'completed' ? 'Completed' : 'Cancelled'}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (screen === 'reports') {
    return (
      <div className="space-y-2.5 pb-2">
        <Header title="Report Status" />
        {isLoading && <p className="py-6 text-center text-xs font-sans font-semibold text-cream-400">Loading…</p>}
        {!isLoading && reports.length === 0 && (
          <div className="rounded-card border border-dashed border-cream-300 bg-cream-100 p-8 text-center">
            <p className="text-sm font-display font-semibold text-trust-slate">No reports filed</p>
            <p className="mt-1 text-xs font-sans text-cream-600">
              If a fare is wrong, report it — you can track it here.
            </p>
          </div>
        )}
        {reports.map((report) => {
          const status = REPORT_STATUS[report.status] ?? REPORT_STATUS.pending;
          return (
            <div key={report.referenceCode} className="rounded-card border border-cream-300 bg-cream-50 p-3.5 shadow-xs">
              <div className="mb-1.5 flex items-center gap-2">
                <span className={`rounded-pill px-2.5 py-0.5 text-[10px] font-sans font-bold uppercase ${status.className}`}>
                  {status.label}
                </span>
                <span className="ml-auto font-mono text-[10px] text-cream-500">
                  {report.referenceCode}
                </span>
              </div>
              <p className="text-xs font-display font-bold capitalize text-trust-slate">
                {report.violationType.replace(/_/g, ' ')}
              </p>
              {report.details && (
                <p className="mt-0.5 line-clamp-2 text-[11px] font-sans text-cream-600">{report.details}</p>
              )}
              <p className="mt-1 text-[10px] font-sans text-cream-400">Filed {formatWhen(report.createdAt)}</p>
              {report.adminNotes && (
                <p className="mt-2 rounded-card bg-cream-100 border border-cream-300 p-2.5 text-[11px] font-sans text-trust-slate">
                  <span className="font-display font-bold text-trust-slate">TMO: </span>
                  {report.adminNotes}
                </p>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  if (screen === 'transactions') {
    const settled = history.filter((r) => r.status === 'completed');
    const byMethod: Record<string, { count: number; total: number }> = {};
    for (const r of settled) {
      const key = r.paymentMethod ?? 'cash';
      if (!byMethod[key]) byMethod[key] = { count: 0, total: 0 };
      byMethod[key].count += 1;
      byMethod[key].total += r.totalFare ?? 0;
    }
    const grandTotal = settled.reduce((sum, r) => sum + (r.totalFare ?? 0), 0);
    const inbound = isDriverMode;

    const METHOD_LABEL: Record<string, string> = {
      cash: 'Cash',
      gcash: 'GCash',
      card: 'Card',
    };

    return (
      <div className="space-y-3 pb-2">
        <Header title="Transactions" />

        <div className="rounded-card bg-trust-slate p-5 text-cream-50 shadow-md border border-cream-400/20">
          <p className="kicker-label text-cream-300">
            {inbound ? 'Received, all time' : 'Paid, all time'}
          </p>
          <p className="mt-1 text-4xl font-display font-extrabold leading-none tracking-tight text-trike-gold tabular-nums">
            ₱{grandTotal}
          </p>
          <p className="mt-2 text-[11px] font-sans font-semibold text-cream-300 tabular-nums">
            across {settled.length} completed trip{settled.length === 1 ? '' : 's'}
          </p>
        </div>

        {Object.keys(byMethod).length > 0 && (
          <div className="divide-y divide-cream-200 overflow-hidden rounded-card border border-cream-300 bg-cream-50 shadow-xs">
            {Object.entries(byMethod).map(([method, m]) => (
              <div key={method} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-cream-200">
                  {method === 'cash' ? (
                    <Wallet className="h-4 w-4 text-trust-slate" />
                  ) : (
                    <CreditCard className="h-4 w-4 text-trust-slate" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-display font-bold text-trust-slate">
                    {METHOD_LABEL[method] ?? method}
                  </p>
                  <p className="text-[11px] font-sans font-medium text-cream-600 tabular-nums">
                    {m.count} trip{m.count === 1 ? '' : 's'}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-display font-extrabold text-trust-slate tabular-nums">₱{m.total}</p>
              </div>
            ))}
          </div>
        )}

        <p className="kicker-label px-1 pt-1">
          Recent
        </p>

        {settled.length === 0 ? (
          <div className="rounded-card border border-dashed border-cream-300 bg-cream-100 px-4 py-10 text-center">
            <p className="text-sm font-display font-semibold text-trust-slate">Nothing settled yet</p>
            <p className="mx-auto mt-1 max-w-xs text-[11px] font-sans font-medium text-cream-600">
              {inbound
                ? 'Fares appear here as you complete trips.'
                : 'Your trip payments appear here once a ride is finished.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-cream-200 overflow-hidden rounded-card border border-cream-300 bg-cream-50 shadow-xs">
            {settled.slice(0, 12).map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-display font-bold text-trust-slate">
                    {r.dropoffLocation.name}
                  </p>
                  <p className="truncate text-[11px] font-sans font-medium text-cream-600">
                    {formatWhen(r.createdAt)} · {METHOD_LABEL[r.paymentMethod ?? 'cash'] ?? r.paymentMethod}
                  </p>
                </div>
                <p
                  className={`shrink-0 text-sm font-display font-extrabold tabular-nums ${
                    inbound ? 'text-sampaguita-green' : 'text-trust-slate'
                  }`}
                >
                  {inbound ? '+' : ''}₱{r.totalFare}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-card border border-cream-300 bg-cream-50 p-4 shadow-xs">
          <p className="text-xs font-display font-bold text-trust-slate">Cash settles in person</p>
          <p className="mt-1 text-[11px] font-sans text-cream-600">
            GentleTrike records what a trip cost and how it was paid; it does not move the
            money. Online and card settlement needs a payment provider the app is not
            connected to yet, so every figure here is a record of a cash fare
            {inbound ? ' you collected' : ' you handed over'} at the end of a trip.
          </p>
        </div>
      </div>
    );
  }

  if (screen === 'settings') {
    return (
      <div className="space-y-3 pb-2">
        <Header title="Settings" />

        {driver && onSeatCapacityChange && (
          <div className="overflow-hidden rounded-card border border-cream-300 bg-cream-50 shadow-xs">
            <p className="kicker-label border-b border-cream-300 px-4 py-2.5">
              Seats in your unit
            </p>
            <div className="flex flex-wrap gap-2 p-3">
              {Array.from({ length: seatCeiling }, (_, i) => i + 1).map((n) => {
                const active = currentSeats === n;
                return (
                  <button
                    key={n}
                    onClick={() => onSeatCapacityChange(n)}
                    aria-pressed={active}
                    className={`h-12 min-w-12 flex-1 rounded-card text-sm font-display font-bold tabular-nums transition active:scale-95 ${
                      active
                        ? 'bg-trike-gold text-trust-slate shadow-xs'
                        : 'border border-cream-300 bg-cream-100 text-cream-700 hover:bg-cream-200'
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <p className="border-t border-cream-300 px-4 py-2.5 text-[11px] font-sans font-medium text-cream-600">
              Dispatch will not offer you a party larger than this, and a trip that
              would overfill the trike is never sent. The maximum for a{' '}
              {vehicleDetail(driver.vehicleType).title.toLowerCase()} is {seatCeiling}.
            </p>
          </div>
        )}

        {saved && (
          <p className="rounded-card bg-sampaguita-green/15 border border-sampaguita-green/30 px-3 py-2 text-[11px] font-sans font-bold text-sampaguita-green">
            {saved}
          </p>
        )}

        <div className="divide-y divide-cream-200 overflow-hidden rounded-card border border-cream-300 bg-cream-50 shadow-xs">
          <p className="kicker-label px-4 py-2.5">
            Account
          </p>

          {editing === 'contact' ? (
            <div className="space-y-2 p-4">
              <input
                autoFocus
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                inputMode="tel"
                placeholder="Contact number"
                className="w-full rounded-card border border-cream-300 bg-cream-50 px-3 py-2.5 text-sm font-sans text-trust-slate outline-none focus:border-trike-gold"
              />
              {formError && <p className="text-[11px] font-sans font-bold text-sunset-coral">{formError}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={closeForm} className="h-10 flex-1 rounded-pill border border-cream-300 text-xs font-display font-semibold text-cream-700 hover:bg-cream-200">Cancel</button>
                <button onClick={submitContact} disabled={saving} className="btn-primary h-10 flex-1 text-xs font-display font-bold shadow-xs disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                setEditing('contact');
                setSaved(null);
              }}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-cream-100"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-cream-200 text-trust-slate">
                <Phone className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-display font-bold text-trust-slate">
                  Change contact number
                </span>
                <span className="block truncate text-[11px] font-sans text-cream-600">
                  {user.contact_number || 'Not set'}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-cream-400" />
            </button>
          )}

          {editing === 'password' ? (
            <div className="space-y-2 p-4">
              <input
                autoFocus
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
                className="w-full rounded-card border border-cream-300 bg-cream-50 px-3 py-2.5 text-sm font-sans text-trust-slate outline-none focus:border-trike-gold"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 8 characters)"
                className="w-full rounded-card border border-cream-300 bg-cream-50 px-3 py-2.5 text-sm font-sans text-trust-slate outline-none focus:border-trike-gold"
              />
              {formError && <p className="text-[11px] font-sans font-bold text-sunset-coral">{formError}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={closeForm} className="h-10 flex-1 rounded-pill border border-cream-300 text-xs font-display font-semibold text-cream-700 hover:bg-cream-200">Cancel</button>
                <button onClick={submitPassword} disabled={saving} className="btn-primary h-10 flex-1 text-xs font-display font-bold shadow-xs disabled:opacity-50">
                  {saving ? 'Saving...' : 'Change'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                setEditing('password');
                setSaved(null);
              }}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-cream-100"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-cream-200 text-trust-slate">
                <KeyRound className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-display font-bold text-trust-slate">Change password</span>
                <span className="block truncate text-[11px] font-sans text-cream-600">
                  Requires your current password
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-cream-400" />
            </button>
          )}
        </div>

        {canUseRiderMode && (
          <button
            onClick={onToggleDriverMode}
            className="flex w-full items-center gap-3 rounded-card border border-cream-300 bg-cream-50 p-4 text-left transition hover:bg-cream-100 shadow-xs active:scale-[0.99]"
          >
            <UserCheck className="h-5 w-5 shrink-0 text-trike-gold" />
            <span className="flex-1 text-sm font-display font-bold text-trust-slate">
              {isDriverMode ? 'Switch to Passenger Mode' : 'Switch to Driver Mode'}
            </span>
            <ChevronRight className="h-4 w-4 text-cream-400" />
          </button>
        )}

        <div className="rounded-card border border-cream-300 bg-cream-50 p-4 shadow-xs">
          <p className="text-xs font-display font-bold text-trust-slate">Location</p>
          <p className="mt-1 text-[11px] font-sans text-cream-600">
            GentleTrike uses your device location to set your pickup and to measure how far
            drivers are. It is granted through your browser and can be revoked there.
          </p>
        </div>
      </div>
    );
  }

  const items = [
    { key: 'history' as const, label: 'Trip History', icon: History, hint: `${history.length} finished` },
    { key: 'reports' as const, label: 'Report Status', icon: FileText, hint: `${reports.length} filed` },
    {
      key: 'transactions' as const,
      label: 'Transactions',
      icon: CreditCard,
      hint: `${history.filter((r) => r.status === 'completed').length} settled`,
    },
    { key: 'settings' as const, label: 'Settings', icon: Settings, hint: 'Appearance, account, mode' },
  ];

  return (
    <div className="space-y-3 pb-2">
      {/* Identity card */}
      <div className="gt-rise flex items-center gap-3 rounded-card border border-cream-300 bg-cream-50 p-4 shadow-xs">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-card bg-trike-gold text-base font-display font-extrabold text-trust-slate shadow-xs">
          {user.name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-display font-bold text-trust-slate">{user.name}</p>
          <p className="truncate text-[11px] font-sans text-cream-600">
            {user.contact_number || 'No contact number on file'}
            {driver ? ` · ${driver.unitNumber}` : ''}
          </p>
        </div>
      </div>

      {/* A rider's day, moved off the Drive tab */}
      {riderToday && <div className="gt-rise" style={{ animationDelay: '60ms' }}>{riderToday}</div>}

      <div className="space-y-2">
        {items.map(({ key, label, icon: Icon, hint }, index) => (
          <button
            key={key}
            onClick={() => go(key)}
            style={{ animationDelay: `${110 + index * 40}ms` }}
            className="gt-rise group flex w-full items-center gap-3 rounded-card border border-cream-300 bg-cream-50 px-4 py-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-trike-gold hover:shadow-md active:scale-[0.99]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-cream-200 text-trust-slate transition-colors group-hover:bg-trike-gold group-hover:text-trust-slate">
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-display font-bold text-trust-slate">{label}</span>
              <span className="block truncate text-[11px] font-sans text-cream-600">{hint}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-cream-400 transition-transform group-hover:translate-x-0.5 group-hover:text-trike-gold" />
          </button>
        ))}
      </div>

      {/* At the root, where people look for it */}
      <button
        onClick={onLogout}
        style={{ animationDelay: '280ms' }}
        className="gt-rise flex w-full items-center gap-3 rounded-card border border-sunset-coral/30 bg-cream-50 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-sunset-coral hover:bg-sunset-coral/10 hover:shadow-md active:scale-[0.99]"
      >
        <LogOut className="h-5 w-5 shrink-0 text-sunset-coral" />
        <span className="flex-1 text-sm font-display font-bold text-sunset-coral">Sign out</span>
      </button>
    </div>
  );
};
