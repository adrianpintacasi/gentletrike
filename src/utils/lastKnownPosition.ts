/**
 * The last place this phone knew it was.
 *
 * The map is built in a mount effect, and geolocation answers on a later tick —
 * even a cached fix does. So at construction there is no position, and the map
 * has to open on *something*. That something was a hardcoded Dumaguete, which
 * is the wrong city for everyone not in it and reads, for the second before the
 * camera jumps, as an app that has no idea where you are.
 *
 * A position from the last session is a far better guess than a constant: a
 * pedicab rider opens the app in the town they worked yesterday. It is only
 * ever the opening frame — the live fix overwrites it the moment it lands, and
 * nothing is priced, routed or dispatched from it.
 *
 * Deliberately not sessionStorage: the value is most useful on the *next* cold
 * open, which is exactly when a session store is empty.
 */

const KEY = 'gt.lastKnownPosition';

/** Older than this and the phone has probably moved town. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface StoredPosition {
  lat: number;
  lng: number;
  at: number;
}

export function readLastKnownPosition(): { lat: number; lng: number } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredPosition>;
    if (
      !Number.isFinite(parsed.lat) ||
      !Number.isFinite(parsed.lng) ||
      !Number.isFinite(parsed.at)
    ) {
      return null;
    }
    if (Date.now() - parsed.at! > MAX_AGE_MS) return null;

    return { lat: parsed.lat!, lng: parsed.lng! };
  } catch {
    // Private browsing, a disabled store, or something else's key under ours.
    // An opening centre is not worth failing a render over.
    return null;
  }
}

export function writeLastKnownPosition(lat: number, lng: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ lat, lng, at: Date.now() }));
  } catch {
    /* storage full or blocked — the app works without it */
  }
}
