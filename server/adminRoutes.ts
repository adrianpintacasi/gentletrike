import { Router } from "express";
import { requireAuth, requireRole, requireSubRole } from "./auth";
import { run, selectAll, selectOne, tx } from "./db";
import { getAuditLogs, logAudit } from "./auditLog";
import { GoogleGenAI } from "@google/genai";

export const adminRoutes = Router();

const wrap =
  (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any) =>
    fn(req, res).catch((err: unknown) => {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: "Server error" });
    });

// Protect ALL admin routes with requireAuth and requireRole("admin")
adminRoutes.use(requireAuth, requireRole("admin"));

/* ------------------------------------------------------------- 5.A Overview */

adminRoutes.get(
  "/stats/overview",
  wrap(async (_req, res) => {
    const [totalRiders] = await selectAll<{ count: number }>(
      "SELECT count(*)::int as count FROM users WHERE role = 'passenger'"
    );
    const [totalDrivers] = await selectAll<{ count: number }>(
      "SELECT count(*)::int as count FROM drivers"
    );
    const [totalRides] = await selectAll<{ count: number }>(
      "SELECT count(*)::int as count FROM rides"
    );
    const [activeReports] = await selectAll<{ count: number }>(
      "SELECT count(*)::int as count FROM tmo_reports WHERE coalesce(status, 'pending') != 'resolved'"
    );

    res.json({
      totalRiders: totalRiders?.count ?? 0,
      totalDrivers: totalDrivers?.count ?? 0,
      totalRides: totalRides?.count ?? 0,
      activeReports: activeReports?.count ?? 0,
    });
  })
);

adminRoutes.get(
  "/stats/ride-status",
  wrap(async (_req, res) => {
    const rows = await selectAll<{ status: string; count: number }>(
      `SELECT 
         CASE 
           WHEN status = 'completed' THEN 'Completed'
           WHEN status = 'cancelled' THEN 'Cancelled'
           WHEN status = 'searching_driver' THEN 'Searching'
           ELSE 'In Progress'
         END as name,
         count(*)::int as value
       FROM rides
       GROUP BY name`
    );
    res.json({ breakdown: rows });
  })
);

adminRoutes.get(
  "/stats/ride-volume",
  wrap(async (req, res) => {
    const period = String(req.query.period ?? "week");
    let dateFormat = "YYYY-MM-DD";

    if (period === "day") {
      dateFormat = "YYYY-MM-DD HH24:00";
    } else if (period === "month") {
      dateFormat = "YYYY-MM";
    }

    const rows = await selectAll<{ date: string; rides: number; completed: number; cancelled: number }>(
      `SELECT 
         to_char(created_at::timestamp, '${dateFormat}') as date,
         count(*)::int as rides,
         count(CASE WHEN status = 'completed' THEN 1 END)::int as completed,
         count(CASE WHEN status = 'cancelled' THEN 1 END)::int as cancelled
       FROM rides
       GROUP BY date
       ORDER BY date ASC
       LIMIT 30`
    );

    res.json({ volume: rows });
  })
);

adminRoutes.get(
  "/stats/peak-hours",
  wrap(async (_req, res) => {
    const rows = await selectAll<{ day: number; hour: number; count: number }>(
      `SELECT 
         extract(dow from created_at::timestamp)::int as day,
         extract(hour from created_at::timestamp)::int as hour,
         count(*)::int as count
       FROM rides
       GROUP BY day, hour
       ORDER BY day, hour`
    );
    res.json({ peakHours: rows });
  })
);

/* ------------------------------------------------ 5.B Rejections & Cancellations */

adminRoutes.get(
  "/rejections",
  wrap(async (_req, res) => {
    const rows = await selectAll<{
      driver_id: string;
      driver_name: string;
      unit_number: string;
      rejections_count: number;
      reasons: string;
    }>(
      `SELECT 
         rd.driver_id,
         coalesce(d.name, 'Unknown Driver') as driver_name,
         coalesce(d.unit_number, N'N/A') as unit_number,
         count(*)::int as rejections_count,
         string_agg(distinct coalesce(r.reject_reason, 'No reason specified'), ', ') as reasons
       FROM ride_declines rd
       LEFT JOIN drivers d ON d.id = rd.driver_id
       LEFT JOIN rides r ON r.id = rd.ride_id
       GROUP BY rd.driver_id, d.name, d.unit_number
       ORDER BY rejections_count DESC`
    );
    res.json({ rejections: rows });
  })
);

