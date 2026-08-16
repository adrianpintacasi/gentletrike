import React from 'react';
import { Clock, MapPin, Loader2, RotateCcw } from 'lucide-react';
import * as api from '../api';
import type { LocationPoint, TransportMode } from '../types';

/**
 * Shown when a request has gone unanswered for too long.
 *
 * A booking that sits on "waiting for a rider" forever is worse than one that
 * fails: the passenger keeps waiting instead of walking to the road and flagging
 * a trike down. After the cap this says so, and — where the fleet data supports
 * it — says where the riders actually are.
 *
 * Every figure here comes from `/me/rider-hint`, which reads live driver
 * positions and asks Google only for the street name. When nobody is on duty it
 * says that plainly rather than inventing an encouraging number.
 */

/**
 * How long a request may sit unanswered.
 *
 * Five minutes: long enough that a rider finishing a drop-off nearby can still
 * take it, short enough that the passenger has not silently lost a quarter of an
 * hour to a request nobody was ever going to accept.
 */
export const SEARCH_TIMEOUT_MS = 5 * 60 * 1000;

interface SearchTimeoutCardProps {
  pickup: LocationPoint;
  vehicleType: TransportMode;
  /** Abandons this request and returns to the booking details to try again. */
  onRebook: () => void;
  onKeepWaiting: () => void;
}

export const SearchTimeoutCard: React.FC<SearchTimeoutCardProps> = ({
  pickup,
  vehicleType,
  onRebook,
  onKeepWaiting,
}) => {
  const [hint, setHint] = React.useState<api.RiderHint | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    api
      .getRiderHint(pickup.lat, pickup.lng, vehicleType)
      .then((result) => {
        if (!cancelled) setHint(result);
      })
      .catch(() => {
        if (!cancelled) setHint(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pickup.lat, pickup.lng, vehicleType]);

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Clock className="h-4 w-4 shrink-0 text-amber-700" />
        <p className="text-sm font-bold text-amber-950">Still looking for a rider</p>
      </div>

      <p className="text-xs font-medium text-amber-900">
        Nobody has accepted this trip yet. You can keep waiting, or try a different
        pickup point.
      </p>

      {isLoading && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-amber-800">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Checking where riders are…
        </p>
      )}

      {/* The advice, only when the data actually supports it. */}
      {!isLoading && hint && hint.riders > 0 && hint.street && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-white p-3">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <p className="text-[11px] font-semibold text-gray-700">
            <span className="font-bold text-gray-900">
              {hint.riders} rider{hint.riders > 1 ? 's are' : ' is'} around {hint.street}
            </span>
            {hint.distanceKm !== null && (
              <>
                {' '}
                — about {hint.distanceKm} km from your pickup.
              </>
            )}{' '}
            Booking from there is likely to be picked up faster.
          </p>
        </div>
      )}

      {!isLoading && hint && hint.driversOnline === 0 && (
        <p className="mt-3 rounded-xl border border-amber-300 bg-white p-3 text-[11px] font-semibold text-gray-700">
          <span className="font-bold text-gray-900">No riders are on duty right now.</span>{' '}
          Trips are unlikely to be accepted until someone goes online.
        </p>
      )}

      {!isLoading && hint && hint.driversOnline > 0 && hint.riders > 0 && !hint.street && (
        <p className="mt-3 rounded-xl border border-amber-300 bg-white p-3 text-[11px] font-semibold text-gray-700">
          <span className="font-bold text-gray-900">
            {hint.driversOnline} rider{hint.driversOnline > 1 ? 's' : ''} on duty
          </span>{' '}
          , but none close enough to suggest a better pickup point.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={onKeepWaiting}
          className="h-11 flex-1 rounded-xl border border-amber-300 bg-white text-xs font-semibold text-amber-900 transition active:scale-[0.99]"
        >
          Keep waiting
        </button>
        <button
          onClick={onRebook}
          className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-900 text-xs font-semibold text-amber-400 transition active:scale-[0.99]"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Change pickup
        </button>
      </div>
    </div>
  );
};
