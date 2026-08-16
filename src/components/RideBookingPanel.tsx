import React, { useEffect, useMemo, useState } from 'react';
import { LocationPoint, TransportMode } from '../types';
import { DUMAGUETE_LOCATIONS, VEHICLE_DETAILS } from '../data/dumagueteData';
import { TRANSPORT_MODES } from '../../shared/transport';
import { farePerPassenger, totalFare } from '../utils/fare';
import { usePlaceSearch, MIN_QUERY, type PlaceSearchState } from '../hooks/usePlaceSearch';
import { useNearbyRiders } from '../hooks/useNearbyRiders';
import {
  MapPin,
  ArrowDownUp,
  Info,
  CheckCircle2,
  X,
  Users,
  LocateFixed,
  Loader2,
  ChevronUp,
  ChevronDown,
  ArrowLeft,
  Map as MapIcon,
} from 'lucide-react';

/**
 * Emoji per vehicle. Left to render in the system font rather than filtered:
 * on the phones this app is actually used on these already read yellow, and a
 * hue shift only made them look wrong there to fix a desktop-only mismatch.
 */
const VEHICLE_EMOJI: Partial<Record<TransportMode, string>> = {
  pedicab_standard: '🛺',
  // Pakyaw is the same trike hired whole, so it carries the same glyph.
  pakyaw_charter: '🛺',
};

/**
 * The suggestion panel under a pickup or drop-off field.
 *
 * It offers nothing until three characters are typed. It used to open on the
 * app's entire built-in list, unfiltered — so the first thing a passenger saw,
 * and the easiest thing to tap, was seed data from before the app had a
 * geocoder. Their own words are a better starting point than a menu of
 * guesses, and the map button beside the field reaches everything Google
 * cannot name.
 *
 * There is no header and no close button either. The field above it says what
 * it is, and blurring the field already closes this.
 */
const SearchDropdown: React.FC<{
  state: PlaceSearchState;
  query: string;
  onPick: (loc: LocationPoint) => void;
}> = ({ state, query, onPick }) => {
  const trimmed = query.trim();
  const typed = trimmed.length >= MIN_QUERY;

  // The app's own points and Google's are one ranked list, not two sections
  // under two headings. Curated stay first — they carry the local names a
  // driver recognises — but the passenger is choosing a place, and where the
  // app happened to learn of it is not their concern.
  const results = typed ? [...state.curated, ...state.found] : [];

  return (
    <div className="gt-scroll absolute left-0 right-0 top-full z-30 mt-2 max-h-64 overflow-y-auto rounded-card border border-cream-300 bg-cream-50 p-1.5 shadow-xl">
      {!typed && (
        <p className="px-3 py-6 text-center text-xs font-sans font-semibold text-cream-600">
          Start typing, or use the map button to pin a spot.
        </p>
      )}

      {results.map((loc) => (
        <button
          key={loc.id}
          onClick={() => onPick(loc)}
          className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-cream-200"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cream-200">
            <MapPin className="h-3.5 w-3.5 text-trust-slate" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-sans font-semibold text-trust-slate">{loc.name}</span>
            {loc.address && (
              <span className="block truncate text-[11px] font-sans text-cream-600">{loc.address}</span>
            )}
          </span>
        </button>
      ))}

      {typed && state.searching && (
        <div className="flex items-center justify-center gap-2 px-3 py-3 text-[11px] font-sans font-semibold text-cream-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-trike-gold" />
          Searching...
        </div>
      )}

      {typed && !state.searching && results.length === 0 && (
        <p className="px-3 py-6 text-center text-xs font-sans font-semibold text-cream-600">
          Nothing found for "{trimmed}". Try a landmark, or pin it on the map.
        </p>
      )}
    </div>
  );
};

