import { Router } from "express";
import { checkServiceArea, DUMAGUETE_BBOX } from "../shared/serviceArea";

/**
 * Place search and address lookup for the booking panel.
 *
 * Proxied through our own server rather than called from the browser for three
 * reasons: the providers require an identifying User-Agent that browsers refuse
 * to set, their fair-use limits can only be honoured somewhere central, and a
 * shared cache means twenty passengers searching "robinsons" cost one request
 * instead of twenty.
 *
 * Two providers, both free and both OpenStreetMap-derived, matching the map
 * tiles and the OSRM routing already in use:
 *   Photon    — built for type-ahead, used for search
 *   Nominatim — used for reverse lookups, which are one-per-pin and rare
 */
export const geocodeRoutes = Router();

const USER_AGENT = "GentleTrike/0.1 (Dumaguete ride-hailing; contact via repo)";

/** Nominatim asks for at most one request a second. Photon is more relaxed. */
const MIN_GAP_MS = 1100;
let lastNominatimCall = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function throttledNominatim(url: string): Promise<any> {
  const wait = lastNominatimCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastNominatimCall = Date.now();

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Small in-memory cache. Passengers search the same handful of landmarks all
 * day, and a pin dropped twice in the same spot should not ask twice.
 */
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE = 500;
const cache = new Map<string, { at: number; value: unknown }>();

function cached<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value as T;
}

function remember(key: string, value: unknown): void {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

export interface GeocodeResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

/** Photon returns GeoJSON features; flatten the parts worth showing. */
function fromPhoton(feature: any): GeocodeResult | null {
  const [lng, lat] = feature?.geometry?.coordinates ?? [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const p = feature.properties ?? {};
  const name = p.name || p.street || p.district || p.city;
  if (!name) return null;

  const address = [p.street && p.street !== name ? p.street : null, p.district, p.city]
    .filter(Boolean)
    .join(", ");

  return { name, address: address || "Dumaguete City", lat, lng };
}

export interface SearchOutcome {
  results: GeocodeResult[];
  cached: boolean;
  /** Set when the provider could not be reached; results will be empty. */
  error?: string;
}

/**
 * Find places in Dumaguete matching free text.
 *
 * Exported as a plain function, not just a route, because Gently resolves
 * passenger phrasing through the same search the booking panel uses. Two
 * separate lookups would eventually disagree about where "Sans Rival" is, and
 * a fare quoted for one point while the ride goes to another is the worst kind
 * of bug — it looks correct.
 *
 * Results are biased to the city, then filtered to the service area, so a
 * caller can only ever be offered somewhere a pedicab will actually go.
 */
export async function searchPlaces(query: string): Promise<SearchOutcome> {
  const q = query.trim().slice(0, 120);
  if (q.length < 2) return { results: [], cached: false };

  const key = `s:${q.toLowerCase()}`;
  const hit = cached<GeocodeResult[]>(key);
  if (hit) return { results: hit, cached: true };

  // Centre the search on the city and clamp it to the boundary's bounding box.
  const url =
    `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}` +
    `&lat=9.3068&lon=123.3054&limit=12&lang=en` +
    `&bbox=${DUMAGUETE_BBOX.minLng},${DUMAGUETE_BBOX.minLat},` +
    `${DUMAGUETE_BBOX.maxLng},${DUMAGUETE_BBOX.maxLat}`;

  try {
    const data = await fetch(url, { headers: { "User-Agent": USER_AGENT } }).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json();
    });

    const seen = new Set<string>();
    const results = (data?.features ?? [])
      .map(fromPhoton)
      .filter((r: GeocodeResult | null): r is GeocodeResult => !!r)
      .filter((r: GeocodeResult) => checkServiceArea(r.lat, r.lng).inside)
      // Photon happily returns the same shop several times from different
      // OSM objects; one entry per name and rough position is enough.
      .filter((r: GeocodeResult) => {
        const id = `${r.name}|${r.lat.toFixed(4)},${r.lng.toFixed(4)}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .slice(0, 8);

    remember(key, results);
    return { results, cached: false };
  } catch (err) {
    console.error("geocode search failed:", (err as Error).message);
    // An empty list degrades to the curated pickup points, which still work.
    return { results: [], cached: false, error: "search-unavailable" };
  }
}

/** GET /api/geocode/search?q=silliman */
geocodeRoutes.get("/search", async (req, res) => {
  const { results, cached: fromCache, error } = await searchPlaces(String(req.query.q ?? ""));
  res.json({ results, ...(fromCache && { cached: true }), ...(error && { error }) });
});

/**
 * GET /api/geocode/reverse?lat=..&lng=..
 *
 * Turns a dropped pin into a street or place name. Callers get a usable label
 * even when the lookup fails, so a pin is never left showing raw coordinates.
 */
geocodeRoutes.get("/reverse", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat and lng are required" });
  }

  const area = checkServiceArea(lat, lng);
  const key = `r:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const hit = cached<GeocodeResult>(key);
  if (hit) return res.json({ place: hit, inServiceArea: area.inside, cached: true });

  const fallback: GeocodeResult = {
    name: "Pinned location",
    address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    lat,
    lng,
  };

  try {
    const data = await throttledNominatim(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}` +
        `&format=json&zoom=18&addressdetails=1`
    );

    const a = data?.address ?? {};
    const name =
      a.amenity || a.shop || a.building || a.road || a.neighbourhood || a.suburb || a.village;

    const place: GeocodeResult = name
      ? {
          name,
          address: [a.road && a.road !== name ? a.road : null, a.suburb || a.village, a.city]
            .filter(Boolean)
            .join(", ") || "Dumaguete City",
          lat,
          lng,
        }
      : fallback;

    remember(key, place);
    res.json({ place, inServiceArea: area.inside });
  } catch (err) {
    console.error("reverse geocode failed:", (err as Error).message);
    res.json({ place: fallback, inServiceArea: area.inside, error: "lookup-unavailable" });
  }
});
