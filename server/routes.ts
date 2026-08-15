import { randomUUID } from "crypto";
import { Router } from "express";
import { authRoutes } from "./authRoutes";
import { adminRoutes } from "./adminRoutes";
import { geocodeRoutes } from "./geocode";
import { routingRoutes } from "./routing";
import { accountRoutes } from "./accountRoutes";
import {
  attachUser,
  requireAuth,
  requireRole,
} from "./auth";
import {
  createRiderDriver,
  isSeedDriverId,
  RiderProfileError,
} from "./riderProfile";
import { maybeAutoSuspendPassenger, maybeAutoSuspendRider } from "./autoModeration";
import {
  run,
  selectAll,
  selectOne,
  toDriver,
  toRide,
  tx,
} from "./db";
import type { DriverRow, RideRow } from "./db";
import {
  rankCandidates,
  canServeTrip,
  isExclusiveTrip,
  sequenceStops,
  DECLINE_COOLDOWN_MINUTES,
  type Stop,
} from "../shared/dispatch";
import { VEHICLE_DETAILS, type TransportMode } from "../shared/transport";

export const api = Router();

api.use((req, res, next) => {
  attachUser(req, res, next).catch(next);
});
api.use("/auth", authRoutes);
api.use("/admin", adminRoutes);
api.use("/geocode", geocodeRoutes);
api.use("/route", routingRoutes);
// Mounted after the direct /me/rides handler below; Express matches in
// registration order and the paths do not overlap.
api.use("/me", accountRoutes);

// Express 4 does not catch errors thrown from async handlers, so every async
// handler is wrapped: a rejected promise becomes a clean 500 instead of a
// hung request with no response.
const wrap =
  (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any) =>
    fn(req, res).catch((err: unknown) => {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: "Server error" });
    });

const RIDE_STATUSES = [
  "searching_driver",
  "driver_assigned",
  "driver_arriving",
  "in_transit",
  "completed",
  "cancelled",
] as const;

/** Statuses a ride can still be worked on from. */
const LIVE_STATUSES = [
  "searching_driver",
  "driver_assigned",
  "driver_arriving",
  "in_transit",
];

const findDriver = (id: string) =>
  selectOne<DriverRow>("SELECT * FROM drivers WHERE id = ?", id);

const findRide = (id: string) =>
  selectOne<RideRow>("SELECT * FROM rides WHERE id = ?", id);

/** Statuses where a rider has committed to a trip, so it sits on their path. */
const COMMITTED_STATUSES = ["driver_assigned", "driver_arriving", "in_transit"];

async function rideWithDriver(row: RideRow) {
  const driver = row.driver_id ? await findDriver(row.driver_id) : null;
  return toRide(row, driver);
}

/**
 * Attach the path the rider will actually drive to finish this trip.
 *
 * A pooled passenger's map otherwise draws a straight run from the rider to
 * their own destination — a journey nobody is making. The rider has others to
 * collect and set down along the way, and those detours are both the reason
 * the fare is shared and the reason the arrival time is what it is. Showing a
 * line that omits them makes the app look wrong every time the pedicab turns
 * off the expected road.
 *
 * Two limits, both deliberate. The path stops at this passenger's own
 * drop-off, because where the rider goes after that is not their business.
 * And each stop is reduced to a coordinate and a kind: a shared trike stops
 * where strangers get on and off, which is unavoidable and plainly visible
 * from the seat, but who they are and where they are headed is not.
 *
 * Returns the ride untouched when the trip is not shared, so the direct route
 * the map already draws stays the true one.
 */
