import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import type { StatementSync, SQLInputValue } from "node:sqlite";
import { INITIAL_DRIVERS } from "../src/data/dumagueteData";

// SQLite ships inside Node 24 itself (node:sqlite), so there is no native module
// to compile and no C++ toolchain to install — it just runs.

// On Render/Railway set DATABASE_PATH to a mounted disk (e.g. /var/data/gentletrike.db)
// so rides survive restarts. Without a disk the file lives on ephemeral storage and
// resets on every deploy — fine for a demo, not for real data.
const DB_PATH =
  process.env.DATABASE_PATH || path.join(process.cwd(), "data", "gentletrike.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// WAL lets the passenger's poll read while a driver's accept is writing.
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

/**
 * Run `fn` inside a transaction, rolling back if it throws.
 *
 * node:sqlite has no `.transaction()` wrapper of its own, and these are all
 * synchronous statements, so a plain BEGIN/COMMIT is enough.
 */
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Preparing the same SQL on every poll is wasted work, so hand out cached
// statements keyed by the query text.
const statementCache = new Map<string, StatementSync>();

function stmt(sql: string): StatementSync {
  let cached = statementCache.get(sql);
  if (!cached) {
    cached = db.prepare(sql);
    statementCache.set(sql, cached);
  }
  return cached;
}

// node:sqlite hands back untyped `Record<string, SQLOutputValue>` rows. These
// three helpers are the single place that assertion happens, so the route
// handlers can work with real row types.
export function selectOne<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return stmt(sql).get(...params) as unknown as T | undefined;
}

export function selectAll<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return stmt(sql).all(...params) as unknown as T[];
}

export function run(sql: string, ...params: SQLInputValue[]) {
  return stmt(sql).run(...params);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS drivers (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    vehicle_type    TEXT NOT NULL,
    unit_number     TEXT NOT NULL,
    plate_number    TEXT NOT NULL,
    rating          REAL NOT NULL DEFAULT 5.0,
    trips_completed INTEGER NOT NULL DEFAULT 0,
    phone           TEXT NOT NULL,
    avatar          TEXT NOT NULL,
    current_lat     REAL NOT NULL,
    current_lng     REAL NOT NULL,
    is_online       INTEGER NOT NULL DEFAULT 0,
    claimed_by      TEXT,
    earnings_today  INTEGER NOT NULL DEFAULT 0,
    trips_today     INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rides (
    id                   TEXT PRIMARY KEY,
    passenger_id         TEXT NOT NULL,
    pickup               TEXT NOT NULL,
    dropoff              TEXT NOT NULL,
    vehicle_type         TEXT NOT NULL,
    passengers           INTEGER NOT NULL DEFAULT 1,
    distance_km          REAL NOT NULL,
    estimated_minutes    INTEGER NOT NULL,
    base_fare            INTEGER NOT NULL,
    total_fare           INTEGER NOT NULL,
    is_pakyaw_negotiated INTEGER NOT NULL DEFAULT 0,
    payment_method       TEXT NOT NULL DEFAULT 'cash',
    notes                TEXT,
    driver_id            TEXT REFERENCES drivers(id),
    status               TEXT NOT NULL DEFAULT 'searching_driver',
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_rides_status    ON rides(status);
  CREATE INDEX IF NOT EXISTS idx_rides_driver    ON rides(driver_id);
  CREATE INDEX IF NOT EXISTS idx_rides_passenger ON rides(passenger_id);

  -- A decline is per-driver: it hides the request from that one rider only,
  -- it must not pull the request out of every other rider's queue.
  CREATE TABLE IF NOT EXISTS ride_declines (
    ride_id    TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    driver_id  TEXT NOT NULL REFERENCES drivers(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (ride_id, driver_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    ride_id    TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    sender     TEXT NOT NULL,
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_ride ON messages(ride_id);

  -- One rating per completed trip. The unique index makes a second submission
  -- an update rather than a duplicate.
  CREATE TABLE IF NOT EXISTS ratings (
    id         TEXT PRIMARY KEY,
    ride_id    TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    driver_id  TEXT REFERENCES drivers(id),
    stars      INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    comment    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_ride ON ratings(ride_id);

  CREATE TABLE IF NOT EXISTS tmo_reports (
    id             TEXT PRIMARY KEY,
    reference_code TEXT NOT NULL UNIQUE,
    ride_id        TEXT REFERENCES rides(id),
    driver_id      TEXT REFERENCES drivers(id),
    violation_type TEXT NOT NULL,
    demanded_fare  INTEGER,
    details        TEXT,
    contact_number TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

/**
 * Seed the pedicab fleet once. Existing rows are left alone so a redeploy does
 * not wipe a driver's live status or today's earnings.
 */
function seedDrivers() {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO drivers
      (id, name, vehicle_type, unit_number, plate_number, rating,
       trips_completed, phone, avatar, current_lat, current_lng, is_online)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,0)
  `);

  tx(() => {
    for (const d of INITIAL_DRIVERS) {
      insert.run(
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
        d.currentLng
      );
    }
  });
}

seedDrivers();

export interface DriverRow {
  id: string;
  name: string;
  vehicle_type: string;
  unit_number: string;
  plate_number: string;
  rating: number;
  trips_completed: number;
  phone: string;
  avatar: string;
  current_lat: number;
  current_lng: number;
  is_online: number;
  claimed_by: string | null;
  earnings_today: number;
  trips_today: number;
  updated_at: string;
}

export interface RideRow {
  id: string;
  passenger_id: string;
  pickup: string;
  dropoff: string;
  vehicle_type: string;
  passengers: number;
  distance_km: number;
  estimated_minutes: number;
  base_fare: number;
  total_fare: number;
  is_pakyaw_negotiated: number;
  payment_method: string;
  notes: string | null;
  driver_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Shape the wire format the React app already expects (see src/types.ts). */
export function toDriver(row: DriverRow) {
  return {
    id: row.id,
    name: row.name,
    vehicleType: row.vehicle_type,
    unitNumber: row.unit_number,
    plateNumber: row.plate_number,
    rating: row.rating,
    tripsCompleted: row.trips_completed,
    phone: row.phone,
    avatar: row.avatar,
    currentLat: row.current_lat,
    currentLng: row.current_lng,
    isOnline: row.is_online === 1,
    earningsToday: row.earnings_today,
    tripsToday: row.trips_today,
  };
}

export function toRide(row: RideRow, driver?: DriverRow | null) {
  return {
    id: row.id,
    passengerId: row.passenger_id,
    pickupLocation: JSON.parse(row.pickup),
    dropoffLocation: JSON.parse(row.dropoff),
    vehicleType: row.vehicle_type,
    passengers: row.passengers,
    distanceKm: row.distance_km,
    estimatedMinutes: row.estimated_minutes,
    baseFare: row.base_fare,
    totalFare: row.total_fare,
    isPakyawNegotiated: row.is_pakyaw_negotiated === 1,
    paymentMethod: row.payment_method,
    notes: row.notes ?? undefined,
    assignedDriver: driver ? toDriver(driver) : undefined,
    status: row.status,
    createdAt: row.created_at,
  };
}
