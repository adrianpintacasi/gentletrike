import { randomUUID } from "crypto";
import { Router } from "express";
import {
  checkRateLimit,
  createSession,
  deleteSession,
  findUserByEmail,
  findUserByEmployeeId,
  findUserById,
  hashPassword,
  isValidEmail,
  isValidPassword,
  normalizeName,
  requireAuth,
  requireRole,
  requireSubRole,
  toAuthUser,
  verifyPassword,
} from "./auth";
import type { AdminSubRole, UserRole } from "./auth";
import { run, selectAll, selectOne, tx } from "./db";
import {
  createRiderDriver,
  RiderProfileError,
} from "./riderProfile";
import { logAudit } from "./auditLog";

export const authRoutes = Router();

const wrap =
  (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any) =>
    fn(req, res).catch((err: unknown) => {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: "Server error" });
    });

const ALLOWED_REGISTER_ROLES: UserRole[] = ["passenger", "rider"];
const VALID_SEX = new Set(["male", "female", "other"]);

/** A lenient PH contact-number check: at least 7 digits once symbols are stripped. */
function normalizeContact(raw: unknown): string | null {
  const t = String(raw ?? "").trim();
  const digits = t.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return t.slice(0, 20);
}

/** Accept a YYYY-MM-DD birthdate for someone at least 15 years old (and real). */
function validateBirthdate(raw: unknown): string | null {
  const t = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(t + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  if (d.getTime() > now.getTime()) return null;
  const age = (now.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (age < 15 || age > 100) return null;
  return t;
}

authRoutes.post(
  "/register",
  wrap(async (req, res) => {
    const {
      email,
      password,
      name,
      firstName,
      lastName,
      role,
      contactNumber,
      sex,
      birthdate,
      address,
      unitNumber,
      vehicleType,
      photo,
    } = req.body ?? {};

    if (!email || !isValidEmail(String(email))) {
      return res.status(400).json({ error: "A valid email address is required" });
    }
    if (!password || !isValidPassword(String(password))) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });
    }

    // First and last name are required for everyone. Fall back to splitting a
    // combined `name` so older clients still work.
    let first = String(firstName ?? "").trim();
    let last = String(lastName ?? "").trim();
    if ((!first || !last) && name && String(name).trim()) {
      const parts = String(name).trim().split(/\s+/);
      first = first || parts[0] || "";
      last = last || parts.slice(1).join(" ") || "";
    }
    if (!first || !last) {
      return res.status(400).json({ error: "First name and last name are required" });
    }

    const chosenRole = String(role ?? "passenger") as UserRole;
    if (!ALLOWED_REGISTER_ROLES.includes(chosenRole)) {
      return res
        .status(400)
        .json({ error: "Role must be passenger or rider" });
    }

    // Everyone provides a contact number (passengers give this and nothing more).
    const contact = normalizeContact(contactNumber);
    if (!contact) {
      return res.status(400).json({ error: "A valid contact number is required" });
    }

    // Riders provide the full set needed for TMO verification.
    let riderSex: string | null = null;
    let riderBirthdate: string | null = null;
    let riderAddress: string | null = null;
    if (chosenRole === "rider") {
      const unitRaw = unitNumber !== undefined ? String(unitNumber).trim() : "";
      if (!unitRaw) {
        return res
          .status(400)
          .json({ error: "Pedicab number is required for rider accounts" });
      }
      riderSex = String(sex ?? "").trim().toLowerCase();
      if (!VALID_SEX.has(riderSex)) {
        return res.status(400).json({ error: "Please select a valid sex" });
      }
      riderBirthdate = validateBirthdate(birthdate);
      if (!riderBirthdate) {
        return res
          .status(400)
          .json({ error: "Please enter a valid birthdate (you must be at least 15)" });
      }
      riderAddress = String(address ?? "").trim();
      if (!riderAddress) {
        return res.status(400).json({ error: "Address is required for rider accounts" });
      }
      riderAddress = riderAddress.slice(0, 200);
    }

    if (await findUserByEmail(String(email))) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    // A banned person can't just sign up again with the same email or contact.
    const banned = await selectOne<{ id: string }>(
      `SELECT id FROM users
        WHERE coalesce(account_status, 'active') = 'banned'
          AND (lower(email) = lower(?) OR contact_number = ?)`,
      String(email).trim(),
      contact
    );
    if (banned) {
      return res.status(403).json({
        error:
          "This email or contact number is linked to a banned account and cannot be used to register.",
      });
    }

    const id = `user_${randomUUID()}`;
    const passwordHash = await hashPassword(String(password));
    const displayName = normalizeName(`${first} ${last}`);
    const firstClean = normalizeName(first);
    const lastClean = normalizeName(last);

    try {
      await tx(async () => {
        await run(
          `INSERT INTO users
            (id, email, password_hash, name, role, first_name, last_name,
             contact_number, sex, birthdate, address)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          id,
          String(email).trim().toLowerCase(),
          passwordHash,
          displayName,
          chosenRole,
          firstClean,
          lastClean,
          contact,
          riderSex,
          riderBirthdate,
          riderAddress
        );
        if (chosenRole === "rider") {
          await createRiderDriver(id, displayName, String(unitNumber), { vehicleType, photo });
        }
      });
    } catch (err) {
      if (err instanceof RiderProfileError) {
        return res.status(409).json({ error: err.message });
      }
      throw err;
    }

    const token = await createSession(id);
    const user = await findUserById(id);
    res.status(201).json({ user: toAuthUser(user!), token });
  })
);

authRoutes.post(
  "/login",
  wrap(async (req, res) => {
    const { email, login: loginInput, password } = req.body ?? {};
    const identifier = String(email || loginInput || "").trim();

    if (!identifier || !password) {
      return res.status(400).json({ error: "Email/Employee ID and password are required" });
    }

    const clientIp = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1") as string;
    const rateKey = `${clientIp}:${identifier.toLowerCase()}`;
    const rateCheck = checkRateLimit(rateKey);

    if (!rateCheck.allowed) {
      const waitMins = Math.ceil(rateCheck.remainingMs / 60000);
      return res.status(429).json({
        error: `Too many failed login attempts. Please wait ${waitMins} minute(s) before trying again.`,
      });
    }

    let user = await findUserByEmail(identifier);
    if (!user) {
      user = await findUserByEmployeeId(identifier);
    }

    if (!user || !(await verifyPassword(String(password), user.password_hash))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const accountStatus = user.account_status ?? "active";
    if (accountStatus !== "active") {
      const msg =
        accountStatus === "banned"
          ? "This account has been banned by the TMO. Please contact the TMO office."
          : "This account is currently suspended. Please contact the TMO office.";
      // Tell the client whether an appeal is already pending, so it shows
      // "waiting for approval" instead of the appeal form again.
      return res.status(403).json({ error: msg, hasPendingRequest: !!user.activation_request });
    }

    const token = await createSession(user.id);
    res.json({ user: toAuthUser(user), token });
  })
);

/**
 * A suspended/banned user files a reactivation appeal. Public (they can't sign
 * in), but identity is proven by their real credentials, so no one can appeal on
 * someone else's behalf. Stores a reason for the TMO to review.
 */
authRoutes.post(
  "/activation-request",
  wrap(async (req, res) => {
    const { email, login: loginInput, password, reason } = req.body ?? {};
    const identifier = String(email || loginInput || "").trim();

    if (!identifier || !password) {
      return res.status(400).json({ error: "Email/Employee ID and password are required" });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: "Please include a reason for your appeal" });
    }

    let user = await findUserByEmail(identifier);
    if (!user) user = await findUserByEmployeeId(identifier);
    if (!user || !(await verifyPassword(String(password), user.password_hash))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const status = user.account_status ?? "active";

    if (status === "active") {
      return res.status(400).json({ error: "This account is active — no reactivation is needed." });
    }

    // A ban is the end of the road, not a step in a process. Suspension is the
    // reversible sanction and is what an appeal is for; letting a banned user
    // keep filing appeals only builds a queue the TMO has already answered.
    if (status === "banned") {
      return res.status(403).json({
        error:
          "This account has been permanently banned and cannot be reactivated through the app. " +
          "Please visit the TMO office in person if you wish to contest it.",
      });
    }

    // One pending request at a time — until the TMO approves or dismisses it.
    if (user.activation_request) {
      return res
        .status(409)
        .json({ error: "You already have a pending reactivation request awaiting review." });
    }

    await run(
      "UPDATE users SET activation_request = ?, activation_requested_at = datetime('now') WHERE id = ?",
      String(reason).trim().slice(0, 1000),
      user.id
    );
    res.json({ ok: true });
  })
);

authRoutes.post(
  "/logout",
  requireAuth,
  wrap(async (req, res) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
    if (token) await deleteSession(token);
    res.json({ ok: true });
  })
);

authRoutes.get(
  "/me",
  requireAuth,
  wrap(async (req, res) => {
    res.json({ user: req.user });
  })
);

/**
 * PATCH /auth/me — change the contact number.
 *
 * The number is how a rider reaches a passenger who is not where they said they
 * would be, so it has to be changeable without an admin. Digits only, and it
 * must stay unique: sign-in accepts either the email or the number.
 */
authRoutes.patch(
  "/me",
  requireAuth,
  wrap(async (req, res) => {
    const raw = String(req.body?.contactNumber ?? "").trim();
    const digits = raw.replace(/[^\d+]/g, "");

    if (digits.length < 7 || digits.length > 15) {
      return res.status(400).json({ error: "Enter a valid contact number." });
    }

    const taken = await selectOne<{ id: string }>(
      "SELECT id FROM users WHERE contact_number = ? AND id <> ?",
      digits,
      req.user!.id
    );
    if (taken) {
      return res.status(409).json({ error: "That number is already used by another account." });
    }

    await run("UPDATE users SET contact_number = ? WHERE id = ?", digits, req.user!.id);
    res.json({ user: { ...req.user!, contact_number: digits } });
  })
);

/**
 * POST /auth/change-password
 *
 * The current password is required even though the session already proves who
 * they are: a borrowed unlocked phone should not be able to lock the owner out
 * of their own account.
 */
authRoutes.post(
  "/change-password",
  requireAuth,
  wrap(async (req, res) => {
    const current = String(req.body?.currentPassword ?? "");
    const next = String(req.body?.newPassword ?? "");

    if (next.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters." });
    }

    const row = await findUserById(req.user!.id);
    if (!row) return res.status(404).json({ error: "Account not found." });

    if (!(await verifyPassword(current, row.password_hash))) {
      return res.status(403).json({ error: "Your current password is incorrect." });
    }

    await run(
      "UPDATE users SET password_hash = ? WHERE id = ?",
      await hashPassword(next),
      req.user!.id
    );
    res.json({ ok: true });
  })
);

authRoutes.get(
  "/users",
  requireAuth,
  requireRole("admin"),
  wrap(async (req, res) => {
    // Only return safe fields (exclude password_hash). Include the moderation
    // status and, for passengers, how many rides they cancelled (a fairness
    // signal for the TMO).
    const rows = await selectAll(
      `SELECT u.id, u.email, u.name, u.first_name, u.last_name, u.role,
              u.employee_id, u.department, u.sub_role,
              coalesce(u.account_status, 'active') as account_status, u.created_at,
              (SELECT count(*) FROM rides
                 WHERE passenger_id = u.id AND cancelled_by = 'passenger')::int
                AS passenger_cancellations
         FROM users u
        ORDER BY u.created_at DESC`
    );
    res.json({ users: rows });
  })
);

authRoutes.post(
  "/users",
  requireAuth,
  requireRole("admin"),
  requireSubRole("super_admin"),
  wrap(async (req, res) => {
    const { email, password, name, firstName, lastName, role, unitNumber, employeeId, department, subRole, vehicleType, photo } = req.body ?? {};

    if (!password || !isValidPassword(String(password))) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    // Prefer explicit first/last name; fall back to splitting a combined `name`.
    let first = String(firstName ?? "").trim();
    let last = String(lastName ?? "").trim();
    if ((!first || !last) && name && String(name).trim()) {
      const parts = String(name).trim().split(/\s+/);
      first = first || parts[0] || "";
      last = last || parts.slice(1).join(" ") || "";
    }
    if (!first) {
      return res.status(400).json({ error: "Name is required" });
    }

    const chosenRole = String(role ?? "passenger") as UserRole;
    if (!["passenger", "rider", "admin"].includes(chosenRole)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const isAdmin = chosenRole === "admin";
    const empId = employeeId ? String(employeeId).trim() : null;
    const emailValue = email ? String(email).trim().toLowerCase() : null;

    // Admins sign in with their Employee ID, so an email is optional for them.
    // Passengers and riders still sign in by email, so it stays required.
    if (isAdmin) {
      if (!empId) {
        return res
          .status(400)
          .json({ error: "Employee ID is required for admin accounts" });
      }
    } else if (!emailValue || !isValidEmail(emailValue)) {
      return res.status(400).json({ error: "A valid email address is required" });
    }
    // If an email is supplied at all, it must be well-formed.
    if (emailValue && !isValidEmail(emailValue)) {
      return res.status(400).json({ error: "A valid email address is required" });
    }

    if (emailValue && (await findUserByEmail(emailValue))) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    if (empId && (await findUserByEmployeeId(empId))) {
      return res.status(409).json({ error: "An account with this Employee ID already exists" });
    }

    const id = `user_${randomUUID()}`;
    const passwordHash = await hashPassword(String(password));
    const firstClean = normalizeName(first);
    const lastClean = last ? normalizeName(last) : null;
    const displayName = normalizeName(`${first} ${last}`.trim());
    const dept = department ? String(department).trim() : null;
    const sub = isAdmin ? (subRole === "staff" ? "staff" : "super_admin") : null;

    if (chosenRole === "rider") {
      const unitRaw = unitNumber !== undefined ? String(unitNumber).trim() : "";
      if (!unitRaw) {
        return res.status(400).json({ error: "Pedicab number is required for rider accounts" });
      }
    }

    try {
      await tx(async () => {
        await run(
          `INSERT INTO users
             (id, email, password_hash, name, role, employee_id, department, sub_role, first_name, last_name)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          id,
          emailValue,
          passwordHash,
          displayName,
          chosenRole,
          empId,
          dept,
          sub,
          firstClean,
          lastClean
        );
        if (chosenRole === "rider") {
          await createRiderDriver(id, displayName, String(unitNumber), { vehicleType, photo });
        }
      });
    } catch (err) {
      if (err instanceof RiderProfileError) {
        return res.status(409).json({ error: err.message });
      }
      throw err;
    }

    const created = await selectOne(
      "SELECT id, email, name, first_name, last_name, role, employee_id, department, sub_role, created_at FROM users WHERE id = ?",
      id
    );

    await logAudit({
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: "create_user",
      targetType: "user",
      targetId: id,
      details: { name: displayName, email, role: chosenRole, subRole: sub, employeeId: empId },
      ipAddress: (req.headers["x-forwarded-for"] || req.socket.remoteAddress || null) as string | null,
    });

    res.status(201).json({ user: created });
  })
);