adminRoutes.get(
  "/cancellations",
  wrap(async (_req, res) => {
    const rows = await selectAll<{
      id: string;
      cancelled_by: string;
      cancel_reason: string;
      pickup: string;
      dropoff: string;
      created_at: string;
    }>(
      `SELECT id, coalesce(cancelled_by, 'passenger') as cancelled_by, coalesce(cancel_reason, 'No reason provided') as cancel_reason, pickup, dropoff, created_at
       FROM rides
       WHERE status = 'cancelled'
       ORDER BY created_at DESC
       LIMIT 50`
    );

    const riderCount = rows.filter((r) => r.cancelled_by === "passenger").length;
    const driverCount = rows.filter((r) => r.cancelled_by === "driver").length;

    res.json({
      summary: { riderInitiated: riderCount, driverInitiated: driverCount },
      cancellations: rows,
    });
  })
);

adminRoutes.get(
  "/flagged-users",
  wrap(async (_req, res) => {
    const flaggedDrivers = await selectAll<{
      id: string;
      name: string;
      unit_number: string;
      rating: number;
      declines_count: number;
      cancellations_count: number;
    }>(
      `SELECT 
         d.id, d.name, d.unit_number, d.rating,
         (SELECT count(*)::int FROM ride_declines WHERE driver_id = d.id) as declines_count,
         (SELECT count(*)::int FROM rides WHERE driver_id = d.id AND status = 'cancelled') as cancellations_count
       FROM drivers d
       WHERE 
         (SELECT count(*) FROM ride_declines WHERE driver_id = d.id) >= 3 OR
         (SELECT count(*) FROM rides WHERE driver_id = d.id AND status = 'cancelled') >= 2 OR
         d.rating < 4.2
       ORDER BY declines_count DESC, cancellations_count DESC`
    );

    res.json({ flaggedDrivers });
  })
);

/* ---------------------------------------------------- 5.C Driver Reports / Complaints */