async function withPoolPath<T extends object>(ride: T, row: RideRow): Promise<T> {
  if (!row.driver_id || !COMMITTED_STATUSES.includes(row.status)) return ride;

  const carried = await selectAll<RideRow>(
    `SELECT * FROM rides
      WHERE driver_id = ? AND status IN (${COMMITTED_STATUSES.map(() => "?").join(",")})`,
    row.driver_id,
    ...COMMITTED_STATUSES
  );
  if (carried.length < 2) return ride;

  const driver = await findDriver(row.driver_id);
  if (!driver) return ride;

  const sequence = sequenceStops(
    { lat: driver.current_lat, lng: driver.current_lng },
    carried.map((r) => {
      const pickup = JSON.parse(r.pickup) as { lat: number; lng: number };
      const dropoff = JSON.parse(r.dropoff) as { lat: number; lng: number };
      return {
        rideId: r.id,
        // Aboard already: that stop is behind the rider. Where they got on is
        // still what their journey is measured against, so it goes in as the
        // origin — without it they can be set down last to save a few hundred
        // metres, which is exactly the unfairness the ordering exists to stop.
        pickup:
          r.status === "in_transit" ? null : { lat: pickup.lat, lng: pickup.lng },
        dropoff: { lat: dropoff.lat, lng: dropoff.lng },
        origin: { lat: pickup.lat, lng: pickup.lng },
      };
    })
  );

  const ends = sequence.findIndex((s) => s.rideId === row.id && s.kind === "dropoff");
  if (ends === -1) return ride;

  return {
    ...ride,
    poolPath: sequence.slice(0, ends + 1).map((s) => ({
      lat: s.at.lat,
      lng: s.at.lng,
      kind: s.kind,
      mine: s.rideId === row.id,
    })),
  };
}

/**
 * A ride plus the passenger's name and number, for the rider carrying them.
 *
 * A rider needs to reach the person they are collecting — "I'm at the corner,
 * where are you?" is most of pedicab dispatch. Only attached once a driver is
 * assigned, so an open trip in the queue never exposes contact details to every
 * rider who happens to see it.
 */
async function rideWithPassenger(row: RideRow) {
  const ride = await rideWithDriver(row);
  if (!row.driver_id) return ride;

  const passenger = await selectOne<{
    first_name: string | null;
    last_name: string | null;
    name: string | null;
    contact_number: string | null;
  }>(
    "SELECT first_name, last_name, name, contact_number FROM users WHERE id = ?",
    row.passenger_id
  );
  if (!passenger) return ride;

  const full = [passenger.first_name, passenger.last_name].filter(Boolean).join(" ").trim();

  return {
    ...ride,
    passengerName: full || passenger.name || "Passenger",
    // Riders sign up without a number, so this is often null. The UI disables
    // the call button rather than offering a link that dials nothing.
    passengerPhone: passenger.contact_number || null,
  };
}

/* ------------------------------------------------------------------ health */

api.get("/health", (_req, res) => {
  res.json({ status: "ok", app: "GentleTrike Dumaguete Public Hailing" });
});

/* ----------------------------------------------------------------- drivers */

/** Fleet for the passenger map. `?online=1` limits it to riders on duty. */
api.get(
  "/drivers",
  wrap(async (req, res) => {
    const rows =
      req.query.online === "1"
        ? await selectAll<DriverRow>("SELECT * FROM drivers WHERE is_online = 1")
        : await selectAll<DriverRow>("SELECT * FROM drivers");
    res.json({ drivers: rows.map(toDriver) });
  })
);

/**
 * Load or create the signed-in rider's own pedicab profile (not demo fleet rows).
 */
api.post(
  "/drivers/claim",
  requireAuth,
  requireRole("rider", "admin"),
  wrap(async (req, res) => {
    const userId = req.user!.id;
    const { unitNumber } = req.body ?? {};
    const unitRaw =
      unitNumber !== undefined && unitNumber !== null
        ? String(unitNumber).trim()
        : "";

    const existing = await selectOne<DriverRow>(
      "SELECT * FROM drivers WHERE claimed_by = ?",
      userId
    );

    if (existing) {
      if (isSeedDriverId(existing.id)) {
        if (!unitRaw) {
          return res.status(400).json({
            error: "Enter your pedicab number to set up your rider profile.",
            code: "RIDER_PROFILE_REQUIRED",
          });
        }
        try {
          await run(
            "UPDATE drivers SET claimed_by = NULL, is_online = 0 WHERE id = ?",
            existing.id
          );
          const created = await createRiderDriver(
            userId,
            req.user!.name,
            unitRaw
          );
          return res.json({ driver: toDriver(created) });
        } catch (err) {
          if (err instanceof RiderProfileError) {
            return res.status(409).json({ error: err.message });
          }
          throw err;
        }
      }
      return res.json({ driver: toDriver(existing) });
    }

    if (!unitRaw) {
      return res.status(400).json({
        error: "Enter your pedicab number to start accepting rides.",
        code: "RIDER_PROFILE_REQUIRED",
      });
    }

    try {
      const created = await createRiderDriver(userId, req.user!.name, unitRaw);
      res.json({ driver: toDriver(created) });
    } catch (err) {
      if (err instanceof RiderProfileError) {
        return res.status(409).json({ error: err.message });
      }
      throw err;
    }
  })
);

