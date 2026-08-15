import 'dotenv/config';
import { selectAll, pool } from '../server/db';
import {
  rankCandidates,
  sequenceStops,
  ALONG_THE_WAY_KM,
  HIDE_BEYOND_KM,
  type Stop,
} from '../shared/dispatch';
import { haversineKm } from '../shared/geo';
import { VEHICLE_DETAILS, type TransportMode } from '../shared/transport';

/**
 * Explains why a rider is or is not being offered each open trip.
 *
 * The dispatch filter is deliberately invisible in the UI — a hidden trip looks
 * identical to no trip existing. This prints the reasoning so a "why did that
 * not show up?" question has an answer.
 *
 *   npm run dispatch:debug
 */
const LIVE = ['searching_driver', 'driver_assigned', 'driver_arriving', 'in_transit'];

async function main() {
  const drivers = await selectAll<any>(
    'SELECT id, name, vehicle_type, current_lat, current_lng, is_online FROM drivers ORDER BY name'
  );

  const open = await selectAll<any>(
    `SELECT id, pickup, dropoff, vehicle_type, passengers, created_at
       FROM rides WHERE status = 'searching_driver' AND driver_id IS NULL`
  );

  console.log(
    `\n"On your route" under ${ALONG_THE_WAY_KM * 1000} m · hidden only beyond ${HIDE_BEYOND_KM * 1000} m\n`
  );
  console.log(`Open trips waiting: ${open.length}`);
  for (const r of open) {
    const p = JSON.parse(r.pickup);
    const d = JSON.parse(r.dropoff);
    console.log(
      `  ${r.id.slice(0, 12)}  ${r.vehicle_type}  ${r.passengers}pax  ` +
        `${p.name} (${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}) -> ${d.name}`
    );
  }

  for (const dr of drivers) {
    const active = await selectAll<any>(
      `SELECT id, pickup, dropoff, status, passengers FROM rides
        WHERE driver_id = ? AND status IN (${LIVE.map(() => '?').join(',')})`,
      dr.id,
      ...LIVE
    );

    console.log(`\n=== ${dr.name} (${dr.vehicle_type}) ===`);
    console.log(
      `  online: ${dr.is_online ? 'yes' : 'no'} · position: ${dr.current_lat?.toFixed?.(4)}, ${dr.current_lng?.toFixed?.(4)}`
    );
    console.log(`  carrying ${active.length} trip(s):`);
    for (const a of active) {
      console.log(
        `    ${a.status.padEnd(16)} ${JSON.parse(a.pickup).name} -> ${JSON.parse(a.dropoff).name}`
      );
    }

    // The order the map draws, and the leg lengths that produce it. A route
    // that looks like it doubles back is usually visible here as two stops in
    // the wrong order — or as two stops metres apart, where the loop is the
    // road network rather than the sequence.
    if (active.length) {
      const seq = sequenceStops(
        { lat: dr.current_lat, lng: dr.current_lng },
        active.map((r: any) => {
          const p = JSON.parse(r.pickup);
          const d = JSON.parse(r.dropoff);
          return {
            rideId: r.id,
            pickup: r.status === 'in_transit' ? null : { lat: p.lat, lng: p.lng },
            dropoff: { lat: d.lat, lng: d.lng },
            // What an aboard passenger's journey is measured against, so this
            // prints the order the app really drives rather than a shorter one.
            origin: { lat: p.lat, lng: p.lng },
          };
        })
      );

      const nameOf = (rideId: string, kind: string) => {
        const r = active.find((a: any) => a.id === rideId);
        return JSON.parse(kind === 'pickup' ? r.pickup : r.dropoff).name;
      };

      console.log('  route order:');
      let prev = { lat: dr.current_lat, lng: dr.current_lng };
      for (const s of seq) {
        const legM = Math.round(haversineKm(prev, s.at) * 1000);
        console.log(
          `    ${s.order}. ${s.kind.padEnd(7)} ${String(legM).padStart(5)} m  ` +
            `${s.at.lat.toFixed(5)},${s.at.lng.toFixed(5)}  ${nameOf(s.rideId, s.kind)}`
        );
        prev = s.at;
      }
    }

    if (!open.length) continue;

    const committed: Stop[] = active.flatMap((r: any) => {
      const p = JSON.parse(r.pickup);
      const d = JSON.parse(r.dropoff);
      return [
        ...(r.status === 'in_transit'
          ? []
          : [{ at: { lat: p.lat, lng: p.lng }, kind: 'pickup' as const, rideId: r.id }]),
        {
          at: { lat: d.lat, lng: d.lng },
          kind: 'dropoff' as const,
          rideId: r.id,
          origin: { lat: p.lat, lng: p.lng },
        },
      ];
    });

    const seatsTaken = active.reduce((n: number, r: any) => n + (r.passengers || 1), 0);
    const seats =
      (VEHICLE_DETAILS[dr.vehicle_type as TransportMode]?.maxPassengers ?? 1) - seatsTaken;

    console.log(`  committed stops used for scoring: ${committed.length}, seats free: ${seats}`);

    const sameType = open.filter((r: any) => r.vehicle_type === dr.vehicle_type);
    if (sameType.length !== open.length) {
      console.log(`  (${open.length - sameType.length} open trip(s) hidden: different vehicle type)`);
    }

    const scores = rankCandidates(
      { lat: dr.current_lat, lng: dr.current_lng },
      committed,
      sameType.map((r: any) => {
        const p = JSON.parse(r.pickup);
        const d = JSON.parse(r.dropoff);
        return {
          rideId: r.id,
          pickup: { lat: p.lat, lng: p.lng },
          dropoff: { lat: d.lat, lng: d.lng },
          passengers: r.passengers || 1,
        };
      }),
      { seatsAvailable: seats }
    );

    for (const s of scores) {
      console.log(
        `    ${s.eligible ? 'OFFERED' : 'HIDDEN '}  ${s.rideId.slice(0, 12)}  ` +
          `detour ${String(Math.round(s.detourKm * 1000)).padStart(5)} m  ` +
          `pickup ${String(Math.round(s.pickupDistanceKm * 1000)).padStart(5)} m away  (${s.reason})`
      );
    }
  }

  console.log();
  await pool.end();
}

main().catch(async (err) => {
  console.error('dispatch-debug failed:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
