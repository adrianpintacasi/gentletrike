import { randomUUID } from "crypto";
import { INITIAL_DRIVERS } from "../src/data/dumagueteData";
import { run, selectOne, type DriverRow } from "./db";

export const SEED_DRIVER_IDS = new Set(INITIAL_DRIVERS.map((d) => d.id));

const DEFAULT_LAT = 9.3067;
const DEFAULT_LNG = 123.3054;
const DEFAULT_AVATAR =
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80";

export class RiderProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RiderProfileError";
  }
}

export function normalizeUnitNumber(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  if (/^pedicab\s*#/i.test(t)) {
    return t.replace(/^pedicab\s*/i, "Pedicab ");
  }
  if (/^\d+$/.test(t)) return `Pedicab #${t}`;
  if (t.startsWith("#")) return `Pedicab ${t}`;
  return t;
}

export function isSeedDriverId(id: string): boolean {
  return SEED_DRIVER_IDS.has(id);
}

export async function createRiderDriver(
  userId: string,
  name: string,
  unitNumber: string
): Promise<DriverRow> {
  const unit = normalizeUnitNumber(unitNumber);
  if (!unit) {
    throw new RiderProfileError("Pedicab number is required");
  }

  const conflict = await selectOne<{ id: string }>(
    `SELECT id FROM drivers
      WHERE lower(unit_number) = lower(?)
        AND claimed_by IS NOT NULL
        AND claimed_by != ?`,
    unit,
    userId
  );
  if (conflict) {
    throw new RiderProfileError(
      "That pedicab number is already registered to another rider"
    );
  }

  const id = `drv_${randomUUID()}`;
  await run(
    `INSERT INTO drivers
      (id, name, vehicle_type, unit_number, plate_number, rating, trips_completed,
       phone, avatar, current_lat, current_lng, is_online, claimed_by)
     VALUES (?,?,?,?,?,5.0,0,?,?,?,?,0,?)`,
    id,
    name.trim().slice(0, 100),
    "pedicab_standard",
    unit.slice(0, 50),
    "TBD",
    "—",
    DEFAULT_AVATAR,
    DEFAULT_LAT,
    DEFAULT_LNG,
    userId
  );

  const row = await selectOne<DriverRow>("SELECT * FROM drivers WHERE id = ?", id);
  if (!row) throw new Error("Failed to create rider profile");
  return row;
}