api.get(
  "/drivers/:id",
  wrap(async (req, res) => {
    const row = await findDriver(req.params.id);
    if (!row) return res.status(404).json({ error: "Driver not found" });
    res.json({ driver: toDriver(row) });
  })
);

/** Live GPS ping + duty status from the driver's phone. */
api.patch(
  "/drivers/:id",
  wrap(async (req, res) => {
    const driver = await findDriver(req.params.id);
    if (!driver) {
      return res.status(404).json({ error: "Driver not found" });
    }

    const { lat, lng, isOnline } = req.body ?? {};

    // A rider may only go ONLINE once the TMO has verified them. Pending,
    // suspended, and declined riders are blocked here with a clear reason.
    // (Going offline is always allowed, whatever their status.)
    if (isOnline === true) {
      const status = driver.verification_status ?? "verified";
      if (status !== "verified") {
        const reason =
          status === "pending"
            ? "Your rider account is pending TMO approval. You can go online once a TMO officer verifies you."
            : status === "suspended"
            ? "Your rider account has been suspended by the TMO. Please contact the TMO office."
            : "Your rider registration was declined by the TMO. Please contact the TMO office.";
        return res.status(403).json({ error: reason, code: "RIDER_NOT_VERIFIED", status });
      }
    }

    const sets: string[] = [];
    const values: (string | number)[] = [];

    if (typeof lat === "number" && typeof lng === "number") {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ error: "lat/lng must be finite numbers" });
      }
      sets.push("current_lat = ?", "current_lng = ?");
      values.push(lat, lng);
    }
    if (typeof isOnline === "boolean") {
      sets.push("is_online = ?");
      values.push(isOnline ? 1 : 0);
    }
    if (sets.length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    sets.push("updated_at = datetime('now')");
    await run(
      `UPDATE drivers SET ${sets.join(", ")} WHERE id = ?`,
      ...values,
      req.params.id
    );

    res.json({ driver: toDriver((await findDriver(req.params.id))!) });
  })
);

/** Every live ride this driver is carrying (the pooled route). */
api.get(
  "/drivers/:id/rides",
  wrap(async (req, res) => {
    const rows = await selectAll<RideRow>(
      `SELECT * FROM rides
        WHERE driver_id = ?
          AND status IN ('driver_assigned','driver_arriving','in_transit')
        ORDER BY created_at ASC`,
      req.params.id
    );
    // The rider is carrying these people, so they get the contact details.
    res.json({ rides: await Promise.all(rows.map(rideWithPassenger)) });
  })
);

/* ------------------------------------------------------------------- rides */

/** Passenger books a trip. */
api.post(
  "/rides",
  requireAuth,
  requireRole("passenger", "admin"),
  wrap(async (req, res) => {
    const passengerId = req.user!.id;
    const {
      pickupLocation,
      dropoffLocation,
      vehicleType,
      passengers,
      distanceKm,
      estimatedMinutes,
      baseFare,
      totalFare,
      isPakyawNegotiated,
      paymentMethod,
      notes,
    } = req.body ?? {};

    if (!pickupLocation?.name || !Number.isFinite(pickupLocation?.lat)) {
      return res.status(400).json({ error: "A valid pickupLocation is required" });
    }
    if (!dropoffLocation?.name || !Number.isFinite(dropoffLocation?.lat)) {
      return res.status(400).json({ error: "A valid dropoffLocation is required" });
    }

    const id = `ride_${randomUUID()}`;
    await run(
      `INSERT INTO rides
        (id, passenger_id, pickup, dropoff, vehicle_type, passengers, distance_km,
         estimated_minutes, base_fare, total_fare, is_pakyaw_negotiated,
         payment_method, notes, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'searching_driver')`,
      id,
      passengerId,
      JSON.stringify(pickupLocation),
      JSON.stringify(dropoffLocation),
      vehicleType ?? "pedicab_standard",
      Number(passengers) || 1,
      Number(distanceKm) || 0,
      Number(estimatedMinutes) || 0,
      Math.round(Number(baseFare) || 0),
      Math.round(Number(totalFare) || 0),
      isPakyawNegotiated ? 1 : 0,
      paymentMethod === "gcash" ? "gcash" : "cash",
      notes ? String(notes).slice(0, 500) : null
    );

    await run(
      "INSERT INTO messages (id, ride_id, sender, text) VALUES (?,?,?,?)",
      `msg_${randomUUID()}`,
      id,
      "system",
      "GentleTrike ride requested! Looking for the nearest Dumaguete motorcab rider..."
    );

    res.status(201).json({ ride: await rideWithDriver((await findRide(id))!) });
  })
);

