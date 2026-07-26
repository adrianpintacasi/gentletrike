import { randomUUID } from "crypto";
import { run, selectAll } from "./db";

export interface AuditLogEntry {
  id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  target_type: string;
  target_id: string | null;
  details: string | null;
  ip_address: string | null;
  created_at: string;
}

export async function logAudit(params: {
  actorId: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: Record<string, unknown> | string | null;
  ipAddress?: string | null;
}): Promise<void> {
  const id = `audit_${randomUUID()}`;
  const detailsStr =
    typeof params.details === "object" && params.details !== null
      ? JSON.stringify(params.details)
      : params.details ?? null;

  try {
    await run(
      `INSERT INTO audit_logs
        (id, actor_id, actor_name, action, target_type, target_id, details, ip_address)
       VALUES (?,?,?,?,?,?,?,?)`,
      id,
      params.actorId,
      params.actorName,
      params.action,
      params.targetType,
      params.targetId ?? null,
      detailsStr,
      params.ipAddress ?? null
    );
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}

export async function getAuditLogs(options?: {
  employeeId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}): Promise<AuditLogEntry[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (options?.employeeId) {
    conditions.push("(actor_id = ? OR actor_name LIKE ?)");
    values.push(options.employeeId, `%${options.employeeId}%`);
  }
  if (options?.action) {
    conditions.push("action = ?");
    values.push(options.action);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  values.push(limit, offset);

  return selectAll<AuditLogEntry>(
    `SELECT * FROM audit_logs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ...values
  );
}
