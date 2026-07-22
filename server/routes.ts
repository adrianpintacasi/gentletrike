import { randomUUID } from "crypto";
import { Router } from "express";
import {
  run,
  selectAll,
  selectOne,
  toDriver,
  toRide,
  tx,
  type DriverRow,
  type RideRow,
} from "./db";

export const api = Router();

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

function rideWithDriver(row: RideRow) {
  const driver = row.driver_id ? findDriver(row.driver_id) : null;
  return toRide(row, driver);
}

/* ------------------------------------------------------------------ health */

api.get("/health", (_req, res) => {
  res.json({ status: "ok", app: "GentleTrike Dumaguete Public Hailing" });
});

/* ----------------------------------------------------------------- drivers */

/** Fleet for the passenger map. `?online=1` limits it to riders on duty. */
api.get("/drivers", (req, res) => {
  const rows =
    req.query.online === "1"
      ? selectAll<DriverRow>("SELECT * FROM drivers WHERE is_online = 1")
      : selectAll<DriverRow>("SELECT * FROM drivers");
  res.json({ drivers: rows.map(toDriver) });
});

/**
 * Claim a pedicab unit for this device. Without accounts, "logging in as a
 * driver" is just taking an unclaimed unit; the same clientId reclaims the
 * same unit on reload.
 */
api.post("/drivers/claim", (req, res) => {
  const { clientId, driverId } = req.body ?? {};
  if (!clientId) return res.status(400).json({ error: "clientId is required" });

  const existing = selectOne<DriverRow>(
    "SELECT * FROM drivers WHERE claimed_by = ?",
    clientId
  );
  if (existing && (!driverId || existing.id === driverId)) {
    return res.json({ driver: toDriver(existing) });
  }

  const claimed = tx(() => {
    // Release whatever this device held before, then take the requested unit
    // (or the first free one).
    run(
      "UPDATE drivers SET claimed_by = NULL, is_online = 0 WHERE claimed_by = ?",
      clientId
    );

    const target = driverId
      ? selectOne<DriverRow>(
          "SELECT * FROM drivers WHERE id = ? AND (claimed_by IS NULL OR claimed_by = ?)",
          driverId,
          clientId
        )
      : selectOne<DriverRow>(
          "SELECT * FROM drivers WHERE claimed_by IS NULL LIMIT 1"
        );

    if (!target) return null;

    run(
      "UPDATE drivers SET claimed_by = ?, updated_at = datetime('now') WHERE id = ?",
      clientId,
      target.id
    );
    return findDriver(target.id) ?? null;
  });

  if (!claimed) {
    return res
      .status(409)
      .json({ error: "That pedicab unit is already in use on another device" });
  }
  res.json({ driver: toDriver(claimed) });
});

api.get("/drivers/:id", (req, res) => {
  const row = findDriver(req.params.id);
  if (!row) return res.status(404).json({ error: "Driver not found" });
  res.json({ driver: toDriver(row) });
});

/** Live GPS ping + duty status from the driver's phone. */
api.patch("/drivers/:id", (req, res) => {
  if (!findDriver(req.params.id)) {
    return res.status(404).json({ error: "Driver not found" });
  }

  const { lat, lng, isOnline } = req.body ?? {};
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
  run(`UPDATE drivers SET ${sets.join(", ")} WHERE id = ?`, ...values, req.params.id);

  res.json({ driver: toDriver(findDriver(req.params.id)!) });
});

/** Every live ride this driver is carrying (the pooled route). */
api.get("/drivers/:id/rides", (req, res) => {
  const rows = selectAll<RideRow>(
    `SELECT * FROM rides
      WHERE driver_id = ?
        AND status IN ('driver_assigned','driver_arriving','in_transit')
      ORDER BY created_at ASC`,
    req.params.id
  );
  res.json({ rides: rows.map(rideWithDriver) });
});

/* ------------------------------------------------------------------- rides */