interface RideBookingPanelProps {
  locations: LocationPoint[];
  pickup: LocationPoint | null;
  dropoff: LocationPoint | null;
  onSelectPickup: (loc: LocationPoint) => void;
  onSelectDropoff: (loc: LocationPoint) => void;
  /** Resolves the phone's GPS fix into a pickup point. Omit to hide the button. */
  onUseCurrentLocation?: () => Promise<void>;
  /** Where the passenger is, so both searches return places near them. */
  position?: { lat: number; lng: number } | null;
  selectedVehicle: TransportMode;
  onSelectVehicle: (mode: TransportMode) => void;
  passengers: number;
  onChangePassengers: (count: number) => void;
  paymentMethod: 'cash' | 'gcash';
  onChangePaymentMethod: (method: 'cash' | 'gcash') => void;
  isPakyawNegotiated: boolean;
  onTogglePakyaw: (pakyaw: boolean) => void;
  customPakyawFare: number;
  onChangeCustomPakyawFare: (fare: number) => void;
  notes: string;
  onChangeNotes: (notes: string) => void;
  onBookRide: () => void;
  isBooking?: boolean;
  /** Real road distance from OSRM; null until the route resolves. */
  distanceKm: number | null;
  estimatedMinutes: number | null;
  distanceSource: 'driving' | 'foot' | 'estimate' | null;
  isRouting?: boolean;
  onClearPickup: () => void;
  onClearDropoff: () => void;
  /** Open the map picker for that end. Changing a location belongs on its bar. */
  onPinPickup?: () => void;
  onPinDropoff?: () => void;
  /** Abandon the booking entirely and go back. */
  onCancelBooking?: () => void;
}

