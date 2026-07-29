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

export const VALID_VEHICLE_TYPES = new Set([
  "pedicab_standard",
  "habal_habal",
  "multicab",
]);

export function normalizeVehicleType(raw?: string): string {
  return raw && VALID_VEHICLE_TYPES.has(raw) ? raw : "pedicab_standard";
}

// A rider photo is stored inline as a base64 data URI (Option A). Cap the size
// so a single upload can't bloat the database or the request body.
const MAX_PHOTO_CHARS = 2_000_000; // ~1.5 MB image once base64-encoded

function sanitizePhoto(raw?: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t.startsWith("data:image/")) return null;
  if (t.length > MAX_PHOTO_CHARS) {
    throw new RiderProfileError("Photo is too large — please use a smaller image.");
  }
  return t;
}

export async function createRiderDriver(
  userId: string,
  name: string,
  unitNumber: string,
  options: { vehicleType?: string; photo?: string } = {}
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

  const vehicleType = normalizeVehicleType(options.vehicleType);
  const avatar = sanitizePhoto(options.photo) ?? DEFAULT_AVATAR;

  // Sign-up already collected a contact number onto the user row; this used to
  // insert a literal "—" instead of carrying it over, so every passenger saw a
  // Call button that dialled nothing.
  const account = await selectOne<{ contact_number: string | null }>(
    "SELECT contact_number FROM users WHERE id = ?",
    userId
  );
  const phone = account?.contact_number?.trim() || "—";

  // A brand-new rider starts as 'pending': they cannot go online or take
  // bookings until a TMO officer verifies them in the dashboard. (Riders that
  // registered before this change keep their existing 'verified' status.)
  const id = `drv_${randomUUID()}`;
  await run(
    `INSERT INTO drivers
      (id, name, vehicle_type, unit_number, plate_number, rating, trips_completed,
       phone, avatar, current_lat, current_lng, is_online, claimed_by, verification_status)
     VALUES (?,?,?,?,?,5.0,0,?,?,?,?,0,?,'pending')`,
    id,
    name.trim().slice(0, 100),
    vehicleType,
    unit.slice(0, 50),
    "TBD",
    phone,
    avatar,
    DEFAULT_LAT,
    DEFAULT_LNG,
    userId
  );

  const row = await selectOne<DriverRow>("SELECT * FROM drivers WHERE id = ?", id);
  if (!row) throw new Error("Failed to create rider profile");
  return row;
}
