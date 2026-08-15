import { useMemo } from 'react';
import type { Driver, RideBooking } from '../types';
import { sequenceStops } from '../../shared/dispatch';

/**
 * Accepted trips in the order the rider will next deal with them.
 *
 * Listing by booking time put a passenger who is minutes away at the top simply
 * because they tapped first, which is not the order anyone drives in. The
 * numbers here match the numbered pins on the map.
 *
 * Extracted from DriverModePanel because the sheet's pinned action needs the
 * same "who is next" answer. Two implementations would eventually disagree, and
 * the disagreement would show as the pinned button naming one passenger while
 * the list below it named another.
 */
export function useRouteOrderedRides(
  driver: Pick<Driver, 'currentLat' | 'currentLng'>,
  rides: RideBooking[]
): RideBooking[] {
  return useMemo(() => {
    if (rides.length < 2) return rides;

    const origin = { lat: driver.currentLat, lng: driver.currentLng };
    const nextStopOrder = new Map<string, number>();

    for (const stop of sequenceStops(
      origin,
      rides.map((r) => ({
        rideId: r.id,
        pickup:
          r.status === 'in_transit'
            ? null
            : { lat: r.pickupLocation.lat, lng: r.pickupLocation.lng },
        dropoff: { lat: r.dropoffLocation.lat, lng: r.dropoffLocation.lng },
        // Where an aboard passenger got on, so the ordering can keep their trip
        // close to the one they booked instead of setting them down last.
        origin: { lat: r.pickupLocation.lat, lng: r.pickupLocation.lng },
      }))
    )) {
      // First time this trip appears is the next thing the rider does for it.
      if (!nextStopOrder.has(stop.rideId)) nextStopOrder.set(stop.rideId, stop.order);
    }

    return [...rides].sort(
      (a, b) => (nextStopOrder.get(a.id) ?? 0) - (nextStopOrder.get(b.id) ?? 0)
    );
  }, [rides, driver.currentLat, driver.currentLng]);
}