/** Open queue for drivers — excludes anything this driver already declined. */
api.get(
  "/rides/open",
  wrap(async (req, res) => {
    const driverId = typeof req.query.driverId === "string" ? req.query.driverId : null;

    // A decline hides a trip from this rider for a while, not forever. Permanent
    // declines meant that once every nearby rider had passed on a trip it was
    // invisible to all of them while the passenger was still told to wait.
    const rows = await selectAll<RideRow>(
      `SELECT * FROM rides
        WHERE status = 'searching_driver'
          AND driver_id IS NULL
          AND (?::text IS NULL OR id NOT IN (
                SELECT ride_id FROM ride_declines
                 WHERE driver_id = ?
                   AND created_at::timestamp >= ((now() AT TIME ZONE 'UTC') - interval '${DECLINE_COOLDOWN_MINUTES} minutes')
              ))
        ORDER BY created_at ASC
        LIMIT 50`,
      driverId,
      driverId
    );

    // Anonymous caller (or a driver we cannot locate): fall back to the old
    // behaviour rather than hiding work from them.
    const driver = driverId ? await findDriver(driverId) : null;
    if (!driver || !Number.isFinite(driver.current_lat)) {
      return res.json({ rides: rows.map((r) => toRide(r, null)) });
    }

    // A rider can only serve trips their vehicle was requested for — a
    // habal-habal has no business seeing a 10-seat EasyRide booking. Pakyaw is
    // the exception: it charters whatever vehicle takes it.
    let matching = rows.filter((r) => canServeTrip(driver.vehicle_type, r.vehicle_type));

    // The rider's committed stops are what "along the way" is measured against.
    const active = await selectAll<RideRow>(
      `SELECT * FROM rides
        WHERE driver_id = ? AND status IN (${LIVE_STATUSES.map(() => "?").join(",")})
        ORDER BY created_at ASC`,
      driver.id,
      ...LIVE_STATUSES
    );

    // A chartered vehicle carries that party alone, so once a rider takes a
    // pakyaw they are offered nothing else — and a rider already carrying
    // passengers is not offered a charter they could not honour.
    if (active.some((r) => isExclusiveTrip(r.vehicle_type))) {
      return res.json({ rides: [] });
    }
    if (active.length > 0) {
      matching = matching.filter((r) => !isExclusiveTrip(r.vehicle_type));
    }

    const committed: Stop[] = active.flatMap((r) => {
      const pickup = JSON.parse(r.pickup);
      const dropoff = JSON.parse(r.dropoff);
      return [
        // A trip already under way has been collected, so only the drop-off is
        // still ahead of the rider; counting the pickup would drag the route
        // backwards to a place they have already been.
        ...(r.status === "in_transit"
          ? []
          : [{ at: { lat: pickup.lat, lng: pickup.lng }, kind: "pickup" as const, rideId: r.id }]),
        {
          at: { lat: dropoff.lat, lng: dropoff.lng },
          kind: "dropoff" as const,
          rideId: r.id,
          // Carried even when the pickup is still a stop above: it costs nothing
          // and it is the only record of the trip this passenger agreed to once
          // they are aboard and that stop disappears.
          origin: { lat: pickup.lat, lng: pickup.lng },
        },
      ];
    });

    const seatsTaken = active.reduce((n, r) => n + (r.passengers || 1), 0);
    const seatsAvailable = Math.max(
      0,
      (VEHICLE_DETAILS[driver.vehicle_type as TransportMode]?.maxPassengers ?? 1) - seatsTaken
    );

    const riderAt = { lat: driver.current_lat, lng: driver.current_lng };

    const scores = rankCandidates(
      riderAt,
      committed,
      matching.map((r) => {
        const pickup = JSON.parse(r.pickup);
        const dropoff = JSON.parse(r.dropoff);
        return {
          rideId: r.id,
          pickup: { lat: pickup.lat, lng: pickup.lng },
          dropoff: { lat: dropoff.lat, lng: dropoff.lng },
          passengers: r.passengers || 1,
        };
      }),
      { seatsAvailable }
    );

    const byId = new Map(matching.map((r) => [r.id, r]));

    // Cheapest first, but nothing is hidden except no-seats and trips that run
    // genuinely the wrong way. Hiding on a tight detour emptied the queue the
    // moment a rider accepted anyone, which defeats pooling — the rider judges
    // whether a diversion is worth it, we just state the cost and the order.
    const rides = scores
      .filter((s) => s.eligible)
      .map((s) => ({
        ...toRide(byId.get(s.rideId)!, null),
        detourKm: Math.round(s.detourKm * 100) / 100,
        pickupDistanceKm: Math.round(s.pickupDistanceKm * 100) / 100,
        alongTheWay: s.alongTheWay,
      }));

    res.json({ rides });
  })
);

