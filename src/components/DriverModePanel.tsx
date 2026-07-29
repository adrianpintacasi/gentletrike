import React from 'react';
import { Driver, RideBooking } from '../types';
import type { OpenRide } from '../api';
import { sequenceStops } from '../../shared/dispatch';
import { VEHICLE_DETAILS } from '../../shared/transport';
import { Power, MapPin, ArrowRight, Users, Plus, X, CheckCircle, Phone, MessageSquare } from 'lucide-react';
import { RiderChatPanel } from './RiderChatPanel';
import { useUnreadMessages } from '../hooks/useUnreadMessages';

interface DriverModePanelProps {
  currentDriver: Driver;
  /** Already filtered and ranked by the server to trips that fit this rider. */
  activeRequests: OpenRide[];
  acceptedPooledRides?: RideBooking[];
  onAcceptRequest: (rideId: string) => void;
  onDeclineRequest: (rideId: string) => void;
  onAdvanceRideStatus: (rideId: string, status: RideBooking['status']) => void;
  onToggleOnline: (isOnline: boolean) => void;
}

/** The next stage a rider moves a trip into, and the button that does it. */
const NEXT_STAGE: Record<
  string,
  { status: RideBooking['status']; label: string } | undefined
> = {
  driver_assigned: { status: 'driver_arriving', label: "I'm arriving at pickup" },
  driver_arriving: { status: 'in_transit', label: 'Passenger onboard — start trip' },
};

