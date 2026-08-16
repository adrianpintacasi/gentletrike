// Dumaguete City Street Network & Routing Engine
//
// Shared between the browser (map + booking panel) and the server (Gently's
// `plan_route` tool). It depends only on `fetch`, which is built in on Node 24
// and in every supported browser.
//
// Routing runs on the Google Routes API. The key that authorises it is a server
// secret, so the browser never calls Google directly — it posts to /api/route on
// our own server, which holds the key and answers with the same RouteResult.
// One exported function, two transports, so all six call sites stay unchanged.

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
   * 'driving' means the numbers came from the Routes API and are real road
   * figures. 'estimate' means the router was unreachable and these are scaled
   * straight-line values — good enough to show, but flagged in the UI.
   *
   * 'foot' is retained because the booking panel's prop type accepts it and the
   * old OSRM walking profile could still be sitting in a cached response; no
   * code path produces it any more.
   */
  source: 'driving' | 'foot' | 'estimate';
}

/**
 * How the route should be worked out. Optional throughout, so every existing
 * caller keeps compiling — the defaults are what the fare needs.
 */
export interface RouteOptions {
  /**
   * TWO_WHEELER follows the alleys and one-way exemptions a motorcycle may use
   * and a car may not, which is what a habal-habal or pedicab actually rides.
   */
  travelMode?: 'DRIVE' | 'TWO_WHEELER';
  /**
   * Traffic costs more per call, and the ordinance fare is charged on distance
   * rather than time, so a quote must never pay for it. Turn it on only where a
   * live ETA is the point.
   */
  trafficAware?: boolean;
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
 * Compass bearing from `a` to `b`, in degrees clockwise from north (0–360).
 *
 * Used to point the rider's arrow when the GPS fix has no heading of its own,
 * which is common on phones that are stationary or moving slowly.
 */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const toRad = Math.PI / 180;
  const φ1 = a.lat * toRad;
  const φ2 = b.lat * toRad;
  const Δλ = (b.lng - a.lng) * toRad;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

/**
 * How much longer the real route is than the straight line. Measured against
 * OSRM over six common Dumaguete routes (Silliman–Robinsons, Boulevard–Airport,
 * Pier 1–Robinsons, Market–Silliman, Boulevard–Valencia, Silliman–Boulevard):
 * the mean ratio was 1.32. Used only when the router cannot be reached, so an
 * offline fare still lands near the ordinance rate instead of undercharging.
 */
export const DUMAGUETE_ROAD_FACTOR = 1.32;

/** Rough pedicab speed through city traffic, km/h — for the offline ETA only. */
export const AVERAGE_SPEED_KMH = 18;

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

/** True in the browser bundle, false under Node. Decides which transport runs. */
const isBrowser = typeof window !== 'undefined';

/**
 * The Routes API key, read lazily.
 *
 * Vite does not polyfill `process`, so touching it unguarded at module scope
 * would throw a ReferenceError in the browser before the app ever renders.
 */
function serverKey(): string | undefined {
  if (typeof process === 'undefined') return undefined;
  return process.env?.GOOGLE_MAPS_SERVER_KEY;
}

/**
 * Google's encoded polyline format, unpacked.
 *
 * Asking the Routes API for GeoJSON instead is possible but bills at a higher
 * tier, and the decoder is twenty lines.
 */
function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

/**
 * Ask Google for the road route. Server-side only — this is where the key is.
 *
 * The field mask is not an optimisation but a requirement: the API rejects a
 * request without one, and the fields named decide which SKU tier the call is
 * billed at. These three are the cheapest set that still draws a line.
 */
export async function googleRoute(
  waypoints: LatLng[],
  options: RouteOptions = {},
  timeoutMs = 5000
): Promise<RouteResult | null> {
  const key = serverKey();
  if (!key) return null;

  const point = (w: LatLng) => ({
    location: { latLng: { latitude: w.lat, longitude: w.lng } },
  });

  const trafficAware = options.trafficAware ?? false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask':
            'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
        },
        body: JSON.stringify({
          origin: point(waypoints[0]),
          destination: point(waypoints[waypoints.length - 1]),
          ...(waypoints.length > 2 && {
            intermediates: waypoints.slice(1, -1).map(point),
          }),
          travelMode: options.travelMode ?? 'DRIVE',
          routingPreference: trafficAware ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE',
          polylineEncoding: 'ENCODED_POLYLINE',
          units: 'METRIC',
        }),
      }
    );

    if (!response.ok) {
      console.error('Routes API error:', response.status, await response.text());
      return null;
    }

    const data = await response.json();
    const route = data?.routes?.[0];
    const encoded = route?.polyline?.encodedPolyline;
    if (!encoded || !Number.isFinite(route?.distanceMeters)) return null;

    const roadPoints = decodePolyline(encoded);
    if (roadPoints.length < 2) return null;

    // Duration arrives as a protobuf string such as "323s".
    const seconds = parseFloat(String(route.duration ?? '0'));
    const distanceKm = route.distanceMeters / 1000;

    return {
      // Pin the ends to the exact pickup/dropoff pins; the router snaps to the
      // nearest road, which can sit a few metres off the marker.
      coords: [waypoints[0], ...roadPoints, waypoints[waypoints.length - 1]],
      distanceKm: roundKm(distanceKm),
      durationMin: Math.max(
        1,
        Math.round(seconds / 60) || Math.round((distanceKm / AVERAGE_SPEED_KMH) * 60)
      ),
      source: 'driving',
    };
  } catch {
    // Timeout, offline, or quota exhausted — the caller falls back to estimate.
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Browser transport: our own server holds the key and does the talking. */
async function routeViaProxy(
  waypoints: LatLng[],
  options: RouteOptions,
  timeoutMs = 6000
): Promise<RouteResult | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('/api/route', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waypoints, ...options }),
    });
    if (!response.ok) return null;

    const data = await response.json();
    if (!Array.isArray(data?.coords) || data.coords.length < 2) return null;
    if (!Number.isFinite(data?.distanceKm)) return null;

    return data as RouteResult;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Resolve the real street route between waypoints.
 *
 * Runs through whichever transport this side of the app has: the proxy in the
 * browser, Google directly on the server. Falls back to a scaled straight line
 * when neither answers, so a missing key or an exhausted quota degrades the
 * fare rather than breaking the booking.
 */
export async function getStreetRoute(
  waypoints: LatLng[],
  options: RouteOptions = {}
): Promise<RouteResult> {
  if (waypoints.length < 2) {
    return {
      coords: waypoints,
      distanceKm: 0,
      durationMin: 0,
      source: 'estimate',
    };
  }

  // Traffic-aware answers go stale, so they are fetched fresh and never stored
  // under a key that a later distance-only caller would read back.
  const cacheable = !options.trafficAware;
  const key = `${cacheKey(waypoints)}|${options.travelMode ?? 'DRIVE'}`;

  if (cacheable) {
    const cached = routeCache.get(key);
    if (cached) return cached;
  }

  const result = isBrowser
    ? await routeViaProxy(waypoints, options)
    : await googleRoute(waypoints, options);

  if (result) return cacheable ? remember(key, result) : result;

  // Not cached: the network may recover, and we would rather retry than pin a
  // guess to this route for the rest of the session.
  return estimateRoute(waypoints);
}
