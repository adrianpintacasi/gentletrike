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
} from 'lucide-react';

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

  const currentCalculatedFare =
    isPakyawNegotiated && customPakyawFare > 0
      ? customPakyawFare
      : calculateFare(selectedVehicle);

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
        <div className="flex items-center gap-1.5 p-1 bg-gray-100 rounded-xl">
          <button
            onClick={() => {
              setActiveTab('ride');
              onTogglePakyaw(false);
            }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${
              activeTab === 'ride'
                ? 'bg-amber-400 text-gray-900 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            🛺 City Trike
          </button>
          <button
            onClick={() => {
              setActiveTab('pakyaw');
              onTogglePakyaw(true);
            }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${
              activeTab === 'pakyaw'
                ? 'bg-amber-400 text-gray-900 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            🤝 Pakyaw Charter
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
                placeholder="Search street, school, or landmark..."
                className="w-full bg-transparent font-bold text-sm text-gray-900 focus:outline-none placeholder:text-gray-400 truncate"
              />
            </div>

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
                  className="mb-1 flex w-full items-center gap-2 rounded-lg bg-emerald-50 p-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-60"
                >
                  {locating ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  ) : (
                    <LocateFixed className="h-4 w-4 shrink-0" />
                  )}
                  <span>{locating ? 'Finding you...' : 'Use my current location'}</span>
                </button>
              )}

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
          {/* Passengers Selector */}
          <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-700 block mb-2 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-gray-700" />
              <span>Number of Passengers:</span>
            </label>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5, 6].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => onChangePassengers(num)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-extrabold transition ${
                    passengers === num
                      ? 'bg-gray-900 text-amber-400 shadow-xs ring-2 ring-gray-900/10'
                      : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {num}
                </button>
              ))}
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
                ['pedicab_standard', 'habal_habal', 'multicab'] as TransportMode[]
              ).map((mode) => {
                const detail = VEHICLE_DETAILS[mode];
                const isSelected = selectedVehicle === mode;
                const fare = calculateFare(mode);

                return (
                  <div
                    key={mode}
                    onClick={() => onSelectVehicle(mode)}
                    className={`p-3.5 rounded-xl cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-amber-50 text-gray-900 border-2 border-amber-400 shadow-sm'
                        : 'bg-white border border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex justify-between items-center gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center text-xl shrink-0 border border-gray-200">
                          {mode === 'pedicab_standard' && '🛺'}
                          {mode === 'habal_habal' && '🛵'}
                          {mode === 'multicab' && '🚐'}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-gray-900 text-sm leading-tight truncate">
                            {detail.title}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5 truncate">
                            {detail.capacity} • {detail.eta} away
                          </p>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <p className="font-extrabold text-gray-900 text-lg">
                          {hasRoute ? `₱${fare}` : '—'}
                        </p>
                        <span className="text-[10px] text-gray-500 font-bold block">
                          {!hasRoute
                            ? 'measuring route'
                            : passengers > 1
                            ? `₱${farePerPassenger(mode, distanceKm)}/pax × ${passengers} pax`
                            : `for ${distanceKm.toFixed(2)} km`}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pakyaw Custom Fare Negotiator */}
          {isPakyawNegotiated && (
            <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 space-y-2">
              <p className="text-xs font-bold uppercase text-amber-900">
                🤝 Custom Negotiated Pakyaw Fare:
              </p>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base text-gray-900">₱</span>
                <input
                  type="number"
                  value={customPakyawFare || ''}
                  onChange={(e) => onChangeCustomPakyawFare(Number(e.target.value))}
                  placeholder="e.g. 150 (Valencia / Airport / Pulangbato)"
                  className="flex-1 bg-white border border-amber-300 rounded-lg px-3 py-1.5 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
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

          {/* Big Action CTA Button */}
          <div className="pt-1">
            <button
              onClick={onBookRide}
              disabled={isBooking || !hasRoute}
              className="w-full py-3.5 rounded-xl font-bold text-sm bg-amber-400 hover:bg-amber-300 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-gray-900 cursor-pointer shadow-md transition active:scale-95 flex items-center justify-center gap-2"
            >
              {isBooking ? (
                <span>Sending your request...</span>
              ) : !hasRoute ? (
                // Never quote a fare before the road distance is known.
                <span>Measuring the route...</span>
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