authRoutes.delete(
  "/users/:id",
  requireAuth,
  requireRole("admin"),
  requireSubRole("super_admin"),
  wrap(async (req, res) => {
    const { id } = req.params;
    if (id === req.user?.id) {
      return res.status(400).json({ error: "You cannot delete your own account" });
    }

    const targetUser = await selectOne<{ id: string; name: string; email: string; role: string }>(
      "SELECT id, name, email, role FROM users WHERE id = ?",
      id
    );

    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    await tx(async () => {
      // First delete from drivers if it's a rider
      await run("DELETE FROM drivers WHERE id = ?", id);
      // Then delete from users (which cascades to sessions, etc.)
      await run("DELETE FROM users WHERE id = ?", id);
    });

    await logAudit({
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: "delete_user",
      targetType: "user",
      targetId: id,
      details: { deletedUser: targetUser },
      ipAddress: (req.headers["x-forwarded-for"] || req.socket.remoteAddress || null) as string | null,
    });

    res.json({ ok: true });
  })
);

/**
 * Moderation: set an account's status to active, suspended, or banned.
 * Suspended/banned users are signed out immediately and cannot sign back in.
 * Super-admin only.
 */
authRoutes.patch(
  "/users/:id/status",
  requireAuth,
  requireRole("admin"),
  requireSubRole("super_admin"),
  wrap(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body ?? {};

    if (!["active", "suspended", "banned"].includes(status)) {
      return res.status(400).json({ error: "Status must be active, suspended, or banned" });
    }
    if (id === req.user?.id) {
      return res.status(400).json({ error: "You cannot change your own account status" });
    }

    const target = await selectOne<{ id: string; name: string; role: string }>(
      "SELECT id, name, role FROM users WHERE id = ?",
      id
    );
    if (!target) return res.status(404).json({ error: "User not found" });

    await tx(async () => {
      if (status === "active") {
        // Reactivating: stamp reactivated_at so auto-moderation starts fresh.
        await run(
          "UPDATE users SET account_status = 'active', reactivated_at = datetime('now') WHERE id = ?",
          id
        );
      } else {
        await run("UPDATE users SET account_status = ? WHERE id = ?", status, id);
        // Force sign-out and pull any rider off the live map right away.
        await run("DELETE FROM sessions WHERE user_id = ?", id);
        await run("UPDATE drivers SET is_online = 0 WHERE claimed_by = ?", id);
      }
    });

    await logAudit({
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: "update_user_status",
      targetType: "user",
      targetId: id,
      details: { name: target.name, role: target.role, status },
      ipAddress: (req.headers["x-forwarded-for"] || req.socket.remoteAddress || null) as string | null,
    });

    res.json({ ok: true, status });
  })
);

