// Dumaguete City Street Network & Routing Engine

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteResult {
  /** Road geometry to draw. Falls back to the raw waypoints if no router answered. */
  coords: LatLng[];
  /** Actual distance along the road, in km. */
  distanceKm: number;
  /** Travel time along the road, in minutes. */
  durationMin: number;
  /**
   * 'driving'/'foot' mean the numbers came from OSRM and are real road figures.
   * 'estimate' means every router was unreachable and these are scaled
   * straight-line values — good enough to show, but flagged in the UI.
   */
  source: 'driving' | 'foot' | 'estimate';
}

/**
 * Straight-line distance. Only a building block — a pedicab cannot fly, so this
 * is never the number a passenger is charged on.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * toRad) *
      Math.cos(b.lat * toRad) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * How much longer the real route is than the straight line. Measured against
 * OSRM over six common Dumaguete routes (Silliman–Robinsons, Boulevard–Airport,
 * Pier 1–Robinsons, Market–Silliman, Boulevard–Valencia, Silliman–Boulevard):
 * the mean ratio was 1.32. Used only when the router cannot be reached, so an
 * offline fare still lands near the ordinance rate instead of undercharging.
 */
const DUMAGUETE_ROAD_FACTOR = 1.32;

/** Rough pedicab speed through city traffic, km/h — for the offline ETA only. */
const AVERAGE_SPEED_KMH = 18;

/**
 * Keep two decimals (10 m). The fare brackets are ceilings, so precision here
 * decides real money: rounding to 0.1 km would fold 1.04 km back to 1.0 and
 * silently drop the ₱2 that a trip past the first kilometre owes.
 */
const roundKm = (km: number) =>
  Number.isFinite(km) && km > 0 ? Math.round(km * 100) / 100 : 0;

function estimateRoute(waypoints: LatLng[]): RouteResult {
  let straight = 0;
  for (let i = 1; i < waypoints.length; i++) {
    straight += haversineKm(waypoints[i - 1], waypoints[i]);
  }
  const distanceKm = roundKm(straight * DUMAGUETE_ROAD_FACTOR);
  return {
    coords: waypoints,
    distanceKm,
    durationMin: Math.max(1, Math.round((distanceKm / AVERAGE_SPEED_KMH) * 60)),
    source: 'estimate',
  };
}

// The map redraws whenever the driver moves, and the booking panel asks for the
// same pickup->dropoff pair on every keystroke. Cache so one route is fetched
// once rather than several times a second.
const routeCache = new Map<string, RouteResult>();
const MAX_CACHED_ROUTES = 60;

const cacheKey = (waypoints: LatLng[]) =>
  waypoints.map((w) => `${w.lat.toFixed(5)},${w.lng.toFixed(5)}`).join(';');

function remember(key: string, result: RouteResult): RouteResult {
  if (routeCache.size >= MAX_CACHED_ROUTES) {
    // Plain FIFO eviction; oldest key first.
    const oldest = routeCache.keys().next().value;
    if (oldest !== undefined) routeCache.delete(oldest);
  }
  routeCache.set(key, result);
  return result;
}

async function requestProfile(
  profile: 'driving' | 'foot',
  waypoints: LatLng[],
  timeoutMs: number
): Promise<RouteResult | null> {
  const coordsString = waypoints
    .map((w) => `${w.lng.toFixed(6)},${w.lat.toFixed(6)}`)
    .join(';');

  const url = `https://router.project-osrm.org/route/v1/${profile}/${coordsString}?overview=full&geometries=geojson`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;

    const data = await response.json();
    const route = data?.routes?.[0];
    if (data?.code !== 'Ok' || !route?.geometry) return null;

    const routeCoords: [number, number][] = route.geometry.coordinates ?? [];
    if (routeCoords.length < 2) return null;
    if (!Number.isFinite(route.distance)) return null;

    const mapRoadPoints: LatLng[] = routeCoords.map(([lng, lat]) => ({ lat, lng }));

    return {
      // Pin the ends to the exact pickup/dropoff pins; OSRM snaps to the nearest
      // road, which can sit a few metres off the marker.
      coords: [waypoints[0], ...mapRoadPoints, waypoints[waypoints.length - 1]],
      distanceKm: roundKm(route.distance / 1000),
      durationMin: Math.max(
        1,
        Math.round((Number(route.duration) || 0) / 60) ||
          Math.round((route.distance / 1000 / AVERAGE_SPEED_KMH) * 60)
      ),
      source: profile,
    };
  } catch {
    // Timeout, offline, or CORS — the caller falls through to the next profile.
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Resolve the real street route between waypoints.
 *
 * Tries the driving profile, then walking (some Dumaguete alleys are not
 * routable by car), and only then falls back to a scaled straight line.
 */
export async function getStreetRoute(waypoints: LatLng[]): Promise<RouteResult> {
  if (waypoints.length < 2) {
    return {
      coords: waypoints,
      distanceKm: 0,
      durationMin: 0,
      source: 'estimate',
    };
  }

  const key = cacheKey(waypoints);
  const cached = routeCache.get(key);
  if (cached) return cached;

  for (const [profile, timeoutMs] of [
    ['driving', 4000],
    ['foot', 3000],
  ] as const) {
    const result = await requestProfile(profile, waypoints, timeoutMs);
    if (result) return remember(key, result);
  }

  // Not cached: the network may recover, and we would rather retry than pin a
  // guess to this route for the rest of the session.
  return estimateRoute(waypoints);
}
