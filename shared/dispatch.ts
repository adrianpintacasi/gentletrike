import { haversineKm, type LatLng } from './geo';

/**
 * Deciding which open trips to show a rider.
 *
 * Dumaguete pedicabs do not run fixed routes. The first passenger sets the
 * direction, and the rider then picks up others who are going roughly the same
 * way, accepting a small diversion. This module turns "roughly the same way"
 * into a number: how much further the rider travels if they take this trip too.
 *
 * Pure functions on purpose — no database, no network — so the behaviour can be
 * tested exhaustively without either.
 */

/** Straight lines understate road distance; the same factor geo.ts uses offline. */
const ROAD_FACTOR = 1.32;

/**
 * Detour under which a trip is genuinely "on the way" and gets a badge.
 *
 * This is a label, NOT a filter. An earlier version hid everything above this
 * line, which emptied the queue the moment a rider accepted anyone — the exact
 * opposite of pooling. Riders decide what is worth a diversion; our job is to
 * put the cheapest options first and show the cost honestly.
 *
 * Set generously against the intuition: a rider picturing "200 m off my route"
 * is usually looking at 500-600 m of real extra travel, because reaching a
 * pickup behind them and returning is counted in full.
 */
export const ALONG_THE_WAY_KM = 0.8;

/**
 * Only genuinely wrong-direction trips are hidden.
 *
 * At this distance the rider would abandon their current route rather than
 * extend it, so showing it is noise. Everything below is offered with its
 * detour stated.
 */
export const HIDE_BEYOND_KM = 3;

/**
 * A rider with no trips yet has no route to be "along", so nothing is a detour.
 * Trips within this radius are offered, nearest first.
 */
export const FIRST_PASSENGER_RADIUS_KM = 3;

export interface Stop {
  at: LatLng;
  kind: 'pickup' | 'dropoff';
  rideId: string;
}

export interface Candidate {
  rideId: string;
  pickup: LatLng;
  dropoff: LatLng;
  passengers: number;
}

export interface DispatchScore {
  rideId: string;
  /** Extra kilometres the rider travels by taking this trip. 0 when idle. */
  detourKm: number;
  /** Straight-line km from the rider to the pickup. */
  pickupDistanceKm: number;
  /** Worth showing at all. False only for no seats or a wrong-direction trip. */
  eligible: boolean;
  /** Close enough to the current route to badge as on the way. */
  alongTheWay: boolean;
  reason: 'idle' | 'along-the-way' | 'worth-a-detour' | 'too-far' | 'wrong-direction' | 'over-capacity';
}

/** Road-ish length of a path through the given points, in km. */
function pathLengthKm(points: LatLng[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i]);
  return km * ROAD_FACTOR;
}

/**
 * Cheapest way to fit a new pickup and drop-off into the route the rider is
 * already committed to.
 *
 * Tries every position for the pickup and every later position for the
 * drop-off — a passenger cannot be set down before being collected. The stop
 * list is short (a pedicab holds a handful of trips), so the quadratic search
 * is cheaper than it looks and always finds the true best insertion rather than
 * approximating one.
 */
export function detourKmFor(
  riderAt: LatLng,
  committed: Stop[],
  candidate: Candidate
): number {
  const base = [riderAt, ...committed.map((s) => s.at)];
  const baseline = pathLengthKm(base);

  let best = Infinity;

  // i = index to insert the pickup at, j = index to insert the drop-off at.
  // Both are offsets into the stop list after the rider's own position, so
  // i starts at 1 — a passenger cannot be collected before the rider sets off.
  for (let i = 1; i <= base.length; i++) {
    for (let j = i; j <= base.length; j++) {
      const withStops = [...base];
      withStops.splice(i, 0, candidate.pickup);
      withStops.splice(j + 1, 0, candidate.dropoff);
      const length = pathLengthKm(withStops);
      if (length < best) best = length;
    }
  }

  return Math.max(0, best - baseline);
}

export interface RideStops {
  rideId: string;
  /** Null once the passenger is aboard — that stop is behind the rider. */
  pickup: LatLng | null;
  dropoff: LatLng;
}

export interface SequencedStop {
  rideId: string;
  kind: 'pickup' | 'dropoff';
  at: LatLng;
  /** 1-based position along the route the rider will actually drive. */
  order: number;
}

/**
 * Put the rider's committed stops into the order they should be driven.
 *
 * Without this the map strings stops together in the order trips were accepted
 * — drive to the first drop-off, then back out to the second pickup — which
 * draws a zigzag and describes a journey no rider would make. Pooling only
 * makes sense if the stops are interleaved.
 *
 * Greedy nearest-next, with the one rule that cannot be broken: a passenger is
 * collected before they are set down. A pedicab carries a handful of trips, so
 * the greedy answer is effectively the good one and costs nothing to compute on
 * every GPS tick.
 */
export function sequenceStops(riderAt: LatLng, rides: RideStops[]): SequencedStop[] {
  const pending: PendingStop[] = [];
  for (const r of rides) {
    if (r.pickup) {
      pending.push({ rideId: r.rideId, kind: 'pickup', at: r.pickup, blockedBy: null });
      pending.push({ rideId: r.rideId, kind: 'dropoff', at: r.dropoff, blockedBy: r.rideId });
    } else {
      // Already aboard: the drop-off is immediately available.
      pending.push({ rideId: r.rideId, kind: 'dropoff', at: r.dropoff, blockedBy: null });
    }
  }

  const ordered = pending.length <= EXACT_SEQUENCE_LIMIT
    ? exactOrder(riderAt, pending)
    : greedyOrder(riderAt, pending);

  return ordered.map((p, i) => ({
    rideId: p.rideId,
    kind: p.kind,
    at: p.at,
    order: i + 1,
  }));
}

