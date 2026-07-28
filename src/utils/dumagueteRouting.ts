/**
 * Moved to shared/geo.ts so the server (Gently's `plan_route` tool) and the map
 * resolve routes through one implementation. Re-exported here so existing UI
 * imports keep working.
 */
export { haversineKm, bearingDegrees, getStreetRoute } from '../../shared/geo';

export type { LatLng, RouteResult } from '../../shared/geo';