/** The signed-in passenger's own live rides. */
api.get(
  "/me/rides",
  requireAuth,
  requireRole("passenger", "admin"),
  wrap(async (req, res) => {
    const rows = await selectAll<RideRow>(
      `SELECT * FROM rides
        WHERE passenger_id = ? AND status IN (${LIVE_STATUSES.map(() => "?").join(",")})
        ORDER BY created_at DESC`,
      req.user!.id,
      ...LIVE_STATUSES
    );
    res.json({
      rides: await Promise.all(
        rows.map(async (row) => withPoolPath(await rideWithDriver(row), row))
      ),
    });
  })
);

/** @deprecated Use GET /me/rides — kept for backwards compatibility. */
api.get(
  "/passengers/:id/rides",
  requireAuth,
  wrap(async (req, res) => {
    if (req.user!.id !== req.params.id && req.user!.role !== "admin") {
      return res.status(403).json({ error: "You can only view your own rides" });
    }
    const rows = await selectAll<RideRow>(
      `SELECT * FROM rides
        WHERE passenger_id = ? AND status IN (${LIVE_STATUSES.map(() => "?").join(",")})
        ORDER BY created_at DESC`,
      req.params.id,
      ...LIVE_STATUSES
    );
    res.json({
      rides: await Promise.all(
        rows.map(async (row) => withPoolPath(await rideWithDriver(row), row))
      ),
    });
  })
);

api.get(
  "/rides/:id",
  wrap(async (req, res) => {
    const row = await findRide(req.params.id);
    if (!row) return res.status(404).json({ error: "Ride not found" });

    const ride = await rideWithDriver(row);
    // This route carries no auth middleware — a ride id alone opens it — so the
    // pooled path is attached only when the caller is provably the passenger it
    // describes. `attachUser` has already resolved any bearer token by here.
    // Everyone else gets exactly what they got before.
    if (req.user?.id === row.passenger_id) {
      return res.json({ ride: await withPoolPath(ride, row) });
    }
    res.json({ ride });
  })
);

/**
 * Driver accepts. The WHERE clause carries the race: only the first request to
 * land finds driver_id still NULL, so a second driver tapping Accept at the
 * same moment gets a 409 instead of silently stealing the trip.
 */
