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

/**
 * How much longer a passenger's own journey may become through pooling.
 *
 * Each detour was checked on its own and nothing stopped them accumulating:
 * three accepts at 400 m each quietly added 1.2 km to the ride of the passenger
 * already aboard, who was never asked and was set down last. Pooling is only
 * fair if the person already in the pedicab keeps roughly the trip they booked.
 *
 * Calibrated against that reported case rather than picked round: a passenger who
 * booked 1.9 km was being carried 2.6 km, so a cap has to sit below 1.4x to catch
 * it. 1.3x leaves real room for pooling while ruling out the long way round.
 */
export const MAX_ONBOARD_STRETCH = 1.3;

/**
 * Floor under the cap above, in km, so short trips are not over-protected.
 *
 * A ratio alone makes brief journeys almost unpoolable — 1.3x of a 450 m hop is
 * 585 m, which forbids the ordinary sideways jog to collect somebody. Any trip
 * may reach this distance regardless of what it booked.
 *
 * A floor rather than a bonus added on top: adding it would have made the cap
 * meaningless on medium trips, where 800 m of slack is itself a 40% diversion.
 */
export const MIN_ONBOARD_ALLOWANCE_KM = 0.8;

/**
 * How long a trip may sit unaccepted before the passenger is told plainly that
 * nothing is coming.
 *
 * There is no auto-cancel: a pedicab may genuinely be four minutes away, and
 * cancelling a ride the passenger still wants is worse than making them wait.
 * This only changes what they are shown — "waiting for a rider" forever is the
 * one thing we must not do.
 */
export const SEARCH_STALL_MINUTES = 3;

/**
 * How long a rider's decline hides a trip from them.
 *
 * Declines used to be permanent, which had a nasty failure mode: once every
 * nearby rider had passed on a trip it was invisible to all of them while the
 * passenger was still told to wait. Expiring the decline puts the trip back in
 * the queue — circumstances change, and a rider heading the other way ten
 * minutes ago may now be pointed straight at it.
 *
 * Comfortably longer than the stall warning, so a rider is not re-shown the
 * same trip they just dismissed.
 */
export const DECLINE_COOLDOWN_MINUTES = 10;

export interface Stop {
  at: LatLng;
  kind: 'pickup' | 'dropoff';
  rideId: string;
  /**
   * Where this passenger was collected.
   *
   * Only needed on a drop-off whose pickup has already been left behind — the
   * passenger is aboard, so their pickup is no longer a stop to visit, but it is
   * still what their journey has to be measured against.
   */
  origin?: LatLng;
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
  reason:
    | 'idle'
    | 'along-the-way'
    | 'worth-a-detour'
    | 'too-far'
    | 'wrong-direction'
    | 'over-capacity';
}

/** Road-ish length of a path through the given points, in km. */
function pathLengthKm(points: LatLng[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i]);
  return km * ROAD_FACTOR;
}

/** A point on a trial route, tagged with whose trip it belongs to. */
interface RoutePoint {
  at: LatLng;
  /** Null for the rider's own current position, which belongs to no trip. */
  rideId: string | null;
  kind: 'pickup' | 'dropoff' | 'rider';
  origin?: LatLng;
}

export interface StretchLimits {
  /** Most a passenger's own journey may be multiplied by. */
  maxStretch: number;
  /** Distance any trip may reach regardless of the multiplier — a floor, not a bonus. */
  minAllowedKm: number;
}

/** Limits that permit anything — for callers measuring raw distance only. */
const NO_STRETCH_LIMITS: StretchLimits = {
  maxStretch: Infinity,
  minAllowedKm: Infinity,
};

/** The distance a trip that booked `bookedKm` may be carried, in km. */
const allowedKm = (bookedKm: number, limits: StretchLimits): number =>
  Math.max(bookedKm * limits.maxStretch, limits.minAllowedKm);

/** The shape both the scorer and the sequencer can be measured through. */
interface FairnessPoint {
  at: LatLng;
  rideId: string | null;
  kind: 'pickup' | 'dropoff' | 'rider';
  origin?: LatLng;
}

/**
 * How far this route carries people beyond the journey they agreed to, in km,
 * summed over everyone aboard or waiting. Zero means nobody is worse off than
 * the trip they booked plus the allowance.
 *
 * Measured per passenger rather than per accept, because that is where the
 * unfairness lives: three individually cheap diversions add up to a long way
 * round for whoever is sitting in the pedicab through all of them, and the
 * person who booked first can end up set down last.
 *
 * A number rather than a yes/no so it can rank orderings, not just veto them —
 * the useful answer to "this ordering is unfair" is almost always a different
 * ordering rather than a refused trip.
 */