export const DriverModePanel: React.FC<DriverModePanelProps> = ({
  currentDriver,
  activeRequests,
  acceptedPooledRides = [],
  onAcceptRequest,
  onDeclineRequest,
  onAdvanceRideStatus,
  onToggleOnline,
}) => {
  // Earnings and trip counts are the server's numbers, credited on completion.
  const earningsToday = currentDriver.earningsToday ?? 0;
  const tripsCompletedToday = currentDriver.tripsToday ?? 0;

  // Only one thread open at a time — a rider glancing at their phone should
  // see one conversation, not a stack of them.
  const [chatRideId, setChatRideId] = React.useState<string | null>(null);

  // Polled in the background so a passenger message is announced even while
  // the rider is looking at the queue rather than the thread.
  const { unread, markRead } = useUnreadMessages(
    React.useMemo(() => acceptedPooledRides.map((r) => r.id), [acceptedPooledRides]),
    'driver'
  );

  const currentCapacityCount = acceptedPooledRides.reduce((sum, r) => sum + r.passengers, 0);

  // Was hardcoded to 6, which is only right for a pedicab — a habal-habal seats
  // one and an EasyRide twelve. Same number the server enforces on accept.
  const seatCapacity = VEHICLE_DETAILS[currentDriver.vehicleType]?.maxPassengers ?? 6;

  /**
   * Passengers listed in the order the rider will next deal with them, so the
   * numbers here match the numbered pins on the map. Listing by booking time
   * put a passenger who is minutes away at the top simply because they tapped
   * first, which is not the order anyone drives in.
   */
  const routeOrderedRides = React.useMemo(() => {
    if (acceptedPooledRides.length < 2) return acceptedPooledRides;

    const origin = { lat: currentDriver.currentLat, lng: currentDriver.currentLng };
    const nextStopOrder = new Map<string, number>();

    for (const stop of sequenceStops(
      origin,
      acceptedPooledRides.map((r) => ({
        rideId: r.id,
        pickup:
          r.status === 'in_transit'
            ? null
            : { lat: r.pickupLocation.lat, lng: r.pickupLocation.lng },
        dropoff: { lat: r.dropoffLocation.lat, lng: r.dropoffLocation.lng },
      }))
    )) {
      // First time this trip appears is the next thing the rider does for it.
      if (!nextStopOrder.has(stop.rideId)) nextStopOrder.set(stop.rideId, stop.order);
    }

    return [...acceptedPooledRides].sort(
      (a, b) => (nextStopOrder.get(a.id) ?? 0) - (nextStopOrder.get(b.id) ?? 0)
    );
  }, [acceptedPooledRides, currentDriver.currentLat, currentDriver.currentLng]);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 text-gray-900 shadow-md md:p-5">
      {/* Rider header. The online toggle sits here, in the space the identity
          block left empty, so the control a rider reaches for most is the
          largest target on the card. Switching back to the passenger app lives
          in the navbar. */}
      <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
        <img
          src={currentDriver.avatar}
          alt={currentDriver.name}
          className="h-12 w-12 shrink-0 rounded-xl border border-gray-200 object-cover shadow-xs"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-bold text-gray-900">{currentDriver.name}</h3>
            <span className="shrink-0 rounded-md border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
              {currentDriver.unitNumber}
            </span>
          </div>
          <p className="truncate text-xs font-medium text-gray-500">
            Verified Dumaguete Rider • ★ {currentDriver.rating}
          </p>
        </div>

        <button
          onClick={() => onToggleOnline(!currentDriver.isOnline)}
          className={`flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-extrabold shadow-xs transition active:scale-95 ${
            currentDriver.isOnline
              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
              : 'bg-rose-600 text-white hover:bg-rose-700'
          }`}
        >
          <Power className="h-4 w-4" />
          <span>{currentDriver.isOnline ? 'ONLINE' : 'OFFLINE'}</span>
        </button>
      </div>

      {/* Today's numbers. Three equal columns with the labels and values on
          shared baselines, so the row scans left to right instead of the third
          item dropping to its own line at narrow widths. */}
      <div className="grid grid-cols-3 divide-x divide-amber-200 rounded-xl border border-amber-200 bg-amber-50">
        <div className="px-3 py-3 text-center">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-amber-900">
            Earnings
          </span>
          <p className="mt-1 text-xl font-extrabold leading-none text-gray-900">₱{earningsToday}</p>
        </div>
        <div className="px-3 py-3 text-center">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-amber-900">
            Trips
          </span>
          <p className="mt-1 text-xl font-extrabold leading-none text-gray-900">
            {tripsCompletedToday}
          </p>
        </div>
        <div className="px-3 py-3 text-center">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-amber-900">
            Seats
          </span>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-xl font-extrabold leading-none text-gray-900">
            <Users className="h-4 w-4 text-amber-800" />
            {currentCapacityCount}/{seatCapacity}
          </p>
        </div>
      </div>

      {/* Accepted Passengers Pool — the rider drives each trip through its stages */}
      {acceptedPooledRides.length > 0 && (
        <div className="space-y-2.5 rounded-xl border border-gray-800 bg-gray-900 p-3 text-white">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">
              Passengers Onboard
            </h4>
            <span className="rounded-md bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-gray-900">
              {acceptedPooledRides.length} active
            </span>
          </div>

          <div className="space-y-2">
            {routeOrderedRides.map((ride, idx) => {
              const nextStage = NEXT_STAGE[ride.status];

              return (
                <div
                  key={ride.id}
                  className="space-y-2 rounded-lg border border-gray-700 bg-gray-800 p-2.5"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[11px] font-black text-gray-900">
                      {idx + 1}
                    </span>

                    {/* Full place names. Truncating to the first word turned
                        "Doctor Venancio Aldecoa Drive" into "Doctor". */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold leading-snug text-white">
                        {ride.pickupLocation.name}
                      </p>
                      <p className="flex items-center gap-1 truncate text-xs font-bold leading-snug text-amber-300">
                        <ArrowRight className="h-3 w-3 shrink-0 text-gray-500" />
                        {ride.dropoffLocation.name}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-gray-400">
                        {ride.passengerName ? `${ride.passengerName} · ` : ''}
                        {ride.passengers} pax · {ride.distanceKm} km
                      </p>
                    </div>

                    {/* Reaching the passenger is half the job — "I'm at the
                        corner, where are you?" Chat works for everyone; calling
                        needs a number, and riders often sign up without one, so
                        the button is disabled rather than dialling nothing. */}
                    <div className="flex shrink-0 gap-1.5">
                      {ride.passengerPhone ? (
                        <a
                          href={`tel:${ride.passengerPhone}`}
                          title={`Call ${ride.passengerName ?? 'passenger'}`}
                          className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-700 text-amber-300 transition active:scale-95 hover:bg-gray-600"
                        >
                          <Phone className="h-4 w-4" />
                        </a>
                      ) : (
                        <span
                          title="This passenger has no contact number on file"
                          className="flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-lg bg-gray-800 text-gray-600"
                        >
                          <Phone className="h-4 w-4" />
                        </span>
                      )}
                      <button
                        onClick={() => {
                          const opening = chatRideId !== ride.id;
                          setChatRideId(opening ? ride.id : null);
                          if (opening) void markRead(ride.id);
                        }}
                        title="Message passenger"
                        className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition active:scale-95 ${
                          chatRideId === ride.id
                            ? 'bg-amber-400 text-gray-900'
                            : 'bg-gray-700 text-amber-300 hover:bg-gray-600'
                        }`}
                      >
                        <MessageSquare className="h-4 w-4" />
                        {(unread[ride.id] ?? 0) > 0 && chatRideId !== ride.id && (
                          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black text-white">
                            {unread[ride.id]}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>

                  {chatRideId === ride.id && (
                    <RiderChatPanel ride={ride} onClose={() => setChatRideId(null)} />
                  )}

                  <div className="flex gap-2">
                    {nextStage && (
                      <button
                        onClick={() => onAdvanceRideStatus(ride.id, nextStage.status)}
                        className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-400 px-2 text-xs font-extrabold text-gray-900 shadow-xs transition active:scale-95 hover:bg-amber-300"
                      >
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{nextStage.label}</span>
                      </button>
                    )}
                    <button
                      onClick={() => onAdvanceRideStatus(ride.id, 'completed')}
                      className={`flex h-10 items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-xs font-extrabold text-white shadow-xs transition active:scale-95 hover:bg-emerald-600 ${
                        nextStage ? 'shrink-0' : 'flex-1'
                      }`}
                    >
                      <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>₱{ride.totalFare}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Incoming Requests Queue or Offline Banner */}
      {!currentDriver.isOnline ? (
        /* OFFLINE STATUS CARD - Nothing / No requests appear when offline */
        <div className="p-8 bg-rose-50 border border-rose-200 rounded-2xl text-center space-y-3 shadow-xs">
          <div className="w-12 h-12 bg-rose-600 text-white rounded-2xl flex items-center justify-center mx-auto shadow-sm">
            <Power className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-extrabold text-base text-rose-950">Rider Status: OFFLINE</h4>
            <p className="text-xs text-rose-800 mt-1 max-w-sm mx-auto font-medium">
              You are currently offline. Turn ON your status to start receiving passenger trip requests across Dumaguete.
            </p>
          </div>
          <button
            onClick={() => onToggleOnline(true)}
            className="mt-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs px-5 py-2.5 rounded-xl shadow-sm transition active:scale-95 inline-flex items-center gap-1.5"
          >
            <Power className="w-3.5 h-3.5" />
            <span>Go Online Now</span>
          </button>
        </div>
      ) : (
        /* ONLINE REQUESTS QUEUE */
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Passenger Requests ({activeRequests.length}):</span>
            </h4>
          </div>

          {activeRequests.length === 0 ? (
            <div className="p-6 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-center text-gray-500 text-xs font-medium">
              <p className="text-gray-900 font-bold text-sm">Searching for nearby Dumaguete passengers...</p>
              <p className="text-gray-500 mt-1">
                Popular zones: Silliman Portal, Boulevard, Public Market, and Robinsons.
              </p>
            </div>
          ) : (
            /* One request per card, laid out top to bottom: where the trip
               goes, what it is worth, then the two decisions. The previous
               single-row layout truncated both place names to a few characters
               and put Accept beside Decline at thumb width, which is the pair
               you least want to mis-tap. */
            <div className="space-y-3">
              {activeRequests.map((req) => (
                /* Kept deliberately short — a rider scans this list on a phone,
                   so fitting three or four trips on screen matters more than
                   breathing room. Route, price and both actions in three rows. */
                <div
                  key={req.id}
                  className="rounded-xl border border-gray-200 bg-white p-3 transition hover:border-amber-400"
                >
                  <div className="flex gap-2.5">
                    <div className="flex flex-col items-center pt-1">
                      <span className="h-2 w-2 rounded-full border-2 border-emerald-600" />
                      <span className="my-0.5 w-px flex-1 bg-gray-300" />
                      <span className="h-2 w-2 rounded-full bg-red-600" />
                    </div>

                    {/* Full names on two lines. Truncating to one word turned
                        "Doctor Venancio Aldecoa Drive" into "Doctor". */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold leading-snug text-gray-900">
                        {req.pickupLocation.name}
                      </p>
                      <p className="truncate text-[13px] font-bold leading-snug text-gray-900">
                        {req.dropoffLocation.name}
                      </p>
                    </div>

                    <div className="shrink-0 text-right leading-none">
                      <p className="text-lg font-extrabold text-gray-900">₱{req.totalFare}</p>
                      <p className="mt-0.5 text-[9px] font-bold uppercase text-gray-400">
                        {req.paymentMethod}
                      </p>
                    </div>
                  </div>

                  {/* Plain text rather than chips — same information, roughly a
                      third of the height. */}
                  <p className="mt-1.5 truncate text-[11px] font-bold text-gray-500">
                    {typeof req.detourKm === 'number' && (
                      <span
                        className={
                          acceptedPooledRides.length === 0 || req.alongTheWay
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                        }
                      >
                        {acceptedPooledRides.length === 0
                          ? `${Math.round((req.pickupDistanceKm ?? 0) * 1000)} m away`
                          : req.alongTheWay
                            ? `on route +${Math.round(req.detourKm * 1000)} m`
                            : `+${Math.round(req.detourKm * 1000)} m off route`}
                        {' · '}
                      </span>
                    )}
                    {req.passengers} pax · {req.distanceKm} km
                    {req.notes ? ` · "${req.notes}"` : ''}
                  </p>

                  {/* 40px targets: comfortably tappable while keeping the card
                      compact. Accept takes the remaining width so the
                      destructive choice is never the easier tap. */}
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => onDeclineRequest(req.id)}
                      className="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-bold text-rose-700 transition active:scale-95 hover:bg-rose-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>Decline</span>
                    </button>
                    <button
                      onClick={() => {
                        // Earnings and trip count are credited on completion,
                        // not on acceptance — otherwise every ride counts twice.
                        onAcceptRequest(req.id);
                      }}
                      className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-400 text-sm font-extrabold text-gray-900 shadow-xs transition active:scale-95 hover:bg-amber-300"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Accept</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