/** Passenger books a trip. */
api.post("/rides", (req, res) => {
  const {
    passengerId,
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

  if (!passengerId) return res.status(400).json({ error: "passengerId is required" });
  if (!pickupLocation?.name || !Number.isFinite(pickupLocation?.lat)) {
    return res.status(400).json({ error: "A valid pickupLocation is required" });
  }
  if (!dropoffLocation?.name || !Number.isFinite(dropoffLocation?.lat)) {
    return res.status(400).json({ error: "A valid dropoffLocation is required" });
  }

  const id = `ride_${randomUUID()}`;
  run(
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

  run(
    "INSERT INTO messages (id, ride_id, sender, text) VALUES (?,?,?,?)",
    `msg_${randomUUID()}`,
    id,
    "system",
    "GentleTrike ride requested! Looking for the nearest Dumaguete motorcab rider..."
  );

  res.status(201).json({ ride: rideWithDriver(findRide(id)!) });
});

/** Open queue for drivers — excludes anything this driver already declined. */
api.get("/rides/open", (req, res) => {
  const driverId = typeof req.query.driverId === "string" ? req.query.driverId : null;

  const rows = selectAll<RideRow>(
    `SELECT * FROM rides
      WHERE status = 'searching_driver'
        AND driver_id IS NULL
        AND (? IS NULL OR id NOT IN (SELECT ride_id FROM ride_declines WHERE driver_id = ?))
      ORDER BY created_at ASC
      LIMIT 50`,
    driverId,
    driverId
  );

  res.json({ rides: rows.map((r) => toRide(r, null)) });
});

/** A passenger's own live rides. */
api.get("/passengers/:id/rides", (req, res) => {
  const rows = selectAll<RideRow>(
    `SELECT * FROM rides
      WHERE passenger_id = ? AND status IN (${LIVE_STATUSES.map(() => "?").join(",")})
      ORDER BY created_at DESC`,
    req.params.id,
    ...LIVE_STATUSES
  );
  res.json({ rides: rows.map(rideWithDriver) });
});

api.get("/rides/:id", (req, res) => {
  const row = findRide(req.params.id);
  if (!row) return res.status(404).json({ error: "Ride not found" });
  res.json({ ride: rideWithDriver(row) });
});

/**
 * Driver accepts. The WHERE clause carries the race: only the first request to
 * land finds driver_id still NULL, so a second driver tapping Accept at the
 * same moment gets a 409 instead of silently stealing the trip.
 */
api.post("/rides/:id/accept", (req, res) => {
  const { driverId } = req.body ?? {};
  if (!driverId) return res.status(400).json({ error: "driverId is required" });

  const driver = findDriver(driverId);
  if (!driver) return res.status(404).json({ error: "Driver not found" });

  const result = run(
    `UPDATE rides
        SET driver_id = ?, status = 'driver_assigned', updated_at = datetime('now')
      WHERE id = ? AND driver_id IS NULL AND status = 'searching_driver'`,
    driverId,
    req.params.id
  );

  if (Number(result.changes) === 0) {
    if (!findRide(req.params.id)) {
      return res.status(404).json({ error: "Ride not found" });
    }
    return res
      .status(409)
      .json({ error: "This trip was already taken by another rider" });
  }

  run(
    "INSERT INTO messages (id, ride_id, sender, text) VALUES (?,?,?,?)",
    `msg_${randomUUID()}`,
    req.params.id,
    "driver",
    `Maayong adlaw! I am ${driver.name}. On my way to your pickup point!`
  );

  res.json({ ride: rideWithDriver(findRide(req.params.id)!) });
});

/** Driver passes on a trip — hidden for them, still open for everyone else. */
api.post("/rides/:id/decline", (req, res) => {
  const { driverId } = req.body ?? {};
  if (!driverId) return res.status(400).json({ error: "driverId is required" });
  if (!findRide(req.params.id)) {
    return res.status(404).json({ error: "Ride not found" });
  }

  run(
    "INSERT OR IGNORE INTO ride_declines (ride_id, driver_id) VALUES (?,?)",
    req.params.id,
    driverId
  );

  res.json({ ok: true });
});

api.post("/rides/:id/status", (req, res) => {
  const { status } = req.body ?? {};
  if (!RIDE_STATUSES.includes(status)) {
    return res
      .status(400)
      .json({ error: `status must be one of: ${RIDE_STATUSES.join(", ")}` });
  }

  const row = findRide(req.params.id);
  if (!row) return res.status(404).json({ error: "Ride not found" });
  if (row.status === "completed" || row.status === "cancelled") {
    return res.status(409).json({ error: `Ride is already ${row.status}` });
  }

  tx(() => {
    run(
      "UPDATE rides SET status = ?, updated_at = datetime('now') WHERE id = ?",
      status,
      req.params.id
    );

    // Credit the rider once, at completion — never on accept.
    if (status === "completed" && row.driver_id) {
      run(
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

  res.json({ ride: rideWithDriver(findRide(req.params.id)!) });
});

api.post("/rides/:id/cancel", (req, res) => {
  const row = findRide(req.params.id);
  if (!row) return res.status(404).json({ error: "Ride not found" });
  if (row.status === "completed") {
    return res.status(409).json({ error: "Completed rides cannot be cancelled" });
  }

  run(
    "UPDATE rides SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?",
    req.params.id
  );
  res.json({ ride: rideWithDriver(findRide(req.params.id)!) });
});

/* ---------------------------------------------------------------- messages */

interface MessageRow {
  id: string;
  sender: string;
  text: string;
  created_at: string;
}

api.get("/rides/:id/messages", (req, res) => {
  if (!findRide(req.params.id)) {
    return res.status(404).json({ error: "Ride not found" });
  }
  const rows = selectAll<MessageRow>(
    "SELECT * FROM messages WHERE ride_id = ? ORDER BY created_at ASC, rowid ASC",
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
});

api.post("/rides/:id/messages", (req, res) => {
  const { sender, text } = req.body ?? {};
  if (!findRide(req.params.id)) {
    return res.status(404).json({ error: "Ride not found" });
  }
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: "text is required" });
  }
  if (!["user", "driver", "system"].includes(sender)) {
    return res.status(400).json({ error: "sender must be user, driver or system" });
  }

  const id = `msg_${randomUUID()}`;
  run(
    "INSERT INTO messages (id, ride_id, sender, text) VALUES (?,?,?,?)",
    id,
    req.params.id,
    sender,
    String(text).slice(0, 1000)
  );
  run("UPDATE rides SET updated_at = datetime('now') WHERE id = ?", req.params.id);

  res.status(201).json({ ok: true, id });
});

/* ------------------------------------------------------------- TMO reports */

api.post("/tmo-reports", (req, res) => {
  const { rideId, driverId, violationType, demandedFare, details, contactNumber } =
    req.body ?? {};

  if (!violationType) {
    return res.status(400).json({ error: "violationType is required" });
  }

  const referenceCode = `TMO-DUM-${Math.floor(100000 + Math.random() * 900000)}`;
  run(
    `INSERT INTO tmo_reports
      (id, reference_code, ride_id, driver_id, violation_type, demanded_fare, details, contact_number)
     VALUES (?,?,?,?,?,?,?,?)`,
    `tmo_${randomUUID()}`,
    referenceCode,
    rideId ?? null,
    driverId ?? null,
    violationType,
    Number.isFinite(Number(demandedFare)) ? Math.round(Number(demandedFare)) : null,
    details ? String(details).slice(0, 2000) : null,
    contactNumber ?? null
  );

  res.status(201).json({ referenceCode });
});
