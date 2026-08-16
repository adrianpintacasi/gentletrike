/**
 * Transport modes and their published rates.
 *
 * Lives in shared/ because three callers need the same numbers: the booking UI,
 * the fare maths, and Gently's `estimate_fare` tool. A second copy of these
 * rates would eventually drift from the ordinance and quote passengers a fare
 * the driver does not recognise.
 *
 * GentleTrike carries one vehicle: the pedicab. Habal-habal and multicab were
 * removed deliberately — a multicab runs a fixed route, which is a scheduled
 * service rather than something you hail, and modelling it as bookable would
 * have been a lie about how it works. They belong on the roadmap, not in the
 * booking panel.
 *
 * `pakyaw_charter` stays, because it is not a vehicle. It is an arrangement:
 * the same pedicab hired whole at a flat price agreed with the rider, which is
 * how out-of-town trips are actually done. One vehicle, two rate cards.
 */

export type TransportMode = 'pedicab_standard' | 'pakyaw_charter';

export interface VehicleDetail {
  title: string;
  subtitle: string;
  capacity: string;
  /**
   * Seats, as a number the server can actually enforce.
   *
   * `capacity` above is display text ("4-6 passengers"), which no check can
   * use. Pooling lets one rider hold several trips at once, so without a
   * numeric ceiling a pedicab can be assigned more passengers than it seats.
   */
  maxPassengers: number;
  /** Covers the first BASE_DISTANCE_KM, in pesos. */
  baseFare: number;
  /** Charged per succeeding kilometre *or fraction thereof*, in pesos. */
  perKm: number;
  eta: string;
}

export const VEHICLE_DETAILS: Record<TransportMode, VehicleDetail> = {
  pedicab_standard: {
    title: 'Pedicab',
    subtitle: 'Shared ride along common route · Standard fare',
    capacity: 'Seats 4–6',
    maxPassengers: 6,
    baseFare: 15,
    perKm: 2,
    eta: '3 mins',
  },
  pakyaw_charter: {
    title: 'Pakyaw / Private Charter',
    subtitle: 'Exclusive hire · Direct private ride for your group',
    capacity: 'Entire vehicle (up to 6 seats)',
    maxPassengers: 6,
    baseFare: 70,
    perKm: 5,
    eta: 'On demand',
  },
};

export const TRANSPORT_MODES = Object.keys(VEHICLE_DETAILS) as TransportMode[];

/** Narrow arbitrary input (an LLM tool argument, a request body) to a real mode. */
export function isTransportMode(value: unknown): value is TransportMode {
  return typeof value === 'string' && value in VEHICLE_DETAILS;
}

/**
 * Read a mode from data that may predate the vehicle list being narrowed.
 *
 * Rows written before habal-habal and multicab were removed still carry those
 * strings, and looking them up in VEHICLE_DETAILS returns undefined — which
 * crashes Trip History and the admin directory on a passenger's own past trips.
 * Anything unrecognised is read as a pedicab, which is what those trips were
 * carried by in practice.
 */
export function asTransportMode(value: unknown): TransportMode {
  return isTransportMode(value) ? value : 'pedicab_standard';
}

/** Details for a stored mode, tolerant of retired ones. See {@link asTransportMode}. */
export const vehicleDetail = (value: unknown): VehicleDetail =>
  VEHICLE_DETAILS[asTransportMode(value)];
