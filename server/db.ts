import { Pool } from "pg";
import type { PoolClient } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";

// GentleTrike stores its data in a cloud Postgres database (Neon), so data
// survives restarts and every teammate + the live site share the same data.
// `pg` is a pure-JavaScript driver — no native module, no C++ toolchain — so it
// installs cleanly on Windows without Visual Studio Build Tools.

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and paste your Neon connection string."
  );
}

export const pool = new Pool({
  connectionString,
  // Neon requires SSL. rejectUnauthorized:false avoids the "self-signed
  // certificate" error that trips up managed Postgres providers.
  ssl: { rejectUnauthorized: false },
});

// A query inside tx() must run on that transaction's own connection — not a
// random one from the pool — or BEGIN/COMMIT wouldn't cover it. AsyncLocalStorage
// carries the active transaction's client through the awaits so callers don't
// have to thread it through by hand.
const txStore = new AsyncLocalStorage<PoolClient>();
const conn = (): Pool | PoolClient => txStore.getStore() ?? pool;

// The routes were written for SQLite. Two SQLite-isms are translated to Postgres
// in this one place, so the query strings elsewhere barely change:
//   ?               -> $1, $2, ...  (Postgres numbered placeholders)
//   datetime('now') -> a UTC text timestamp in SQLite's exact old format,
//                      keeping created_at/updated_at byte-identical to before.
const NOW_SQL = "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')";

function translate(sql: string): string {
  let i = 0;
  return sql
    .replace(/datetime\('now'\)/g, NOW_SQL)
    .replace(/\?/g, () => `$${++i}`);
}

async function query(sql: string, params: unknown[]) {
  return conn().query(translate(sql), params as unknown[]);
}

/**
 * These three helpers are the single place row types are asserted, so the route
 * handlers can work with real row types. All async now — Postgres is over the
 * network, unlike the old in-process SQLite file.
 */
export async function selectOne<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
  const r = await query(sql, params);
  return r.rows[0] as T | undefined;
}

export async function selectAll<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  const r = await query(sql, params);
  return r.rows as T[];
}

export async function run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
  const r = await query(sql, params);
  return { changes: r.rowCount ?? 0 };
}

/**
 * Run `fn` inside a transaction on a single dedicated connection, rolling back
 * if it throws. Queries called inside `fn` automatically use that same
 * connection (via the AsyncLocalStorage above).
 */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  return txStore.run(client, async () => {
    try {
      await client.query("BEGIN");
      const result = await fn();
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });
}

// Postgres has no `rowid`, so `messages` carries an explicit `seq` (auto-
// incrementing) column to preserve insertion order as a tiebreaker within the
// same second. Otherwise the schema mirrors the old SQLite one; integer columns
// (0/1) still stand in for booleans so the app code is unchanged.
const SCHEMA = `
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
    updated_at      TEXT NOT NULL DEFAULT ${NOW_SQL}
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
    created_at           TEXT NOT NULL DEFAULT ${NOW_SQL},
    updated_at           TEXT NOT NULL DEFAULT ${NOW_SQL}
  );

  ALTER TABLE rides ADD COLUMN IF NOT EXISTS started_at   TEXT;
  ALTER TABLE rides ADD COLUMN IF NOT EXISTS completed_at TEXT;

  CREATE INDEX IF NOT EXISTS idx_rides_status    ON rides(status);
  CREATE INDEX IF NOT EXISTS idx_rides_driver    ON rides(driver_id);
  CREATE INDEX IF NOT EXISTS idx_rides_passenger ON rides(passenger_id);

  -- A decline is per-driver: it hides the request from that one rider only,
  -- it must not pull the request out of every other rider's queue.
  CREATE TABLE IF NOT EXISTS ride_declines (
    ride_id    TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    driver_id  TEXT NOT NULL REFERENCES drivers(id),
    created_at TEXT NOT NULL DEFAULT ${NOW_SQL},
    PRIMARY KEY (ride_id, driver_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    seq        BIGSERIAL,
    id         TEXT PRIMARY KEY,
    ride_id    TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    sender     TEXT NOT NULL,
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW_SQL}
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
    created_at TEXT NOT NULL DEFAULT ${NOW_SQL}
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
    created_at     TEXT NOT NULL DEFAULT ${NOW_SQL}
  );

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('passenger', 'rider', 'admin')),
    created_at    TEXT NOT NULL DEFAULT ${NOW_SQL}
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW_SQL}
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id          TEXT PRIMARY KEY,
    actor_id    TEXT NOT NULL,
    actor_name  TEXT NOT NULL,
    action      TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id   TEXT,
    details     TEXT,
    ip_address  TEXT,
    created_at  TEXT NOT NULL DEFAULT ${NOW_SQL}
  );

  CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`;

/**
 * Before accounts, `claimed_by` held a browser clientId. Those rows block real
 * riders from claiming a unit until we clear claims that no longer match a user.
 */
async function releaseOrphanedDriverClaims() {
  await run(
    `UPDATE drivers d
        SET claimed_by = NULL, is_online = 0
      WHERE d.claimed_by IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = d.claimed_by)`
  );
}

/** Run column additions for schema migrations. */
async function runMigrations() {
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_role TEXT DEFAULT 'staff';
    ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

    ALTER TABLE rides ADD COLUMN IF NOT EXISTS reject_reason TEXT;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancelled_by TEXT;

    ALTER TABLE tmo_reports ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'medium';
    ALTER TABLE tmo_reports ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
    ALTER TABLE tmo_reports ADD COLUMN IF NOT EXISTS filed_by TEXT;
    ALTER TABLE tmo_reports ADD COLUMN IF NOT EXISTS admin_notes TEXT;
    ALTER TABLE tmo_reports ADD COLUMN IF NOT EXISTS resolved_by TEXT;
    ALTER TABLE tmo_reports ADD COLUMN IF NOT EXISTS resolved_at TEXT;

    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'verified';
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS registered_at TEXT DEFAULT ${NOW_SQL};
  `);
}

/** Create the tables and run migrations. Call once at server startup.
 *  (No fake fleet is seeded — the map shows only real, registered riders.) */
export async function initDb() {
  await pool.query(SCHEMA);
  await runMigrations();
  await releaseOrphanedDriverClaims();
}

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
  started_at: string | null;
  completed_at: string | null;
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
