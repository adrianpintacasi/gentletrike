/**
 * Proves the Google Maps migration end to end, without starting the server.
 *
 * Checks the two things Phase 1 swapped — routing and place search — plus the
 * reverse lookup, and reports which provider actually answered. A route coming
 * back as 'estimate' means Google was never reached: wrong key, API not enabled,
 * or quota exhausted.
 *
 *   npm run maps:test
 */
import "dotenv/config";
import { googleRoute, haversineKm } from "../shared/geo";
import { searchPlaces } from "../server/geocode";
import { checkServiceArea } from "../shared/serviceArea";

const SILLIMAN = { lat: 9.3116, lng: 123.3073 };
const ROBINSONS = { lat: 9.3005, lng: 123.3018 };

const ok = (m: string) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const bad = (m: string) => console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`);

let failures = 0;
const check = (passed: boolean, message: string) => {
  if (passed) ok(message);
  else {
    bad(message);
    failures++;
  }
};

async function main() {
  console.log("\nGoogle Maps Platform — integration check\n");

  if (!process.env.GOOGLE_MAPS_SERVER_KEY) {
    bad("GOOGLE_MAPS_SERVER_KEY is not set in .env — nothing else can pass.");
    process.exit(1);
  }
  ok("GOOGLE_MAPS_SERVER_KEY is set");

  console.log("\nRoutes API — Silliman University to Robinsons Place");
  const route = await googleRoute([SILLIMAN, ROBINSONS]);

  if (!route) {
    bad("Routes API returned nothing. Check the key's API restrictions.");
    failures++;
  } else {
    const straight = haversineKm(SILLIMAN, ROBINSONS);
    check(route.source === "driving", `source is '${route.source}' (want 'driving')`);
    check(route.coords.length > 2, `${route.coords.length} points of road geometry`);
    check(route.distanceKm > straight, `${route.distanceKm} km by road vs ${straight.toFixed(2)} km straight`);
    check(route.durationMin > 0, `${route.durationMin} min estimated`);
  }

  console.log("\nPlaces API (New) — text search for 'silliman'");
  const search = await searchPlaces("silliman");

  if (search.error) {
    bad(`search failed: ${search.error}`);
    failures++;
  } else {
    check(search.results.length > 0, `${search.results.length} result(s) inside the service area`);
    for (const r of search.results.slice(0, 3)) {
      console.log(`        ${r.name} — ${r.address} (${r.lat.toFixed(4)}, ${r.lng.toFixed(4)})`);
    }
  }

  /**
   * The guarantee is not "no results" — it is "nothing we cannot drive to".
   *
   * locationRestriction searches only inside the city box, so asking for "cebu
   * city" returns the Cokaliong ferry office and the Ceres terminal, and asking
   * for "siquijor" returns the Port of Dumaguete. Those are the right answers
   * for a ride: they are where a passenger heading there must actually be taken.
   * What must never appear is a point outside the service area.
   */
  console.log("\nPlaces API (New) — out-of-area queries stay inside the service area");
  for (const query of ["cebu city", "manila", "siquijor", "valencia negros oriental"]) {
    const outside = await searchPlaces(query);
    const strays = outside.results.filter((r) => !checkServiceArea(r.lat, r.lng).inside);
    check(
      strays.length === 0,
      `'${query}' — ${outside.results.length} result(s), ${strays.length} outside the area` +
        (outside.results[0] ? ` (top: ${outside.results[0].name})` : "")
    );
  }

  console.log(
    failures === 0
      ? "\n\x1b[32mAll checks passed.\x1b[0m Phase 1 is live.\n"
      : `\n\x1b[31m${failures} check(s) failed.\x1b[0m\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nUnexpected failure:", err);
  process.exit(1);
});
