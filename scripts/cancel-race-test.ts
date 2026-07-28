import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { run, selectOne, selectAll, pool } from '../server/db';

/**
 * Reproduces the cancel race against the real database.
 *
 * The bug: the passenger taps Cancel, the app clears the ride locally, but a
 * poll already in flight resolves afterwards and puts the ride back on screen.
 * The fix is an "abandoned rides" guard in App.tsx; this script proves the
 * server behaves the way that guard assumes.
 *
 *   npm run test:cancel
 */
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const LIVE = ['searching_driver', 'driver_assigned', 'driver_arriving', 'in_transit'];

async function main() {
  const passengerId = `test_passenger_${randomUUID().slice(0, 8)}`;
  const rideId = `ride_${randomUUID()}`;

  console.log('\n=== cancel race, against the real rides table ===');

  await run(
    `INSERT INTO rides (id, passenger_id, pickup, dropoff, vehicle_type, passengers,
                        distance_km, estimated_minutes, base_fare, total_fare,
                        is_pakyaw_negotiated, payment_method, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'searching_driver')`,
    rideId,
    passengerId,
    JSON.stringify({ id: 'rizal_blvd', name: 'Rizal Boulevard Promenade', lat: 9.3058, lng: 123.311 }),
    JSON.stringify({ id: 'robinsons_place', name: 'Robinsons Place Dumaguete', lat: 9.2987, lng: 123.3027 }),
    'pedicab_standard',
    1,
    2.1,
    5,
    15,
    19,
    0,
    'cash'
  );

  const before = await selectOne<{ status: string }>('SELECT status FROM rides WHERE id = ?', rideId);
  check('ride starts live', before?.status === 'searching_driver', before?.status);

  // The interleaving: a poll begins, the passenger cancels, the poll then lands.
  const pollInFlight = selectOne<{ status: string }>('SELECT status FROM rides WHERE id = ?', rideId);

  await run(
    "UPDATE rides SET status = 'cancelled', cancel_reason = ?, cancelled_by = 'passenger' WHERE id = ?",
    'race test',
    rideId
  );

  const stale = await pollInFlight;
  check(
    'the in-flight poll really can return a LIVE status after cancel',
    LIVE.includes(stale?.status ?? ''),
    `poll saw "${stale?.status}" — this is the value that used to be written back to state`
  );

  const after = await selectOne<{ status: string }>('SELECT status FROM rides WHERE id = ?', rideId);
  check('server state is cancelled', after?.status === 'cancelled', after?.status);

  // /me/rides only returns live statuses, so a reload must not resurrect it.
  const reclaimed = await selectAll<{ id: string }>(
    `SELECT id FROM rides WHERE passenger_id = ? AND status IN (${LIVE.map(() => '?').join(',')})`,
    passengerId,
    ...LIVE
  );
  check('a reload would not reclaim it', reclaimed.length === 0, `${reclaimed.length} live rides`);

  await run('DELETE FROM rides WHERE id = ?', rideId);
  const gone = await selectOne('SELECT id FROM rides WHERE id = ?', rideId);
  check('test row cleaned up', !gone);

  console.log(
    `\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED.`}\n` +
      'The stale-poll value above is exactly what App.tsx now discards via abandonedRides.\n'
  );

  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('cancel-race-test failed:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
