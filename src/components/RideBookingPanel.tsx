import React, { useState } from 'react';
import { LocationPoint, TransportMode } from '../types';
import { DUMAGUETE_LOCATIONS, VEHICLE_DETAILS } from '../data/dumagueteData';
import { farePerPassenger, totalFare } from '../utils/fare';
import {
  MapPin,
  Navigation,
  ArrowDownUp,
  Info,
  CheckCircle2,
  X,
  Users,
} from 'lucide-react';

interface RideBookingPanelProps {
  locations: LocationPoint[];
  pickup: LocationPoint | null;
  dropoff: LocationPoint | null;
  onSelectPickup: (loc: LocationPoint) => void;
  onSelectDropoff: (loc: LocationPoint) => void;
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

  const filteredPickupLocations = locations.filter(
    (loc) =>
      loc.name.toLowerCase().includes(pickupSearch.toLowerCase()) ||
      (loc.address && loc.address.toLowerCase().includes(pickupSearch.toLowerCase()))
  );

  const filteredDropoffLocations = locations.filter(
    (loc) =>
      loc.name.toLowerCase().includes(dropoffSearch.toLowerCase()) ||
      (loc.address && loc.address.toLowerCase().includes(dropoffSearch.toLowerCase()))
  );

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
            <MapPin className="w-4 h-4 text-blue-600 shrink-0" />
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
            <Navigation className="w-4 h-4 text-amber-600 shrink-0" />
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
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                Select Vehicle Category:
              </h2>
              <span
                className="text-xs font-extrabold text-amber-900 bg-amber-100 px-2.5 py-1 rounded-lg border border-amber-200 shadow-xs flex items-center gap-1"
                title={
                  distanceSource === 'estimate'
                    ? 'Route server unreachable — distance estimated from map coordinates.'
                    : 'Actual driving distance along Dumaguete streets.'
                }
              >
                <span>📏 Road Distance:</span>
                {isRouting && !hasRoute ? (
                  <span className="text-gray-500 font-bold">measuring…</span>
                ) : (
                  <>
                    <span className="text-gray-900 font-extrabold">
                      {distanceKm.toFixed(2)} km
                    </span>
                    {estimatedMinutes !== null && (
                      <span className="text-amber-800 font-bold">• ~{estimatedMinutes} min</span>
                    )}
                    {distanceSource === 'estimate' && (
                      <span className="text-[10px] text-amber-700 font-bold">(approx)</span>
                    )}
                  </>
                )}
              </span>
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

          {/* 1. Dedicated Payment Method Section */}
          <div className="pt-2 border-t border-gray-100 space-y-1.5">
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
              <span>💳 Select Payment Method:</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onChangePaymentMethod('cash')}
                className={`p-2.5 rounded-xl text-xs font-extrabold border transition flex items-center justify-center gap-2 shadow-xs ${
                  paymentMethod === 'cash'
                    ? 'bg-gray-900 text-amber-400 border-gray-900 ring-2 ring-gray-900/10'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <span>💵 Cash Payment</span>
              </button>
              <button
                type="button"
                onClick={() => onChangePaymentMethod('gcash')}
                className={`p-2.5 rounded-xl text-xs font-extrabold border transition flex items-center justify-center gap-2 shadow-xs ${
                  paymentMethod === 'gcash'
                    ? 'bg-blue-600 text-white border-blue-600 ring-2 ring-blue-600/20'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <span>📱 GCash e-Wallet</span>
              </button>
            </div>
          </div>

          {/* 2. Dedicated Driver Note Section */}
          <div className="pt-2 border-t border-gray-100 space-y-1.5">
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
              <span>📝 Note to Driver (Optional):</span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => onChangeNotes(e.target.value)}
              placeholder="e.g. Waiting in front of Sans Rival / near Silliman Portal..."
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-xs font-medium text-gray-900 focus:outline-none focus:bg-white focus:border-amber-400 focus:ring-2 focus:ring-amber-200/50 transition"
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
