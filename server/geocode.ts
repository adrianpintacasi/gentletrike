import { Router } from "express";
import { checkServiceArea, DUMAGUETE_BBOX } from "../shared/serviceArea";
import { haversineKm } from "../shared/geo";

/**
 * Place search and address lookup for the booking panel.
 *
 * Proxied through our own server rather than called from the browser because the
 * Google key that authorises these calls is a secret, and because a shared cache
 * means twenty passengers searching "robinsons" cost one request instead of
 * twenty.
 *
 * Two Google APIs, both keyed by GOOGLE_MAPS_SERVER_KEY:
 *   Places (New) Text Search — free-text search, returns coordinates in one call
 *   Geocoding                — reverse lookups, which are one-per-pin and rare
 *
 * Text Search rather than Autocomplete on purpose: Autocomplete returns
 * predictions without coordinates, so each of the eight results would need its
 * own Place Details call. One search request is both cheaper and a smaller
 * change than reshaping what this function promises its callers.
 */
export const geocodeRoutes = Router();

const apiKey = (): string | undefined => process.env.GOOGLE_MAPS_SERVER_KEY;

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

/**
 * Open Location Code, e.g. "8864+MW3".
 *
 * Google leads with one wherever a spot has no street number, so both the search
 * result and the reverse lookup for Silliman University arrive as
 * "8864+MW3, Dumaguete City". It is a precise location and a meaningless label
 * to a passenger, so it is stripped from anything shown and never used as a name.
 */
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3},?\s*/i;

const stripPlusCode = (address: string): string => address.replace(PLUS_CODE, "").trim();

/** Flatten one Places result into the shape the booking panel expects. */
function fromPlace(place: any): GeocodeResult | null {
  const lat = place?.location?.latitude;
  const lng = place?.location?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const name = place?.displayName?.text;
  if (!name) return null;

  // Google repeats the place name at the front of the formatted address; the
  // panel shows both, so trim it rather than printing "Sans Rival, Sans Rival…".
  const formatted: string = place?.formattedAddress ?? "";
  const trimmed = formatted.startsWith(`${name}, `)
    ? formatted.slice(name.length + 2)
    : formatted;

  // Places leads with a plus code wherever there is no street number, so
  // Silliman University arrives as "8864+MW3, Dumaguete City" — a precise
  // location and a meaningless line under a search result.
  const address = stripPlusCode(trimmed);

  return { name, address: address || "Dumaguete City", lat, lng };
}

export interface SearchOutcome {
  results: GeocodeResult[];
  cached: boolean;
  /** Set when the provider could not be reached; results will be empty. */
  error?: string;
}

/**
 * Find places matching free text, near whoever is asking.
 *
 * Exported as a plain function, not just a route, because Gently resolves
 * passenger phrasing through the same search the booking panel uses. Two
 * separate lookups would eventually disagree about where "Sans Rival" is, and a
 * fare quoted for one point while the ride goes to another is the worst kind of
 * bug — it looks correct.
 *
 * `near` is the searcher's own position and decides what "the terminal" or "the
 * mall" means. Omit it and Google is left to guess from the words alone, which
 * is how a search for "the university" ends up in another province.
 */
export async function searchPlaces(
  query: string,
  near?: { lat: number; lng: number }
): Promise<SearchOutcome> {
  const q = query.trim().slice(0, 120);
  if (q.length < 2) return { results: [], cached: false };

  // The searcher's rough position is part of the cache key: the same words mean
  // different places in different cities, and a shared cache would serve Cebu's
  // answer to someone standing in Dumaguete. One decimal place is ~11 km, which
  // is coarse enough to still get hits.
  const where = near ? `@${near.lat.toFixed(1)},${near.lng.toFixed(1)}` : '';
  const key = `s:${q.toLowerCase()}${where}`;
  const hit = cached<GeocodeResult[]>(key);
  if (hit) return { results: hit, cached: true };

  const googleKey = apiKey();
  if (!googleKey) {
    console.error("geocode search skipped: GOOGLE_MAPS_SERVER_KEY is not set");
    return { results: [], cached: false, error: "search-unavailable" };
  }

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": googleKey,
        // Only the three fields actually rendered. Adding photos or ratings here
        // would silently move every search onto a pricier billing tier.
        "X-Goog-FieldMask":
          "places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify({
        textQuery: q,
        /*
         * A bias, not a restriction.
         *
         * This was a hard rectangle around Dumaguete, so Google would not return
         * anything outside it — which kept Manila out of the results and also
         * made the app useless anywhere else. Someone standing in Cebu searching
         * for a place in Cebu got nothing at all.
         *
         * A circular bias around the searcher instead: near things rank first,
         * so "the terminal" still means the one down the road, but a real place
         * further out is reachable rather than invisible. 30 km covers a city
         * and the towns around it without pulling in the next province.
         */
        ...(near && {
          locationBias: {
            circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 30000 },
          },
        }),
        maxResultCount: 12,
        languageCode: "en",
      }),
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }

    const data = await response.json();

    const seen = new Set<string>();
    const results = (data?.places ?? [])
      .map(fromPlace)
      .filter((r: GeocodeResult | null): r is GeocodeResult => !!r)
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

