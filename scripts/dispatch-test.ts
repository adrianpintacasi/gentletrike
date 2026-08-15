import {
  sequenceStops,
  canServeTrip,
  isExclusiveTrip,
  rankCandidates,
  scoreCandidate,
  detourKmFor,
  ALONG_THE_WAY_KM,
  HIDE_BEYOND_KM,
  MAX_ONBOARD_STRETCH,
  MIN_ONBOARD_ALLOWANCE_KM,
  type Stop,
  type Candidate,
} from '../shared/dispatch';
import { haversineKm } from '../shared/geo';

/**
 * Verifies which open trips a rider is offered.
 *
 * Uses real Dumaguete coordinates from the app's own pickup points, so the
 * distances are the ones riders would actually travel.
 *
 *   npm run dispatch:test
 */
const P = {
  silliman: { lat: 9.3105, lng: 123.3075 },
  robinsons: { lat: 9.2987, lng: 123.3027 },
  boulevard: { lat: 9.3058, lng: 123.311 },
  market: { lat: 9.3057, lng: 123.3104 },
  cathedral: { lat: 9.3049, lng: 123.3078 },
  leePlaza: { lat: 9.308, lng: 123.3076 },
  bantayan: { lat: 9.328, lng: 123.3076 },
  airport: { lat: 9.3326, lng: 123.296 },
  cityMall: { lat: 9.3237, lng: 123.2987 },
};

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const m = (km: number) => `${Math.round(km * 1000)} m`;

console.log(`\n"On your route" under ${m(ALONG_THE_WAY_KM)} · hidden only beyond ${m(HIDE_BEYOND_KM)}\n`);

// ---------------------------------------------------------------------------
console.log('=== 1. Idle rider: no route yet, so nearest pickup wins ===');

const idleCandidates: Candidate[] = [
  { rideId: 'far', pickup: P.airport, dropoff: P.cityMall, passengers: 1 },
  { rideId: 'near', pickup: P.leePlaza, dropoff: P.robinsons, passengers: 1 },
  { rideId: 'mid', pickup: P.boulevard, dropoff: P.market, passengers: 1 },
];

const idleRanked = rankCandidates(P.silliman, [], idleCandidates);
idleRanked.forEach((s) =>
  console.log(`    ${s.rideId.padEnd(5)} pickup ${m(s.pickupDistanceKm).padStart(7)}  ${s.reason}`)
);
check('nearest pickup ranked first', idleRanked[0].rideId === 'near', idleRanked[0].rideId);
check('all detours are zero when idle', idleRanked.every((s) => s.detourKm === 0));
check('everything in town is eligible', idleRanked.every((s) => s.eligible));

// ---------------------------------------------------------------------------
console.log('\n=== 2. Rider committed to Silliman -> Robinsons (heading south-west) ===');

const committed: Stop[] = [{ at: P.robinsons, kind: 'dropoff', rideId: 'r1' }];

const cases: [string, Candidate][] = [
  ['on-the-way', { rideId: 'on-the-way', pickup: P.leePlaza, dropoff: P.cathedral, passengers: 1 }],
  ['slight-east', { rideId: 'slight-east', pickup: P.boulevard, dropoff: P.market, passengers: 1 }],
  ['opposite', { rideId: 'opposite', pickup: P.bantayan, dropoff: P.airport, passengers: 1 }],
];

for (const [label, c] of cases) {
  const s = scoreCandidate(P.silliman, committed, c);
  console.log(
    `    ${label.padEnd(12)} detour ${m(s.detourKm).padStart(8)}  ${s.eligible ? 'OFFERED' : 'hidden '}  (${s.reason})`
  );
}

const onWay = scoreCandidate(P.silliman, committed, cases[0][1]);
const opposite = scoreCandidate(P.silliman, committed, cases[2][1]);

check('a trip along the route is badged on-route', onWay.alongTheWay, m(onWay.detourKm));
check('a trip the opposite way is hidden', !opposite.eligible, m(opposite.detourKm));
check('opposite direction costs far more', opposite.detourKm > onWay.detourKm * 3);

// Accepting one passenger must not empty the queue — this is what pooling is
// for, and a hard detour filter previously broke it.
console.log('\n=== 2b. Accepting a passenger must NOT hide everything else ===');
const stillOffered = rankCandidates(P.silliman, committed, cases.map(([, c]) => c)).filter(
  (s) => s.eligible
);
check(
  'a moderate detour is still offered, just ranked lower',
  stillOffered.length >= 2,
  `${stillOffered.length} of ${cases.length} still shown`
);

