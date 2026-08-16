import React from 'react';
import { Search, Map, Clock, ChevronRight, X, MapPin, Loader2 } from 'lucide-react';
import type { HistoryRide, TodayTotals } from '../api';
import type { LocationPoint } from '../types';
import { useWeather, describeWeather } from '../hooks/useWeather';
import { usePlaceSearch } from '../hooks/usePlaceSearch';

/**
 * The passenger's home screen.
 *
 * One question, asked the way the reference asks it: where are you going? The
 * destination comes first because it is the only thing the passenger actually
 * knows when they open the app — the pickup is wherever they happen to be
 * standing, and the app can work most of that out itself.
 */

interface HomePassengerProps {
  name: string;
  history: HistoryRide[];
  today: TodayTotals | null;
  /** The app's saved points, matched instantly before the geocoder is asked. */
  locations: LocationPoint[];
  /** Where the passenger is, so search results are places near them. */
  position?: { lat: number; lng: number } | null;
  /**
   * Called once a destination is settled. The pickup, vehicle and payment come
   * next — the destination is the only thing the passenger reliably knows when
   * they open the app, so it is the only thing asked for here.
   */
  onSelectDestination: (place: LocationPoint) => void;
  /** Opens the full-screen map so an unsearchable spot can still be pinned. */
  onPinOnMap: () => void;
  /**
   * Leaving the search entirely.
   *
   * The map may have been opened from here, so closing this has to close that
   * too — otherwise the column returns to Home while the picker stays up beside
   * it, still asking a question nobody is answering.
   */
  onCloseSearch?: () => void;
  /** Rebook a place they have been before, skipping the search entirely. */
  onRepeatDestination: (ride: HistoryRide) => void;
  onSeeAllHistory: () => void;
}

/**
 * The Cebuano greeting for the current hour.
 *
 * "Maayong adlaw" is the all-purpose form and was hardcoded, so the app said
 * "good day" at eleven at night. These are the greetings people actually use,
 * and the boundaries follow ordinary Visayan usage rather than clock quarters.
 */
function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 4) return 'Maayong gabii';
  if (hour < 11) return 'Maayong buntag';
  if (hour < 13) return 'Maayong udto';
  if (hour < 18) return 'Maayong hapon';
  return 'Maayong gabii';
}

/** How many recent destinations the search screen offers. */
const MAX_RECENT_DESTINATIONS = 5;