/** GET /api/geocode/search?q=silliman&lat=..&lng=.. */
geocodeRoutes.get("/search", async (req, res) => {
  // The caller's position steers the search. Without it Google guesses from the
  // words alone, which is how "the university" lands in another province.
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const near =
    Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;

  const { results, cached: fromCache, error } = await searchPlaces(
    String(req.query.q ?? ""),
    near
  );
  res.json({ results, ...(fromCache && { cached: true }), ...(error && { error }) });
});

/**
 * GET /api/geocode/accessible?lat=..&lng=..
 *
 * The nearest spot a pedicab can actually stop at.
 *
 * A passenger standing in an alley, inside a subdivision, or halfway down a
 * footpath has a perfectly valid GPS fix and a pickup point no trike can reach.
 * Rather than send a rider to a coordinate and let them work it out by phone,
 * this looks for named places within a short walk — a shop, a school gate, a
 * junction — which by their nature sit on something drivable.
 *
 * Returns the original point when it is already fine, so the caller always has
 * something to show and never has to special-case an empty answer.
 */
geocodeRoutes.get("/accessible", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat and lng are required" });
  }

  const key = `a:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const hit = cached<{ suggestion: GeocodeResult | null; walkMetres: number | null }>(key);
  if (hit) return res.json({ ...hit, cached: true });

  const googleKey = apiKey();
  if (!googleKey) return res.json({ suggestion: null, walkMetres: null });

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": googleKey,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify({
        // 250 m is a walk a passenger will accept in the rain; beyond that the
        // suggestion stops being help and starts being a different trip.
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius: 250 },
        },
        rankPreference: "DISTANCE",
        maxResultCount: 5,
        languageCode: "en",
      }),
    });

    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);

    const data = await response.json();
    const candidates: GeocodeResult[] = (data?.places ?? [])
      .map(fromPlace)
      .filter((p: GeocodeResult | null): p is GeocodeResult => !!p)
      .filter((p: GeocodeResult) => checkServiceArea(p.lat, p.lng).inside);

    const best = candidates[0] ?? null;
    const walkMetres = best
      ? Math.round(haversineKm({ lat, lng }, { lat: best.lat, lng: best.lng }) * 1000)
      : null;

    // Already within a few metres of a named place — the fix is fine as it is,
    // and suggesting somewhere the passenger is already standing is noise.
    const payload =
      best && walkMetres !== null && walkMetres > 25
        ? { suggestion: best, walkMetres }
        : { suggestion: null, walkMetres: null };

    remember(key, payload);
    res.json(payload);
  } catch (err) {
    console.error("accessible point lookup failed:", (err as Error).message);
    res.json({ suggestion: null, walkMetres: null });
  }
});

/**
 * Components Google will accept as a place's short name, best first.
 *
 * Reverse geocoding answers with an address rather than a business, so the most
 * specific useful label is usually the building or the street.
 */
const NAME_COMPONENTS = [
  "point_of_interest",
  "establishment",
  "premise",
  "route",
  "neighborhood",
  "sublocality_level_1",
  "sublocality",
];

/** First component of a named type, or undefined if this result has none. */
function nameFromComponents(components: any[]): string | undefined {
  for (const type of NAME_COMPONENTS) {
    const hit = components.find((c) => c.types?.includes(type));
    if (hit?.long_name && !PLUS_CODE.test(hit.long_name)) return hit.long_name;
  }
  return undefined;
}

/**
 * GET /api/geocode/reverse?lat=..&lng=..
 *
 * Turns a dropped pin into a street or place name. Callers get a usable label
 * even when the lookup fails, so a pin is never left showing raw coordinates.
 */
/**
 * The named establishment a point is standing on, if there is one.
 *
 * The Geocoding API answers in addresses, so dropping a pin on McDonald's
 * returned "National Highway" — correct, and not what the passenger pointed at.
 * Establishment names live in Places, so that is asked first and the street is
 * kept as the fallback it should always have been.
 *
 * The radius is deliberately tight. Forty metres is "the thing under the pin";
 * widen it and a pin on the road starts being named after whichever shop
 * happens to be nearest, which is a different and worse kind of wrong.
 */
export async function placeAtPoint(lat: number, lng: number): Promise<GeocodeResult | null> {
  const googleKey = apiKey();
  if (!googleKey) return null;

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": googleKey,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify({
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius: 40 },
        },
        rankPreference: "DISTANCE",
        maxResultCount: 1,
        languageCode: "en",
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    return (data?.places ?? []).map(fromPlace).find((p: GeocodeResult | null) => !!p) ?? null;
  } catch (err) {
    console.error("place-at-point lookup failed:", (err as Error).message);
    return null;
  }
}

/** Street-level address for a coordinate, or null. The fallback for "where am I". */
async function reverseGeocodeAddress(lat: number, lng: number): Promise<string | null> {
  const googleKey = apiKey();
  if (!googleKey) return null;
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}` +
        `&language=en&key=${googleKey}`
    );
    if (!response.ok) return null;
    const data = await response.json();
    const first = (data?.results ?? []).find(
      (r: any) => !(r?.types?.length === 1 && r.types[0] === "plus_code")
    );
    const address = stripPlusCode(first?.formatted_address ?? "");
    return address || null;
  } catch {
    return null;
  }
}