api.post(
  "/rides/:id/accept",
  wrap(async (req, res) => {
    const { driverId } = req.body ?? {};
    if (!driverId) return res.status(400).json({ error: "driverId is required" });

    const driver = await findDriver(driverId);
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    const wanted = await findRide(req.params.id);
    if (!wanted) return res.status(404).json({ error: "Ride not found" });

    if (!canServeTrip(driver.vehicle_type, wanted.vehicle_type)) {
      return res.status(409).json({
        error: `This passenger requested a ${wanted.vehicle_type.replace(/_/g, " ")}, not a ${driver.vehicle_type.replace(/_/g, " ")}`,
      });
    }

    // Pooling means one rider can hold several trips, so seats have to be
    // counted across all of them. Checked here rather than in the UI: the
    // client's view of the queue is a snapshot, and two accepts a second apart
    // could each look fine while together they overfill the sidecar.
    const active = await selectAll<RideRow>(
      `SELECT passengers, vehicle_type FROM rides
        WHERE driver_id = ? AND status IN (${LIVE_STATUSES.map(() => "?").join(",")})`,
      driverId,
      ...LIVE_STATUSES
    );

    // A charter hires the whole vehicle, so it cannot share it in either
    // direction. Enforced here as well as in the queue: the queue is a snapshot,
    // and a rider could accept a pakyaw and an ordinary trip seconds apart.
    if (active.length > 0 && isExclusiveTrip(wanted.vehicle_type)) {
      return res.status(409).json({
        error:
          "A pakyaw charter hires your whole vehicle — finish or drop your current passengers first",
      });
    }
    if (active.some((r) => isExclusiveTrip(r.vehicle_type))) {
      return res.status(409).json({
        error: "You are on a pakyaw charter — that party has hired the whole vehicle",
      });
    }

    const seatsTaken = active.reduce((n, r) => n + (r.passengers || 1), 0);
    const seats = VEHICLE_DETAILS[driver.vehicle_type as TransportMode]?.maxPassengers ?? 1;

    if (seatsTaken + (wanted.passengers || 1) > seats) {
      return res.status(409).json({
        error: `Not enough seats — you are carrying ${seatsTaken} of ${seats} and this trip needs ${wanted.passengers || 1}`,
      });
    }

    const result = await run(
      `UPDATE rides
          SET driver_id = ?, status = 'driver_assigned', updated_at = datetime('now')
        WHERE id = ? AND driver_id IS NULL AND status = 'searching_driver'`,
      driverId,
      req.params.id
    );

    if (Number(result.changes) === 0) {
      if (!(await findRide(req.params.id))) {
        return res.status(404).json({ error: "Ride not found" });
      }
      return res
        .status(409)
        .json({ error: "This trip was already taken by another rider" });
    }

    await run(
      "INSERT INTO messages (id, ride_id, sender, text) VALUES (?,?,?,?)",
      `msg_${randomUUID()}`,
      req.params.id,
      "driver",
      `Maayong adlaw! I am ${driver.name}. On my way to your pickup point!`
    );

    res.json({ ride: await rideWithDriver((await findRide(req.params.id))!) });
  })
);

/** Driver passes on a trip — hidden for them, still open for everyone else. */
api.post(
  "/rides/:id/decline",
  wrap(async (req, res) => {
    const { driverId, reason } = req.body ?? {};
    if (!driverId) return res.status(400).json({ error: "driverId is required" });
    if (!(await findRide(req.params.id))) {
      return res.status(404).json({ error: "Ride not found" });
    }

    await run(
      "INSERT INTO ride_declines (ride_id, driver_id) VALUES (?,?) ON CONFLICT DO NOTHING",
      req.params.id,
      driverId
    );

    if (reason) {
      await run(
        "UPDATE rides SET reject_reason = ?, updated_at = datetime('now') WHERE id = ?",
        String(reason).slice(0, 500),
        req.params.id
      );
    }

    // Auto-suspend a rider who declines too often (never blocks the response).
    try {
      await maybeAutoSuspendRider(String(driverId));
    } catch (err) {
      console.error("rider auto-suspend check failed:", err);
    }

    res.json({ ok: true });
  })
);

api.post(
  "/rides/:id/status",
  wrap(async (req, res) => {
    const { status } = req.body ?? {};
    if (!RIDE_STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ error: `status must be one of: ${RIDE_STATUSES.join(", ")}` });
    }

    const row = await findRide(req.params.id);
    if (!row) return res.status(404).json({ error: "Ride not found" });
    if (row.status === "completed" || row.status === "cancelled") {
      return res.status(409).json({ error: `Ride is already ${row.status}` });
    }

    await tx(async () => {
      // Quietly record when a trip actually starts and finishes — real
      // timestamps for daily stats later. No ML, just data collection.
      if (status === "in_transit" && !row.started_at) {
        await run(
          "UPDATE rides SET started_at = datetime('now') WHERE id = ?",
          req.params.id
        );
      }
      if (status === "completed") {
        await run(
          "UPDATE rides SET completed_at = datetime('now') WHERE id = ?",
          req.params.id
        );
      }

      await run(
        "UPDATE rides SET status = ?, updated_at = datetime('now') WHERE id = ?",
        status,
        req.params.id
      );

      // Credit the rider once, at completion — never on accept.
      if (status === "completed" && row.driver_id) {
        await run(
          `UPDATE drivers
              SET trips_completed = trips_completed + 1,
                  trips_today     = trips_today + 1,
                  earnings_today  = earnings_today + ?,
                  updated_at      = datetime('now')
            WHERE id = ?`,
          row.total_fare,
          row.driver_id
        );
      }
    });

    res.json({ ride: await rideWithDriver((await findRide(req.params.id))!) });
  })
);

