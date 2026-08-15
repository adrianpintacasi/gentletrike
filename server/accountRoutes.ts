import { Router } from "express";
import { requireAuth } from "./auth";
import { selectAll, selectOne, toRide, type RideRow } from "./db";
import { haversineKm } from "../shared/geo";

/**
 * Everything the Account tab shows: finished trips, filed complaints, and the
 * day's running totals.
 *
 * `/me/rides` deliberately returns only live trips, because the booking screen
 * wants the one in progress. History is a different question with a different
 * answer, so it gets its own route rather than a flag on that one.
 */
export const accountRoutes = Router();

/** Trips that are over, either way they ended. */
const FINISHED_STATUSES = ["completed", "cancelled"] as const;

/**
 * The calendar day in Dumaguete, as YYYY-MM-DD.
 *
 * Timestamps are stored as text and the server may well be running in UTC, so a
 * rider finishing a trip at 9pm local would otherwise be counted against the
 * next day. Everything the driver sees is bucketed by *their* day.
 */
function manilaDay(value: string | Date = new Date()): string {
  const date =
    value instanceof Date
      ? value
      : new Date(String(value).includes("T") ? value : `${String(value).replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

/** The drivers row this user has claimed, if they ride. */
async function claimedDriverId(userId: string): Promise<string | null> {
  const row = await selectOne<{ id: string }>(
    "SELECT id FROM drivers WHERE claimed_by = ? LIMIT 1",
    userId
  );
  return row?.id ?? null;
}

/**
 * GET /me/history
 *
 * Finished trips, newest first — the rider's as driver, everyone else's as
 * passenger. Capped because a phone list nobody scrolls to the end of does not
 * need every row ever written.
 */
accountRoutes.get("/history", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const placeholders = FINISHED_STATUSES.map(() => "?").join(",");
  const driverId = await claimedDriverId(userId);

  const rows = await selectAll<RideRow>(
    `SELECT * FROM rides
      WHERE (passenger_id = ?${driverId ? " OR driver_id = ?" : ""})
        AND status IN (${placeholders})
      ORDER BY COALESCE(completed_at, updated_at, created_at) DESC
      LIMIT 60`,
    ...(driverId ? [userId, driverId] : [userId]),
    ...FINISHED_STATUSES
  );

  res.json({
    rides: rows.map((row) => ({
      ...toRide(row),
      // Which side of this trip the caller was on, so the list can say
      // "you rode" or "you drove" without a second lookup.
      role: row.driver_id && row.driver_id === driverId ? "driver" : "passenger",
    })),
  });
});

/**
 * GET /me/reports
 *
 * Complaints this user filed, with where each one got to. A report that
 * disappears the moment it is submitted is a report nobody trusts enough to
 * file twice.
 */
accountRoutes.get("/reports", requireAuth, async (req, res) => {
  const rows = await selectAll<{
    reference_code: string;
    violation_type: string;
    severity: string | null;
    status: string | null;
    details: string | null;
    admin_notes: string | null;
    created_at: string;
    resolved_at: string | null;
  }>(
    `SELECT reference_code, violation_type, severity, status, details,
            admin_notes, created_at, resolved_at
       FROM tmo_reports
      WHERE filed_by = ?
      ORDER BY created_at DESC
      LIMIT 40`,
    req.user!.id
  );

  res.json({
    reports: rows.map((r) => ({
      referenceCode: r.reference_code,
      violationType: r.violation_type,
      severity: r.severity ?? "medium",
      status: r.status ?? "pending",
      details: r.details,
      adminNotes: r.admin_notes,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
    })),
  });
});

/**
 * GET /me/rider-hint?lat=..&lng=..&vehicleType=..
 *
 * Where the riders actually are, when nobody has taken the trip.
 *
 * Google cannot answer this — it has no idea where Dumaguete's pedicabs are.
 * The fleet positions are ours, from `drivers.current_lat/lng`; Google's only
 * job here is turning the busiest cluster's centre into a street name a
 * passenger can walk to.
 *
 * Everything returned is measured: the count is real riders on duty, the
 * distance is computed, and when there is nobody out it says so rather than
 * inventing an encouraging number.
 */
accountRoutes.get("/rider-hint", requireAuth, async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const vehicleType = typeof req.query.vehicleType === "string" ? req.query.vehicleType : null;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat and lng are required" });
  }

  const drivers = await selectAll<{
    current_lat: number;
    current_lng: number;
    vehicle_type: string;
  }>(
    `SELECT current_lat, current_lng, vehicle_type
       FROM drivers
      WHERE is_online = 1${vehicleType ? " AND vehicle_type = ?" : ""}`,
    ...(vehicleType ? [vehicleType] : [])
  );

  if (drivers.length === 0) {
    return res.json({ riders: 0, street: null, distanceKm: null, driversOnline: 0 });
  }

  /**
   * Group riders that are within ~400 m of each other and take the biggest
   * group. A single nearest rider is a worse suggestion than a corner three of
   * them are waiting at — the point is to send the passenger somewhere trips
   * actually start, not to chase one moving trike.
   */
  const CLUSTER_KM = 0.4;
  const clusters: { lat: number; lng: number; members: number }[] = [];

  for (const driver of drivers) {
    const point = { lat: driver.current_lat, lng: driver.current_lng };
    const home = clusters.find((c) => haversineKm(c, point) <= CLUSTER_KM);
    if (home) {
      // Running mean, so the centre drifts to the middle of the group.
      home.lat = (home.lat * home.members + point.lat) / (home.members + 1);
      home.lng = (home.lng * home.members + point.lng) / (home.members + 1);
      home.members += 1;
    } else {
      clusters.push({ ...point, members: 1 });
    }
  }

  // Biggest group first; ties broken by whichever is closer to the passenger.
  clusters.sort(
    (a, b) =>
      b.members - a.members ||
      haversineKm({ lat, lng }, a) - haversineKm({ lat, lng }, b)
  );
  const best = clusters[0];
  const distanceKm = Math.round(haversineKm({ lat, lng }, best) * 100) / 100;

  let street: string | null = null;
  try {
    const key = process.env.GOOGLE_MAPS_SERVER_KEY;
    if (key) {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${best.lat},${best.lng}` +
          `&result_type=route&language=en&key=${key}`
      );
      const data = await response.json();
      street =
        data?.results?.[0]?.address_components?.find((c: any) =>
          c.types?.includes("route")
        )?.long_name ?? null;
    }
  } catch (err) {
    console.error("rider hint geocode failed:", (err as Error).message);
  }

  res.json({
    riders: best.members,
    street,
    distanceKm,
    driversOnline: drivers.length,
  });
});