// The case reported from real testing: rider running CityMall -> Lee, second
// passenger pinned near CityMall and heading to the Cathedral, which is 345 m
// beyond Lee. Both legs are the same direction, so this must be offered.
console.log('\n=== 2c. Reported case: CityMall -> Lee, plus a passenger to the Cathedral ===');
const pinnedNearCityMall = { lat: 9.3206, lng: 123.3004 };
const runToLee: Stop[] = [{ at: P.leePlaza, kind: 'dropoff', rideId: 'r1' }];

const beforePickup = scoreCandidate(P.cityMall, runToLee, {
  rideId: 'cathedral',
  pickup: pinnedNearCityMall,
  dropoff: P.cathedral,
  passengers: 1,
});
// Same trip, but the rider has already driven past the pickup point.
const pastPickup = scoreCandidate({ lat: 9.3199, lng: 123.304 }, runToLee, {
  rideId: 'cathedral',
  pickup: pinnedNearCityMall,
  dropoff: P.cathedral,
  passengers: 1,
});

console.log(`    rider still before the pickup : ${m(beforePickup.detourKm).padStart(7)}  ${beforePickup.reason}`);
console.log(`    rider already past the pickup : ${m(pastPickup.detourKm).padStart(7)}  ${pastPickup.reason}`);

check('offered when the rider has not passed the pickup', beforePickup.alongTheWay, m(beforePickup.detourKm));
check('still offered even after passing it, just ranked lower', pastPickup.eligible, pastPickup.reason);
check('backtracking costs more than not backtracking', pastPickup.detourKm > beforePickup.detourKm);

// ---------------------------------------------------------------------------
console.log('\n=== 3. Detour maths behaves sanely ===');

const zero = detourKmFor(P.silliman, [{ at: P.robinsons, kind: 'dropoff', rideId: 'r1' }], {
  rideId: 'x',
  pickup: P.silliman,
  dropoff: P.robinsons,
  passengers: 1,
});
check('a trip identical to the current route adds ~nothing', zero < 0.05, m(zero));

const backtrack = detourKmFor(P.silliman, [{ at: P.robinsons, kind: 'dropoff', rideId: 'r1' }], {
  rideId: 'y',
  pickup: P.bantayan,
  dropoff: P.silliman,
  passengers: 1,
});
check('doubling back costs real distance', backtrack > 1, m(backtrack));
check('detour is never negative', zero >= 0 && backtrack >= 0);

// ---------------------------------------------------------------------------
console.log('\n=== 4. Capacity is respected ===');

const big: Candidate = { rideId: 'group', pickup: P.leePlaza, dropoff: P.cathedral, passengers: 4 };
const withSeats = scoreCandidate(P.silliman, committed, big, { seatsAvailable: 5 });
const noSeats = scoreCandidate(P.silliman, committed, big, { seatsAvailable: 2 });

check('offered when seats remain', withSeats.eligible);
check('hidden when it would overfill', !noSeats.eligible, noSeats.reason);
check('reason is over-capacity', noSeats.reason === 'over-capacity');

// ---------------------------------------------------------------------------
console.log('\n=== 5. Ranking prefers the smallest detour ===');

const ranked = rankCandidates(P.silliman, committed, cases.map(([, c]) => c));
console.log('    ' + ranked.map((s) => `${s.rideId}:${m(s.detourKm)}`).join('  <  '));
check(
  'sorted ascending by detour',
  ranked.every((s, i) => i === 0 || ranked[i - 1].detourKm <= s.detourKm)
);

// ---------------------------------------------------------------------------
console.log('\n=== 6. Stop sequencing: one route, not one per passenger ===');

// Reported case: rider near CityMall carrying two trips. Visiting them in
// acceptance order means CityMall pickup -> Lee -> back out to the pinned
// pickup -> Cathedral, which draws a zigzag.
const riderNow = { lat: 9.3199, lng: 123.304 };
const pinned = { lat: 9.3206, lng: 123.3004 };

const seq = sequenceStops(riderNow, [
  { rideId: 'cityMallTrip', pickup: P.cityMall, dropoff: P.leePlaza },
  { rideId: 'pinnedTrip', pickup: pinned, dropoff: P.cathedral },
]);

seq.forEach((s) => console.log(`    ${s.order}. ${s.kind.padEnd(7)} ${s.rideId}`));