api.post(
  "/rides/:id/cancel",
  wrap(async (req, res) => {
    const { reason, cancelledBy } = req.body ?? {};
    const row = await findRide(req.params.id);
    if (!row) return res.status(404).json({ error: "Ride not found" });
    if (row.status === "completed") {
      return res.status(409).json({ error: "Completed rides cannot be cancelled" });
    }

    const cBy = cancelledBy === "driver" ? "driver" : "passenger";
    const cReason = reason ? String(reason).slice(0, 500) : "No reason provided";

    await run(
      "UPDATE rides SET status = 'cancelled', cancel_reason = ?, cancelled_by = ?, updated_at = datetime('now') WHERE id = ?",
      cReason,
      cBy,
      req.params.id
    );

    // Auto-suspend a passenger who cancels too often (never blocks the response).
    if (cBy === "passenger") {
      try {
        await maybeAutoSuspendPassenger(row.passenger_id);
      } catch (err) {
        console.error("passenger auto-suspend check failed:", err);
      }
    }

    res.json({ ride: await rideWithDriver((await findRide(req.params.id))!) });
  })
);

/* ---------------------------------------------------------------- messages */

interface MessageRow {
  id: string;
  sender: string;
  text: string;
  created_at: string;
}

api.get(
  "/rides/:id/messages",
  wrap(async (req, res) => {
    if (!(await findRide(req.params.id))) {
      return res.status(404).json({ error: "Ride not found" });
    }
    const rows = await selectAll<MessageRow>(
      "SELECT * FROM messages WHERE ride_id = ? ORDER BY created_at ASC, seq ASC",
      req.params.id
    );

    res.json({
      messages: rows.map((m) => ({
        id: m.id,
        sender: m.sender,
        text: m.text,
        time: m.created_at,
      })),
    });
  })
);

api.post(
  "/rides/:id/messages",
  wrap(async (req, res) => {
    const { sender, text } = req.body ?? {};
    if (!(await findRide(req.params.id))) {
      return res.status(404).json({ error: "Ride not found" });
    }
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: "text is required" });
    }
    if (!["user", "driver", "system"].includes(sender)) {
      return res.status(400).json({ error: "sender must be user, driver or system" });
    }

    const id = `msg_${randomUUID()}`;
    await run(
      "INSERT INTO messages (id, ride_id, sender, text) VALUES (?,?,?,?)",
      id,
      req.params.id,
      sender,
      String(text).slice(0, 1000)
    );
    await run(
      "UPDATE rides SET updated_at = datetime('now') WHERE id = ?",
      req.params.id
    );

    res.status(201).json({ ok: true, id });
  })
);

/* ----------------------------------------------------------------- ratings */

api.post(
  "/rides/:id/rating",
  wrap(async (req, res) => {
    const { stars, comment } = req.body ?? {};
    const value = Number(stars);

    if (!Number.isInteger(value) || value < 1 || value > 5) {
      return res.status(400).json({ error: "stars must be a whole number from 1 to 5" });
    }

    const ride = await findRide(req.params.id);
    if (!ride) return res.status(404).json({ error: "Ride not found" });

    // Re-rating replaces the previous score rather than stacking another row.
    await run(
      `INSERT INTO ratings (id, ride_id, driver_id, stars, comment)
       VALUES (?,?,?,?,?)
       ON CONFLICT(ride_id) DO UPDATE SET
         stars = excluded.stars,
         comment = excluded.comment,
         created_at = datetime('now')`,
      `rate_${randomUUID()}`,
      req.params.id,
      ride.driver_id,
      value,
      comment ? String(comment).slice(0, 500) : null
    );

    /**
     * Fold the new score into the driver's average.
     *
     * Ratings were being written to their own table and never read back, so
     * `drivers.rating` stayed at the 5.0 every row is seeded with — the star on
     * the driver card was a default wearing the appearance of a reputation.
     * Recomputed from the table so it always reflects what passengers actually
     * submitted.
     */
    const summary = await selectOne<{ average: number | null; count: number }>(
      `SELECT AVG(stars)::float AS average, COUNT(*)::int AS count
         FROM ratings WHERE driver_id = ?`,
      ride.driver_id
    );

    if (summary?.average != null) {
      await run(
        "UPDATE drivers SET rating = ? WHERE id = ?",
        Math.round(summary.average * 10) / 10,
        ride.driver_id
      );
    }

    res.status(201).json({
      ok: true,
      stars: value,
      driverRating: summary?.average != null ? Math.round(summary.average * 10) / 10 : null,
      ratingCount: summary?.count ?? 0,
    });
  })
);