function stretchExcessKm(
  riderAt: LatLng,
  points: FairnessPoint[],
  limits: StretchLimits
): number {
  if (limits.maxStretch === Infinity) return 0;

  // Distance from the rider's current position to each point along this route.
  const cumulative: number[] = [];
  let travelled = 0;
  let previous = riderAt;
  for (const p of points) {
    travelled += haversineKm(previous, p.at) * ROAD_FACTOR;
    cumulative.push(travelled);
    previous = p.at;
  }

  let excess = 0;

  for (let k = 0; k < points.length; k++) {
    const stop = points[k];
    if (stop.kind !== 'dropoff') continue;

    const pickupIndex = points.findIndex(
      (p) => p.kind === 'pickup' && p.rideId === stop.rideId
    );

    let booked: number;
    let planned: number;

    if (pickupIndex >= 0) {
      // Not collected yet, so their whole journey is still ahead: it is exactly
      // the stretch of route between their pickup and their drop-off.
      booked = haversineKm(points[pickupIndex].at, stop.at) * ROAD_FACTOR;
      planned = cumulative[k] - cumulative[pickupIndex];
    } else if (stop.origin) {
      // Aboard already. What they have travelled so far cannot be recovered from
      // the remaining route, so count it as the direct line from where they got
      // on — an under-estimate, which keeps this on the permissive side rather
      // than penalising a route on a guess.
      booked = haversineKm(stop.origin, stop.at) * ROAD_FACTOR;
      planned = haversineKm(stop.origin, riderAt) * ROAD_FACTOR + cumulative[k];
    } else {
      // Aboard, but we were not told where from — nothing to measure against.
      continue;
    }

    const allowed = allowedKm(booked, limits);
    if (planned > allowed) excess += planned - allowed;
  }

  return excess;
}

interface Insertion {
  detourKm: number;
  order: RoutePoint[];
}

/**
 * Cheapest way to fit a new pickup and drop-off into the route the rider is
 * already committed to, without treating the people already on it unfairly.
 *
 * Tries every position for the pickup and every later position for the
 * drop-off — a passenger cannot be set down before being collected. The stop
 * list is short (a pedicab holds a handful of trips), so the quadratic search
 * is cheaper than it looks and always finds the true best insertion rather than
 * approximating one.
 *
 * Fairness is weighed before distance, not after: the shortest ordering overall
 * is often the one that drags whoever is aboard to the back of the queue, and a
 * slightly longer ordering that sets them down on time is the better route. In
 * practice a fair ordering always exists — serving each trip in turn leaves
 * nobody stretched — so this is a re-ordering rule rather than a veto.
 *
 * The consequence for the rider is honest rather than hidden: a trip that can
 * only be served by keeping someone aboard the long way round reports the larger
 * detour of the fair ordering, and the ordinary distance thresholds then judge it
 * on that.
 */
function bestInsertion(
  riderAt: LatLng,
  committed: Stop[],
  candidate: Candidate,
  limits: StretchLimits
): Insertion {
  const base: RoutePoint[] = committed.map((s) => ({
    at: s.at,
    rideId: s.rideId,
    kind: s.kind,
    origin: s.origin,
  }));
  const baseline = pathLengthKm([riderAt, ...base.map((p) => p.at)]);

  let best: Insertion | null = null;
  let bestExcess = Infinity;

  // i = index to insert the pickup at, j = index to insert the drop-off at.
  for (let i = 0; i <= base.length; i++) {
    for (let j = i; j <= base.length; j++) {
      const order = [...base];
      order.splice(i, 0, {
        at: candidate.pickup,
        rideId: candidate.rideId,
        kind: 'pickup',
      });
      order.splice(j + 1, 0, {
        at: candidate.dropoff,
        rideId: candidate.rideId,
        kind: 'dropoff',
      });

      const detourKm = Math.max(
        0,
        pathLengthKm([riderAt, ...order.map((p) => p.at)]) - baseline
      );
      const excess = stretchExcessKm(riderAt, order, limits);

      // Least unfair first, shortest among equals.
      if (excess > bestExcess) continue;
      if (excess === bestExcess && best && detourKm >= best.detourKm) continue;

      bestExcess = excess;
      best = { detourKm, order };
    }
  }

  // Unreachable — the loops always produce at least one ordering — but typed as
  // definite so callers do not carry a null case that cannot happen.
  return best ?? { detourKm: 0, order: base };
}

/**
 * Extra kilometres this trip adds to the rider's route, ignoring fairness.
 *
 * The raw geometric figure, kept separate so it can be reasoned about (and
 * tested) without the onboard-stretch policy folded in.
 */
export function detourKmFor(
  riderAt: LatLng,
  committed: Stop[],
  candidate: Candidate
): number {
  return bestInsertion(riderAt, committed, candidate, NO_STRETCH_LIMITS).detourKm;
}

