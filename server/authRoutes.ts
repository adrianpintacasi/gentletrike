import { randomUUID } from "crypto";
import { Router } from "express";
import {
  createSession,
  deleteSession,
  findUserByEmail,
  findUserById,
  hashPassword,
  isValidEmail,
  isValidPassword,
  requireAuth,
  requireRole,
  toAuthUser,
  verifyPassword,
} from "./auth";
import type { UserRole } from "./auth";
import { run, selectAll, tx } from "./db";
import {
  createRiderDriver,
  RiderProfileError,
} from "./riderProfile";

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
    const { email, password, name, role, unitNumber } = req.body ?? {};

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
    const displayName = String(name).trim().slice(0, 100);

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
          await createRiderDriver(id, displayName, String(unitNumber));
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
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await findUserByEmail(String(email));
    if (!user || !(await verifyPassword(String(password), user.password_hash))) {
      return res.status(401).json({ error: "Invalid email or password" });
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
      "SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC"
    );
    res.json({ users: rows });
  })
);

authRoutes.post(
  "/users",
  requireAuth,
  requireRole("admin"),
  wrap(async (req, res) => {
    const { email, password, name, role, unitNumber } = req.body ?? {};

    if (!email || !isValidEmail(String(email))) {
      return res.status(400).json({ error: "A valid email address is required" });
    }
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

    if (await findUserByEmail(String(email))) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const id = `user_${randomUUID()}`;
    const passwordHash = await hashPassword(String(password));
    const displayName = String(name).trim().slice(0, 100);

    if (chosenRole === "rider") {
      const unitRaw = unitNumber !== undefined ? String(unitNumber).trim() : "";
      if (!unitRaw) {
        return res.status(400).json({ error: "Pedicab number is required for rider accounts" });
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
          await createRiderDriver(id, displayName, String(unitNumber));
        }
      });
    } catch (err) {
      if (err instanceof RiderProfileError) {
        return res.status(409).json({ error: err.message });
      }
      throw err;
    }

    // Notice we do NOT create a session or return a token here
    // because this is an admin creating another user.
    const user = await selectAll(
      "SELECT id, email, name, role, created_at FROM users WHERE id = ?",
      id
    );
    res.status(201).json({ user: user[0] });
  })
);

authRoutes.delete(
  "/users/:id",
  requireAuth,
  requireRole("admin"),
  wrap(async (req, res) => {
    const { id } = req.params;
    if (id === req.user?.id) {
      return res.status(400).json({ error: "You cannot delete your own account" });
    }

    await tx(async () => {
      // First delete from drivers if it's a rider
      await run("DELETE FROM drivers WHERE id = ?", id);
      // Then delete from users (which cascades to sessions, etc.)
      await run("DELETE FROM users WHERE id = ?", id);
    });

    res.json({ ok: true });
  })
);