interface PendingStop {
  rideId: string;
  kind: 'pickup' | 'dropoff';
  at: LatLng;
  blockedBy: string | null;
}

/**
 * Above this, searching every ordering stops being instant. A pedicab seats six
 * and rarely carries more than three trips, so the exact path is the normal one
 * and greedy is the safety valve.
 */
const EXACT_SEQUENCE_LIMIT = 8;

function pathKm(riderAt: LatLng, order: PendingStop[]): number {
  let km = 0;
  let at = riderAt;
  for (const s of order) {
    km += haversineKm(at, s.at);
    at = s.at;
  }
  return km;
}

/**
 * Shortest ordering that never sets a passenger down before collecting them.
 *
 * Greedy nearest-next can strand a stop and double back for it; with eight or
 * fewer stops every legal ordering can simply be measured, so it does not have
 * to guess.
 */
function exactOrder(riderAt: LatLng, pending: PendingStop[]): PendingStop[] {
  let best: PendingStop[] = [];
  let bestKm = Infinity;

  const walk = (chosen: PendingStop[], left: PendingStop[], collected: Set<string>) => {
    if (!left.length) {
      const km = pathKm(riderAt, chosen);
      if (km < bestKm) {
        bestKm = km;
        best = [...chosen];
      }
      return;
    }

    for (let i = 0; i < left.length; i++) {
      const s = left[i];
      if (s.blockedBy && !collected.has(s.blockedBy)) continue;

      const nextCollected = s.kind === 'pickup' ? new Set(collected).add(s.rideId) : collected;
      walk(
        [...chosen, s],
        [...left.slice(0, i), ...left.slice(i + 1)],
        nextCollected
      );
    }
  };

  walk([], pending, new Set());
  return best.length ? best : greedyOrder(riderAt, pending);
}

function greedyOrder(riderAt: LatLng, pending: PendingStop[]): PendingStop[] {
  const left = [...pending];
  const out: PendingStop[] = [];
  const collected = new Set<string>();
  let at = riderAt;

  while (left.length) {
    let bestIndex = -1;
    let bestKm = Infinity;

    for (let i = 0; i < left.length; i++) {
      const p = left[i];
      if (p.blockedBy && !collected.has(p.blockedBy)) continue;
      const km = haversineKm(at, p.at);
      if (km < bestKm) {
        bestKm = km;
        bestIndex = i;
      }
    }

    // Every remaining stop is blocked — impossible while each pickup is also in
    // the list, but bail rather than spin if the data is ever inconsistent.
    if (bestIndex === -1) break;

    const [next] = left.splice(bestIndex, 1);
    if (next.kind === 'pickup') collected.add(next.rideId);
    out.push(next);
    at = next.at;
  }

  return out;
}

export interface ScoreOptions {
  /** Detour under which a trip is badged as on the way. Label, not a filter. */
  alongTheWayKm?: number;
  /** Detour above which a trip is hidden as wrong-direction. */
  hideBeyondKm?: number;
  firstPassengerRadiusKm?: number;
  /** Seats left on the vehicle. Candidates needing more are rejected outright. */
  seatsAvailable?: number;
}

export function scoreCandidate(
  riderAt: LatLng,
  committed: Stop[],
  candidate: Candidate,
  opts: ScoreOptions = {}
): DispatchScore {
  const alongKm = opts.alongTheWayKm ?? ALONG_THE_WAY_KM;
  const hideKm = opts.hideBeyondKm ?? HIDE_BEYOND_KM;
  const radius = opts.firstPassengerRadiusKm ?? FIRST_PASSENGER_RADIUS_KM;
  const seats = opts.seatsAvailable ?? Infinity;

  const pickupDistanceKm = haversineKm(riderAt, candidate.pickup);

  // Seats are a hard limit — no amount of convenience creates another seat.
  if (candidate.passengers > seats) {
    return {
      rideId: candidate.rideId,
      detourKm: 0,
      pickupDistanceKm,
      eligible: false,
      alongTheWay: false,
      reason: 'over-capacity',
    };
  }

  // Idle rider: no route exists yet, so this trip *becomes* the route. Only
  // proximity matters. Treating this as a detour would reject every first
  // passenger, since any trip is infinitely far off an empty route.
  if (committed.length === 0) {
    const near = pickupDistanceKm <= radius;
    return {
      rideId: candidate.rideId,
      detourKm: 0,
      pickupDistanceKm,
      eligible: near,
      alongTheWay: near,
      reason: near ? 'idle' : 'too-far',
    };
  }

  const detourKm = detourKmFor(riderAt, committed, candidate);

  return {
    rideId: candidate.rideId,
    detourKm,
    pickupDistanceKm,
    eligible: detourKm <= hideKm,
    alongTheWay: detourKm <= alongKm,
    reason:
      detourKm <= alongKm
        ? 'along-the-way'
        : detourKm <= hideKm
          ? 'worth-a-detour'
          : 'wrong-direction',
  };
}

/**
 * Rank open trips for one rider: best fit first.
 *
 * An idle rider sorts by how close the pickup is; a rider already carrying
 * someone sorts by how little extra distance the trip adds.
 */
export function rankCandidates(
  riderAt: LatLng,
  committed: Stop[],
  candidates: Candidate[],
  opts: ScoreOptions = {}
): DispatchScore[] {
  const idle = committed.length === 0;

  return candidates
    .map((c) => scoreCandidate(riderAt, committed, c, opts))
    .sort((a, b) =>
      idle ? a.pickupDistanceKm - b.pickupDistanceKm : a.detourKm - b.detourKm
    );
}
