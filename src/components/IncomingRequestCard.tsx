import React from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import type { OpenRide } from '../api';
import { isExclusiveTrip } from '../../shared/dispatch';

/**
 * The trip offer on top of the stack.
 *
 * It used to float over the map, which meant covering the road it was floating
 * on while a queue below showed the same trip again — one request, on screen
 * twice, at two sizes. It lives in the sheet now, where the depth of the queue
 * is drawn behind it and the map stays a map.
 *
 * Swipe right to accept, left to decline; the buttons do the same for anyone
 * who would rather aim than swipe.
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
    <div className="w-full">
      <div className="w-full">
        <div className="relative">
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
            className="relative touch-pan-y rounded-card bg-trust-slate px-4 py-3 shadow-2xl ring-1 ring-cream-400/20 border border-cream-400/20"
            style={{
              transform: `translateX(${dragX}px) rotate(${dragX * 0.02}deg)`,
              transition: dragStart.current === null ? 'transform 200ms ease-out' : 'none',
              opacity: committing ? 0 : 1,
              willChange: 'transform',
            }}
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-sans font-semibold leading-tight text-cream-300">
                  {ride.pickupLocation.name}
                </p>
                <p className="flex items-center gap-1 truncate text-[15px] font-display font-bold leading-tight text-cream-50">
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-trike-gold" />
                  {ride.dropoffLocation.name}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xl font-display font-extrabold leading-none text-trike-gold tabular-nums">
                  ₱{ride.totalFare}
                </p>
                <p className="mt-1 text-[10px] font-sans font-semibold text-cream-300 tabular-nums">
                  {ride.distanceKm} km · {ride.passengers} pax
                </p>
              </div>
            </div>

            <div className="mt-2.5 flex items-center gap-2">
              <button
                onClick={() => commit('decline')}
                aria-label="Decline this trip"
                className="flex h-11 w-14 shrink-0 items-center justify-center rounded-pill border border-cream-400/30 text-cream-300 transition active:scale-95 hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
              <button
                onClick={() => commit('accept')}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-pill bg-sampaguita-green text-sm font-display font-bold text-white transition active:scale-95 hover:bg-sampaguita-green/90 shadow-md"
              >
                <Check className="h-4 w-4" />
                Accept
                {isCharter && (
                  <span className="rounded-pill bg-white/20 px-2 py-0.5 text-[9px] font-display font-extrabold">
                    PAKYAW
                  </span>
                )}
              </button>
              {remaining > 0 && (
                <span className="shrink-0 rounded-pill border border-cream-400/20 bg-cream-50/10 px-2.5 py-2 text-[11px] font-display font-bold text-cream-300 tabular-nums">
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
