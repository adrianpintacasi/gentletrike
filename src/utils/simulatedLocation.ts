/**
 * Stand somewhere else without going there.
 *
 * GentleTrike works wherever it is opened, which is exactly what makes it hard
 * to test: you cannot check that it behaves correctly in Cebu from a desk in
 * Dumaguete, because the browser reports the truth. This overrides the phone's
 * fix with a named place, so the whole app — map, search, fares, dispatch —
 * runs as though you were standing there.
 *
 * Turn it on with a query parameter and it sticks for the session:
 *
 *   ?at=citu        Cebu Institute of Technology - University
 *   ?at=cebu        Cebu City centre
 *   ?at=dumaguete   Quezon Park
 *   ?at=danlugan    Brgy. Danlugan, Pagadian City
 *   ?at=9.31,123.30 any coordinate pair
 *   ?at=off         back to the real GPS
 *
 * Open two windows on different presets to act out both sides of a trip. The
 * banner is deliberately loud and impossible to miss — a simulated fix that
 * someone forgets about is a bug report about a problem that does not exist.
 */

export interface SimulatedPlace {
  name: string;
  lat: number;
  lng: number;
}

const PRESETS: Record<string, SimulatedPlace> = {
  citu: { name: 'CIT-U, Cebu City', lat: 10.2949, lng: 123.8811 },
  cebu: { name: 'Cebu City', lat: 10.3157, lng: 123.8854 },
  ayala: { name: 'Ayala Center Cebu', lat: 10.3181, lng: 123.9053 },
  dumaguete: { name: 'Quezon Park, Dumaguete', lat: 9.3072, lng: 123.3068 },
  silliman: { name: 'Silliman University', lat: 9.3078, lng: 123.3072 },
  danlugan: { name: 'Brgy. Danlugan, Pagadian City', lat: 7.8386, lng: 123.4739 },
  pagadian: { name: 'Pagadian City', lat: 7.8257, lng: 123.437 },
};

const STORAGE_KEY = 'gt:simulated-location';

/** A bare "lat,lng" pair, for a spot no preset covers. */
function parseCoordinates(raw: string): SimulatedPlace | null {
  const [a, b] = raw.split(',').map((n) => Number(n.trim()));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { name: `${a.toFixed(4)}, ${b.toFixed(4)}`, lat: a, lng: b };
}

function readParam(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('at');
}

/**
 * The simulated fix for this session, if one is set.
 *
 * Resolved once at module load. The query parameter wins and is remembered, so
 * the setting survives the reloads that testing involves without needing the
 * parameter retyped each time.
 */
export const simulatedLocation: SimulatedPlace | null = (() => {
  if (typeof window === 'undefined') return null;

  const param = readParam();

  if (param) {
    const key = param.trim().toLowerCase();

    if (key === 'off' || key === 'none' || key === 'real') {
      try {
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* private mode — nothing to clear */
      }
      return null;
    }

    const place = PRESETS[key] ?? parseCoordinates(key);
    if (place) {
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(place));
      } catch {
        /* private mode — the parameter still works for this page */
      }
      return place;
    }
  }

  try {
    const saved = window.sessionStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved) as SimulatedPlace;
  } catch {
    /* unreadable or malformed — fall through to the real GPS */
  }

  return null;
})();

export const isSimulatingLocation = simulatedLocation !== null;

/** Every preset, for the banner's "switch to" list. */
export const LOCATION_PRESETS = PRESETS;
