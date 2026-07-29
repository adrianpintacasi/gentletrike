import {
  sequenceStops,
  rankCandidates,
  scoreCandidate,
  detourKmFor,
  ALONG_THE_WAY_KM,
  HIDE_BEYOND_KM,
  type Stop,
  type Candidate,
} from '../shared/dispatch';

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

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
