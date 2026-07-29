import { checkServiceArea, DUMAGUETE_BBOX } from '../shared/serviceArea';
import { DUMAGUETE_LOCATIONS } from '../src/data/dumagueteData';

/**
 * Guards what a passenger is allowed to book.
 *
 * Free-text search can surface anywhere on earth. The fare table and the rider
 * network are Dumaguete-only, so this boundary is what stops the app quoting a
 * pedicab to Cebu.
 *
 *   npm run area:test
 */
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log(
  `\nBoundary bbox: lat ${DUMAGUETE_BBOX.minLat}..${DUMAGUETE_BBOX.maxLat}, ` +
    `lng ${DUMAGUETE_BBOX.minLng}..${DUMAGUETE_BBOX.maxLng}\n`
);

console.log('=== 1. Every bookable pickup point must be inside ===');
// If one of the app's own points were rejected, passengers would lose a
// destination the booking panel still offers them.
for (const loc of DUMAGUETE_LOCATIONS) {
  const r = checkServiceArea(loc.lat, loc.lng);
  check(loc.name, r.inside, r.reason);
}

console.log('\n=== 2. Neighbouring towns are outside ===');
const outside: [string, number, number][] = [
  ['Valencia town', 9.2745, 123.2419],
  ['Bacong', 9.2456, 123.2933],
  ['Dauin', 9.1928, 123.2661],
  ['Zamboanguita', 9.1017, 123.1944],
  ['Siquijor town', 9.2144, 123.5153],
  ['Cebu City', 10.3157, 123.8854],
  ['Manila', 14.5995, 120.9842],
];
for (const [name, lat, lng] of outside) {
  const r = checkServiceArea(lat, lng);
  check(`${name} rejected`, !r.inside, r.reason);
}

console.log('\n=== 3. Well-known spots inside the city ===');
const inside: [string, number, number][] = [
  ['Quezon Park', 9.3072, 123.3068],
  ['Dumaguete Cathedral', 9.3049, 123.3078],
  ['Silliman Beach', 9.3315, 123.3097],
  ['Daro', 9.3237, 123.2987],
  ['Bantayan', 9.328, 123.3076],
  ['Piapi', 9.3182, 123.3096],
];
for (const [name, lat, lng] of inside) {
  const r = checkServiceArea(lat, lng);
  check(`${name} accepted`, r.inside, r.reason);
}

console.log('\n=== 4. Sibulan Airport is served despite sitting outside the polygon ===');
const airport = checkServiceArea(9.3326, 123.296);
check('airport accepted', airport.inside, airport.reason);
check(
  'accepted as a known pickup point, not as city territory',
  airport.reason === 'known-pickup-point',
  airport.reason
);
// The allowance must not quietly swallow the neighbouring town.
const sibulanTown = checkServiceArea(9.3611, 123.2919);
check('but Sibulan town centre is still rejected', !sibulanTown.inside, sibulanTown.reason);

console.log('\n=== 5. Rubbish input is rejected, not crashed on ===');
for (const [lat, lng] of [
  [NaN, 123.3],
  [9.3, NaN],
  [0, 0],
  [999, 999],
] as [number, number][]) {
  check(`(${lat}, ${lng}) rejected`, !checkServiceArea(lat, lng).inside);
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
