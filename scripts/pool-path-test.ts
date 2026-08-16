/**
 * What a pooled passenger is allowed to see of the rider's path.
 *
 * Mirrors the slicing `withPoolPath` does in server/routes.ts, over the real
 * sequencer, and asserts the two limits that matter: the path ends at this
 * passenger's own drop-off, and it carries no stop belonging to anyone else
 * beyond a bare coordinate.
 *
 *   npm run pool:test
 */
import { sequenceStops, type RideStops } from '../shared/dispatch';

interface Row {
  id: string;
  status: string;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
}

interface PooledStop {
  lat: number;
  lng: number;
  kind: 'pickup' | 'dropoff';
  mine: boolean;
}

const COMMITTED = ['driver_assigned', 'driver_arriving', 'in_transit'];

/** The exact shape of the server helper, minus the database. */
function poolPathFor(
  mineId: string,
  riderAt: { lat: number; lng: number },
  carried: Row[]
): PooledStop[] | null {
  const live = carried.filter((r) => COMMITTED.includes(r.status));
  if (live.length < 2) return null;

  const stops: RideStops[] = live.map((r) => ({
    rideId: r.id,
    pickup: r.status === 'in_transit' ? null : r.pickup,
    dropoff: r.dropoff,
    origin: r.pickup,
  }));

  const sequence = sequenceStops(riderAt, stops);
  const ends = sequence.findIndex((s) => s.rideId === mineId && s.kind === 'dropoff');
  if (ends === -1) return null;

  return sequence.slice(0, ends + 1).map((s) => ({
    lat: s.at.lat,
    lng: s.at.lng,
    kind: s.kind,
    mine: s.rideId === mineId,
  }));
}

/* Real Dumaguete points, north to south along the highway. */
const P = {
  rider: { lat: 9.3200, lng: 123.3060 },
  citymall: { lat: 9.3168, lng: 123.3038 },
  silliman: { lat: 9.3072, lng: 123.3072 },
  quezonPark: { lat: 9.3070, lng: 123.3050 },
  robinsons: { lat: 9.2966, lng: 123.3005 },
  boulevard: { lat: 9.3090, lng: 123.3105 },
};

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const render = (p: PooledStop[] | null) =>
  p === null ? '(none)' : p.map((s) => `${s.mine ? '*' : ''}${s.kind[0]}`).join(' ');

console.log('\nsolo trip — nothing shared, so nothing to send');
{
  const path = poolPathFor('A', P.rider, [
    { id: 'A', status: 'driver_assigned', pickup: P.citymall, dropoff: P.robinsons },
  ]);
  check('a lone passenger gets no pooled path', path === null, render(path));
}

console.log('\ntwo waiting passengers — A sees the rider come via B');
{
  const carried: Row[] = [
    { id: 'A', status: 'driver_assigned', pickup: P.silliman, dropoff: P.robinsons },
    { id: 'B', status: 'driver_assigned', pickup: P.citymall, dropoff: P.quezonPark },
  ];
  const path = poolPathFor('A', P.rider, carried)!;
  console.log(`    A's view: ${render(path)}`);

  check('a path is produced', !!path);
  const last = path[path.length - 1];
  check("it ends at A's own drop-off", last.mine && last.kind === 'dropoff');
  check(
    'no stop appears after it',
    path.filter((s) => s.mine && s.kind === 'dropoff').length === 1
  );
  check(
    "B's stops are present as bare coordinates",
    path.some((s) => !s.mine),
    `${path.filter((s) => !s.mine).length} of ${path.length}`
  );
  check(
    'every stop carries only lat, lng, kind, mine',
    path.every((s) => Object.keys(s).sort().join(',') === 'kind,lat,lng,mine')
  );
  check(
    'A is collected before A is set down',
    path.findIndex((s) => s.mine && s.kind === 'pickup') <
      path.findIndex((s) => s.mine && s.kind === 'dropoff')
  );
}

console.log('\nA aboard, B still waiting — A no longer has a pickup to make');
{
  const carried: Row[] = [
    { id: 'A', status: 'in_transit', pickup: P.silliman, dropoff: P.robinsons },
    { id: 'B', status: 'driver_assigned', pickup: P.boulevard, dropoff: P.quezonPark },
  ];
  const path = poolPathFor('A', P.silliman, carried)!;
  console.log(`    A's view: ${render(path)}`);
  check('A has no pickup stop left', !path.some((s) => s.mine && s.kind === 'pickup'));
  check("it still ends at A's drop-off", path[path.length - 1].mine);
}

console.log("\nB's separate view of that same trike — truncated at B's own end");
{
  const carried: Row[] = [
    { id: 'A', status: 'in_transit', pickup: P.silliman, dropoff: P.robinsons },
    { id: 'B', status: 'driver_assigned', pickup: P.boulevard, dropoff: P.quezonPark },
  ];
  const a = poolPathFor('A', P.silliman, carried)!;
  const b = poolPathFor('B', P.silliman, carried)!;
  console.log(`    A: ${render(a)}`);
  console.log(`    B: ${render(b)}`);
  check("B's path ends at B's drop-off", b[b.length - 1].mine && b[b.length - 1].kind === 'dropoff');
  check(
    'neither passenger sees past their own drop-off',
    !a.slice(a.findIndex((s) => s.mine && s.kind === 'dropoff') + 1).length &&
      !b.slice(b.findIndex((s) => s.mine && s.kind === 'dropoff') + 1).length
  );
}

console.log('\na trip with no rider yet is never pooled');
{
  const path = poolPathFor('A', P.rider, [
    { id: 'A', status: 'searching_driver', pickup: P.silliman, dropoff: P.robinsons },
    { id: 'B', status: 'driver_assigned', pickup: P.citymall, dropoff: P.quezonPark },
  ]);
  check('an unaccepted trip gets no path', path === null, render(path));
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
