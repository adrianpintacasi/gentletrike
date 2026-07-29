import React, { useState } from 'react';
import { LocationPoint, TransportMode } from '../types';
import { DUMAGUETE_LOCATIONS, VEHICLE_DETAILS } from '../data/dumagueteData';
import { farePerPassenger, totalFare } from '../utils/fare';
import { usePlaceSearch, type PlaceSearchState } from '../hooks/usePlaceSearch';
import {
  MapPin,
  Navigation,
  ArrowDownUp,
  Info,
  CheckCircle2,
  X,
  Users,
  LocateFixed,
  Search,
  Loader2,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';

/**
 * Emoji per vehicle. Left to render in the system font rather than filtered:
 * on the phones this app is actually used on these already read yellow, and a
 * hue shift only made them look wrong there to fix a desktop-only mismatch.
 */
const VEHICLE_EMOJI: Partial<Record<TransportMode, string>> = {
  pedicab_standard: '🛺',
  habal_habal: '🛵',
  multicab: '🚐',
  // Pakyaw is a chartered trike, so it carries the same glyph as the pedicab.
  pakyaw_charter: '🛺',
};

/**
 * Places found by the geocoder, listed under the app's own pickup points.
 *
 * Kept visually separate so the curated points — the ones with known fares and
 * driver familiarity — stay the obvious first choice, while any Dumaguete shop
 * or street remains reachable.
 */
const PlaceResults: React.FC<{
  state: PlaceSearchState;
  query: string;
  onPick: (loc: LocationPoint) => void;
}> = ({ state, query, onPick }) => {
  if (query.trim().length < 3) return null;

  if (state.searching && state.found.length === 0) {
    return (
      <div className="flex items-center gap-2 p-2 text-[11px] font-semibold text-gray-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Searching Dumaguete...
      </div>
    );
  }

  if (state.found.length === 0) return null;

  return (
    <>
      <div className="mt-1 flex items-center gap-1.5 border-t px-2 pt-2 text-[10px] font-bold uppercase text-gray-400">
        <Search className="h-3 w-3" />
        <span>More places in Dumaguete</span>
      </div>
      {state.found.map((loc) => (
        <button
          key={loc.id}
          onClick={() => onPick(loc)}
          className="flex w-full flex-col rounded-lg p-2 text-left text-xs font-bold transition hover:bg-amber-50"
        >
          <span className="font-bold text-gray-900">{loc.name}</span>
          {loc.address && (
            <span className="text-[10px] font-normal text-gray-500">{loc.address}</span>
          )}
        </button>
      ))}
    </>
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
  onSwapPickupDropoff: () => void;
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
  onOpenFareGuide: () => void;
  onClearPickup: () => void;
  onClearDropoff: () => void;
}

export const RideBookingPanel: React.FC<RideBookingPanelProps> = ({
  locations = DUMAGUETE_LOCATIONS,
  pickup,
  dropoff,
  onSelectPickup,
  onSelectDropoff,
  onUseCurrentLocation,
  onSwapPickupDropoff,
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
  onOpenFareGuide,
  onClearPickup,
  onClearDropoff,
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
  const pickupResults = usePlaceSearch(pickupSearch, locations);
  const dropoffResults = usePlaceSearch(dropoffSearch, locations);

  const filteredPickupLocations = pickupResults.curated;
  const filteredDropoffLocations = dropoffResults.curated;

  const handleAddCustomPickup = () => {
    if (!pickupSearch.trim()) return;
    const customLoc: LocationPoint = {
      id: `custom_p_${Date.now()}`,
      name: pickupSearch.trim(),
      address: 'Custom location in Dumaguete',
      lat: 9.3082 + (Math.random() - 0.5) * 0.01,
      lng: 123.3075 + (Math.random() - 0.5) * 0.01,
      isCustomPinned: true,
    };
    onSelectPickup(customLoc);
    setIsSearchingPickup(false);
  };

  const handleAddCustomDropoff = () => {
    if (!dropoffSearch.trim()) return;
    const customLoc: LocationPoint = {
      id: `custom_d_${Date.now()}`,
      name: dropoffSearch.trim(),
      address: 'Custom location in Dumaguete',
      lat: 9.3102 + (Math.random() - 0.5) * 0.01,
      lng: 123.3095 + (Math.random() - 0.5) * 0.01,
      isCustomPinned: true,
    };
    onSelectDropoff(customLoc);
    setIsSearchingDropoff(false);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-md p-5 md:p-6 flex flex-col gap-5 text-gray-900">
      {/* Top Header & Ride Mode Switch */}
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-gray-100">
        {/* min-w-0 lets this group shrink first; the City Matrix button keeps
            its width so it can never be pushed off the edge of the card. */}
        <div className="flex min-w-0 items-center gap-1 rounded-xl bg-gray-100 p-1">
          <button
            onClick={() => {
              setActiveTab('ride');
              onTogglePakyaw(false);
              // Auto-select pedicab when switching back to city trike mode
              onSelectVehicle('pedicab_standard');
            }}
            className={`min-w-0 truncate rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              activeTab === 'ride'
                ? 'bg-gray-900 text-amber-400 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            City Trike
          </button>
          <button
            onClick={() => {
              setActiveTab('pakyaw');
              onTogglePakyaw(true);
              // Auto-select pakyaw charter mode when switching to pakyaw tab
              onSelectVehicle('pakyaw_charter');
              // Initialize custom fare with ordinance minimum
              onChangeCustomPakyawFare(minimumPakyawFare);
            }}
            className={`min-w-0 truncate rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              activeTab === 'pakyaw'
                ? 'bg-gray-900 text-amber-400 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Pakyaw
          </button>
        </div>

        <button
          onClick={onOpenFareGuide}
          className="text-xs font-bold text-gray-700 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-xl border border-gray-200 transition flex items-center gap-1.5 shrink-0"
        >
          <Info className="w-3.5 h-3.5 text-amber-600" />
          <span>City Matrix</span>
        </button>
      </div>

      {/* Searchable Pickup & Destination Inputs */}
      <div className="space-y-3 relative">
        {/* Pickup Search Field */}
        <div className="relative">
          <div className="flex items-center gap-2.5 p-3 bg-gray-50 rounded-xl border border-gray-200 focus-within:border-gray-400 transition">
            <MapPin className="w-4 h-4 text-emerald-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-0.5">
                PICKUP LOCATION
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
                placeholder="Search street, school, or landmark..."
                className="w-full bg-transparent font-bold text-sm text-gray-900 focus:outline-none placeholder:text-gray-400 truncate"
              />
            </div>

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
                className="px-2 py-1 text-emerald-600 hover:text-emerald-800 text-xs font-bold rounded-lg shrink-0 flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 transition"
                title="Use your current GPS location"
              >
                {locating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LocateFixed className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">{locating ? 'Locating...' : 'Use Current'}</span>
              </button>
            )}

            {pickup && !isSearchingPickup && (
              <button
                onClick={() => {
                  // Clearing makes the next tap on the map set pickup again.
                  onClearPickup();
                  setPickupSearch('');
                }}
                className="px-2 py-1 text-gray-500 hover:text-rose-600 text-xs font-bold rounded-lg shrink-0 flex items-center gap-1"
                title="Clear pickup — the next map tap will set it again"
              >
                <X className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Clear</span>
              </button>
            )}
          </div>

          {/* Pickup Search Autocomplete Results */}
          {isSearchingPickup && (
            <div className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-xl border border-gray-200 shadow-xl z-30 p-2 max-h-56 overflow-y-auto">
              <div className="flex items-center justify-between p-2 border-b text-xs font-bold text-gray-500 uppercase">
                <span>Search Dumaguete Location:</span>
                <button
                  onClick={() => setIsSearchingPickup(false)}
                  className="text-gray-400 hover:text-gray-900"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* No "use my current location" here — the field itself already
                  carries a Use Current button, and repeating it inside the
                  dropdown made the same action appear twice on one screen. */}
              {filteredPickupLocations.map((loc) => (
                <button
                  key={loc.id}
                  onClick={() => {
                    onSelectPickup(loc);
                    setIsSearchingPickup(false);
                  }}
                  className="w-full text-left p-2 hover:bg-amber-50 rounded-lg transition text-xs font-bold flex flex-col group"
                >
                  <span className="text-gray-900 font-bold">{loc.name}</span>
                  {loc.address && (
                    <span className="text-[10px] text-gray-500 font-normal">
                      {loc.address}
                    </span>
                  )}
                </button>
              ))}

              <PlaceResults
                state={pickupResults}
                query={pickupSearch}
                onPick={(loc) => {
                  onSelectPickup(loc);
                  setIsSearchingPickup(false);
                }}
              />

              {pickupSearch.trim() && (
                <button
                  onClick={handleAddCustomPickup}
                  className="w-full text-left p-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-xs font-bold text-blue-700 mt-1 flex items-center gap-1.5"
                >
                  <span>Set custom location:</span>
                  <span className="underline truncate">"{pickupSearch}"</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Swap Divider (No overlapping negative margin) */}
        <div className="flex items-center justify-between px-2 py-0.5 relative z-10">
          <div className="h-[1px] flex-1 bg-gray-200" />
          <button
            type="button"
            onClick={onSwapPickupDropoff}
            className="mx-3 px-2.5 py-1 bg-gray-100 hover:bg-amber-400 text-gray-700 hover:text-gray-900 rounded-full border border-gray-200 shadow-xs transition-all flex items-center gap-1.5 text-[11px] font-bold active:scale-95"
            title="Swap pickup and dropoff locations"
          >
            <ArrowDownUp className="w-3.5 h-3.5" />
            <span>Swap Locations</span>
          </button>
          <div className="h-[1px] flex-1 bg-gray-200" />
        </div>

        {/* Dropoff Destination Search Field */}
        <div className="relative">
          <div className="flex items-center gap-2.5 p-3 bg-amber-50/60 rounded-xl border border-amber-200 focus-within:border-amber-400 transition">
            <Navigation className="w-4 h-4 text-red-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block mb-0.5">
                DESTINATION DROPOFF
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
                placeholder="Search destination street in Dumaguete..."
                className="w-full bg-transparent font-bold text-sm text-gray-900 focus:outline-none placeholder:text-gray-400 truncate"
              />
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {dropoff && !isSearchingDropoff && (
                <button
                  onClick={() => {
                    onClearDropoff();
                    setDropoffSearch('');
                  }}
                  className="px-2 py-1 text-gray-600 hover:text-rose-600 text-xs font-bold rounded-lg flex items-center gap-1"
                  title="Clear drop-off"
                >
                  <X className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Clear</span>
                </button>
              )}
            </div>
          </div>

          {/* Dropoff Search Autocomplete Results */}
          {isSearchingDropoff && (
            <div className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-xl border border-gray-200 shadow-xl z-30 p-2 max-h-56 overflow-y-auto">
              <div className="flex items-center justify-between p-2 border-b text-xs font-bold text-gray-500 uppercase">
                <span>Select Destination Point:</span>
                <button
                  onClick={() => setIsSearchingDropoff(false)}
                  className="text-gray-400 hover:text-gray-900"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {filteredDropoffLocations.map((loc) => (
                <button
                  key={loc.id}
                  onClick={() => {
                    onSelectDropoff(loc);
                    setIsSearchingDropoff(false);
                  }}
                  className="w-full text-left p-2 hover:bg-amber-50 rounded-lg transition text-xs font-bold flex flex-col group"
                >
                  <span className="text-gray-900 font-bold">{loc.name}</span>
                  {loc.address && (
                    <span className="text-[10px] text-gray-500 font-normal">
                      {loc.address}
                    </span>
                  )}
                </button>
              ))}

              <PlaceResults
                state={dropoffResults}
                query={dropoffSearch}
                onPick={(loc) => {
                  onSelectDropoff(loc);
                  setIsSearchingDropoff(false);
                }}
              />

              {dropoffSearch.trim() && (
                <button
                  onClick={handleAddCustomDropoff}
                  className="w-full text-left p-2 bg-amber-50 hover:bg-amber-100 rounded-lg text-xs font-bold text-amber-800 mt-1 flex items-center gap-1.5"
                >
                  <span>Set custom location:</span>
                  <span className="underline truncate">"{dropoffSearch}"</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Render options ONLY when both pickup and dropoff are identified */}
      {pickup && dropoff ? (
        <>
          {/* Passengers Selector - Simplified to reduce cognitive load */}
          <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-700 block mb-2 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-gray-700" />
              <span>Number of Passengers:</span>
            </label>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => onChangePassengers(num)}
                  className={`flex-1 py-2 rounded-lg text-sm font-extrabold transition relative ${
                    passengers === num
                      ? 'bg-gray-900 text-amber-400 shadow-xs ring-2 ring-gray-900/10'
                      : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onChangePassengers(passengers >= 5 ? 1 : 5)}
                className={`flex-1 py-2 rounded-lg text-sm font-extrabold transition ${
                  passengers >= 5
                    ? 'bg-gray-900 text-amber-400 shadow-xs ring-2 ring-gray-900/10'
                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-100'
                }`}
              >
                {passengers >= 5 ? passengers : '5+'}
              </button>
            </div>
          </div>

          {/* Select Vehicle Category List */}
          <div>
            {/* The distance chip that used to sit here duplicated the "for
                X km" already printed on every vehicle card. Only the two cases
                the cards cannot express stay: still measuring, and a figure
                that is estimated rather than measured along real streets. */}
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-700">
                Select Vehicle Category
              </h2>
              {isRouting && !hasRoute ? (
                <span className="text-[11px] font-bold text-gray-500">measuring route…</span>
              ) : (
                distanceSource === 'estimate' && (
                  <span
                    className="text-[11px] font-bold text-amber-700"
                    title="Route server unreachable — distance estimated from map coordinates."
                  >
                    approximate distance
                  </span>
                )
              )}
            </div>

            <div className="space-y-2">
              {(
                isPakyawNegotiated
                  ? (['pakyaw_charter'] as TransportMode[])
                  : (['pedicab_standard', 'habal_habal', 'multicab'] as TransportMode[])
              ).map((mode) => {
                const detail = VEHICLE_DETAILS[mode];
                const isSelected = selectedVehicle === mode;
                const fare = calculateFare(mode);

                return (
                  <div
                    key={mode}
                    onClick={() => onSelectVehicle(mode)}
                    className={`p-3.5 rounded-xl cursor-pointer transition-all relative ${
                      isSelected
                        ? 'bg-gray-900 text-amber-400 shadow-xs ring-2 ring-gray-900/10'
                        : 'bg-white border border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {mode === 'pedicab_standard' && (
                      <span className="absolute -top-2 -right-2 bg-amber-400 text-gray-900 text-[9px] font-extrabold px-2 py-0.5 rounded-full shadow-xs">
                        POPULAR
                      </span>
                    )}
                    <div className="flex justify-between items-center gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-xl ${
                            isSelected
                              ? 'border-amber-400/30 bg-amber-400/15'
                              : 'border-amber-200 bg-amber-50'
                          }`}
                        >
                          {VEHICLE_EMOJI[mode] ?? '🛺'}
                        </div>
                        <div className="min-w-0">
                          <p className={`font-bold text-sm leading-tight truncate ${isSelected ? 'text-amber-400' : 'text-gray-900'}`}>
                            {detail.title}
                          </p>
                          <p className={`text-xs mt-0.5 truncate ${isSelected ? 'text-gray-400' : 'text-gray-500'}`}>
                            {detail.capacity} • {detail.eta} away
                          </p>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        {isPakyawNegotiated ? (
                          <>
                            {/* Presented the same way as every other vehicle: a
                                fare for this distance. Labelling it "Estimated"
                                over "ordinance minimum" made a correctly
                                calculated figure look like a flat floor. */}
                            <p className={`text-lg font-extrabold ${isSelected ? 'text-amber-400' : 'text-gray-900'}`}>
                              {hasRoute ? `₱${minimumPakyawFare}` : '—'}
                            </p>
                            <span className={`block text-[10px] font-bold ${isSelected ? 'text-gray-400' : 'text-gray-500'}`}>
                              {hasRoute ? `for ${distanceKm.toFixed(2)} km` : 'measuring route'}
                            </span>
                          </>
                        ) : (
                          <>
                            <p className={`font-extrabold text-lg ${isSelected ? 'text-amber-400' : 'text-gray-900'}`}>
                              {hasRoute ? `₱${fare}` : '—'}
                            </p>
                            <span className={`text-[10px] font-bold block ${isSelected ? 'text-gray-400' : 'text-gray-500'}`}>
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
            <div className="space-y-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-bold text-amber-950">
                What are you willing to pay for this trip?
              </p>

              {/* Steppers live inside the field, against the amount they change.
                  Separate +/- buttons flanking a boxed number read as a
                  calculator keypad rather than a single value being adjusted. */}
              <div
                className={`flex items-center gap-1 rounded-xl border-2 bg-white pl-3.5 pr-1.5 ${
                  !isCustomFareValid && customPakyawFare > 0
                    ? 'border-red-400 bg-red-50'
                    : 'border-amber-400'
                }`}
              >
                <span className="text-2xl font-extrabold text-gray-900">₱</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={customPakyawFare === 0 ? '' : customPakyawFare}
                  onChange={(e) => {
                    const value = e.target.value === '' ? 0 : Number(e.target.value);
                    if (!isNaN(value)) onChangeCustomPakyawFare(value);
                  }}
                  placeholder={String(minimumPakyawFare)}
                  className="w-24 min-w-0 bg-transparent py-3 text-2xl font-extrabold text-gray-900 focus:outline-none"
                />
                <div className="ml-auto flex shrink-0 flex-col">
                  <button
                    type="button"
                    onClick={() =>
                      onChangeCustomPakyawFare(
                        Math.max(minimumPakyawFare, (customPakyawFare || minimumPakyawFare) + 10)
                      )
                    }
                    className="flex h-6 w-8 items-center justify-center rounded-t-md text-amber-800 transition hover:bg-amber-100 active:scale-95"
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
                    className="flex h-6 w-8 items-center justify-center rounded-b-md text-amber-800 transition hover:bg-amber-100 active:scale-95 disabled:opacity-30 disabled:hover:bg-transparent"
                    aria-label="Lower your offer by 10 pesos"
                  >
                    <ChevronDown className="h-4 w-4" strokeWidth={3} />
                  </button>
                </div>
              </div>

              {!isCustomFareValid ? (
                <p className="text-xs font-bold text-red-700">
                  Too low — this trip cannot be booked below ₱{minimumPakyawFare}.
                </p>
              ) : (
                <div className="space-y-1">
                  {/* The rule itself, so a passenger can check the figure above
                      rather than take it on trust. */}
                  <p className="text-xs font-medium text-amber-800">
                    ₱{VEHICLE_DETAILS.pakyaw_charter.baseFare} minimum for the first km + ₱
                    {VEHICLE_DETAILS.pakyaw_charter.perKm} for each succeeding km.
                  </p>
                  <p className="text-xs font-medium text-amber-700">
                    You can increase your offer to attract more riders.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Payment. Emoji dropped — the selected state is already carried by
              colour and weight, and a wallet glyph next to the word "Payment"
              adds nothing a passenger reads. */}
          <div className="space-y-2 border-t border-gray-100 pt-3">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-700">
              Payment Method
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onChangePaymentMethod('cash')}
                className={`flex min-h-11 items-center justify-center rounded-xl border text-xs font-extrabold transition ${
                  paymentMethod === 'cash'
                    ? 'border-gray-900 bg-gray-900 text-amber-400 shadow-xs'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                Cash
              </button>
              <button
                type="button"
                onClick={() => onChangePaymentMethod('gcash')}
                className={`flex min-h-11 items-center justify-center rounded-xl border text-xs font-extrabold transition ${
                  paymentMethod === 'gcash'
                    ? 'border-blue-600 bg-blue-600 text-white shadow-xs'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                GCash
              </button>
            </div>
          </div>

          <div className="space-y-2 border-t border-gray-100 pt-3">
            <label className="flex items-baseline gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-700">
              Note to Rider
              <span className="text-[10px] font-medium normal-case tracking-normal text-gray-400">
                optional
              </span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => onChangeNotes(e.target.value)}
              placeholder="e.g. Waiting in front of Sans Rival, near the gate"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-xs font-medium text-gray-900 transition focus:border-amber-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-200/50"
            />
          </div>

          {/* Big Action CTA Button - Primary action, made larger and more prominent */}
          <div className="pt-2">
            <button
              onClick={onBookRide}
              disabled={isBooking || !hasRoute || (isPakyawNegotiated && !isCustomFareValid)}
              className="w-full py-4 rounded-xl font-extrabold text-lg bg-amber-400 hover:bg-amber-300 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-gray-900 cursor-pointer shadow-lg transition active:scale-95 flex items-center justify-center gap-2.5"
            >
              {isBooking ? (
                <span>Sending your request...</span>
              ) : !hasRoute ? (
                // Never quote a fare before the road distance is known.
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
        <div className="bg-amber-50/80 border border-amber-200 p-4 rounded-xl text-center space-y-2">
          <div className="w-9 h-9 bg-amber-100 text-amber-800 rounded-full flex items-center justify-center mx-auto text-base font-bold">
            📍
          </div>
          <p className="text-xs font-bold text-gray-900">
            Set Pickup & Drop-off Locations
          </p>
          <p className="text-[11px] text-gray-600 leading-snug">
            Please select both your pickup point and drop-off destination above or tap on the map to view available vehicles and estimated fares.
          </p>
        </div>
      )}
    </div>
  );
};