const formatWhen = (iso: string) => {
  const date = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

export const HomePassenger: React.FC<HomePassengerProps> = ({
  name,
  history,
  today,
  locations,
  position,
  onSelectDestination,
  onPinOnMap,
  onCloseSearch,
  onRepeatDestination,
  onSeeAllHistory,
}) => {
  const { weather } = useWeather(position);
  const sky = weather ? describeWeather(weather.code) : null;

  const [isSearching, setIsSearching] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { curated, found, searching } = usePlaceSearch(query, locations, position);

  React.useEffect(() => {
    if (isSearching) inputRef.current?.focus();
  }, [isSearching]);

  const choose = (place: LocationPoint) => {
    setIsSearching(false);
    setQuery('');
    onSelectDestination(place);
  };

  /**
   * Search takes the whole screen rather than dropping a list under the field.
   * Google's suggestions are the entire point of this step, and a dropdown
   * fighting a scroll container for room is how a passenger ends up pinning a
   * destination by hand instead.
   */
  if (isSearching) {
    const typing = query.trim().length >= 3;
    // Nothing is offered until they actually type. An untouched search box
    // showing a list of places invites picking one at random; their own recent
    // destinations are the only thing worth volunteering.
    const results = typing ? [...curated, ...found] : [];
    const seen = new Set<string>();
    const recentPlaces: LocationPoint[] = [];
    for (const ride of history) {
      if (ride.role !== 'passenger') continue;
      const key = ride.dropoffLocation.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      recentPlaces.push(ride.dropoffLocation);
      // Five is the point where the list still reads as shortcuts. Past that it
      // becomes a trip log competing with the search box above it, and Trip
      // History in the Menu is where a full record belongs.
      if (recentPlaces.length === MAX_RECENT_DESTINATIONS) break;
    }

    return (
      <div className="space-y-3 pt-1">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setIsSearching(false);
              setQuery('');
              onCloseSearch?.();
            }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cream-300 bg-cream-50 text-trust-slate transition active:scale-95 hover:bg-cream-200"
            aria-label="Cancel search"
          >
            <X className="h-4 w-4" />
          </button>
          <h2 className="text-lg font-display font-bold tracking-tight text-trust-slate">Where to?</h2>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2.5 rounded-card border border-cream-300 bg-cream-50 px-4 py-3 shadow-xs focus-within:border-trike-gold">
            <Search className="h-4 w-4 shrink-0 text-cream-500" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a place"
              className="w-full bg-transparent text-sm font-sans font-semibold text-trust-slate outline-none placeholder:font-normal placeholder:text-cream-500"
            />
            {searching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-trike-gold" />}
          </div>

          {/* Opening the map from here keeps this column on "Where to?" — the
              search and the map are two ways of answering one question. */}
          <button
            onClick={onPinOnMap}
            aria-label="Pin destination on the map"
            className="btn-primary flex h-[46px] w-[46px] shrink-0 items-center justify-center shadow-xs"
          >
            <Map className="h-4 w-4" />
          </button>
        </div>

        {/* Search results stay one grouped list — they are alternatives to
            compare, so dividers read better than gaps. */}
        {results.length > 0 && (
          <div className="divide-y divide-cream-300 overflow-hidden rounded-card border border-cream-300 bg-cream-50">
            {results.map((place) => (
              <button
                key={place.id}
                onClick={() => choose(place)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-cream-200"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cream-200 text-trust-slate">
                  <MapPin className="h-4 w-4 text-trust-slate" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-sans font-semibold text-trust-slate">
                    {place.name}
                  </span>
                  <span className="block truncate text-[11px] font-sans text-cream-600">{place.address}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {results.length === 0 && typing && (
          <div className="rounded-card border border-cream-300 bg-cream-50 px-4 py-10 text-center">
            <p className="text-xs font-sans font-semibold text-cream-600">
              {searching
                ? 'Searching...'
                : `Nothing found for "${query}". Try a landmark or street name.`}
            </p>
          </div>
        )}

        {/* Recents are separate cards, set well below the field.
            They are shortcuts, not search results — spacing them apart stops
            them reading as an answer to a query nobody has typed yet. */}
        {results.length === 0 && !typing && recentPlaces.length > 0 && (
          <div className="pt-6">
            <p className="kicker-label mb-2.5 px-1">
              Recent destinations
            </p>

            <div className="space-y-2.5">
              {recentPlaces.map((place) => (
                <button
                  key={place.id}
                  onClick={() => choose(place)}
                  className="group flex w-full items-center gap-3 rounded-card border border-cream-300 bg-cream-50 p-3.5 text-left shadow-xs transition active:scale-[0.99] hover:border-trike-gold hover:shadow-sm"
                >
                  <Clock className="h-5 w-5 shrink-0 text-trust-slate" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-sans font-semibold text-trust-slate">
                      {place.name}
                    </span>
                    <span className="block truncate text-[11px] font-sans text-cream-600">
                      {place.address}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-cream-400 group-hover:text-trust-slate transition-colors" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-2">
      <header className="gt-rise pt-1">
        <p className="text-xs font-sans font-semibold text-cream-600">
          {greeting()}, {name.split(' ')[0]}
        </p>
        <h1 className="mt-1 text-3xl font-display font-black leading-tight tracking-tight text-trust-slate">
          Where do you
          <br />
          want to go?
        </h1>
      </header>

      {/* Search, and the way out of it. Not every destination is a named place
          Google knows — a house on an unnamed purok has no search result, and
          the map is the only way to say where it is. */}
      <div className="gt-rise flex items-center gap-2" style={{ animationDelay: '60ms' }}>
        <button
          onClick={() => setIsSearching(true)}
          className="flex h-12 flex-1 items-center gap-2.5 rounded-card border border-cream-300 bg-cream-50 px-3.5 text-left shadow-sm transition active:scale-[0.99] hover:border-trike-gold"
        >
          <Search className="h-4 w-4 shrink-0 text-cream-500" />
          <span className="flex-1 truncate text-sm font-sans font-semibold text-cream-600">
            Find your destination
          </span>
        </button>

        <button
          onClick={onPinOnMap}
          aria-label="Pin destination on the map"
          className="btn-primary flex h-12 w-12 shrink-0 items-center justify-center shadow-sm"
        >
          <Map className="h-5 w-5" />
        </button>
      </div>

      <div className="gt-rise grid grid-cols-2 gap-3 pt-2" style={{ animationDelay: '110ms' }}>
        <div className="rounded-card border border-cream-300 bg-cream-50 p-4 shadow-xs transition-all hover:-translate-y-0.5 hover:border-trike-gold hover:shadow-md">
          <p className="mb-1 text-2xl leading-none">{sky?.icon ?? '🌤️'}</p>
          <p className="kicker-label">
            Weather
          </p>
          <p className="mt-0.5 text-2xl font-display font-extrabold leading-none text-trust-slate">
            {weather ? `${weather.temperature}°C` : '—'}
          </p>
          <p className="mt-1 text-[11px] font-sans font-semibold text-cream-600 leading-snug">
            {weather
              ? weather.rainChance >= 40
                ? `${weather.rainChance}% rain · Covered trike advised`
                : `${sky?.label} · Great open-air ride`
              : 'Weather unavailable'}
          </p>
        </div>

        <div className="rounded-card border border-cream-300 bg-cream-50 p-4 shadow-xs transition-all hover:-translate-y-0.5 hover:border-trike-gold hover:shadow-md">
          <Clock className="mb-2 h-5 w-5 text-trust-slate" />
          <p className="kicker-label">
            Your trips today
          </p>
          <p className="mt-0.5 text-2xl font-display font-extrabold leading-none text-trust-slate">
            {today?.passenger.trips ?? 0}
          </p>
          <p className="mt-1 text-[11px] font-sans font-semibold text-cream-600">
            ₱{today?.passenger.spent ?? 0} spent
          </p>
        </div>
      </div>

      {/* Quick Dumaguete Destination Shortcuts */}
      {locations.length > 0 && (
        <div className="gt-rise space-y-2 pt-1" style={{ animationDelay: '150ms' }}>
          <div className="flex items-center justify-between px-0.5">
            <p className="kicker-label">Popular Destinations</p>
            <span className="text-[10px] font-display font-bold text-trust-slate/80">Tap to select</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {locations.slice(0, 4).map((place) => (
              <button
                key={place.id}
                onClick={() => onSelectDestination(place)}
                className="group flex flex-col text-left p-3 rounded-card bg-cream-50 border border-cream-300 shadow-2xs hover:border-trike-gold hover:shadow-xs transition-all active:scale-95"
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cream-200 text-trust-slate group-hover:bg-trike-gold/20">
                    <MapPin className="h-3.5 w-3.5 text-trust-slate" />
                  </span>
                  <span className="text-[10px] font-display font-black text-trust-slate bg-cream-200 px-1.5 py-0.5 rounded-md">
                    ₱15–25
                  </span>
                </div>
                <span className="font-display font-bold text-xs text-trust-slate truncate">
                  {place.name}
                </span>
                <span className="text-[10px] font-sans text-cream-600 truncate mt-0.5">
                  {place.address}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
