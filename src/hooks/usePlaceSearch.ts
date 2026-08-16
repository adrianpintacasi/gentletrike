import { useEffect, useRef, useState } from 'react';
import * as api from '../api';
import { LocationPoint } from '../types';

/**
 * Search that looks beyond the app's curated pickup points.
 *
 * The fifteen built-in points stay first and match instantly — they are the
 * common trips and should never wait on a network call. Anything else the
 * passenger types is looked up through the geocoder, debounced so a request
 * goes out per pause rather than per keystroke.
 */

/** Long enough that "Sil" does not fire a request, short enough to feel live. */
export const MIN_QUERY = 3;
const DEBOUNCE_MS = 350;

export interface PlaceSearchState {
  /** Matches among the app's own pickup points. */
  curated: LocationPoint[];
  /** Places found by the geocoder, minus anything already listed above. */
  found: LocationPoint[];
  searching: boolean;
}

export function usePlaceSearch(
  query: string,
  curatedSource: LocationPoint[],
  /**
   * Where the passenger is, so results are near them.
   *
   * The search used to be restricted to a box around Dumaguete, which made the
   * question "where am I" irrelevant. Now that it works anywhere, position is
   * what decides whether "the university" means the one across the street.
   */
  near?: { lat: number; lng: number } | null
): PlaceSearchState {
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();

  const curated = lower
    ? curatedSource.filter(
        (loc) =>
          loc.name.toLowerCase().includes(lower) ||
          (loc.address ?? '').toLowerCase().includes(lower) ||
          (loc.popularFor ?? '').toLowerCase().includes(lower)
      )
    : curatedSource;

  const [found, setFound] = useState<LocationPoint[]>([]);
  const [searching, setSearching] = useState(false);

  // Identifies the most recent request so a slow earlier one cannot overwrite
  // results the passenger is already looking at.
  const latest = useRef(0);

  useEffect(() => {
    if (trimmed.length < MIN_QUERY) {
      setFound([]);
      setSearching(false);
      return;
    }

    const ticket = ++latest.current;
    setSearching(true);

    const timer = setTimeout(async () => {
      const results = await api.searchPlaces(trimmed, near ?? undefined);
      if (ticket !== latest.current) return;

      const alreadyShown = new Set(curated.map((c) => c.name.toLowerCase()));

      setFound(
        results
          .filter((r) => !alreadyShown.has(r.name.toLowerCase()))
          .map((r) => ({
            // Coordinates make the id stable, so re-searching the same place
            // does not look like a different result to React.
            id: `geo_${r.lat.toFixed(5)}_${r.lng.toFixed(5)}`,
            name: r.name,
            address: r.address,
            lat: r.lat,
            lng: r.lng,
            isCustomPinned: true,
          }))
      );
      setSearching(false);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `curated` is derived from the same query, so depending on the query alone
    // is correct and avoids re-running on every parent render. Position is
    // rounded first: a raw GPS watch changes every second, and re-running the
    // search on each fix would bill a request per heartbeat.
  }, [trimmed, near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : '']); // eslint-disable-line react-hooks/exhaustive-deps

  return { curated, found, searching };
}
