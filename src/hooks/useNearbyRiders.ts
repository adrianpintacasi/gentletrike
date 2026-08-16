import { useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import type { Driver, LocationPoint } from '../types';
import { AVERAGE_SPEED_KMH, DUMAGUETE_ROAD_FACTOR, haversineKm } from '../../shared/geo';
import { TRANSPORT_MODES, type TransportMode } from '../../shared/transport';

/**
 * How far away the nearest on-duty rider of each vehicle type actually is.
 *
 * The booking card used to print `VEHICLE_DETAILS[mode].eta` — the strings
 * "3 mins", "2 mins", "6 mins", hardcoded in the fare table. They were fixed
 * copy dressed as live information: identical at 3am with nobody on duty as at
 * rush hour with twelve riders out, and identical whether the passenger stood
 * on the Boulevard or in a barangay nobody serves.
 *
 * These figures come from the same `GET /drivers?online=1` the fleet map uses,
 * measured against the passenger's chosen pickup.
 */

/** Matches the driver poll elsewhere in the app; riders move, not teleport. */
const REFRESH_MS = 15000;

export interface RiderAvailability {
  /** On-duty riders of this type anywhere in the city. */
  count: number;
  /** Road distance to the closest one, km — null when none are on duty. */
  distanceKm: number | null;
  /** Minutes for that closest rider to reach the pickup, null when none. */
  etaMinutes: number | null;
}

export type AvailabilityByMode = Record<TransportMode, RiderAvailability>;

const EMPTY: RiderAvailability = { count: 0, distanceKm: null, etaMinutes: null };

/**
 * Straight-line distance scaled by the road factor and divided by city speed.
 *
 * Deliberately not a Routes API call: this runs for every vehicle type whenever
 * the pickup moves, and billing four routing requests per keystroke to put a
 * number on a card is not a trade worth making. The figure is honest about
 * being an estimate, and it is derived from where riders really are.
 */
function minutesAway(distanceKm: number): number {
  return Math.max(1, Math.round((distanceKm / AVERAGE_SPEED_KMH) * 60));
}

export function useNearbyRiders(pickup: LocationPoint | null): {
  availability: AvailabilityByMode;
  isLoading: boolean;
} {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const online = await api.listDrivers(true);
        if (!cancelled) setDrivers(online);
      } catch {
        // A failed poll leaves the last known fleet in place rather than
        // blanking every card; the next tick will correct it.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const availability = useMemo(() => {
    const result = {} as AvailabilityByMode;

    for (const mode of TRANSPORT_MODES) {
      const ofType = drivers.filter((d) => d.vehicleType === mode);

      if (ofType.length === 0 || !pickup) {
        result[mode] = { ...EMPTY, count: ofType.length };
        continue;
      }

      let nearestKm = Infinity;
      for (const driver of ofType) {
        const straight = haversineKm(
          { lat: driver.currentLat, lng: driver.currentLng },
          { lat: pickup.lat, lng: pickup.lng }
        );
        if (straight < nearestKm) nearestKm = straight;
      }

      const roadKm = Math.round(nearestKm * DUMAGUETE_ROAD_FACTOR * 100) / 100;
      result[mode] = {
        count: ofType.length,
        distanceKm: roadKm,
        etaMinutes: minutesAway(roadKm),
      };
    }

    return result;
  }, [drivers, pickup?.lat, pickup?.lng]);

  return { availability, isLoading };
}
