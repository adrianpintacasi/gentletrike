import React from 'react';
import { CheckCircle, Radar, Navigation, MessageSquare, Phone } from 'lucide-react';
import type { Driver, RideBooking } from '../types';
import { NEXT_STAGE } from './DriverModePanel';
import { useRouteOrderedRides } from '../hooks/useRouteOrderedRides';

/**
 * The row that never scrolls.
 *
 * A rider should be able to glance at the phone and see the road plus the one
 * button they need, without touching the sheet. That is the whole reason this
 * slot exists — the same actions live inside DriverModePanel, and "further
 * down" is exactly the problem when you are driving.
 *
 * Rebuilt to be short. It previously stacked a route line, a pair of primary
 * buttons, and a second pair for message and call — four rows deep, sitting on
 * top of a sheet that was already covering most of the map. Every millimetre
 * here is a millimetre of road the rider cannot see, so the layout is now one
 * line of context and one line of controls, with message and call as icons
 * beside the action rather than a row of their own.
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
  /** Duty toggle, so going off shift never needs the sheet opened. */
  onToggleOnline?: (online: boolean) => void;
}

export const DriverPinned: React.FC<DriverPinnedProps> = ({
  driver,
  acceptedPooledRides,
  pendingRequestCount,
  onAdvanceRideStatus,
  onExpand,
  onOpenChat,
  unread = {},
  onToggleOnline,
}) => {
  const ordered = useRouteOrderedRides(driver, acceptedPooledRides);
  const next = ordered[0];

  // Off duty is handled by not rendering this row at all — see App. Kept as a
  // guard so the component is safe to mount in any state.
  if (!driver.isOnline) return null;

  /*
   * Nothing accepted, nothing to pin.
   *
   * This showed a black "On duty — End shift" card directly above the panel's
   * duty control, which says the same thing with the same two options. The row
   * exists for one purpose: the next action on a trip that is under way. With
   * no trip there is no next action, and the map's own chip already reports
   * whether the app is listening.
   */
  if (!next) return null;

  const stage = NEXT_STAGE[next.status];
  const unreadHere = unread[next.id] ?? 0;

  return (
    <div className="overflow-hidden rounded-2xl bg-gray-900">
      {/* Where the rider is headed, in one line. Tapping it opens the queue. */}
      <button
        onClick={onExpand}
        className="flex w-full items-center gap-2 px-4 pt-2.5 text-left"
        aria-label="Expand trip details"
      >
        <Navigation className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        <p className="min-w-0 flex-1 truncate text-[11px] font-bold text-gray-400">
          {next.status === 'in_transit' ? 'Dropping off' : 'Next pickup'}
          <span className="ml-1 text-white">
            {next.status === 'in_transit' ? next.dropoffLocation.name : next.pickupLocation.name}
          </span>
        </p>
        {acceptedPooledRides.length > 1 && (
          <span className="shrink-0 rounded-md bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-gray-900">
            +{acceptedPooledRides.length - 1}
          </span>
        )}
      </button>

      {/* One row of controls. The stage button takes the width it needs to be
          hit without aiming; contact and completion are fixed-size icons beside
          it, because they are known targets a rider finds by position. */}
      <div className="flex items-center gap-2 px-3 pb-3 pt-2">
        {stage && (
          <button
            onClick={() => onAdvanceRideStatus(next.id, stage.status)}
            className="flex h-12 min-w-0 flex-1 items-center justify-center rounded-xl bg-amber-400 px-3 text-sm font-bold text-gray-900 shadow-sm transition active:scale-95 hover:bg-amber-300"
          >
            <span className="truncate">{stage.label}</span>
          </button>
        )}

        <button
          onClick={() => onOpenChat(next.id)}
          aria-label={unreadHere > 0 ? `${unreadHere} unread messages` : 'Message passenger'}
          className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/15 text-gray-300 transition active:scale-95 hover:bg-white/10"
        >
          <MessageSquare className="h-5 w-5" />
          {unreadHere > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-gray-900">
              {unreadHere > 9 ? '9+' : unreadHere}
            </span>
          )}
        </button>

        {/* Riders often sign up without a number, so this is disabled rather
            than offering a link that dials nothing. */}
        {next.passengerPhone ? (
          <a
            href={`tel:${next.passengerPhone}`}
            aria-label="Call passenger"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/15 text-gray-300 transition active:scale-95 hover:bg-white/10"
          >
            <Phone className="h-5 w-5" />
          </a>
        ) : (
          <span
            title="This passenger has no contact number on file"
            aria-label="No contact number on file"
            className="flex h-12 w-12 shrink-0 cursor-not-allowed items-center justify-center rounded-xl border border-white/5 text-gray-700"
          >
            <Phone className="h-5 w-5" />
          </span>
        )}

        <button
          onClick={() => onAdvanceRideStatus(next.id, 'completed')}
          aria-label={`Complete trip and collect ₱${next.totalFare}`}
          className="flex h-12 shrink-0 items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 text-sm font-bold text-white shadow-sm transition active:scale-95 hover:bg-emerald-600 tabular-nums"
        >
          <CheckCircle className="h-4 w-4 shrink-0" />₱{next.totalFare}
        </button>
      </div>
    </div>
  );
};
