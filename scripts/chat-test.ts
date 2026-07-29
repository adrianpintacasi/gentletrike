import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { run, selectAll, pool } from '../server/db';

/**
 * Verifies the trip chat carries messages in both directions.
 *
 * The passenger side could always message a rider, but nothing on the rider's
 * screen received it. A one-way channel is worse than none — the passenger sees
 * their question delivered and never answered — so this checks both senders
 * land in the same thread, in order.
 *
 *   npm run chat:test
 */
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';

async function main() {
  const rideId = `ride_${randomUUID()}`;
  const passengerId = `test_passenger_${randomUUID().slice(0, 8)}`;

  console.log('\n=== Trip chat, both directions ===');

  await run(
    `INSERT INTO rides (id, passenger_id, pickup, dropoff, vehicle_type, passengers,
                        distance_km, estimated_minutes, base_fare, total_fare,
                        is_pakyaw_negotiated, payment_method, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'driver_assigned')`,
    rideId,
    passengerId,
    JSON.stringify({ id: 'a', name: 'Silliman University Portal', lat: 9.3105, lng: 123.3075 }),
    JSON.stringify({ id: 'b', name: 'Robinsons Place Dumaguete', lat: 9.2987, lng: 123.3027 }),
    'pedicab_standard',
    1,
    1.75,
    3,
    15,
    17,
    0,
    'cash'
  );

  const post = (sender: string, text: string) =>
    fetch(`${BASE}/api/rides/${rideId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender, text }),
    });

  const passengerMsg = await post('user', 'Hi, I am wearing a red shirt near the gate');
  check('passenger can send', passengerMsg.ok, `HTTP ${passengerMsg.status}`);

  const riderMsg = await post('driver', 'Ok, I am 2 minutes away');
  check('rider can send', riderMsg.ok, `HTTP ${riderMsg.status}`);

  const thread = await fetch(`${BASE}/api/rides/${rideId}/messages`).then((r) => r.json());
  const msgs: { sender: string; text: string }[] = thread.messages ?? [];

  console.log('  thread:');
  for (const m of msgs) console.log(`    ${m.sender.padEnd(9)} ${m.text}`);

  check('both messages are in one thread', msgs.length >= 2, `${msgs.length} message(s)`);
  check('passenger message present', msgs.some((m) => m.sender === 'user'));
  check('rider message present', msgs.some((m) => m.sender === 'driver'));

  const userAt = msgs.findIndex((m) => m.sender === 'user');
  const driverAt = msgs.findIndex((m) => m.sender === 'driver');
  check('order preserved (passenger asked first)', userAt < driverAt, `${userAt} < ${driverAt}`);

  await run('DELETE FROM messages WHERE ride_id = ?', rideId);
  await run('DELETE FROM rides WHERE id = ?', rideId);
  const [left] = await selectAll('SELECT id FROM rides WHERE id = ?', rideId);
  check('test data cleaned up', !left);

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED.`}\n`);
  // Set the code and let the process wind down on its own. Calling
  // process.exit() straight after pool.end() races the driver's socket
  // teardown and trips a libuv assertion that looks like a test failure.
  process.exitCode = failures === 0 ? 0 : 1;
  await pool.end();
}

main().catch(async (err) => {
  console.error('chat-test failed (is the dev server running?):', err?.message ?? err);
  await pool.end().catch(() => {});
  process.exit(1);
});
