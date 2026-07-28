/**
 * Transport modes and their published rates.
 *
 * Lives in shared/ because three callers need the same numbers: the booking UI,
 * the fare maths, and Gently's `estimate_fare` tool. A second copy of these
 * rates would eventually drift from the ordinance and quote passengers a fare
 * the driver does not recognise.
 */

export type TransportMode = 'pedicab_standard' | 'habal_habal' | 'multicab';

export interface VehicleDetail {
  title: string;
  subtitle: string;
  capacity: string;
  /** Covers the first BASE_DISTANCE_KM, in pesos. */
  baseFare: number;
  /** Charged per succeeding kilometre *or fraction thereof*, in pesos. */
  perKm: number;
  eta: string;
}

export const VEHICLE_DETAILS: Record<TransportMode, VehicleDetail> = {
  pedicab_standard: {
    title: 'Pedicab Standard',
    subtitle: 'Classic Dumaguete Motorcab',
    capacity: '4-6 passengers',
    baseFare: 15,
    perKm: 2,
    eta: '3 mins',
  },
  habal_habal: {
    title: 'Habal-Habal Express',
    subtitle: 'Fast Solo Motorcycle Taxi',
    capacity: '1 passenger',
    baseFare: 25,
    perKm: 3,
    eta: '2 mins',
  },
  multicab: {
    title: 'EasyRide',
    subtitle: 'Group / Suburb Route',
    capacity: '12 passengers',
    baseFare: 15,
    perKm: 2,
    eta: '6 mins',
  },
};

export const TRANSPORT_MODES = Object.keys(VEHICLE_DETAILS) as TransportMode[];

/** Narrow arbitrary input (an LLM tool argument, a request body) to a real mode. */
export function isTransportMode(value: unknown): value is TransportMode {
  return typeof value === 'string' && value in VEHICLE_DETAILS;
}
