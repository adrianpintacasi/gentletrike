import React from 'react';
import { ArrowLeft, Search, LocateFixed, Loader2, Footprints, X } from 'lucide-react';
import * as api from '../api';
import type { LocationPoint } from '../types';
import { loadGoogleMaps, MAP_ID } from '../utils/loadGoogleMaps';
import { usePlaceSearch } from '../hooks/usePlaceSearch';

/**
 * Full-screen map for choosing one point — a destination or a pickup.
 *
 * One component for both because the interaction is identical: move the map, the
 * pin stays in the centre, the card underneath names whatever is now beneath it.
 * A centre-locked pin rather than a draggable marker is deliberate; on a phone
 * the thumb that drags a marker also covers it.
 *
 * The address is resolved from the map's own centre on every settle, so the name
 * on the card is always the place that will actually be booked.
 */

interface LocationPickerMapProps {
  mode: 'destination' | 'pickup';
  /** Where to open. The passenger's GPS fix for a pickup, the city for a drop-off. */
  initialCentre: { lat: number; lng: number } | null;
  locations: LocationPoint[];
  onConfirm: (place: LocationPoint) => void;
  onCancel: () => void;
  /**
   * Render inside its column instead of over the whole window.
   *
   * Desktop already shows a map beside the booking column, so covering the
   * screen to pick a point covered the very thing being used to decide. Inline,
   * the same picker simply takes the map's place for as long as it is needed.
   */
  inline?: boolean;
}

const DUMAGUETE_CENTRE = { lat: 9.3082, lng: 123.3054 };

