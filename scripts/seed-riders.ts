/**
 * Put riders on the map where you are demoing.
 *
 * `INITIAL_DRIVERS` only ever fed an id set — nothing wrote those rows to the
 * database — so a fresh deployment has an empty queue and a booking sits on
 * "searching for a rider" forever. This inserts them for real.
 *
 *   npm run seed:riders            every seeded rider, Dumaguete and Cebu
 *   npm run seed:riders -- cebu    only the CIT-U ones
 *   npm run seed:riders -- offline take them all off duty afterwards
 *
 * Safe to run repeatedly: rows are upserted by id, so it refreshes positions
 * rather than piling up duplicates. It only ever touches ids from the seed
 * list, so a rider who signed up on a real phone is never overwritten.
 */
import 'dotenv/config';
import { pool, run, selectAll } from '../server/db';
import { INITIAL_DRIVERS } from '../src/data/dumagueteData';

const arg = (process.argv[2] ?? '').toLowerCase();
const onlyCebu = arg === 'cebu';
const goOffline = arg === 'offline';

const chosen = INITIAL_DRIVERS.filter((d) =>
  onlyCebu ? d.id.startsWith('drv_cebu') : true
);

(async () => {
  if (!chosen.length) {
    console.log('No seed riders matched. Nothing to do.');
    await pool.end();
    return;
  }

  for (const d of chosen) {
    await run(
      `INSERT INTO drivers
         (id, name, vehicle_type, unit_number, plate_number, rating,
          trips_completed, phone, avatar, current_lat, current_lng, is_online)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         vehicle_type = EXCLUDED.vehicle_type,
         unit_number = EXCLUDED.unit_number,
         plate_number = EXCLUDED.plate_number,
         phone = EXCLUDED.phone,
         avatar = EXCLUDED.avatar,
         current_lat = EXCLUDED.current_lat,
         current_lng = EXCLUDED.current_lng,
         is_online = EXCLUDED.is_online`,
      d.id,
      d.name,
      d.vehicleType,
      d.unitNumber,
      d.plateNumber,
      d.rating,
      d.tripsCompleted,
      d.phone,
      d.avatar,
      d.currentLat,
      d.currentLng,
      goOffline ? 0 : 1
    );
    const where = `${d.currentLat.toFixed(4)}, ${d.currentLng.toFixed(4)}`;
    console.log(`  ${goOffline ? 'off duty' : 'ON DUTY '}  ${d.name.padEnd(28)} ${where}`);
  }

  const online = await selectAll<{ id: string; current_lat: number; current_lng: number }>(
    'SELECT id, current_lat, current_lng FROM drivers WHERE is_online = 1'
  );
  console.log(`\n${online.length} rider(s) on duty in total.\n`);

  await pool.end();
})().catch(async (err) => {
  console.error('Seeding failed:', (err as Error).message);
  await pool.end();
  process.exit(1);
});