check('every stop is sequenced', seq.length === 4, `${seq.length} stops`);
for (const rideId of ['cityMallTrip', 'pinnedTrip']) {
  const pickupAt = seq.findIndex((s) => s.rideId === rideId && s.kind === 'pickup');
  const dropAt = seq.findIndex((s) => s.rideId === rideId && s.kind === 'dropoff');
  check(`${rideId}: collected before set down`, pickupAt < dropAt, `${pickupAt} < ${dropAt}`);
}
check(
  'both pickups happen before the last drop-off (stops interleave)',
  seq.filter((s) => s.kind === 'pickup').every((p) => p.order < seq[seq.length - 1].order)
);

// A passenger already aboard has no pickup left to drive to.
const aboard = sequenceStops(riderNow, [
  { rideId: 'onboard', pickup: null, dropoff: P.leePlaza },
  { rideId: 'waiting', pickup: pinned, dropoff: P.cathedral },
]);
check('an in-transit trip contributes only its drop-off', aboard.length === 3, `${aboard.length}`);
check(
  'no pickup is listed for the passenger already aboard',
  !aboard.some((s) => s.rideId === 'onboard' && s.kind === 'pickup')
);

// ---------------------------------------------------------------------------
console.log('\n=== 7. The chosen order is the fairest legal one, then the shortest ===');

// Brute-forced here independently of the implementation, so this catches a
// sequencer that quietly degrades rather than just agreeing with itself.
//
// Two contracts, since the fairness rule applies to passengers still waiting as
// well as those aboard: nobody may be carried far past their own booking, and the
// shortest ordering that manages it wins. With the cap lifted this must still
// find the true optimum — that is what proves the search itself is sound.
{
  const trips = [
    { rideId: 'a', pickup: P.silliman, dropoff: P.robinsons },
    { rideId: 'b', pickup: P.boulevard, dropoff: P.cathedral },
    { rideId: 'c', pickup: P.cityMall, dropoff: P.market },
  ];
  const riderAt = { lat: 9.315, lng: 123.305 };

  const flat = trips.flatMap((t) => [
    { key: `${t.rideId}P`, ride: t.rideId, kind: 'p', at: t.pickup },
    { key: `${t.rideId}D`, ride: t.rideId, kind: 'd', at: t.dropoff },
  ]);

  const legal = (order: typeof flat) => {
    const got = new Set<string>();
    for (const s of order) {
      if (s.kind === 'p') got.add(s.ride);
      else if (!got.has(s.ride)) return false;
    }
    return true;
  };
  const length = (order: typeof flat) => {
    let km = 0;
    let at = riderAt;
    for (const s of order) {
      km += haversineKm(at, s.at);
      at = s.at;
    }
    return km;
  };
  function* perms<T>(a: T[]): Generator<T[]> {
    if (a.length <= 1) return yield a;
    for (let i = 0; i < a.length; i++)
      for (const rest of perms([...a.slice(0, i), ...a.slice(i + 1)])) yield [a[i], ...rest];
  }

  /** How far this ordering carries people beyond what they booked, in km. */
  const excess = (order: typeof flat) => {
    let total = 0;
    for (const t of trips) {
      const from = order.findIndex((s) => s.ride === t.rideId && s.kind === 'p');
      const to = order.findIndex((s) => s.ride === t.rideId && s.kind === 'd');
      const booked = haversineKm(t.pickup, t.dropoff) * 1.32;
      let planned = 0;
      for (let i = from + 1; i <= to; i++) {
        planned += haversineKm(order[i - 1].at, order[i].at) * 1.32;
      }
      const allowed = Math.max(booked * MAX_ONBOARD_STRETCH, MIN_ONBOARD_ALLOWANCE_KM);
      if (planned > allowed) total += planned - allowed;
    }
    return total;
  };

  let bestKm = Infinity;
  let bestExcess = Infinity;
  let bestFairKm = Infinity;
  let checked = 0;
  for (const p of perms(flat)) {
    if (!legal(p)) continue;
    checked++;
    bestKm = Math.min(bestKm, length(p));
    const e = excess(p);
    if (e < bestExcess - 1e-9) {
      bestExcess = e;
      bestFairKm = length(p);
    } else if (Math.abs(e - bestExcess) <= 1e-9) {
      bestFairKm = Math.min(bestFairKm, length(p));
    }
  }

  const measure = (seq: ReturnType<typeof sequenceStops>) =>
    seq.map((s) => flat.find((f) => f.at.lat === s.at.lat && f.at.lng === s.at.lng)!);

  const chosen = measure(sequenceStops(riderAt, trips));
  const chosenKm = length(chosen);

  console.log(
    `    ${checked} legal orderings · shortest ${m(bestKm)} · fairest-then-shortest ${m(bestFairKm)} · chosen ${m(chosenKm)}`
  );

  check(
    'the chosen ordering is as fair as any legal ordering gets',
    excess(chosen) <= bestExcess + 1e-9,
    `${m(excess(chosen))} over vs best possible ${m(bestExcess)}`
  );
  check(
    'and the shortest among those',
    chosenKm <= bestFairKm + 1e-9,
    m(chosenKm - bestFairKm) + ' worse'
  );

  // With fairness switched off the sequencer must still find the true optimum,
  // which is what proves the ordering search has not degraded.
  const rawKm = length(
    measure(sequenceStops(riderAt, trips, { maxStretch: Infinity, minAllowedKm: Infinity }))
  );
  console.log(`    with the cap lifted: ${m(rawKm)} (optimum ${m(bestKm)})`);
  check(
    'with the cap lifted it still matches the brute-forced optimum',
    rawKm <= bestKm + 1e-9,
    m(rawKm - bestKm) + ' worse'
  );

  // Protecting people costs the rider distance; that trade must be visible, not
  // hidden, so it is asserted rather than assumed.
  check(
    'fairness costs the rider some distance here',
    chosenKm > rawKm,
    `${m(chosenKm)} fair vs ${m(rawKm)} shortest`
  );
}