/**
 * Trip types that hire the whole vehicle.
 *
 * A pakyaw charter is booked as one flat fare for the vehicle, and the rider
 * carries that party alone. Pooling anyone else into it would be selling the
 * same seats twice.
 */
const EXCLUSIVE_MODES = new Set(['pakyaw_charter']);

export const isExclusiveTrip = (vehicleType: string): boolean =>
  EXCLUSIVE_MODES.has(vehicleType);

/**
 * Whether a rider's vehicle can serve a booking.
 *
 * `pakyaw_charter` is an arrangement rather than a vehicle class — riders
 * register as a pedicab, habal-habal or multicab, and any of them can be
 * chartered. Comparing it by equality meant no rider ever matched a pakyaw
 * booking, so those requests reached nobody.
 */
export function canServeTrip(riderVehicle: string, rideVehicle: string): boolean {
  if (isExclusiveTrip(rideVehicle)) return true;
  return riderVehicle === rideVehicle;
}

export interface RideStops {
  rideId: string;
  /** Null once the passenger is aboard — that stop is behind the rider. */
  pickup: LatLng | null;
  dropoff: LatLng;
  /**
   * Where this passenger was collected, for a trip already under way.
   *
   * Supply it whenever `pickup` is null, so the ordering knows what this
   * passenger's journey should be measured against. Without it their trip is
   * ordered on distance alone and they can be set down last.
   */
  origin?: LatLng;
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
 * Two rules, in order of priority: nobody is carried far past the journey they
 * booked, and among the orderings that manage that, the shortest wins. A
 * passenger is always collected before they are set down.
 *
 * Fairness has to be applied here and not only when scoring a new trip, because
 * this is the route the rider actually drives. Ordering on distance alone let the
 * first passenger aboard be set down last whenever that happened to save the
 * rider a few hundred metres.
 */
export function sequenceStops(
  riderAt: LatLng,
  rides: RideStops[],
  limits: StretchLimits = {
    maxStretch: MAX_ONBOARD_STRETCH,
    minAllowedKm: MIN_ONBOARD_ALLOWANCE_KM,
  }
): SequencedStop[] {
  const pending: PendingStop[] = [];
  for (const r of rides) {
    if (r.pickup) {
      pending.push({ rideId: r.rideId, kind: 'pickup', at: r.pickup, blockedBy: null });
      pending.push({ rideId: r.rideId, kind: 'dropoff', at: r.dropoff, blockedBy: r.rideId });
    } else {
      // Already aboard: the drop-off is immediately available.
      pending.push({
        rideId: r.rideId,
        kind: 'dropoff',
        at: r.dropoff,
        blockedBy: null,
        origin: r.origin,
      });
    }
  }

  const ordered = pending.length <= EXACT_SEQUENCE_LIMIT
    ? exactOrder(riderAt, pending, limits)
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
  origin?: LatLng;
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
 * Fairest ordering that never sets a passenger down before collecting them, and
 * the shortest of those.
 *
 * Greedy nearest-next can strand a stop and double back for it; with eight or
 * fewer stops every legal ordering can simply be measured, so it does not have
 * to guess. Measuring them all is also what makes the fairness rule affordable —
 * each candidate ordering is already in hand, so checking who it treats badly
 * costs one pass over a handful of stops.
 */
function exactOrder(
  riderAt: LatLng,
  pending: PendingStop[],
  limits: StretchLimits
): PendingStop[] {
  let best: PendingStop[] = [];
  let bestKm = Infinity;
  let bestExcess = Infinity;

  const walk = (chosen: PendingStop[], left: PendingStop[], collected: Set<string>) => {
    if (!left.length) {
      const km = pathKm(riderAt, chosen);
      const excess = stretchExcessKm(riderAt, chosen, limits);

      // Least unfair first, shortest among equals.
      if (excess < bestExcess || (excess === bestExcess && km < bestKm)) {
        bestExcess = excess;
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
  /** Most a committed passenger's own journey may be multiplied by. */
  maxOnboardStretch?: number;
  /** Distance any trip may reach regardless of the multiplier. */
  minOnboardAllowanceKm?: number;
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

  // Costed against the fair ordering, not the shortest one. A trip that can only
  // be served by carrying someone aboard the long way round therefore reports the
  // larger figure, and the thresholds below judge it on that — the protection
  // shows up as an honest price rather than a silent rejection.
  const detourKm = bestInsertion(riderAt, committed, candidate, {
    maxStretch: opts.maxOnboardStretch ?? MAX_ONBOARD_STRETCH,
    minAllowedKm: opts.minOnboardAllowanceKm ?? MIN_ONBOARD_ALLOWANCE_KM,
  }).detourKm;

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
