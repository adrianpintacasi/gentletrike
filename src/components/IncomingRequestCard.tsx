import React from 'react';
import { ArrowRight, Check, MapPin, Users, X } from 'lucide-react';
import type { OpenRide } from '../api';
import { isExclusiveTrip } from '../../shared/dispatch';
import { VEHICLE_DETAILS , vehicleDetail } from '../../shared/transport';

/**
 * A trip offer, thrown over the map rather than buried in the sheet.
 *
 * A rider is driving. Asking them to open a sheet, scroll a queue, and hit a
 * small button is asking them to look away from the road for several seconds.
 * This card appears on its own, takes one gesture, and leaves — so the map is
 * hidden for as long as the decision takes and no longer.
 *
 * Swipe right to accept, left to decline; the buttons do the same thing for
 * anyone who would rather aim than swipe.
 */

/** Past this much horizontal travel, letting go commits the decision. */
const COMMIT_PX = 96;

interface IncomingRequestCardProps {
  ride: OpenRide;
  /** How many more are queued behind this one, for the "+2 more" hint. */
  remaining: number;
  onAccept: (rideId: string) => void;
  onDecline: (rideId: string) => void;
}

export const IncomingRequestCard: React.FC<IncomingRequestCardProps> = ({
  ride,
  remaining,
  onAccept,
  onDecline,
}) => {
  const [dragX, setDragX] = React.useState(0);
  const [committing, setCommitting] = React.useState<'accept' | 'decline' | null>(null);
  const dragStart = React.useRef<number | null>(null);

  // A fresh offer must never inherit the previous card's drag position — the
  // next request would slide in already half-accepted.
  React.useEffect(() => {
    setDragX(0);
    setCommitting(null);
    dragStart.current = null;
  }, [ride.id]);

  const commit = (decision: 'accept' | 'decline') => {
    if (committing) return;
    setCommitting(decision);
    // Let the card finish leaving before the list underneath changes.
    setDragX(decision === 'accept' ? 520 : -520);
    window.setTimeout(() => {
      if (decision === 'accept') onAccept(ride.id);
      else onDecline(ride.id);
    }, 180);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (committing) return;
    dragStart.current = event.clientX;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (dragStart.current === null || committing) return;
    setDragX(event.clientX - dragStart.current);
  };

  const onPointerUp = () => {
    if (dragStart.current === null || committing) return;
    dragStart.current = null;

    if (dragX > COMMIT_PX) commit('accept');
    else if (dragX < -COMMIT_PX) commit('decline');
    else setDragX(0);
  };

  const progress = Math.min(1, Math.abs(dragX) / COMMIT_PX);
  const leaning = dragX > 8 ? 'accept' : dragX < -8 ? 'decline' : null;

  const vehicle = vehicleDetail(ride.vehicleType);
  const isCharter = isExclusiveTrip(ride.vehicleType);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center px-3 pt-3">
      <div className="pointer-events-auto w-full max-w-md">
        {/* The intent rails. They brighten as the card is pushed toward one, so
            the gesture says what it will do before it is finished. */}
        <div className="relative">
          <div
            className="absolute inset-0 flex items-center justify-between rounded-2xl px-5"
            style={{
              background:
                leaning === 'accept'
                  ? `rgba(16,185,129,${0.15 + progress * 0.5})`
                  : leaning === 'decline'
                  ? `rgba(244,63,94,${0.15 + progress * 0.5})`
                  : 'transparent',
            }}
          >
            <X className="h-5 w-5 text-rose-700" style={{ opacity: leaning === 'decline' ? progress : 0 }} />
            <Check className="h-5 w-5 text-emerald-700" style={{ opacity: leaning === 'accept' ? progress : 0 }} />
          </div>

          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="relative touch-pan-y rounded-2xl border border-gray-200 bg-white p-3.5 shadow-2xl"
            style={{
              transform: `translateX(${dragX}px) rotate(${dragX * 0.02}deg)`,
              transition: dragStart.current === null ? 'transform 200ms ease-out' : 'none',
              opacity: committing ? 0 : 1,
            }}
          >
            <div className="mb-2.5 flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-70" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              </span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-900">
                New trip request
              </span>
              {remaining > 0 && (
                <span className="ml-auto rounded-md bg-gray-900 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                  +{remaining} more
                </span>
              )}
            </div>

            <div className="mb-2 min-w-0">
              <p className="truncate text-sm font-semibold leading-snug text-gray-900">
                {ride.pickupLocation.name}
              </p>
              <p className="flex items-center gap-1 truncate text-sm font-semibold leading-snug text-amber-700">
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                {ride.dropoffLocation.name}
              </p>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-gray-600">
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3 text-gray-400" />
                {ride.distanceKm} km
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3 text-gray-400" />
                {ride.passengers} pax
              </span>
              <span className="truncate text-gray-500">{vehicle?.title ?? ride.vehicleType}</span>
              {isCharter && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                  PAKYAW
                </span>
              )}
              <span className="ml-auto text-base font-bold text-gray-900">₱{ride.totalFare}</span>
            </div>

            {/* Buttons carry the same two actions. Decline is deliberately the
                smaller target: a mis-tap that turns work away costs the rider
                money, a mis-tap that accepts costs them a short detour. */}
            <div className="flex gap-2">
              <button
                onClick={() => commit('decline')}
                aria-label="Decline this trip"
                className="flex h-12 w-14 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-500 transition active:scale-95 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
              <button
                onClick={() => commit('accept')}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white shadow-sm transition active:scale-95 hover:bg-emerald-700"
              >
                <Check className="h-4 w-4" />
                Accept trip
              </button>
            </div>

            <p className="mt-2 text-center text-[10px] font-semibold text-gray-400">
              or swipe right to accept, left to decline
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