// ---------------------------------------------------------------------------
console.log('\n=== 8. Pakyaw charters reach riders, and are exclusive ===');

// Riders register as a pedicab, habal-habal or multicab — never as
// "pakyaw_charter". Comparing vehicle types by equality meant no rider ever
// matched a charter booking, so those requests reached nobody at all.
for (const riderVehicle of ['pedicab_standard', 'habal_habal', 'multicab']) {
  check(
    `a ${riderVehicle} can take a pakyaw charter`,
    canServeTrip(riderVehicle, 'pakyaw_charter')
  );
}

check('a pedicab is still offered pedicab trips', canServeTrip('pedicab_standard', 'pedicab_standard'));
check(
  'a habal-habal is still not offered an EasyRide',
  !canServeTrip('habal_habal', 'multicab')
);

check('pakyaw is flagged exclusive', isExclusiveTrip('pakyaw_charter'));
check('an ordinary trip is not', !isExclusiveTrip('pedicab_standard'));

// ---------------------------------------------------------------------------
// Individually cheap detours used to accumulate without limit: the passenger
// already aboard could be carried a long way round and set down last, having
// agreed to none of it. The fix is an ordering rule, not a refusal — a fair
// ordering always exists, because serving each trip in turn stretches nobody.
console.log('\n=== 9. The passenger already aboard is not set down last ===');

// The exact regression: A is aboard from Silliman to Robinsons, and the rider
// then accepts two more short trips. Every detour was individually small, and
// ordering on distance alone still set A down last — 2.6 km for a 1.9 km booking.
const aBookedKm = haversineKm(P.silliman, P.robinsons) * 1.32;
const pastRobinsons = { lat: 9.2945, lng: 123.301 };

const pooled = [
  { rideId: 'A', pickup: null, dropoff: P.robinsons, origin: P.silliman },
  { rideId: 'B', pickup: P.leePlaza, dropoff: P.cathedral },
  { rideId: 'C', pickup: P.boulevard, dropoff: P.market },
];

console.log(`    A booked Silliman -> Robinsons = ${m(aBookedKm)}`);
console.log(
  `    cap ${MAX_ONBOARD_STRETCH}x, or ${m(MIN_ONBOARD_ALLOWANCE_KM)} whichever is greater` +
    ` -> A may ride ${m(Math.max(aBookedKm * MAX_ONBOARD_STRETCH, MIN_ONBOARD_ALLOWANCE_KM))}\n`
);

const withStretchCap = sequenceStops(P.silliman, pooled);
// The same stops with the cap lifted: distance alone decides, as it used to.
const distanceOnly = sequenceStops(P.silliman, pooled, {
  maxStretch: Infinity,
  minAllowedKm: Infinity,
});

const describe = (seq: { rideId: string; kind: string }[]) =>
  seq.map((s) => `${s.kind === 'pickup' ? '+' : '-'}${s.rideId}`).join(' ');
console.log(`    distance only : ${describe(distanceOnly)}`);
console.log(`    with the cap  : ${describe(withStretchCap)}`);

/** Where in the driven order this trip's passenger is finally set down. */
const dropIndex = (seq: { rideId: string; kind: string }[], rideId: string) =>
  seq.findIndex((s) => s.rideId === rideId && s.kind === 'dropoff');

