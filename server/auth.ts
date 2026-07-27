import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import type { Request, Response, NextFunction } from "express";
import { run, selectOne } from "./db";

const scryptAsync = promisify(scrypt);

export type UserRole = "passenger" | "rider" | "admin";
export type AdminSubRole = "super_admin" | "staff";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  employee_id?: string | null;
  department?: string | null;
  sub_role?: AdminSubRole | null;
  created_at: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  employee_id?: string;
  department?: string;
  sub_role?: AdminSubRole;
}

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: string;
}

const SESSION_DAYS = 30;

export function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    employee_id: row.employee_id ?? undefined,
    department: row.department ?? undefined,
    sub_role: row.role === "admin" ? (row.sub_role ?? "super_admin") : undefined,
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const hashBuf = Buffer.from(hash, "hex");
  if (derived.length !== hashBuf.length) return false;
  return timingSafeEqual(derived, hashBuf);
}

export async function createSession(userId: string): Promise<string> {
  const id = randomUUID();
  const expires = new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  await run(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)",
    id,
    userId,
    expires
  );
  return id;
}

export async function deleteSession(token: string): Promise<void> {
  await run("DELETE FROM sessions WHERE id = ?", token);
}

export async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  return selectOne<UserRow>(
    "SELECT * FROM users WHERE lower(email) = lower(?)",
    email.trim()
  );
}

export async function findUserByEmployeeId(employeeId: string): Promise<UserRow | undefined> {
  return selectOne<UserRow>(
    "SELECT * FROM users WHERE lower(employee_id) = lower(?)",
    employeeId.trim()
  );
}

export async function findUserById(id: string): Promise<UserRow | undefined> {
  return selectOne<UserRow>("SELECT * FROM users WHERE id = ?", id);
}

async function resolveSession(token: string): Promise<AuthUser | null> {
  const session = await selectOne<SessionRow>(
    "SELECT * FROM sessions WHERE id = ?",
    token
  );
  if (!session) return null;

  const expiresAt = new Date(session.expires_at).getTime();
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    await deleteSession(token);
    return null;
  }

  const user = await findUserById(session.user_id);
  return user ? toAuthUser(user) : null;
}

function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Attach req.user when a valid session token is present. */
export async function attachUser(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const token = readBearerToken(req);
  if (token) {
    req.user = (await resolveSession(token)) ?? undefined;
  }
  next();
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to continue" });
    return;
  }
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Sign in to continue" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "You do not have access to this feature" });
      return;
    }
    next();
  };
}

export function requireSubRole(...subRoles: AdminSubRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Sign in to continue" });
      return;
    }
    if (req.user.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const userSubRole = req.user.sub_role ?? "super_admin";
    if (!subRoles.includes(userSubRole)) {
      res.status(403).json({ error: "Insufficient admin permissions for this action" });
      return;
    }
    next();
  };
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function isValidPassword(password: string): boolean {
  return password.length >= 8;
}

/** Trim, collapse runs of whitespace, and cap length — tidy display names. */
export function normalizeName(raw: string): string {
  return String(raw).trim().replace(/\s+/g, " ").slice(0, 100);
}

// In-memory Rate Limiting for Login Attempts
const loginAttempts = new Map<string, { count: number; resetTime: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export function checkRateLimit(key: string): { allowed: boolean; remainingMs: number } {
  const now = Date.now();
  const entry = loginAttempts.get(key);

  if (!entry || now > entry.resetTime) {
    loginAttempts.set(key, { count: 1, resetTime: now + WINDOW_MS });
    return { allowed: true, remainingMs: 0 };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    return { allowed: false, remainingMs: entry.resetTime - now };
  }

  entry.count += 1;
  return { allowed: true, remainingMs: 0 };
}

