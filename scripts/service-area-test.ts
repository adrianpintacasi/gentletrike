import { checkServiceArea, hasFareAuthority, DUMAGUETE_BBOX } from '../shared/serviceArea';
import { DUMAGUETE_LOCATIONS } from '../src/data/dumagueteData';

/**
 * What the service-area check now answers.
 *
 * It used to guard what a passenger was allowed to book, and rejected anything
 * outside the Dumaguete polygon. That conflated two questions, and the second
 * one was the only jurisdictional one:
 *
 *   1. Can a rider and a passenger find each other here?   — always yes
 *   2. Do we know what the local council says this costs?  — sometimes
 *
 * So nothing is refused any more. These checks assert the new contract: the app
 * works everywhere, and the *official fare* is claimed only where an ordinance
 * is genuinely on file. Getting that second half wrong is the serious failure —
 * it means quoting a price no council ever passed.
 *
 *   npm run area:test
 */
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log(
  `\nDumaguete bbox: lat ${DUMAGUETE_BBOX.minLat.toFixed(4)}..${DUMAGUETE_BBOX.maxLat.toFixed(4)}, ` +
    `lng ${DUMAGUETE_BBOX.minLng.toFixed(4)}..${DUMAGUETE_BBOX.maxLng.toFixed(4)}\n`
);

console.log('=== 1. Nowhere is refused ===');
// The demo is in Cebu; the pitch is about a barangay in Zamboanga del Sur.
// Every one of these must be bookable.
const anywhere: [string, number, number][] = [
  ['CIT-U, Cebu City', 10.2949, 123.8811],
  ['Cebu City centre', 10.3157, 123.8854],
  ['Pagadian City', 7.8257, 123.437],
  ['Manila', 14.5995, 120.9842],
  ['Valencia town', 9.2745, 123.2419],
  ['Bacong', 9.2456, 123.2933],
  ['Sibulan town centre', 9.3611, 123.2919],
  ['Quezon Park, Dumaguete', 9.3072, 123.3068],
];
for (const [name, lat, lng] of anywhere) {
  check(`${name} is bookable`, checkServiceArea(lat, lng).inside);
}

console.log('\n=== 2. Official fares are claimed only where an ordinance is on file ===');
const dumaguete: [string, number, number][] = [
  ['Quezon Park', 9.3072, 123.3068],
  ['Dumaguete Cathedral', 9.3049, 123.3078],
  ['Silliman Beach', 9.3315, 123.3097],
  ['Daro', 9.3237, 123.2987],
  ['Piapi', 9.3182, 123.3096],
];
for (const [name, lat, lng] of dumaguete) {
  const r = checkServiceArea(lat, lng);
  check(`${name} → official rate`, r.faresKnown && r.authority === 'Dumaguete City', r.authority ?? 'none');
}

console.log('\n=== 3. Everywhere else gets an honest estimate, never a fabricated rate ===');
// This is the check that matters. Claiming Dumaguete's ordinance in Cebu would
// print a confident number no council passed — the exact failure the fare
// screen exists to prevent.
const noOrdinance: [string, number, number][] = [
  ['CIT-U, Cebu City', 10.2949, 123.8811],
  ['Pagadian City', 7.8257, 123.437],
  ['Sibulan town centre', 9.3611, 123.2919],
  ['Valencia town', 9.2745, 123.2419],
  ['Manila', 14.5995, 120.9842],
];
for (const [name, lat, lng] of noOrdinance) {
  const r = checkServiceArea(lat, lng);
  check(`${name} → estimate, no authority claimed`, !r.faresKnown && r.authority === null, r.reason);
}

console.log('\n=== 4. The app’s own saved points still resolve to Dumaguete’s ordinance ===');
for (const loc of DUMAGUETE_LOCATIONS) {
  const r = checkServiceArea(loc.lat, loc.lng);
  // A couple sit just outside the administrative polygon (the airport is in
  // Sibulan). Those are legitimately estimate-only now, so only report.
  console.log(`  ${r.faresKnown ? 'ordinance' : 'estimate '}  ${loc.name}`);
}

console.log('\n=== 5. Rubbish input degrades to an estimate, and does not crash ===');
for (const [lat, lng] of [
  [NaN, 123.3],
  [9.3, NaN],
  [0, 0],
  [999, 999],
] as [number, number][]) {
  const r = checkServiceArea(lat, lng);
  check(`(${lat}, ${lng}) → no authority claimed`, r.inside && !r.faresKnown);
}

console.log('\n=== 6. hasFareAuthority agrees with checkServiceArea ===');
for (const [name, lat, lng] of [...anywhere, ...noOrdinance]) {
  check(
    `${name}`,
    hasFareAuthority(lat, lng) === checkServiceArea(lat, lng).faresKnown
  );
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