export const LocationPickerMap: React.FC<LocationPickerMapProps> = ({
  mode,
  initialCentre,
  locations,
  onConfirm,
  onCancel,
  inline = false,
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<google.maps.Map | null>(null);

  const [place, setPlace] = React.useState<api.GeocodeResult | null>(null);
  const [inArea, setInArea] = React.useState(true);
  const [isResolving, setIsResolving] = React.useState(true);
  const [suggestion, setSuggestion] = React.useState<api.GeocodeResult | null>(null);
  const [walkMetres, setWalkMetres] = React.useState<number | null>(null);

  const [searchOpen, setSearchOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  // The map's own opening centre is the best available "where am I" here, and
  // it is what stops a search made in Cebu answering with a place in Negros.
  const { curated, found, searching } = usePlaceSearch(query, locations, initialCentre);

  const isPickup = mode === 'pickup';

  const resolveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Rising counter, so a slow earlier lookup cannot overwrite a newer one. */
  const resolveSeq = React.useRef(0);

  /**
   * Resolve whatever is under the pin, plus a reachable alternative if needed.
   *
   * Debounced, because both calls are metered and `idle` fires on every pause
   * of a drag. Someone hunting for a spot pauses constantly, so resolving on
   * each one meant two billed requests per twitch. Settling for 400 ms first
   * turns a minute of searching into a handful of lookups instead of dozens,
   * and costs nothing in feel — the card is already showing a spinner.
   */
  const resolveCentre = React.useCallback((lat: number, lng: number) => {
    setIsResolving(true);
    if (resolveTimer.current) clearTimeout(resolveTimer.current);

    resolveTimer.current = setTimeout(async () => {
      const seq = ++resolveSeq.current;
      try {
        const [reverse, accessible] = await Promise.all([
          api.reverseGeocode(lat, lng),
          api.accessiblePoint(lat, lng),
        ]);
        if (seq !== resolveSeq.current) return;
        setPlace(reverse.place);
        setInArea(reverse.inServiceArea);
        setSuggestion(accessible.suggestion);
        setWalkMetres(accessible.walkMetres);
      } catch {
        if (seq !== resolveSeq.current) return;
        setPlace({
          name: 'Pinned location',
          address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
          lat,
          lng,
        });
        setSuggestion(null);
      } finally {
        if (seq === resolveSeq.current) setIsResolving(false);
      }
    }, 400);
  }, []);

  React.useEffect(
    () => () => {
      if (resolveTimer.current) clearTimeout(resolveTimer.current);
    },
    []
  );

  /**
   * The opening centre, captured once.
   *
   * `initialCentre` is derived from the passenger's GPS watch, so it changes
   * every time a fix lands. Depending on it rebuilt the whole map on each
   * update — a visible flicker, a lost pan, and a fresh billable map load every
   * second or two. It is the *initial* centre; after that the map's own centre
   * is the truth.
   */
  const openingCentre = React.useRef(initialCentre ?? DUMAGUETE_CENTRE).current;

  /** The live fix, for the "back to my location" button only. */
  const latestFix = React.useRef(initialCentre);
  React.useEffect(() => {
    latestFix.current = initialCentre;
  }, [initialCentre?.lat, initialCentre?.lng]);

  /**
   * Switching between choosing a destination and choosing a pickup used to
   * remount this component, which built a second map and billed a second map
   * load. The map is the same map; only the question changed, so it pans.
   */
  const firstMode = React.useRef(true);
  React.useEffect(() => {
    if (firstMode.current) {
      firstMode.current = false;
      return;
    }
    const target = latestFix.current;
    if (target && mapRef.current) {
      mapRef.current.panTo(target);
      mapRef.current.setZoom(17);
    }
  }, [mode]);

  React.useEffect(() => {
    let cancelled = false;
    const centre = openingCentre;

    loadGoogleMaps().then(() => {
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = new google.maps.Map(containerRef.current, {
        center: centre,
        // Close enough to tell one street corner from the next; picking a pickup
        // at city zoom is picking a neighbourhood, not a place to stand.
        zoom: 17,
        mapId: MAP_ID,
        disableDefaultUI: true,
        zoomControl: true,
        zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER },
        clickableIcons: false,
        gestureHandling: 'greedy',
      });
      mapRef.current = map;

      // `idle` fires once the map settles, so the lookup happens per gesture
      // rather than per frame of a drag.
      map.addListener('idle', () => {
        const c = map.getCenter();
        if (c) void resolveCentre(c.lat(), c.lng());
      });

      void resolveCentre(centre.lat, centre.lng);
    });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        google.maps.event.clearInstanceListeners(mapRef.current);
        mapRef.current = null;
      }
    };
    // Built exactly once. Everything that moves the map afterwards does so
    // through `moveTo`, never by re-running this.
  }, [openingCentre, resolveCentre]);

  const moveTo = (lat: number, lng: number) => {
    mapRef.current?.panTo({ lat, lng });
    mapRef.current?.setZoom(17);
  };

  const confirm = (chosen?: api.GeocodeResult) => {
    const target = chosen ?? place;
    if (!target) return;
    onConfirm({
      id: `${mode}_${Date.now()}`,
      name: target.name,
      address: target.address,
      lat: target.lat,
      lng: target.lng,
      isCustomPinned: true,
      pickedOnMap: true,
    });
  };

  const results = [...curated, ...found];

  return (
    <div
      className={
        inline
          ? "relative h-full w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-md"
          : "fixed inset-0 z-50 bg-white"
      }
    >
      <div ref={containerRef} className="absolute inset-0 bg-white" />

      {/* Centre-locked pin. Offset by its own height so the point of the
          teardrop, not its middle, marks the coordinate. */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-full">
        <svg
          className={`h-10 w-10 drop-shadow-lg ${isPickup ? 'text-emerald-600' : 'text-red-600'}`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
        </svg>
      </div>

      {/* Top bar: back, and the search that can jump the map anywhere. */}
      <div className="absolute inset-x-0 top-0 z-20 p-3">
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            aria-label="Back"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-gray-700 shadow-md transition active:scale-95"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-11 flex-1 items-center gap-2.5 rounded-xl bg-white px-3.5 text-left shadow-md"
          >
            <Search className="h-4 w-4 shrink-0 text-gray-400" />
            <span className="truncate text-xs font-semibold text-gray-500">
              {isPickup ? 'Search pickup location' : 'Search destination'}
            </span>
          </button>

          {isPickup && (
            <button
              onClick={() => {
                const fix = latestFix.current;
                if (fix) moveTo(fix.lat, fix.lng);
              }}
              aria-label="Back to my location"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-amber-600 shadow-md transition active:scale-95"
            >
              <LocateFixed className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {searchOpen && (
        <div className="absolute inset-0 z-30 flex flex-col bg-white">
          <div className="flex items-center gap-2 p-3">
            <button
              onClick={() => {
                setSearchOpen(false);
                setQuery('');
              }}
              aria-label="Close search"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-500"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex h-11 flex-1 items-center gap-2.5 rounded-xl border border-gray-200 px-3.5 focus-within:border-amber-400">
              <Search className="h-4 w-4 shrink-0 text-gray-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={isPickup ? 'Search pickup location' : 'Search destination'}
                className="w-full bg-transparent text-sm font-semibold outline-none placeholder:font-medium placeholder:text-gray-400"
              />
              {searching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-500" />}
            </div>
          </div>

          <div className="flex-1 divide-y divide-gray-100 overflow-y-auto">
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  setSearchOpen(false);
                  setQuery('');
                  moveTo(r.lat, r.lng);
                }}
                className="w-full px-4 py-3 text-left transition hover:bg-gray-50"
              >
                <span className="block truncate text-sm font-bold text-gray-900">{r.name}</span>
                <span className="block truncate text-[11px] font-medium text-gray-400">
                  {r.address}
                </span>
              </button>
            ))}
            {results.length === 0 && query.trim().length >= 3 && !searching && (
              <p className="px-4 py-10 text-center text-xs font-bold text-gray-400">
                Nothing found for “{query}”.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Bottom card: what is under the pin, and the one button that accepts it. */}
      <div className="absolute inset-x-0 bottom-0 z-20 rounded-t-2xl bg-white p-4 shadow-[0_-8px_32px_rgba(0,0,0,0.18)]">
        <div className="mb-3 flex items-start gap-2.5">
          <span
            className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${
              isPickup ? 'bg-emerald-600' : 'bg-red-600'
            }`}
          />
          <div className="min-w-0 flex-1">
            {isResolving ? (
              <p className="flex items-center gap-1.5 text-sm font-bold text-gray-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Finding this place…
              </p>
            ) : (
              <>
                <p className="truncate text-sm font-bold text-gray-900">
                  {place?.name ?? 'Pinned location'}
                </p>
                <p className="truncate text-[11px] font-medium text-gray-400">
                  {place?.address}
                </p>
              </>
            )}
          </div>
        </div>

        {!inArea && (
          <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-800">
            Outside Dumaguete City — GentleTrike cannot serve this point yet.
          </p>
        )}

        {/* A real alternative, not a nudge: the walk is measured and the button
            moves the pin there rather than just naming it. */}
        {suggestion && walkMetres !== null && inArea && (
          <button
            onClick={() => moveTo(suggestion.lat, suggestion.lng)}
            className="mb-3 flex w-full items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-left transition active:scale-[0.99]"
          >
            <Footprints className="h-4 w-4 shrink-0 text-amber-700" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-bold text-amber-900">
                Easier to reach: {suggestion.name}
              </span>
              <span className="block text-[10px] font-semibold text-amber-700">
                {walkMetres} m walk · a trike can pull in here
              </span>
            </span>
          </button>
        )}

        <button
          onClick={() => confirm()}
          disabled={isResolving || !inArea || !place}
          className="h-12 w-full rounded-xl bg-gray-900 text-sm font-semibold text-amber-400 shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPickup ? 'Confirm Pickup' : 'Choose this Destination'}
        </button>
      </div>
    </div>
  );
};