/* ------------------------------------------------------------- TMO reports */

api.post(
  "/tmo-reports",
  wrap(async (req, res) => {
    const { rideId, driverId, violationType, demandedFare, details, contactNumber } =
      req.body ?? {};

    if (!violationType) {
      return res.status(400).json({ error: "violationType is required" });
    }

    // The ride_id/driver_id columns are foreign keys. If a report points at a
    // ride or driver that isn't in the database (e.g. a stale reference), the
    // insert would fail and the complaint would be lost. A TMO complaint is too
    // important to drop, so we keep each link only when it really exists and
    // otherwise file the report unlinked rather than throwing it away.
    let safeRideId: string | null = null;
    if (rideId) {
      const found = await selectOne<{ id: string }>("SELECT id FROM rides WHERE id = ?", rideId);
      safeRideId = found ? String(rideId) : null;
      if (!found) console.warn(`TMO report filed for unknown ride ${rideId} — saved without ride link.`);
    }
    let safeDriverId: string | null = null;
    if (driverId) {
      const found = await selectOne<{ id: string }>("SELECT id FROM drivers WHERE id = ?", driverId);
      safeDriverId = found ? String(driverId) : null;
      if (!found) console.warn(`TMO report filed for unknown driver ${driverId} — saved without driver link.`);
    }

    const referenceCode = `TMO-DUM-${Math.floor(100000 + Math.random() * 900000)}`;
    await run(
      `INSERT INTO tmo_reports
        (id, reference_code, ride_id, driver_id, violation_type, demanded_fare, details, contact_number, filed_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      `tmo_${randomUUID()}`,
      referenceCode,
      safeRideId,
      safeDriverId,
      violationType,
      Number.isFinite(Number(demandedFare)) ? Math.round(Number(demandedFare)) : null,
      details ? String(details).slice(0, 2000) : null,
      contactNumber ?? null,
      req.user?.id ?? null
    );

    res.status(201).json({ referenceCode });
  })
);

/* ------------------------------------------------------------ admin stats */

api.get(
  "/admin/stats/daily",
  requireAuth,
  requireRole("admin"),
  wrap(async (req, res) => {
    const rows = await selectAll<RideRow>(
      "SELECT * FROM rides WHERE status = 'completed'"
    );

    // Group completed trips by the day they finished, add up fares per day.
    const byDay = new Map<string, { trips: number; fareTotal: number }>();
    const routeCounts = new Map<string, number>();

    for (const row of rows) {
      const day = (row.completed_at ?? row.created_at).slice(0, 10); // "YYYY-MM-DD"
      const entry = byDay.get(day) ?? { trips: 0, fareTotal: 0 };
      entry.trips += 1;
      entry.fareTotal += row.total_fare;
      byDay.set(day, entry);

      let routeName = "Unknown route";
      try {
        const pickup = JSON.parse(row.pickup)?.name ?? "?";
        const dropoff = JSON.parse(row.dropoff)?.name ?? "?";
        routeName = `${pickup} → ${dropoff}`;
      } catch {
        // pickup/dropoff wasn't valid JSON for this row — skip naming it
      }
      routeCounts.set(routeName, (routeCounts.get(routeName) ?? 0) + 1);
    }

    const dailyStats = Array.from(byDay.entries())
      .map(([day, { trips, fareTotal }]) => ({
        day,
        trips,
        averageFare: Math.round(fareTotal / trips),
      }))
      .sort((a, b) => b.day.localeCompare(a.day));

    const busiestRoutes = Array.from(routeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([route, trips]) => ({ route, trips }));

    res.json({
      dailyStats,
      busiestRoutes,
      totalCompletedTrips: rows.length,
    });
  })
);