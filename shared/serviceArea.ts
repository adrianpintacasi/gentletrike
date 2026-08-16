import { DUMAGUETE_BOUNDARY } from './dumagueteBoundary';
import type { LatLng } from './geo';

/**
 * Where GentleTrike knows the official fare.
 *
 * This used to be a gate: anything outside the Dumaguete city polygon was
 * refused outright, because the fare table and the rider network were
 * Dumaguete-only and quoting a trip we could not price was worse than refusing
 * it. That was the right call when there was exactly one fare table.
 *
 * It is the wrong call now, because it conflated two different questions:
 *
 *   1. Can a rider and a passenger find each other here?   — always yes
 *   2. Do we know what the local council says this costs?  — sometimes
 *
 * Matching works anywhere two people have phones. Only the *official* fare is
 * jurisdictional. So this no longer refuses anything; it reports which fare
 * authority applies, and the booking screen shows an ordinance-backed rate or a
 * clearly-labelled estimate accordingly.
 *
 * The Dumaguete polygon survives as the first entry in what is meant to become
 * a registry of many. It is the real OpenStreetMap administrative boundary
 * rather than a bounding box, because a rectangle around Dumaguete swallows
 * chunks of Sibulan, Valencia and Bacong — separate municipalities with their
 * own ordinances.
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
  /**
   * Whether a trip here can be booked at all.
   *
   * Always true. Kept on the result because every caller reads it, and because
   * the day GentleTrike genuinely cannot serve somewhere — a different island,
   * a country with no riders — this is where that answer belongs.
   */
  inside: boolean;
  /** The fare authority whose ordinance applies, when one is on file. */
  authority: string | null;
  /**
   * Whether the fare shown here is an official rate or an estimate.
   *
   * The whole credibility of the fare screen rests on "rates set by local
   * ordinance, not GentleTrike". Somewhere without an ordinance on file gets an
   * honest estimate and a note saying so — never a confident number no council
   * ever passed.
   */
  faresKnown: boolean;
  reason: 'ordinance-on-file' | 'no-ordinance-on-file';
}

export function checkServiceArea(lat: number, lng: number): ServiceAreaResult {
  const unknown: ServiceAreaResult = {
    inside: true,
    authority: null,
    faresKnown: false,
    reason: 'no-ordinance-on-file',
  };

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return unknown;

  if (
    lat >= BBOX.minLat &&
    lat <= BBOX.maxLat &&
    lng >= BBOX.minLng &&
    lng <= BBOX.maxLng &&
    insidePolygon(lat, lng)
  ) {
    return {
      inside: true,
      authority: 'Dumaguete City',
      faresKnown: true,
      reason: 'ordinance-on-file',
    };
  }

  return unknown;
}

/** Whether the official rate applies here, rather than an estimate. */
export const hasFareAuthority = (lat: number, lng: number): boolean =>
  checkServiceArea(lat, lng).faresKnown;

/**
 * Retained so existing callers keep compiling.
 *
 * Now always true — nowhere is refused. Prefer {@link hasFareAuthority} when
 * the real question is "can I quote an official price here".
 */
export const isInServiceArea = (_lat: number, _lng: number): boolean => true;

/** Unused now that nothing is refused; kept so the type still resolves. */
export type ServiceAreaReason = ServiceAreaResult['reason'];

export type { LatLng };