check(
  'ordering on distance alone sets A down last (the bug)',
  dropIndex(distanceOnly, 'A') === distanceOnly.length - 1,
  describe(distanceOnly)
);
check(
  'the cap moves A off the back of the queue (the fix)',
  dropIndex(withStretchCap, 'A') < dropIndex(distanceOnly, 'A'),
  `${describe(distanceOnly)}  ->  ${describe(withStretchCap)}`
);
check(
  'pooling still happens — someone else is collected before A is dropped',
  withStretchCap.some((s) => s.kind === 'pickup') &&
    withStretchCap.findIndex((s) => s.kind === 'pickup') < dropIndex(withStretchCap, 'A'),
  describe(withStretchCap)
);

// The distances that make the rule worth having: how far A actually rides.
const ridesUntilDropped = (seq: { at: typeof P.silliman; rideId: string; kind: string }[]) => {
  let km = 0;
  let at = P.silliman;
  for (const s of seq) {
    km += haversineKm(at, s.at) * 1.32;
    at = s.at;
    if (s.rideId === 'A' && s.kind === 'dropoff') break;
  }
  return km;
};
const cappedKm = ridesUntilDropped(withStretchCap);
const uncappedKm = ridesUntilDropped(distanceOnly);
console.log(
  `\n    A rides ${m(cappedKm)} with the cap vs ${m(uncappedKm)} on distance alone (booked ${m(aBookedKm)})`
);
check(
  "A's own journey stays within the cap",
  cappedKm <= Math.max(aBookedKm * MAX_ONBOARD_STRETCH, MIN_ONBOARD_ALLOWANCE_KM) + 1e-9,
  m(cappedKm)
);
check('and is shorter than it was before the cap', cappedKm < uncappedKm, `${m(cappedKm)} < ${m(uncappedKm)}`);

// A genuinely on-route trip must still be offered, and still badged: the cap
// protects passengers, it must not quietly switch pooling off.
const aAboard: Stop[] = [
  { at: P.robinsons, kind: 'dropoff', rideId: 'A', origin: P.silliman },
];
const gentle = scoreCandidate(P.silliman, aAboard, {
  rideId: 'gentle',
  pickup: P.leePlaza,
  dropoff: P.cathedral,
  passengers: 1,
});
console.log(`\n    gentle jog (Lee -> Cathedral)  ${m(gentle.detourKm).padStart(8)}  ${gentle.reason}`);
check('a genuinely on-route trip is still offered', gentle.eligible, gentle.reason);
check('and still badged on-route', gentle.alongTheWay, m(gentle.detourKm));
check('its detour is still reported honestly', gentle.detourKm > 0 && gentle.detourKm < ALONG_THE_WAY_KM);

// Short trips must not be over-protected: 1.5x of a 456 m hop is only 684 m, so
// the flat allowance is what keeps pooling possible on short journeys at all.
const shortBooked = haversineKm(P.leePlaza, P.cathedral) * 1.32;
const shortPool = scoreCandidate(
  P.leePlaza,
  [{ at: P.cathedral, kind: 'dropoff', rideId: 'S', origin: P.leePlaza }],
  { rideId: 'alsoShort', pickup: P.market, dropoff: P.boulevard, passengers: 1 }
);
console.log(
  `    a ${m(shortBooked)} trip pooling with another  ${m(shortPool.detourKm).padStart(8)}  ${shortPool.reason}`
);
check('the flat allowance keeps short trips poolable', shortPool.eligible, shortPool.reason);

// A trip that can only be served the unfair way must cost more, not vanish: the
// rider sees the price of the fair ordering and the usual thresholds judge it.
const fairCost = scoreCandidate(P.silliman, aAboard, {
  rideId: 'far',
  pickup: P.leePlaza,
  dropoff: pastRobinsons,
  passengers: 1,
});
const rawCost = detourKmFor(P.silliman, aAboard, {
  rideId: 'far',
  pickup: P.leePlaza,
  dropoff: pastRobinsons,
  passengers: 1,
});
console.log(`\n    Lee -> past Robinsons: fair ordering ${m(fairCost.detourKm)}, raw shortest ${m(rawCost)}`);
check('the fair ordering is never cheaper than the raw shortest', fairCost.detourKm >= rawCost - 1e-9);
check('and the trip is still offered rather than hidden', fairCost.eligible, fairCost.reason);

// Sequencing must not regress: a passenger is still never set down before being
// collected, however the fairness rule reorders things.
const legal = withStretchCap.every((s, i) =>
  s.kind !== 'dropoff'
    ? true
    : withStretchCap.findIndex((p) => p.rideId === s.rideId && p.kind === 'pickup') < i ||
      !withStretchCap.some((p) => p.rideId === s.rideId && p.kind === 'pickup')
);
check('nobody is set down before being collected', legal, describe(withStretchCap));

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