export const RideBookingPanel: React.FC<RideBookingPanelProps> = ({
  locations = DUMAGUETE_LOCATIONS,
  pickup,
  dropoff,
  onSelectPickup,
  onSelectDropoff,
  onUseCurrentLocation,
  position,
  selectedVehicle,
  onSelectVehicle,
  passengers,
  onChangePassengers,
  paymentMethod,
  onChangePaymentMethod,
  isPakyawNegotiated,
  onTogglePakyaw,
  customPakyawFare,
  onChangeCustomPakyawFare,
  notes,
  onChangeNotes,
  onBookRide,
  isBooking = false,
  distanceKm: routedDistanceKm,
  estimatedMinutes,
  distanceSource,
  isRouting = false,
  onClearPickup,
  onClearDropoff,
  onPinPickup,
  onPinDropoff,
  onCancelBooking,
}) => {
  const [activeTab, setActiveTab] = useState<'ride' | 'pakyaw'>('ride');

  // Search state for pickup and dropoff
  const [pickupSearch, setPickupSearch] = useState('');
  const [dropoffSearch, setDropoffSearch] = useState('');
  const [locating, setLocating] = useState(false);
  const [isSearchingPickup, setIsSearchingPickup] = useState(false);
  const [isSearchingDropoff, setIsSearchingDropoff] = useState(false);

  // Distance comes from the routing engine in App, so the fare shown here and
  // the fare charged on booking are computed from the same road distance.
  // While the route is still resolving, show a neutral placeholder.
  const distanceKm = routedDistanceKm ?? 0;
  const hasRoute = routedDistanceKm !== null;

  const calculateFare = (mode: TransportMode): number =>
    totalFare(mode, distanceKm, passengers);

  // Real positions of on-duty riders, measured against this pickup, replacing
  // the fixed "3 mins away" strings that used to sit in the fare table.
  const { availability, isLoading: isLoadingRiders } = useNearbyRiders(pickup);

  /**
   * Vehicles that can actually seat the party.
   *
   * A habal-habal carries one passenger, so offering it to a group of four was
   * offering a booking the rider has to refuse on arrival. Charter is exempt
   * from the filter: it is priced for the whole vehicle, and the passenger is
   * agreeing a price for exactly that.
   */
  const availableModes = useMemo(() => {
    if (isPakyawNegotiated) return ['pakyaw_charter'] satisfies TransportMode[];
    // Derived from the rate card rather than written out. The list used to be
    // typed here and cast to TransportMode[], so when the retired vehicles were
    // removed the cast kept it compiling and it went on looking them up —
    // undefined.maxPassengers, and a blank booking screen on every trip.
    return TRANSPORT_MODES.filter(
      (mode) =>
        mode !== 'pakyaw_charter' && VEHICLE_DETAILS[mode].maxPassengers >= passengers
    );
  }, [isPakyawNegotiated, passengers]);

  /**
   * Keep the selection legal.
   *
   * Raising the party size while a habal-habal was selected used to leave it
   * selected but unlisted, so the booking went out for a vehicle the passenger
   * could no longer see and could not fit in.
   */
  useEffect(() => {
    if (availableModes.length === 0) return;
    if (!availableModes.includes(selectedVehicle)) onSelectVehicle(availableModes[0]);
  }, [availableModes, selectedVehicle, onSelectVehicle]);

  // Calculate minimum pakyaw fare based on ordinance (70 base + 5 per km after 1st km)
  const minimumPakyawFare = totalFare('pakyaw_charter', distanceKm, 1);

  // Initialize custom fare with ordinance minimum when switching to pakyaw mode
  const effectiveCustomFare = isPakyawNegotiated && customPakyawFare > 0
    ? customPakyawFare
    : minimumPakyawFare;

  const currentCalculatedFare =
    isPakyawNegotiated
      ? effectiveCustomFare
      : calculateFare(selectedVehicle);

  // Validate custom pakyaw fare is not below ordinance minimum
  const isCustomFareValid = !isPakyawNegotiated || effectiveCustomFare >= minimumPakyawFare;

  // Curated points match instantly; anything else is looked up as the passenger
  // pauses typing, so any Dumaguete shop, school or street is bookable.
  const pickupResults = usePlaceSearch(pickupSearch, locations, position);
  const dropoffResults = usePlaceSearch(dropoffSearch, locations, position);

  /*
   * "Set custom location" used to live here, and it invented the coordinates:
   *
   *     lat: 9.3082 + (Math.random() - 0.5) * 0.01
   *
   * Typing "my house" produced a point up to ~550m from a hardcoded centre,
   * labelled with whatever the passenger wrote, and the app then dispatched a
   * real driver to it. It has been removed rather than repaired — the map
   * button on each row already answers "somewhere with no name", and it
   * answers it with a coordinate the passenger chose.
   */

  return (
    <div className="bg-cream-50 rounded-card border border-cream-300 shadow-xs p-4 flex flex-col gap-4 text-trust-slate">
      {/* A way out. A passenger who changes their mind should not have to book
          a trip and cancel it to escape the form. */}
      {onCancelBooking && (
        <button
          onClick={onCancelBooking}
          className="-mb-1 flex items-center gap-1.5 self-start text-xs font-display font-bold text-cream-600 transition hover:text-trust-slate"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
      )}

      {/*
        Pickup and drop-off as one object, not two.
      */}
      <div className="relative rounded-card border border-cream-300 bg-cream-50 transition focus-within:border-trike-gold">
        {/* The rail runs the height of the card and the two markers sit over
            it on a white backing */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-7 left-[25px] border-l-2 border-dotted border-cream-300"
        />

        {/* Pickup ------------------------------------------------------- */}
        <div className="relative">
          <div className="flex items-center gap-3 px-3.5 py-3">
            {/* Hollow ring for the start, filled pin for the end */}
            <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center bg-cream-50">
              <span className="h-3 w-3 rounded-full border-2 border-sampaguita-green" />
            </span>

            <input
              type="text"
              value={isSearchingPickup ? pickupSearch : pickup ? pickup.name : ''}
              onFocus={() => {
                setIsSearchingPickup(true);
                setPickupSearch('');
              }}
              onChange={(e) => setPickupSearch(e.target.value)}
              onBlur={() => {
                // Delay closing to allow click events to register
                setTimeout(() => setIsSearchingPickup(false), 200);
              }}
              placeholder="Pickup location"
              className="min-w-0 flex-1 truncate bg-transparent text-sm font-sans font-bold text-trust-slate outline-none placeholder:font-medium placeholder:text-cream-500"
            />

            <div className="flex shrink-0 items-center gap-0.5">
              {onUseCurrentLocation && (
                <button
                  onClick={async () => {
                    setLocating(true);
                    try {
                      await onUseCurrentLocation();
                      setIsSearchingPickup(false);
                    } finally {
                      setLocating(false);
                    }
                  }}
                  disabled={locating}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-sampaguita-green transition hover:bg-sampaguita-green/10 active:scale-95 disabled:opacity-60"
                  title="Use your current GPS location"
                  aria-label="Use your current GPS location"
                >
                  {locating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LocateFixed className="h-4 w-4" />
                  )}
                </button>
              )}

              {pickup && !isSearchingPickup && (
                <button
                  onClick={() => {
                    // Clearing makes the next tap on the map set pickup again.
                    onClearPickup();
                    setPickupSearch('');
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-cream-400 transition hover:bg-sunset-coral/10 hover:text-sunset-coral"
                  title="Clear pickup"
                  aria-label="Clear pickup"
                >
                  <X className="h-4 w-4" />
                </button>
              )}

              {onPinPickup && (
                <button
                  onClick={onPinPickup}
                  aria-label="Choose pickup on the map"
                  title="Choose pickup on the map"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-cream-500 transition hover:bg-cream-200 hover:text-trust-slate active:scale-95"
                >
                  <MapIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {isSearchingPickup && (
            <SearchDropdown
              state={pickupResults}
              query={pickupSearch}
              onPick={(loc) => {
                onSelectPickup(loc);
                setIsSearchingPickup(false);
              }}
            />
          )}
        </div>

        {/* A hairline divider */}
        <div className="ml-[50px] mr-4 h-px bg-cream-300" />

        {/* Drop-off ----------------------------------------------------- */}
        <div className="relative">
          <div className="flex items-center gap-3 px-3.5 py-3">
            <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center bg-cream-50">
              <MapPin className="h-4 w-4 fill-sunset-coral text-sunset-coral" />
            </span>

            <input
              type="text"
              value={isSearchingDropoff ? dropoffSearch : dropoff ? dropoff.name : ''}
              onFocus={() => {
                setIsSearchingDropoff(true);
                setDropoffSearch('');
              }}
              onChange={(e) => setDropoffSearch(e.target.value)}
              onBlur={() => {
                // Delay closing to allow click events to register
                setTimeout(() => setIsSearchingDropoff(false), 200);
              }}
              placeholder="Destination"
              className="min-w-0 flex-1 truncate bg-transparent text-sm font-sans font-bold text-trust-slate outline-none placeholder:font-medium placeholder:text-cream-500"
            />

            <div className="flex shrink-0 items-center gap-0.5">
              {dropoff && !isSearchingDropoff && (
                <button
                  onClick={() => {
                    onClearDropoff();
                    setDropoffSearch('');
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-cream-400 transition hover:bg-sunset-coral/10 hover:text-sunset-coral"
                  title="Clear drop-off"
                  aria-label="Clear drop-off"
                >
                  <X className="h-4 w-4" />
                </button>
              )}

              {onPinDropoff && (
                <button
                  onClick={onPinDropoff}
                  aria-label="Choose drop-off on the map"
                  title="Choose drop-off on the map"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-cream-500 transition hover:bg-cream-200 hover:text-trust-slate active:scale-95"
                >
                  <MapIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {isSearchingDropoff && (
            <SearchDropdown
              state={dropoffResults}
              query={dropoffSearch}
              onPick={(loc) => {
                onSelectDropoff(loc);
                setIsSearchingDropoff(false);
              }}
            />
          )}
        </div>
      </div>

      {/* Render options ONLY when both pickup and dropoff are identified */}
      {pickup && dropoff ? (
        <>
          {/* How the fare is set — metered by the ordinance, or agreed for the
              whole vehicle. */}
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('ride');
                  onTogglePakyaw(false);
                  onSelectVehicle('pedicab_standard');
                }}
                className={`flex-1 rounded-pill py-2.5 text-xs font-display font-semibold transition ${
                  !isPakyawNegotiated
                    ? 'bg-trike-gold text-trust-slate shadow-xs'
                    : 'border border-cream-300 bg-cream-50 text-cream-600 hover:text-trust-slate hover:bg-cream-200'
                }`}
              >
                Regular (Shared)
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('pakyaw');
                  onTogglePakyaw(true);
                  onSelectVehicle('pakyaw_charter');
                  onChangeCustomPakyawFare(minimumPakyawFare);
                }}
                className={`flex-1 rounded-pill py-2.5 text-xs font-display font-semibold transition ${
                  isPakyawNegotiated
                    ? 'bg-trike-gold text-trust-slate shadow-xs'
                    : 'border border-cream-300 bg-cream-50 text-cream-600 hover:text-trust-slate hover:bg-cream-200'
                }`}
              >
                Charter (Private)
              </button>
            </div>
            <p className="text-[11px] font-sans font-medium text-cream-600 px-1">
              {isPakyawNegotiated
                ? '🔒 Private Charter: Hire the entire pedicab exclusively for your group.'
                : '👥 Regular: Standard ordinance fare per passenger along common route.'}
            </p>
          </div>

          {/* Passengers. */}
          {!isPakyawNegotiated && (
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 shrink-0 text-cream-500" />
              <span className="shrink-0 text-xs font-sans font-semibold text-cream-600">Passengers</span>
              <div className="ml-auto flex items-center gap-1">
                {[1, 2, 3, 4].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => onChangePassengers(num)}
                    className={`h-8 w-8 rounded-lg text-xs font-display font-bold transition ${
                      passengers === num
                        ? 'bg-trike-gold text-trust-slate shadow-xs'
                        : 'border border-cream-300 bg-cream-50 text-cream-600 hover:bg-cream-200'
                    }`}
                  >
                    {num}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => onChangePassengers(passengers >= 5 ? 1 : 5)}
                  className={`h-8 min-w-8 rounded-lg px-2 text-xs font-display font-bold transition ${
                    passengers >= 5
                      ? 'bg-trike-gold text-trust-slate shadow-xs'
                      : 'border border-cream-300 bg-cream-50 text-cream-600 hover:bg-cream-200'
                  }`}
                >
                  {passengers >= 5 ? passengers : '5+'}
                </button>
              </div>
            </div>
          )}

          {/* Select Vehicle Category List */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="kicker-label">
                Your ride
              </h2>
              {isRouting && !hasRoute ? (
                <span className="text-[11px] font-sans font-bold text-cream-500">measuring route…</span>
              ) : (
                distanceSource === 'estimate' && (
                  <span
                    className="text-[11px] font-sans font-bold text-sunset-coral"
                    title="Route server unreachable — distance estimated from map coordinates."
                  >
                    approximate distance
                  </span>
                )
              )}
            </div>

            <div className="space-y-2">
              {availableModes.length === 0 && (
                <div className="rounded-card border border-dashed border-cream-300 bg-cream-100 p-5 text-center">
                  <p className="text-sm font-display font-bold text-trust-slate">
                    No vehicle seats {passengers} passengers
                  </p>
                  <p className="mt-1 text-xs font-sans font-medium text-cream-600">
                    Reduce the party size, or book a Charter for the whole vehicle.
                  </p>
                </div>
              )}

              {availableModes.map((mode) => {
                const detail = VEHICLE_DETAILS[mode];
                const nearby = availability[mode];
                const isSelected = selectedVehicle === mode;
                const fare = calculateFare(mode);

                return (
                  <div
                    key={mode}
                    onClick={() => onSelectVehicle(mode)}
                    data-selected={isSelected}
                    className={`card-selectable p-3.5 cursor-pointer transition-all duration-150 relative ${
                      isSelected
                        ? '!border-2 !border-trike-gold shadow-sm'
                        : 'hover:-translate-y-0.5 hover:border-cream-400 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex justify-between items-center gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-card border text-3xl ${
                            isSelected
                              ? 'border-trike-gold/40 bg-trike-gold/20'
                              : 'border-cream-300 bg-cream-200'
                          }`}
                        >
                          {VEHICLE_EMOJI[mode] ?? '🛺'}
                        </div>
                        <div className="min-w-0">
                          <p className="font-display font-bold text-sm leading-tight truncate text-trust-slate">
                            {detail.title}
                          </p>
                          <p className="text-xs font-sans mt-0.5 truncate text-cream-600">
                            {detail.capacity} •{' '}
                            {isLoadingRiders
                              ? 'checking riders…'
                              : nearby.etaMinutes !== null
                                ? `nearest ${nearby.etaMinutes} min away`
                                : nearby.count > 0
                                  ? `${nearby.count} on duty`
                                  : 'none on duty'}
                          </p>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        {isPakyawNegotiated ? (
                          <>
                            <p className="text-lg font-display font-bold text-trust-slate">
                              {hasRoute ? `₱${minimumPakyawFare}` : '—'}
                            </p>
                            <span className="block text-[10px] font-sans font-bold text-cream-600">
                              {hasRoute ? `for ${distanceKm.toFixed(2)} km` : 'measuring route'}
                            </span>
                          </>
                        ) : (
                          <>
                            <p className="font-display font-extrabold text-lg text-trust-slate">
                              {hasRoute ? `₱${fare}` : '—'}
                            </p>
                            <span className="text-[10px] font-sans font-bold block text-cream-600">
                              {!hasRoute
                                ? 'measuring route'
                                : passengers > 1
                                ? `₱${farePerPassenger(mode, distanceKm)}/pax × ${passengers} pax`
                                : `for ${distanceKm.toFixed(2)} km`}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pakyaw Custom Fare Negotiator */}
          {isPakyawNegotiated && (
            <div className="space-y-3 rounded-card border-2 border-trike-gold/40 bg-cream-100 p-4">
              <p className="text-sm font-display font-bold text-trust-slate">
                What are you willing to pay for this trip?
              </p>

              <div
                className={`flex items-center gap-1 rounded-card border-2 bg-cream-50 pl-3.5 pr-1.5 ${
                  !isCustomFareValid && customPakyawFare > 0
                    ? 'border-sunset-coral bg-sunset-coral/10'
                    : 'border-trike-gold'
                }`}
              >
                <span className="text-2xl font-display font-bold text-trust-slate">₱</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={customPakyawFare === 0 ? '' : customPakyawFare}
                  onChange={(e) => {
                    const value = e.target.value === '' ? 0 : Number(e.target.value);
                    if (!isNaN(value)) onChangeCustomPakyawFare(value);
                  }}
                  placeholder={String(minimumPakyawFare)}
                  className="w-24 min-w-0 bg-transparent py-3 text-2xl font-display font-bold text-trust-slate focus:outline-none"
                />
                <div className="ml-auto flex shrink-0 flex-col">
                  <button
                    type="button"
                    onClick={() =>
                      onChangeCustomPakyawFare(
                        Math.max(minimumPakyawFare, (customPakyawFare || minimumPakyawFare) + 10)
                      )
                    }
                    className="flex h-6 w-8 items-center justify-center rounded-t-md text-trust-slate transition hover:bg-cream-200 active:scale-95"
                    aria-label="Raise your offer by 10 pesos"
                  >
                    <ChevronUp className="h-4 w-4" strokeWidth={3} />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeCustomPakyawFare(
                        Math.max(minimumPakyawFare, (customPakyawFare || minimumPakyawFare) - 10)
                      )
                    }
                    disabled={(customPakyawFare || minimumPakyawFare) <= minimumPakyawFare}
                    className="flex h-6 w-8 items-center justify-center rounded-b-md text-trust-slate transition hover:bg-cream-200 active:scale-95 disabled:opacity-30 disabled:hover:bg-transparent"
                    aria-label="Lower your offer by 10 pesos"
                  >
                    <ChevronDown className="h-4 w-4" strokeWidth={3} />
                  </button>
                </div>
              </div>

              {!isCustomFareValid ? (
                <p className="text-xs font-sans font-bold text-sunset-coral">
                  Too low — this trip cannot be booked below ₱{minimumPakyawFare}.
                </p>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs font-sans font-medium text-cream-700">
                    ₱{VEHICLE_DETAILS.pakyaw_charter.baseFare} minimum for the first km + ₱
                    {VEHICLE_DETAILS.pakyaw_charter.perKm} for each succeeding km.
                  </p>
                  <p className="text-xs font-sans font-medium text-cream-600">
                    You can increase your offer to attract more drivers.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Payment Method */}
          <div className="space-y-2 border-t border-cream-300 pt-3">
            <label className="kicker-label">
              Payment Method
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onChangePaymentMethod('cash')}
                className={`flex min-h-11 items-center justify-center rounded-card border text-xs font-display font-semibold transition ${
                  paymentMethod === 'cash'
                    ? 'border-2 border-trike-gold bg-trike-gold/20 text-trust-slate font-bold shadow-xs'
                    : 'border-cream-300 bg-cream-50 text-cream-600 hover:border-cream-400 hover:bg-cream-200'
                }`}
              >
                Cash
              </button>
              <button
                type="button"
                onClick={() => onChangePaymentMethod('gcash')}
                className={`flex min-h-11 items-center justify-center rounded-card border text-xs font-display font-semibold transition ${
                  paymentMethod === 'gcash'
                    ? 'border-2 border-trust-slate bg-trust-slate text-cream-50 font-bold shadow-xs'
                    : 'border-cream-300 bg-cream-50 text-cream-600 hover:border-cream-400 hover:bg-cream-200'
                }`}
              >
                GCash
              </button>
            </div>
          </div>

          <div className="space-y-2 border-t border-cream-300 pt-3">
            <label className="kicker-label flex items-baseline gap-1.5">
              Note to Driver
              <span className="text-[10px] font-sans font-medium normal-case tracking-normal text-cream-500">
                optional
              </span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => onChangeNotes(e.target.value)}
              placeholder="e.g. Waiting in front of Sans Rival, near the gate"
              className="w-full rounded-card border border-cream-300 bg-cream-50 px-3.5 py-2.5 text-xs font-sans font-medium text-trust-slate transition focus:border-trike-gold focus:outline-none"
            />
          </div>

          {/* Big Action CTA Button */}
          <div className="pt-2">
            <button
              onClick={onBookRide}
              disabled={isBooking || !hasRoute || (isPakyawNegotiated && !isCustomFareValid)}
              className="btn-primary w-full py-4 text-base font-display font-bold shadow-lg flex items-center justify-center gap-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBooking ? (
                <span>Sending your request...</span>
              ) : !hasRoute ? (
                <span>Measuring the route...</span>
              ) : isPakyawNegotiated && !isCustomFareValid ? (
                <span>Increase fare to minimum ordinance rate</span>
              ) : (
                <>
                  <span>Book GentleTrike (₱{currentCalculatedFare})</span>
                  <CheckCircle2 className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </>
      ) : (
        <div className="bg-cream-100 border border-cream-300 p-4 rounded-card text-center space-y-2">
          <div className="w-9 h-9 bg-cream-200 text-trust-slate rounded-full flex items-center justify-center mx-auto text-base font-bold">
            📍
          </div>
          <p className="text-xs font-display font-bold text-trust-slate">
            Set Pickup & Drop-off Locations
          </p>
          <p className="text-[11px] font-sans text-cream-600 leading-snug">
            Please select both your pickup point and drop-off destination above or tap on the map to view available vehicles and estimated fares.
          </p>
        </div>
      )}
    </div>
  );
};
