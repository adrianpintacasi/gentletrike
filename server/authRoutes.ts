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

authRoutes.post(
  "/register",
  wrap(async (req, res) => {
    const { email, password, name, role, unitNumber, vehicleType, photo } = req.body ?? {};

    if (!email || !isValidEmail(String(email))) {
      return res.status(400).json({ error: "A valid email address is required" });
    }
    if (!password || !isValidPassword(String(password))) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Your name is required" });
    }
    const chosenRole = String(role ?? "passenger") as UserRole;
    if (!ALLOWED_REGISTER_ROLES.includes(chosenRole)) {
      return res
        .status(400)
        .json({ error: "Role must be passenger or rider" });
    }

    if (await findUserByEmail(String(email))) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const id = `user_${randomUUID()}`;
    const passwordHash = await hashPassword(String(password));
    const displayName = normalizeName(name);

    if (chosenRole === "rider") {
      const unitRaw = unitNumber !== undefined ? String(unitNumber).trim() : "";
      if (!unitRaw) {
        return res
          .status(400)
          .json({ error: "Pedicab number is required for rider accounts" });
      }
    }

    try {
      await tx(async () => {
        await run(
          "INSERT INTO users (id, email, password_hash, name, role) VALUES (?,?,?,?,?)",
          id,
          String(email).trim().toLowerCase(),
          passwordHash,
          displayName,
          chosenRole
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

    const token = await createSession(user.id);
    res.json({ user: toAuthUser(user), token });
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

authRoutes.get(
  "/users",
  requireAuth,
  requireRole("admin"),
  wrap(async (req, res) => {
    // Only return safe fields (exclude password_hash)
    const rows = await selectAll(
      "SELECT id, email, name, role, employee_id, department, sub_role, created_at FROM users ORDER BY created_at DESC"
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
    const { email, password, name, role, unitNumber, employeeId, department, subRole, vehicleType, photo } = req.body ?? {};

    if (!password || !isValidPassword(String(password))) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    if (!name || !String(name).trim()) {
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
    const displayName = normalizeName(name);
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
          "INSERT INTO users (id, email, password_hash, name, role, employee_id, department, sub_role) VALUES (?,?,?,?,?,?,?,?)",
          id,
          emailValue,
          passwordHash,
          displayName,
          chosenRole,
          empId,
          dept,
          sub
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
      "SELECT id, email, name, role, employee_id, department, sub_role, created_at FROM users WHERE id = ?",
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