/**
 * GET /me/today
 *
 * The day's totals, computed from the rides table rather than read from a
 * counter.
 *
 * `drivers.earnings_today` and `drivers.trips_today` are incremented on every
 * completed trip and never reset, so after a week they were a career total
 * wearing a "today" label. Deriving them from `completed_at` means the numbers
 * are right by construction and roll over at Dumaguete midnight with no cron
 * job to forget to run.
 */
accountRoutes.get("/today", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const today = manilaDay();
  const driverId = await claimedDriverId(userId);

  const rows = await selectAll<RideRow>(
    `SELECT * FROM rides
      WHERE (passenger_id = ?${driverId ? " OR driver_id = ?" : ""})
        AND status = 'completed'
      ORDER BY COALESCE(completed_at, updated_at, created_at) DESC
      LIMIT 200`,
    ...(driverId ? [userId, driverId] : [userId])
  );

  const finishedToday = rows.filter(
    (row) => manilaDay(row.completed_at ?? row.updated_at ?? row.created_at) === today
  );

  const asDriver = finishedToday.filter((row) => driverId && row.driver_id === driverId);
  const asPassenger = finishedToday.filter((row) => row.passenger_id === userId);

  const sum = (list: RideRow[]) => list.reduce((total, row) => total + row.total_fare, 0);
  const distance = (list: RideRow[]) =>
    Math.round(list.reduce((total, row) => total + (row.distance_km ?? 0), 0) * 10) / 10;

  res.json({
    day: today,
    driver: {
      trips: asDriver.length,
      earnings: sum(asDriver),
      distanceKm: distance(asDriver),
    },
    passenger: {
      trips: asPassenger.length,
      spent: sum(asPassenger),
      distanceKm: distance(asPassenger),
    },
  });
});