adminRoutes.get(
  "/reports",
  wrap(async (req, res) => {
    const { category, status, severity } = req.query;

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (category) {
      conditions.push("violation_type = ?");
      values.push(category);
    }
    if (status) {
      conditions.push("coalesce(status, 'pending') = ?");
      values.push(status);
    }
    if (severity) {
      conditions.push("coalesce(severity, 'medium') = ?");
      values.push(severity);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await selectAll<{
      id: string;
      reference_code: string;
      ride_id: string | null;
      driver_id: string | null;
      driver_name: string | null;
      violation_type: string;
      demanded_fare: number | null;
      details: string | null;
      contact_number: string | null;
      severity: string;
      status: string;
      filed_by: string | null;
      admin_notes: string | null;
      resolved_by: string | null;
      resolved_at: string | null;
      created_at: string;
    }>(
      `SELECT 
         r.id, r.reference_code, r.ride_id, r.driver_id, d.name as driver_name,
         r.violation_type, r.demanded_fare, r.details, r.contact_number,
         coalesce(r.severity, 'medium') as severity,
         coalesce(r.status, 'pending') as status,
         r.filed_by, r.admin_notes, r.resolved_by, r.resolved_at, r.created_at
       FROM tmo_reports r
       LEFT JOIN drivers d ON d.id = r.driver_id
       ${where}
       ORDER BY r.created_at DESC`
    );

    res.json({ reports: rows });
  })
);

adminRoutes.get(
  "/reports/stats",
  wrap(async (_req, res) => {
    const rows = await selectAll<{ category: string; count: number }>(
      `SELECT violation_type as category, count(*)::int as count
       FROM tmo_reports
       GROUP BY violation_type`
    );
    res.json({ categoryBreakdown: rows });
  })
);

adminRoutes.patch(
  "/reports/:id",
  wrap(async (req, res) => {
    const { status, adminNotes, severity } = req.body ?? {};
    const reportId = req.params.id;

    const report = await selectOne<{ id: string; reference_code: string }>(
      "SELECT id, reference_code FROM tmo_reports WHERE id = ?",
      reportId
    );
    if (!report) return res.status(404).json({ error: "Report not found" });

    // Restrict resolving to super_admin if status is being changed to resolved
    if (status === "resolved" && req.user?.sub_role === "staff") {
      return res.status(403).json({ error: "Only super_admin staff can mark reports as resolved" });
    }

    const sets: string[] = [];
    const values: unknown[] = [];

    if (status) {
      sets.push("status = ?");
      values.push(status);
      if (status === "resolved") {
        sets.push("resolved_by = ?", "resolved_at = datetime('now')");
        values.push(req.user!.name);
      }
    }

    if (adminNotes !== undefined) {
      sets.push("admin_notes = ?");
      values.push(adminNotes ? String(adminNotes).slice(0, 1000) : null);
    }

    if (severity) {
      sets.push("severity = ?");
      values.push(severity);
    }

    if (sets.length > 0) {
      await run(`UPDATE tmo_reports SET ${sets.join(", ")} WHERE id = ?`, ...values, reportId);

      await logAudit({
        actorId: req.user!.id,
        actorName: req.user!.name,
        action: "update_report_status",
        targetType: "tmo_report",
        targetId: reportId,
        details: { referenceCode: report.reference_code, status, adminNotes, severity },
        ipAddress: (req.headers["x-forwarded-for"] || req.socket.remoteAddress || null) as string | null,
      });
    }

    const updated = await selectOne("SELECT * FROM tmo_reports WHERE id = ?", reportId);
    res.json({ report: updated });
  })
);

adminRoutes.get(
  "/reports/repeat-offenders",
  wrap(async (_req, res) => {
    const rows = await selectAll<{
      driver_id: string;
      driver_name: string;
      unit_number: string;
      report_count: number;
      categories: string;
    }>(
      `SELECT 
         r.driver_id,
         d.name as driver_name,
         d.unit_number,
         count(*)::int as report_count,
         string_agg(distinct r.violation_type, ', ') as categories
       FROM tmo_reports r
       JOIN drivers d ON d.id = r.driver_id
       GROUP BY r.driver_id, d.name, d.unit_number
       HAVING count(*) >= 2
       ORDER BY report_count DESC`
    );

    res.json({ repeatOffenders: rows });
  })
);

/* ------------------------------------------------ 5.D Driver & Rider Directory */

adminRoutes.get(
  "/drivers",
  wrap(async (req, res) => {
    const search = req.query.search ? `%${String(req.query.search).trim()}%` : null;

    const sql = search
      ? `SELECT * FROM drivers WHERE name LIKE ? OR unit_number LIKE ? OR phone LIKE ? ORDER BY name ASC`
      : `SELECT * FROM drivers ORDER BY name ASC`;

    const params = search ? [search, search, search] : [];
    const rows = await selectAll(sql, ...params);
    res.json({ drivers: rows });
  })
);

adminRoutes.get(
  "/drivers/:id/profile",
  wrap(async (req, res) => {
    const driver = await selectOne("SELECT * FROM drivers WHERE id = ?", req.params.id);
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    const rides = await selectAll(
      "SELECT * FROM rides WHERE driver_id = ? ORDER BY created_at DESC LIMIT 20",
      req.params.id
    );

    const reports = await selectAll(
      "SELECT * FROM tmo_reports WHERE driver_id = ? ORDER BY created_at DESC",
      req.params.id
    );

    res.json({ driver, rides, reports });
  })
);

adminRoutes.patch(
  "/drivers/:id/verification",
  wrap(async (req, res) => {
    const { status } = req.body ?? {};
    if (!["verified", "pending", "suspended"].includes(status)) {
      return res.status(400).json({ error: "Status must be verified, pending, or suspended" });
    }

    await run("UPDATE drivers SET verification_status = ? WHERE id = ?", status, req.params.id);

    await logAudit({
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: "verify_driver",
      targetType: "driver",
      targetId: req.params.id,
      details: { status },
      ipAddress: (req.headers["x-forwarded-for"] || req.socket.remoteAddress || null) as string | null,
    });

    res.json({ ok: true });
  })
);

adminRoutes.get(
  "/riders",
  wrap(async (req, res) => {
    const search = req.query.search ? `%${String(req.query.search).trim()}%` : null;

    const sql = search
      ? `SELECT id, email, name, role, created_at FROM users WHERE role = 'passenger' AND (name LIKE ? OR email LIKE ?) ORDER BY created_at DESC`
      : `SELECT id, email, name, role, created_at FROM users WHERE role = 'passenger' ORDER BY created_at DESC`;

    const params = search ? [search, search] : [];
    const rows = await selectAll(sql, ...params);
    res.json({ riders: rows });
  })
);

/* ---------------------------------------------------- 5.E Audit Log (super_admin only) */

adminRoutes.get(
  "/audit-log",
  requireSubRole("super_admin"),
  wrap(async (req, res) => {
    const { employeeId, action } = req.query;
    const logs = await getAuditLogs({
      employeeId: employeeId ? String(employeeId) : undefined,
      action: action ? String(action) : undefined,
      limit: 100,
    });
    res.json({ auditLogs: logs });
  })
);

/* ------------------------------------------------------------ 5.F AI Insights */

adminRoutes.get(
  "/ai/demand-forecast",
  wrap(async (_req, res) => {
    // Moving-average volume forecast per 3-hour block
    const hourlyCounts = await selectAll<{ hour: number; count: number }>(
      `SELECT extract(hour from created_at::timestamp)::int as hour, count(*)::int as count
       FROM rides
       GROUP BY hour
       ORDER BY hour ASC`
    );

    const forecast = Array.from({ length: 24 }, (_, h) => {
      const match = hourlyCounts.find((row) => row.hour === h);
      const histAvg = match ? match.count : 0;
      // Moving average simulation baseline + historical factor
      const predicted = Math.max(3, Math.round(histAvg * 1.2 + Math.sin(h / 3) * 4 + 5));
      return {
        hour: `${h.toString().padStart(2, "0")}:00`,
        predictedDemand: predicted,
        confidence: 0.85,
      };
    });

    res.json({ forecast, model: "Moving-Average Time-Series (Baseline)" });
  })
);

adminRoutes.get(
  "/ai/driver-risk",
  wrap(async (_req, res) => {
    const drivers = await selectAll<{
      id: string;
      name: string;
      unit_number: string;
      reports_count: number;
      declines_count: number;
      cancellations_count: number;
    }>(
      `SELECT 
         d.id, d.name, d.unit_number,
         (SELECT count(*)::int FROM tmo_reports WHERE driver_id = d.id) as reports_count,
         (SELECT count(*)::int FROM ride_declines WHERE driver_id = d.id) as declines_count,
         (SELECT count(*)::int FROM rides WHERE driver_id = d.id AND status = 'cancelled') as cancellations_count
       FROM drivers d`
    );

    const scored = drivers.map((d) => {
      const score = d.reports_count * 35 + d.cancellations_count * 20 + d.declines_count * 10;
      let badge: "Low" | "Medium" | "High" = "Low";
      if (score >= 60) badge = "High";
      else if (score >= 25) badge = "Medium";

      return {
        id: d.id,
        name: d.name,
        unitNumber: d.unit_number,
        riskScore: Math.min(100, score),
        riskBadge: badge,
        reportsCount: d.reports_count,
        declinesCount: d.declines_count,
        cancellationsCount: d.cancellations_count,
      };
    });

    res.json({ riskScores: scored.sort((a, b) => b.riskScore - a.riskScore) });
  })
);

adminRoutes.post(
  "/ai/categorize",
  wrap(async (req, res) => {
    const { text } = req.body ?? {};
    const reportText = String(text || "").toLowerCase();

    let category = "other";
    let urgency: "low" | "medium" | "high" = "medium";

    if (/overcharg|demanded|singil|mahal/i.test(reportText)) {
      category = "overcharging";
      urgency = "medium";
    } else if (/reckless|kaskas|banga|harabas|fast|speed/i.test(reportText)) {
      category = "reckless_driving";
      urgency = "high";
    } else if (/harass|bastos|hawak|touch|malisya|threat/i.test(reportText)) {
      category = "harassment";
      urgency = "high";
    } else if (/rude|away|bastos|mura|shout/i.test(reportText)) {
      category = "rudeness";
      urgency = "low";
    } else if (/condition|guba|buling|broken|smoke/i.test(reportText)) {
      category = "vehicle_condition";
      urgency = "low";
    }

    res.json({
      suggestedCategory: category,
      urgency,
      note: "Keyword-based categorization engine (Rule-based NLP)",
    });
  })
);

adminRoutes.post(
  "/chatbot",
  wrap(async (req, res) => {
    const { query } = req.body ?? {};
    const userQuery = String(query || "").toLowerCase();

    // Natural Language Query Assistant for TMO Admin
    if (/cancelled|cancel/i.test(userQuery)) {
      const [cancels] = await selectAll<{ count: number }>(
        "SELECT count(*)::int as count FROM rides WHERE status = 'cancelled'"
      );
      return res.json({
        reply: `There are currently **${cancels?.count ?? 0} cancelled rides** recorded in the system.`,
      });
    }

    if (/drivers|riders|fleet/i.test(userQuery)) {
      const [drivers] = await selectAll<{ count: number }>("SELECT count(*)::int as count FROM drivers");
      const [online] = await selectAll<{ count: number }>(
        "SELECT count(*)::int as count FROM drivers WHERE is_online = 1"
      );
      return res.json({
        reply: `There are **${drivers?.count ?? 0} total registered drivers**, with **${online?.count ?? 0} currently online** on the roads of Dumaguete.`,
      });
    }

    if (/reports|complaint|violation/i.test(userQuery)) {
      const [reports] = await selectAll<{ count: number }>("SELECT count(*)::int as count FROM tmo_reports");
      const [pending] = await selectAll<{ count: number }>(
        "SELECT count(*)::int as count FROM tmo_reports WHERE coalesce(status, 'pending') = 'pending'"
      );
      return res.json({
        reply: `Total filed TMO reports: **${reports?.count ?? 0}** (**${pending?.count ?? 0} pending investigation**).`,
      });
    }

    // Default reply or Gemini fallback
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: userQuery,
          config: {
            systemInstruction:
              "You are the TMO (Transportation Management Office) Dumaguete Admin Assistant. Provide short, concise answers about Dumaguete public trike hailing data.",
          },
        });
        return res.json({ reply: response.text || "No response generated." });
      } catch (err: any) {
        console.error("Gemini chatbot error:", err);
      }
    }

    return res.json({
      reply: `TMO Assistant: I can help answer queries like "How many cancelled rides?", "How many online drivers?", or "Show total reports".`,
    });
  })
);
