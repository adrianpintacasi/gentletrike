import { DUMAGUETE_BOUNDARY } from './dumagueteBoundary';
import { DUMAGUETE_LOCATIONS } from '../src/data/dumagueteData';
import type { LatLng } from './geo';

/**
 * Where GentleTrike will actually take you.
 *
 * Free-text place search can return anywhere on earth — Cebu, Manila,
 * Valencia. The fare table and the rider network are Dumaguete-only, so a
 * result outside the city is not a trip we can price or serve, and quoting one
 * repeats the Valencia bug through a different door.
 *
 * The boundary is the real OpenStreetMap administrative polygon rather than a
 * bounding box: a rectangle around Dumaguete swallows chunks of Sibulan,
 * Valencia and Bacong, which are separate municipalities with their own
 * transport.
 */

/** Bounding box of the polygon — a cheap reject before the precise test. */
const BBOX = DUMAGUETE_BOUNDARY.reduce(
  (b, [lat, lng]) => ({
    minLat: Math.min(b.minLat, lat),
    maxLat: Math.max(b.maxLat, lat),
    minLng: Math.min(b.minLng, lng),
    maxLng: Math.max(b.maxLng, lng),
  }),
  { minLat: Infinity, maxLat: -Infinity, minLng: Infinity, maxLng: -Infinity }
);

export const DUMAGUETE_BBOX = BBOX;

/**
 * Places outside the city limits that GentleTrike serves anyway.
 *
 * Sibulan Airport is the city's airport and already a bookable point in the
 * app, but it sits in Sibulan and the polygon rightly excludes it. Rather than
 * loosening the boundary — which would also let in unrelated parts of Sibulan —
 * the app's own pickup points are trusted explicitly.
 */
const ALLOWED_OUTSIDE: LatLng[] = DUMAGUETE_LOCATIONS.map((l) => ({ lat: l.lat, lng: l.lng }));

/** Anything within this of an allowed point counts as that point. */
const ALLOWANCE_DEGREES = 0.004; // roughly 400 m

/**
 * Ray casting. Counts how many times a ray east from the point crosses the
 * polygon edge — odd means inside.
 */
function insidePolygon(lat: number, lng: number): boolean {
  let inside = false;

  for (let i = 0, j = DUMAGUETE_BOUNDARY.length - 1; i < DUMAGUETE_BOUNDARY.length; j = i++) {
    const [latI, lngI] = DUMAGUETE_BOUNDARY[i];
    const [latJ, lngJ] = DUMAGUETE_BOUNDARY[j];

    const straddles = latI > lat !== latJ > lat;
    if (straddles && lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI) {
      inside = !inside;
    }
  }

  return inside;
}

export interface ServiceAreaResult {
  inside: boolean;
  reason: 'inside' | 'known-pickup-point' | 'outside-city';
}

export function checkServiceArea(lat: number, lng: number): ServiceAreaResult {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { inside: false, reason: 'outside-city' };
  }

  if (
    lat >= BBOX.minLat &&
    lat <= BBOX.maxLat &&
    lng >= BBOX.minLng &&
    lng <= BBOX.maxLng &&
    insidePolygon(lat, lng)
  ) {
    return { inside: true, reason: 'inside' };
  }

  const nearKnown = ALLOWED_OUTSIDE.some(
    (p) =>
      Math.abs(p.lat - lat) <= ALLOWANCE_DEGREES && Math.abs(p.lng - lng) <= ALLOWANCE_DEGREES
  );
  if (nearKnown) return { inside: true, reason: 'known-pickup-point' };

  return { inside: false, reason: 'outside-city' };
}

export const isInServiceArea = (lat: number, lng: number): boolean =>
  checkServiceArea(lat, lng).inside;
