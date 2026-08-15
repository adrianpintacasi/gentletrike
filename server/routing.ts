import { Router } from "express";
import { getStreetRoute, type LatLng, type RouteOptions } from "../shared/geo";

/**
 * Street routing for the browser.
 *
 * The Routes API key is a server secret, so the map and the booking panel cannot
 * call Google themselves. They post here instead and get back the same
 * RouteResult the server-side callers get.
 *
 * Routing through one place also means one cache: the thirteen saved pickup
 * points generate the same handful of routes all day, and the module-level cache
 * in shared/geo.ts is now shared by every passenger on the deployment rather
 * than living per browser tab.
 */
export const routingRoutes = Router();

/**
 * Enough for a pooled trip's pickups and drop-offs, low enough that a malformed
 * or hostile request cannot turn one call into an expensive many-stop route.
 */
const MAX_WAYPOINTS = 12;

function toWaypoint(value: unknown): LatLng | null {
  if (!value || typeof value !== "object") return null;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** POST /api/route  { waypoints: [{lat,lng}, ...], travelMode?, trafficAware? } */
routingRoutes.post("/", async (req, res) => {
  const raw = Array.isArray(req.body?.waypoints) ? req.body.waypoints : [];

  if (raw.length < 2) {
    return res.status(400).json({ error: "at least two waypoints are required" });
  }
  if (raw.length > MAX_WAYPOINTS) {
    return res.status(400).json({ error: `at most ${MAX_WAYPOINTS} waypoints` });
  }

  const waypoints = raw.map(toWaypoint);
  if (waypoints.some((w: LatLng | null) => w === null)) {
    return res.status(400).json({ error: "every waypoint needs a numeric lat and lng" });
  }

  const options: RouteOptions = {
    travelMode: req.body?.travelMode === "TWO_WHEELER" ? "TWO_WHEELER" : "DRIVE",
    trafficAware: req.body?.trafficAware === true,
  };

  try {
    // Falls back to a scaled straight line on its own, so this always answers
    // with a drawable route rather than an error the map would have to handle.
    const route = await getStreetRoute(waypoints as LatLng[], options);
    res.json(route);
  } catch (err) {
    console.error("route lookup failed:", (err as Error).message);
    res.status(502).json({ error: "routing-unavailable" });
  }
});
