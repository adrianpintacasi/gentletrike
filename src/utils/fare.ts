import { VEHICLE_DETAILS } from '../data/dumagueteData';
import { TransportMode } from '../types';

/** Distance covered by the base fare. Anything past this starts charging. */
export const BASE_DISTANCE_KM = 1;

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

/** Total for the whole booking. Each passenger pays the ordinance rate. */
export function totalFare(
  mode: TransportMode,
  distanceKm: number,
  passengers: number
): number {
  return farePerPassenger(mode, distanceKm) * Math.max(1, passengers);
}
