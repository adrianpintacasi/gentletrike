import React from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import type { OpenRide } from '../api';
import { isExclusiveTrip } from '../../shared/dispatch';

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

  const isCharter = isExclusiveTrip(ride.vehicleType);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center px-4 pt-3">
      <div className="pointer-events-auto w-full max-w-sm">
        <div className="relative">
          {/* The rest of the queue, as a physical stack behind the top card.
              Two slips of paper are enough to say "there are more" — a number
              alone reads as a badge, and a rider glancing down understands a
              pile without decoding it. */}
          {remaining > 0 && (
            <div
              aria-hidden
              className="absolute inset-x-3 -bottom-1.5 h-full rounded-2xl bg-gray-900/60 ring-1 ring-white/10"
            />
          )}
          {remaining > 1 && (
            <div
              aria-hidden
              className="absolute inset-x-6 -bottom-3 h-full rounded-2xl bg-gray-900/40 ring-1 ring-white/5"
            />
          )}

          {/* Intent rails: they brighten as the card is pushed toward one, so
              the gesture says what it will do before it is finished. */}
          <div
            className="absolute inset-0 flex items-center justify-between rounded-2xl px-5"
            style={{
              background:
                leaning === 'accept'
                  ? `rgba(16,185,129,${0.2 + progress * 0.55})`
                  : leaning === 'decline'
                    ? `rgba(244,63,94,${0.2 + progress * 0.55})`
                    : 'transparent',
            }}
          >
            <X
              className="h-6 w-6 text-white"
              style={{ opacity: leaning === 'decline' ? progress : 0 }}
            />
            <Check
              className="h-6 w-6 text-white"
              style={{ opacity: leaning === 'accept' ? progress : 0 }}
            />
          </div>

          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="relative touch-pan-y rounded-2xl bg-gray-900 px-4 py-3 shadow-2xl ring-1 ring-white/10"
            style={{
              transform: `translateX(${dragX}px) rotate(${dragX * 0.02}deg)`,
              transition: dragStart.current === null ? 'transform 200ms ease-out' : 'none',
              opacity: committing ? 0 : 1,
              willChange: 'transform',
            }}
          >
            {/*
              Everything a rider needs to say yes or no, and nothing else.
              
              This card was a header, a two-line route, a row of metadata, two
              full-width buttons and a hint — tall enough to cover a third of
              the map it was floating over, and repeating a queue that was
              already open below. Where they are going and what it pays is the
              decision; the rest is available in the sheet once parked.
            */}
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold leading-tight text-gray-400">
                  {ride.pickupLocation.name}
                </p>
                <p className="flex items-center gap-1 truncate text-[15px] font-bold leading-tight text-white">
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  {ride.dropoffLocation.name}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xl font-bold leading-none text-amber-400 tabular-nums">
                  ₱{ride.totalFare}
                </p>
                <p className="mt-1 text-[10px] font-semibold text-gray-500 tabular-nums">
                  {ride.distanceKm} km · {ride.passengers} pax
                </p>
              </div>
            </div>

            {/* Swipe is the primary gesture. These stay for anyone who would
                rather aim, and are sized to be hit without looking. */}
            <div className="mt-2.5 flex items-center gap-2">
              <button
                onClick={() => commit('decline')}
                aria-label="Decline this trip"
                className="flex h-11 w-14 shrink-0 items-center justify-center rounded-xl border border-white/15 text-gray-400 transition active:scale-95 hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
              <button
                onClick={() => commit('accept')}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-bold text-white transition active:scale-95 hover:bg-emerald-400"
              >
                <Check className="h-4 w-4" />
                Accept
                {isCharter && (
                  <span className="rounded bg-white/20 px-1.5 py-0.5 text-[9px] font-bold">
                    PAKYAW
                  </span>
                )}
              </button>
              {remaining > 0 && (
                <span className="shrink-0 rounded-xl border border-white/10 px-2.5 py-2 text-[11px] font-bold text-gray-400 tabular-nums">
                  +{remaining}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