/**
 * Where someone is, in words they would use themselves.
 *
 * Distinct from {@link placeAtPoint}, and deliberately so. That answers "what is
 * at this exact coordinate", which is right for a dropped pin — the passenger
 * chose the spot, so the nearest thing to it is what they meant.
 *
 * "Where am I" is a different question and the nearest thing is usually the
 * wrong answer to it. Ranked by distance inside forty metres, the Ayala Center
 * comes back as "Lounge area", a main road comes back as the petrol station on
 * it, and a university gate comes back as the student council office. All
 * true, none of them what anybody would say.
 *
 * So this ranks by prominence over a wider circle, and falls back to the
 * street-level address when nothing prominent is near — which is what a map app
 * shows under its own blue dot.
 */
export async function describePosition(lat: number, lng: number): Promise<string | null> {
  const googleKey = apiKey();
  if (!googleKey) return null;

  const key = `d:${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = cached<{ name: string }>(key);
  if (hit) return hit.name;

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": googleKey,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify({
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius: 220 },
        },
        // Prominence, not proximity. The landmark somebody would name is rarely
        // the nearest doorway to them.
        rankPreference: "POPULARITY",
        maxResultCount: 1,
        languageCode: "en",
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const place = (data?.places ?? []).map(fromPlace).find((p: GeocodeResult | null) => !!p);
      if (place) {
        remember(key, { name: place.name });
        return place.name;
      }
    }
  } catch (err) {
    console.error("describe-position lookup failed:", (err as Error).message);
  }

  // Nothing prominent nearby — a street is still a better answer than silence.
  const fallback = await reverseGeocodeAddress(lat, lng);
  if (fallback) remember(key, { name: fallback });
  return fallback;
}

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

  const googleKey = apiKey();
  if (!googleKey) {
    console.error("reverse geocode skipped: GOOGLE_MAPS_SERVER_KEY is not set");
    return res.json({ place: fallback, inServiceArea: area.inside, error: "lookup-unavailable" });
  }

  try {
    // A named place beats a street name: it is what the passenger pointed at,
    // and it is what they will say to the driver on the phone.
    const named = await placeAtPoint(lat, lng);
    if (named) {
      const place: GeocodeResult = { ...named, lat, lng };
      remember(key, place);
      return res.json({ place, inServiceArea: area.inside });
    }

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}` +
        `&language=en&key=${googleKey}`
    );
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

    const data = await response.json();
    if (data?.status !== "OK" && data?.status !== "ZERO_RESULTS") {
      throw new Error(data?.error_message || data?.status || "unknown error");
    }

    /**
     * Results run most specific first, but the most specific one is not always
     * the most *nameable*: the top hit for Silliman University is tagged
     * `establishment` yet carries nothing but a plus code and the city in its
     * components. Walk the list until one yields a real name rather than giving
     * up on the first, which is what left every dropped pin reading
     * "Pinned location".
     */
    const candidates: any[] = (data?.results ?? []).filter(
      (r: any) => !(r?.types?.length === 1 && r.types[0] === "plus_code")
    );

    let place: GeocodeResult = fallback;

    for (const candidate of candidates) {
      const name = nameFromComponents(candidate?.address_components ?? []);
      if (!name) continue;

      place = {
        name,
        address: stripPlusCode(candidate?.formatted_address ?? "") || "Dumaguete City",
        lat,
        lng,
      };
      break;
    }

    remember(key, place);
    res.json({ place, inServiceArea: area.inside });
  } catch (err) {
    console.error("reverse geocode failed:", (err as Error).message);
    res.json({ place: fallback, inServiceArea: area.inside, error: "lookup-unavailable" });
  }
});
