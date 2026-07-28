import { run, selectOne } from "./db";
import { logAudit } from "./auditLog";

// Auto-suspend policy (agreed with the user). A rolling window keeps this fair:
// only recent activity counts, so long-time users aren't punished for lifetime
// totals. Suspension is temporary and reversible — a TMO officer reviews and
// reactivates (or escalates to a ban). Bans are never automatic.
export const AUTO_SUSPEND = {
  passengerCancellations: 5, // in the rolling window → suspend the passenger account
  riderDeclines: 10, // in the rolling window → suspend the rider's operating status
  windowDays: 7,
  suspensionsBeforeBan: 3, // the Nth auto-suspension escalates to a permanent ban
};

// created_at/updated_at are stored as UTC text (SQLite's old format). Compare
// them as naive UTC timestamps against a UTC "now minus N days".
const WINDOW_START = `((now() AT TIME ZONE 'UTC') - interval '${AUTO_SUSPEND.windowDays} days')`;

/**
 * If a passenger has cancelled too many rides recently, suspend their account
 * (blocked from booking + signed out) and flag it in the audit log for review.
 * Only acts on an already-active account, so it won't fight a manual decision.
 */
export async function maybeAutoSuspendPassenger(passengerId: string): Promise<void> {
  if (!passengerId) return;
  const user = await selectOne<{
    account_status: string | null;
    reactivated_at: string | null;
    suspension_count: number | null;
  }>("SELECT account_status, reactivated_at, suspension_count FROM users WHERE id = ?", passengerId);
  if (!user || (user.account_status ?? "active") !== "active") return;

  // Grace: ignore cancellations from before the last manual reactivation.
  const row = await selectOne<{ count: number }>(
    `SELECT count(*)::int as count FROM rides
      WHERE passenger_id = ? AND cancelled_by = 'passenger'
        AND updated_at::timestamp >= ${WINDOW_START}
        AND (?::text IS NULL OR updated_at::timestamp > ?::timestamp)`,
    passengerId,
    user.reactivated_at,
    user.reactivated_at
  );
  const count = row?.count ?? 0;
  if (count < AUTO_SUSPEND.passengerCancellations) return;

  // Escalation: the Nth auto-suspension becomes a permanent ban.
  const suspensionNumber = (user.suspension_count ?? 0) + 1;
  const ban = suspensionNumber >= AUTO_SUSPEND.suspensionsBeforeBan;
  const status = ban ? "banned" : "suspended";

  await run(
    "UPDATE users SET account_status = ?, suspension_count = ? WHERE id = ?",
    status,
    suspensionNumber,
    passengerId
  );
  await run("DELETE FROM sessions WHERE user_id = ?", passengerId);

  await logAudit({
    actorId: "system",
    actorName: "System (auto-moderation)",
    action: ban ? "auto_ban_passenger" : "auto_suspend_passenger",
    targetType: "user",
    targetId: passengerId,
    details: { reason: "excessive_cancellations", count, windowDays: AUTO_SUSPEND.windowDays, suspensionNumber },
    ipAddress: null,
  });
}

/**
 * If a rider has declined too many bookings recently, suspend their operating
 * status (knocked offline, can't go online) and flag it for review. Only acts on
 * a currently-verified rider.
 */
export async function maybeAutoSuspendRider(driverId: string): Promise<void> {
  if (!driverId) return;
  const driver = await selectOne<{
    verification_status: string | null;
    reactivated_at: string | null;
    claimed_by: string | null;
  }>("SELECT verification_status, reactivated_at, claimed_by FROM drivers WHERE id = ?", driverId);
  if (!driver || (driver.verification_status ?? "verified") !== "verified") return;

  // Grace: ignore declines from before the last manual re-verification.
  const row = await selectOne<{ count: number }>(
    `SELECT count(*)::int as count FROM ride_declines
      WHERE driver_id = ? AND created_at::timestamp >= ${WINDOW_START}
        AND (?::text IS NULL OR created_at::timestamp > ?::timestamp)`,
    driverId,
    driver.reactivated_at,
    driver.reactivated_at
  );
  const count = row?.count ?? 0;
  if (count < AUTO_SUSPEND.riderDeclines) return;

  // Always suspend the rider's operating status.
  await run("UPDATE drivers SET verification_status = 'suspended', is_online = 0 WHERE id = ?", driverId);

  // Escalation is tracked on the linked user account: the Nth suspension bans it.
  let ban = false;
  let suspensionNumber = 0;
  if (driver.claimed_by) {
    const u = await selectOne<{ suspension_count: number | null }>(
      "SELECT suspension_count FROM users WHERE id = ?",
      driver.claimed_by
    );
    suspensionNumber = (u?.suspension_count ?? 0) + 1;
    ban = suspensionNumber >= AUTO_SUSPEND.suspensionsBeforeBan;
    // Suspension blocks the rider's login (like a passenger); the Nth escalates
    // to a permanent ban.
    await run(
      "UPDATE users SET account_status = ?, suspension_count = ? WHERE id = ? AND coalesce(account_status,'active') <> 'banned'",
      ban ? "banned" : "suspended",
      suspensionNumber,
      driver.claimed_by
    );
    await run("DELETE FROM sessions WHERE user_id = ?", driver.claimed_by);
  }

  await logAudit({
    actorId: "system",
    actorName: "System (auto-moderation)",
    action: ban ? "auto_ban_rider" : "auto_suspend_rider",
    targetType: "driver",
    targetId: driverId,
    details: { reason: "excessive_declines", count, windowDays: AUTO_SUSPEND.windowDays, suspensionNumber },
    ipAddress: null,
  });
}
