import { randomUUID } from "crypto";
import { Router } from "express";
import { authRoutes } from "./authRoutes";
import { adminRoutes } from "./adminRoutes";
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

export const api = Router();

api.use((req, res, next) => {
  attachUser(req, res, next).catch(next);
});
api.use("/auth", authRoutes);
api.use("/admin", adminRoutes);

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

async function rideWithDriver(row: RideRow) {
  const driver = row.driver_id ? await findDriver(row.driver_id) : null;
  return toRide(row, driver);
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
    res.json({ rides: await Promise.all(rows.map(rideWithDriver)) });
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

    const rows = await selectAll<RideRow>(
      `SELECT * FROM rides
        WHERE status = 'searching_driver'
          AND driver_id IS NULL
          AND (?::text IS NULL OR id NOT IN (SELECT ride_id FROM ride_declines WHERE driver_id = ?))
        ORDER BY created_at ASC
        LIMIT 50`,
      driverId,
      driverId
    );

    res.json({ rides: rows.map((r) => toRide(r, null)) });
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
    res.json({ rides: await Promise.all(rows.map(rideWithDriver)) });
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
    res.json({ rides: await Promise.all(rows.map(rideWithDriver)) });
  })
);

api.get(
  "/rides/:id",
  wrap(async (req, res) => {
    const row = await findRide(req.params.id);
    if (!row) return res.status(404).json({ error: "Ride not found" });
    res.json({ ride: await rideWithDriver(row) });
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

    res.status(201).json({ ok: true, stars: value });
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