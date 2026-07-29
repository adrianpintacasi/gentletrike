import { TransportMode, VEHICLE_DETAILS } from './transport';

/** Distance covered by the base fare. Anything past this starts charging. */
export const BASE_DISTANCE_KM = 1;

/**
 * NOTE ON DISCOUNTS: the TMO grants 20% to seniors, PWDs, and students, but
 * GentleTrike does not compute it — the booking panel has never applied one, so
 * neither does anything here. A discounted quote would disagree with what the
 * app actually charges and with what lands in the rides table. The entitlement
 * is documented in the knowledge base as information; it is not arithmetic.
 */

/**
 * Guards the ceiling against floating-point noise. Without it a distance that
 * should land exactly on a kilometre boundary (2.0 km arriving as
 * 2.0000000000000004) would tip into the next bracket and overcharge.
 */
const EPSILON = 1e-9;

/**
 * Fare for one passenger, per the Dumaguete motorcab ordinance:
 * ₱15 for the first kilometre or less, then ₱2 for every succeeding kilometre
 * **or fraction thereof**.
 *
 * The bracket is a ceiling, not a proportion — a trip 10 metres past the first
 * kilometre already owes the full ₱2:
 *
 *   0.40 km -> ₱15      1.00 km -> ₱15
 *   1.01 km -> ₱17      1.70 km -> ₱17      2.00 km -> ₱17
 *   2.01 km -> ₱19      2.90 km -> ₱19      3.00 km -> ₱19
 */
export function farePerPassenger(mode: TransportMode, distanceKm: number): number {
  const { baseFare, perKm } = VEHICLE_DETAILS[mode];
  if (!Number.isFinite(distanceKm) || distanceKm <= BASE_DISTANCE_KM) return baseFare;

  const succeedingKm = Math.ceil(distanceKm - BASE_DISTANCE_KM - EPSILON);
  return baseFare + succeedingKm * perKm;
}

/** Total for the whole booking. Each passenger pays the ordinance rate, except pakyaw charter which is a flat rate. */
export function totalFare(
  mode: TransportMode,
  distanceKm: number,
  passengers: number
): number {
  if (mode === 'pakyaw_charter') {
    // Pakyaw charter is a flat rate regardless of passenger count
    return farePerPassenger(mode, distanceKm);
  }
  return farePerPassenger(mode, distanceKm) * Math.max(1, passengers);
}

/**
 * Full breakdown for one trip. This is what Gently's `estimate_fare` tool
 * returns, so the model reports computed pesos instead of doing the ceiling
 * arithmetic itself — which it reliably gets wrong.
 *
 * `total` here must always equal what totalFare() gives the booking panel for
 * the same trip. If the two ever diverge, a passenger sees one price from
 * Gently and a different one at checkout.
 */
export interface FareBreakdown {
  mode: TransportMode;
  distanceKm: number;
  passengers: number;
  baseFare: number;
  perKm: number;
  /** Kilometres billed beyond the first, after the ceiling is applied. */
  succeedingKm: number;
  farePerPassenger: number;
  total: number;
}

export function fareBreakdown(
  mode: TransportMode,
  distanceKm: number,
  passengers = 1
): FareBreakdown {
  const { baseFare, perKm } = VEHICLE_DETAILS[mode];
  const heads = Math.max(1, Math.floor(passengers) || 1);
  const km = Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0;

  return {
    mode,
    distanceKm: km,
    passengers: heads,
    baseFare,
    perKm,
    succeedingKm: km <= BASE_DISTANCE_KM ? 0 : Math.ceil(km - BASE_DISTANCE_KM - EPSILON),
    farePerPassenger: farePerPassenger(mode, km),
    total: totalFare(mode, km, heads),
  };
}
