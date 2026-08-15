/**
 * Load the Google Maps JavaScript API once, on demand.
 *
 * A module-level promise rather than a hook because the API is a global: React
 * StrictMode mounts effects twice in development, and two <script> tags for the
 * same key produce a console error and a wasted map load. Everything after the
 * first call awaits the same promise.
 *
 * The `marker` library is requested up front — advanced markers are what the
 * pins are built from, and importing it lazily would leave the first render
 * without any.
 */

/** Resolves when `google.maps` is ready to use. */
let loader: Promise<void> | null = null;

const CALLBACK_NAME = '__gentletrikeMapsReady';

export class GoogleMapsLoadError extends Error {}

export function loadGoogleMaps(): Promise<void> {
  if (loader) return loader;

  const key = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY;
  if (!key) {
    loader = Promise.reject(
      new GoogleMapsLoadError(
        'VITE_GOOGLE_MAPS_BROWSER_KEY is not set — add it to .env and restart the dev server.'
      )
    );
    return loader;
  }

  loader = new Promise<void>((resolve, reject) => {
    // Already present (a hot reload kept the script but dropped this module).
    if (typeof google !== 'undefined' && google.maps?.Map) {
      resolve();
      return;
    }

    (window as unknown as Record<string, unknown>)[CALLBACK_NAME] = () => resolve();

    const script = document.createElement('script');
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      `&v=weekly&libraries=marker&loading=async&callback=${CALLBACK_NAME}`;
    script.async = true;
    script.onerror = () =>
      reject(
        new GoogleMapsLoadError(
          'Google Maps could not be loaded. Check the browser key restrictions and that Maps JavaScript API is enabled.'
        )
      );

    document.head.appendChild(script);
  });

  return loader;
}

/**
 * The cloud-styled Map ID.
 *
 * Advanced markers refuse to render without one, and the failure is silent — the
 * map draws, the pins simply never appear. Surfaced here so the component can
 * say so out loud instead of leaving a blank map to debug.
 */
export const MAP_ID: string | undefined = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID;
