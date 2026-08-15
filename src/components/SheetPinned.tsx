import React from 'react';
import {
  MapPin,
  CheckCircle,
  Power,
  Radar,
  Navigation,
  MessageSquare,
  Phone,
} from 'lucide-react';
import type { Driver, RideBooking } from '../types';
import { NEXT_STAGE } from './DriverModePanel';
import { useRouteOrderedRides } from '../hooks/useRouteOrderedRides';

/**
 * The row that never scrolls.
 *
 * A rider driving through Dumaguete should be able to glance at the phone and
 * see the road plus the one button they need, without touching the sheet. That
 * is the whole reason this slot exists: the same action is further down inside
 * DriverModePanel, but "further down" is exactly the problem.
 */

interface DriverPinnedProps {
  driver: Driver;
  acceptedPooledRides: RideBooking[];
  pendingRequestCount: number;
  onAdvanceRideStatus: (rideId: string, status: RideBooking['status']) => void;
  onExpand: () => void;
  /** Opens the thread as a full overlay — no scrolling to reach it. */
  onOpenChat: (rideId: string) => void;
  /** Unread count per ride, so a waiting question is visible without opening. */
  unread?: Record<string, number>;
}

export const DriverPinned: React.FC<DriverPinnedProps> = ({
  driver,
  acceptedPooledRides,
  pendingRequestCount,
  onAdvanceRideStatus,
  onExpand,
  onOpenChat,
  unread = {},
}) => {
  const ordered = useRouteOrderedRides(driver, acceptedPooledRides);
  const next = ordered[0];

  if (!driver.isOnline) {
    return (
      <button
        onClick={onExpand}
        className="flex w-full items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-left transition active:scale-[0.99]"
      >
        <Power className="h-5 w-5 shrink-0 text-rose-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-rose-950">You are OFFLINE</p>
          <p className="truncate text-[11px] font-medium text-rose-800">
            Tap to go online and start receiving trips
          </p>
        </div>
      </button>
    );
  }

  // Online with nothing accepted: the useful signal is whether anything is
  // waiting, not a button, so this row reports and invites rather than acts.
  if (!next) {
    return (
      <button
        onClick={onExpand}
        className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3 text-left transition active:scale-[0.99]"
      >
        <Radar className="h-5 w-5 shrink-0 animate-pulse text-emerald-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">
            {pendingRequestCount > 0
              ? `${pendingRequestCount} request${pendingRequestCount > 1 ? 's' : ''} waiting`
              : 'Online — searching for passengers'}
          </p>
          <p className="truncate text-[11px] font-medium text-gray-500">
            ₱{driver.earningsToday ?? 0} today · {driver.tripsToday ?? 0} trips
          </p>
        </div>
      </button>
    );
  }

  const stage = NEXT_STAGE[next.status];

  return (
    <div className="space-y-2">
      <button
        onClick={onExpand}
        className="flex w-full items-center gap-2 text-left"
        aria-label="Expand trip details"
      >
        <Navigation className="h-3.5 w-3.5 shrink-0 text-amber-600" />
        <p className="min-w-0 flex-1 truncate text-[11px] font-bold text-gray-600">
          {next.status === 'in_transit' ? 'Dropping off' : 'Next pickup'} ·{' '}
          <span className="text-gray-900">
            {next.status === 'in_transit'
              ? next.dropoffLocation.name
              : next.pickupLocation.name}
          </span>
          {next.passengerName ? ` · ${next.passengerName}` : ''}
        </p>
        {acceptedPooledRides.length > 1 && (
          <span className="shrink-0 rounded-md bg-gray-900 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
            +{acceptedPooledRides.length - 1}
          </span>
        )}
      </button>

      <div className="flex gap-2">
        {stage && (
          <button
            onClick={() => onAdvanceRideStatus(next.id, stage.status)}
            className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-400 px-3 text-sm font-semibold text-gray-900 shadow-sm transition active:scale-95 hover:bg-amber-300"
          >
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="truncate">{stage.label}</span>
          </button>
        )}
        <button
          onClick={() => onAdvanceRideStatus(next.id, 'completed')}
          className={`flex h-12 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-white shadow-sm transition active:scale-95 hover:bg-emerald-600 ${
            stage ? 'shrink-0' : 'flex-1'
          }`}
        >
          <CheckCircle className="h-4 w-4 shrink-0" />
          <span>₱{next.totalFare}</span>
        </button>
      </div>

      {/* Reaching the passenger is half the job — "I'm at the corner, where are
          you?" Both live here rather than inside the queue below, because a
          rider looking for them is a rider scrolling while driving. */}
      <div className="flex gap-2">
        <button
          onClick={() => onOpenChat(next.id)}
          className="relative flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 text-xs font-bold text-gray-700 transition active:scale-95 hover:bg-gray-100"
        >
          <MessageSquare className="h-4 w-4" />
          Message
          {(unread[next.id] ?? 0) > 0 && (
            <span className="absolute right-2 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
              {unread[next.id]}
            </span>
          )}
        </button>

        {/* Calling needs a number, and riders often sign up without one, so the
            button is disabled rather than dialling nothing. */}
        {next.passengerPhone ? (
          <a
            href={`tel:${next.passengerPhone}`}
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 text-xs font-bold text-gray-700 transition active:scale-95 hover:bg-gray-100"
          >
            <Phone className="h-4 w-4" />
            Call
          </a>
        ) : (
          <span
            title="This passenger has no contact number on file"
            className="flex h-10 flex-1 cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-gray-100 bg-gray-50 text-xs font-bold text-gray-300"
          >
            <Phone className="h-4 w-4" />
            Call
          </span>
        )}
      </div>
    </div>
  );
};
