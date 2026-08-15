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
  Plus,
  Phone,
  KeyRound,
  Moon,
  Sun,
  Check,  Wallet,
} from 'lucide-react';
import * as api from '../api';
import type { Driver } from '../types';
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
  theme: 'light' | 'dark';
  onThemeChange: (theme: 'light' | 'dark') => void;
  /** Lets the rest of the app show the new number without a reload. */
  onContactChanged?: (contactNumber: string) => void;
  initialScreen?: MenuScreen;
  onScreenChange?: (screen: MenuScreen) => void;
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

/**
 * Payment methods, drawn as cards because that is the shape people already
 * recognise from GCash and their banking apps.
 *
 * Cash is the only one that actually settles today — GCash is arranged directly
 * with the driver, and nothing here is connected to a payment processor. The UI
 * says so rather than implying money moves through GentleTrike, which would be
 * a promise the app cannot keep.
 */
const WALLETS = [
  { key: 'gcash', name: 'GCash', tint: 'from-sky-500 to-blue-600', glyph: 'G' },
  { key: 'maya', name: 'Maya', tint: 'from-emerald-500 to-green-600', glyph: 'M' },
  { key: 'bank', name: 'Bank account', tint: 'from-gray-700 to-gray-900', glyph: '₱' },
];

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
  theme,
  onThemeChange,
  onContactChanged,
  initialScreen = 'root',
  onScreenChange,
}) => {
  const [screen, setScreen] = React.useState<MenuScreen>(initialScreen);

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
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 transition active:scale-95"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <h1 className="text-lg font-bold tracking-tight text-gray-900">{title}</h1>
    </div>
  );

  if (screen === 'history') {
    return (
      <div className="space-y-2.5 pb-2">
        <Header title="Trip History" />
        {isLoading && <p className="py-6 text-center text-xs font-semibold text-gray-400">Loading…</p>}
        {!isLoading && history.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center">
            <p className="text-sm font-semibold text-gray-900">No finished trips yet</p>
          </div>
        )}
        {history.map((ride) => (
          <div key={ride.id} className="rounded-2xl border border-gray-200 bg-white p-3.5">
            <div className="flex items-start gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-sm">
                🛺
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-gray-900">
                  {ride.pickupLocation.name}
                </p>
                <p className="truncate text-xs font-semibold text-amber-700">
                  → {ride.dropoffLocation.name}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-gray-400">
                  {formatWhen(ride.createdAt)} · {ride.distanceKm} km ·{' '}
                  {ride.role === 'driver' ? 'you drove' : 'you rode'}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold text-gray-900">₱{ride.totalFare}</p>
                <p
                  className={`text-[10px] font-semibold uppercase ${
                    ride.status === 'completed' ? 'text-emerald-600' : 'text-gray-400'
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
        {isLoading && <p className="py-6 text-center text-xs font-semibold text-gray-400">Loading…</p>}
        {!isLoading && reports.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center">
            <p className="text-sm font-semibold text-gray-900">No reports filed</p>
            <p className="mt-1 text-xs text-gray-500">
              If a fare is wrong, report it — you can track it here.
            </p>
          </div>
        )}
        {reports.map((report) => {
          const status = REPORT_STATUS[report.status] ?? REPORT_STATUS.pending;
          return (
            <div key={report.referenceCode} className="rounded-2xl border border-gray-200 bg-white p-3.5">
              <div className="mb-1.5 flex items-center gap-2">
                <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${status.className}`}>
                  {status.label}
                </span>
                <span className="ml-auto font-mono text-[10px] text-gray-400">
                  {report.referenceCode}
                </span>
              </div>
              <p className="text-xs font-semibold capitalize text-gray-900">
                {report.violationType.replace(/_/g, ' ')}
              </p>
              {report.details && (
                <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-500">{report.details}</p>
              )}
              <p className="mt-1 text-[10px] text-gray-400">Filed {formatWhen(report.createdAt)}</p>
              {report.adminNotes && (
                <p className="mt-2 rounded-xl bg-gray-50 p-2.5 text-[11px] text-gray-700">
                  <span className="font-semibold text-gray-900">TMO: </span>
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
    /*
     * A ledger, not a wallet.
     *
     * This screen was four payment-method cards — Cash, GCash, Maya — drawn as
     * gradient credit cards with masked digits, none of them connected to
     * anything. It looked like an account page and was a mock, and for a rider
     * it answered a question nobody has: they do not choose how they are paid,
     * the passenger does.
     *
     * What both sides actually want is the record. Every completed trip already
     * carries its fare and how it settled, so this reads that back: what came in
     * or went out, by method, with the trips that make up the total. Nothing on
     * this page is invented — remove a trip and the figure changes.
     */
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

        {/* The total first, because it is the answer to why anyone opened this. */}
        <div className="rounded-2xl bg-gray-900 p-5 text-white shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">
            {inbound ? 'Received, all time' : 'Paid, all time'}
          </p>
          <p className="mt-1 text-4xl font-bold leading-none tracking-tight text-amber-400 tabular-nums">
            ₱{grandTotal}
          </p>
          <p className="mt-2 text-[11px] font-semibold text-gray-400 tabular-nums">
            across {settled.length} completed trip{settled.length === 1 ? '' : 's'}
          </p>
        </div>

        {Object.keys(byMethod).length > 0 && (
          <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
            {Object.entries(byMethod).map(([method, m]) => (
              <div key={method} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-100">
                  {method === 'cash' ? (
                    <Wallet className="h-4 w-4 text-gray-500" />
                  ) : (
                    <CreditCard className="h-4 w-4 text-gray-500" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900">
                    {METHOD_LABEL[method] ?? method}
                  </p>
                  <p className="text-[11px] font-medium text-gray-500 tabular-nums">
                    {m.count} trip{m.count === 1 ? '' : 's'}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-bold text-gray-900 tabular-nums">₱{m.total}</p>
              </div>
            ))}
          </div>
        )}

        <p className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Recent
        </p>

        {settled.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-10 text-center">
            <p className="text-sm font-semibold text-gray-900">Nothing settled yet</p>
            <p className="mx-auto mt-1 max-w-xs text-[11px] font-medium text-gray-500">
              {inbound
                ? 'Fares appear here as you complete trips.'
                : 'Your trip payments appear here once a ride is finished.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
            {settled.slice(0, 12).map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">
                    {r.dropoffLocation.name}
                  </p>
                  <p className="truncate text-[11px] font-medium text-gray-500">
                    {formatWhen(r.createdAt)} · {METHOD_LABEL[r.paymentMethod ?? 'cash'] ?? r.paymentMethod}
                  </p>
                </div>
                <p
                  className={`shrink-0 text-sm font-bold tabular-nums ${
                    inbound ? 'text-emerald-600' : 'text-gray-900'
                  }`}
                >
                  {inbound ? '+' : ''}₱{r.totalFare}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Said plainly, because a ledger implies a processor behind it. */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold text-gray-900">Cash settles in person</p>
          <p className="mt-1 text-[11px] text-gray-500">
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

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <p className="border-b border-gray-100 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Appearance
          </p>
          <div className="flex gap-2 p-3">
            {(['light', 'dark'] as const).map((option) => (
              <button
                key={option}
                onClick={() => onThemeChange(option)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-xs font-semibold transition ${
                  theme === option
                    ? 'bg-gray-900 text-white'
                    : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {option === 'light' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {option === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>

        {saved && (
          <p className="rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800">
            {saved}
          </p>
        )}

        <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <p className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
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
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-amber-400"
              />
              {formError && <p className="text-[11px] font-semibold text-rose-600">{formError}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={closeForm} className="h-10 flex-1 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600">Cancel</button>
                <button onClick={submitContact} disabled={saving} className="h-10 flex-1 rounded-xl bg-gray-900 text-xs font-semibold text-amber-400 disabled:opacity-50">
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
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-gray-50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-500">
                <Phone className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-gray-900">
                  Change contact number
                </span>
                <span className="block truncate text-[11px] text-gray-400">
                  {user.contact_number || 'Not set'}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
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
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-amber-400"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 8 characters)"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-amber-400"
              />
              {formError && <p className="text-[11px] font-semibold text-rose-600">{formError}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={closeForm} className="h-10 flex-1 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600">Cancel</button>
                <button onClick={submitPassword} disabled={saving} className="h-10 flex-1 rounded-xl bg-gray-900 text-xs font-semibold text-amber-400 disabled:opacity-50">
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
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-gray-50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-500">
                <KeyRound className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-gray-900">Change password</span>
                <span className="block truncate text-[11px] text-gray-400">
                  Requires your current password
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
            </button>
          )}
        </div>

        {canUseRiderMode && (
          <button
            onClick={onToggleDriverMode}
            className="flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left transition active:scale-[0.99]"
          >
            <UserCheck className="h-5 w-5 shrink-0 text-amber-600" />
            <span className="flex-1 text-sm font-semibold text-gray-900">
              {isDriverMode ? 'Switch to Passenger' : 'Switch to Rider Mode'}
            </span>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>
        )}

        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold text-gray-900">Location</p>
          <p className="mt-1 text-[11px] text-gray-500">
            GentleTrike uses your device location to set your pickup and to measure how far
            riders are. It is granted through your browser and can be revoked there.
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
      {/* Identity, with the number instead of a role the user already knows. */}
      <div className="gt-rise flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-yellow-400 text-base font-bold text-gray-900">
          {user.name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-gray-900">{user.name}</p>
          <p className="truncate text-[11px] text-gray-500">
            {user.contact_number || 'No contact number on file'}
            {driver ? ` · ${driver.unitNumber}` : ''}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {items.map(({ key, label, icon: Icon, hint }, index) => (
          <button
            key={key}
            onClick={() => go(key)}
            style={{ animationDelay: `${110 + index * 40}ms` }}
            className="gt-rise group flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md active:scale-[0.99]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-500 transition-colors group-hover:bg-yellow-400 group-hover:text-gray-900">
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-900">{label}</span>
              <span className="block truncate text-[11px] text-gray-400">{hint}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-amber-500" />
          </button>
        ))}
      </div>

      {/* At the root, where people look for it. */}
      <button
        onClick={onLogout}
        style={{ animationDelay: '280ms' }}
        className="gt-rise flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-rose-200 hover:bg-rose-50 hover:shadow-md active:scale-[0.99]"
      >
        <LogOut className="h-5 w-5 shrink-0 text-rose-500" />
        <span className="flex-1 text-sm font-semibold text-rose-600">Sign out</span>
      </button>
    </div>
  );
};
