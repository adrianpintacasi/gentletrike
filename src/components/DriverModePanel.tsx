import React from 'react';
import { Driver, RideBooking } from '../types';
import type { OpenRide } from '../api';
import { isExclusiveTrip } from '../../shared/dispatch';
import { useRouteOrderedRides } from '../hooks/useRouteOrderedRides';
import { VEHICLE_DETAILS , vehicleDetail } from '../../shared/transport';
import {
  Power,
  MapPin,
  ArrowRight,
  Users,
  Plus,
  Minus,
  X,
  CheckCircle,
  Phone,
  MessageSquare,
  AlertTriangle,
} from 'lucide-react';
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
  /** Records passengers picked up off the app, so capacity stays truthful. */
  onSetWalkInSeats?: (seats: number) => void;
}

/**
 * The next stage a rider moves a trip into, and the button that does it.
 *
 * Exported because the bottom sheet pins this same action above the fold, and a
 * second copy would drift the moment a stage is added.
 */
export const NEXT_STAGE: Record<
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
  onSetWalkInSeats,
}) => {
  // Loading state for online toggle
  const [isTogglingOnline, setIsTogglingOnline] = React.useState(false);

  /*
   * `earningsToday` and `tripsToday` used to be read here and shown on this
   * screen. They come from columns that are incremented on completion and never
   * reset, so they were career totals labelled "today" — and they sat beside the
   * real figures, disagreeing. The Menu now derives both from completed trips.
   */

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

  const handleToggleOnline = async () => {
    if (isTogglingOnline) return;
    setIsTogglingOnline(true);
    try {
      await onToggleOnline(!currentDriver.isOnline);
    } finally {
      setIsTogglingOnline(false);
    }
  };

  const verification = currentDriver.verificationStatus ?? 'verified';

  // Was hardcoded to 6, which is only right for a pedicab — a habal-habal seats
  // one and an EasyRide twelve. Same number the server enforces on accept.
  // The rider's own figure, not the vehicle class ceiling. Set in Settings and
  // clamped by the server, so this can be trusted as-is.
  const seatCapacity =
    currentDriver.seatCapacity ?? vehicleDetail(currentDriver.vehicleType).maxPassengers;

  /**
   * Passengers listed in the order the rider will next deal with them, so the
   * numbers here match the numbered pins on the map and the action pinned to
   * the top of the sheet.
   */
  const routeOrderedRides = useRouteOrderedRides(currentDriver, acceptedPooledRides);

  // Seats booked through the app, plus anyone flagged down on the road. The
  // server applies exactly the same sum before offering a trip.
  const walkIn = currentDriver.walkInSeats ?? 0;
  const bookedSeats = currentCapacityCount;
  const seatsFree = Math.max(0, seatCapacity - bookedSeats - walkIn);

  return (
    <div className="flex flex-col gap-3 text-gray-900">
      {/*
        Duty and seats, on one line.
        
        There were two duty buttons on screen at once — a full-width slab here
        and a black card in the pinned row above saying the same thing. Both are
        gone. What is left is an icon: green means on duty, and it is the only
        round control on the screen, so it is found by shape rather than read.
      */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleToggleOnline}
          disabled={isTogglingOnline}
          aria-pressed={currentDriver.isOnline}
          aria-label={currentDriver.isOnline ? 'End shift' : 'Start shift'}
          title={currentDriver.isOnline ? 'On duty — tap to end shift' : 'Off duty — tap to start'}
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full shadow-sm transition active:scale-95 ${
            currentDriver.isOnline
              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
              : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
          } ${isTogglingOnline ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          {isTogglingOnline ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <Power className="h-6 w-6" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-gray-900">
            {currentDriver.isOnline ? 'On duty' : 'Off duty'}
          </p>
          <p className="truncate text-[11px] font-semibold text-gray-500">
            {currentDriver.isOnline
              ? `${seatsFree} of ${seatCapacity} seats free`
              : 'Not receiving trips'}
          </p>
        </div>

        {/*
          Passengers the rider picked up off the app.
          
          A trike flagged down on the road is still a full trike, and until now
          the app had no way to know — so it went on offering seats that were
          physically occupied and the rider declined each one by hand. Two taps,
          and dispatch stops offering what does not fit.
        */}
        <div className="flex shrink-0 items-center gap-1 rounded-2xl border border-gray-200 p-1">
          <button
            onClick={() => onSetWalkInSeats?.(Math.max(0, walkIn - 1))}
            disabled={walkIn === 0}
            aria-label="Remove a walk-in passenger"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-600 transition active:scale-95 hover:bg-gray-100 disabled:text-gray-200 disabled:hover:bg-transparent"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="flex min-w-8 flex-col items-center leading-none">
            <span className="text-base font-bold text-gray-900 tabular-nums">{walkIn}</span>
            <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-gray-400">
              walk-in
            </span>
          </span>
          <button
            onClick={() => onSetWalkInSeats?.(Math.min(seatCapacity, walkIn + 1))}
            disabled={walkIn >= seatCapacity - bookedSeats}
            aria-label="Add a walk-in passenger"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-600 transition active:scale-95 hover:bg-gray-100 disabled:text-gray-200 disabled:hover:bg-transparent"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Verification only when it is a problem. A rider who is verified does
          not need telling; one who is not cannot go online and must know why. */}
      {verification !== 'verified' && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
          <p className="text-xs font-semibold text-amber-900">
            {verification === 'pending'
              ? 'Pending TMO verification — you cannot go on duty yet.'
              : `Rider account ${verification}.`}
          </p>
        </div>
      )}

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
                        className={`relative flex h-10 w-10 items-center justify-center rounded-lg transition active:scale-95 ${
                          chatRideId === ride.id
                            ? 'bg-amber-400 text-gray-900'
                            : 'bg-gray-700 text-amber-300 hover:bg-gray-600'
                        }`}
                      >
                        <MessageSquare className="h-5 w-5" />
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
          <button
            onClick={handleToggleOnline}
            disabled={isTogglingOnline}
            className={`w-12 h-12 bg-rose-600 text-white rounded-2xl flex items-center justify-center mx-auto shadow-sm ${isTogglingOnline ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            {isTogglingOnline ? (
              <span className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Power className="w-6 h-6" />
            )}
          </button>
          <div>
            <h4 className="font-extrabold text-base text-rose-950">Rider Status: OFFLINE</h4>
            <p className="text-xs text-rose-800 mt-1 max-w-sm mx-auto font-medium">
              You are currently offline. Turn ON your status to start receiving passenger trip requests across Dumaguete.
            </p>
          </div>
          <button
            onClick={handleToggleOnline}
            disabled={isTogglingOnline}
            className={`mt-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs px-5 py-2.5 rounded-xl shadow-sm transition active:scale-95 inline-flex items-center gap-1.5 ${
              isTogglingOnline ? 'opacity-60 cursor-not-allowed' : ''
            }`}
          >
            {isTogglingOnline ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Going Online...</span>
              </>
            ) : (
              <>
                <Power className="w-3.5 h-3.5" />
                <span>Go Online Now</span>
              </>
            )}
          </button>
        </div>
      ) : (
        /* ONLINE REQUESTS QUEUE */
        <div>
          <div className="mb-3 flex items-center gap-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
              {activeRequests.length === 0
                ? 'Waiting for requests'
                : `${activeRequests.length} request${activeRequests.length > 1 ? 's' : ''}`}
            </h4>
            {seatsFree === 0 && (
              <span className="rounded-md bg-gray-900 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                Full
              </span>
            )}
          </div>

          {activeRequests.length === 0 ? (
            /* The old empty state named Dumaguete and listed four Dumaguete
               landmarks as "popular zones", which is wrong everywhere else and
               was never true anywhere — nothing measured them. It now says only
               what is actually known: whether there is room, and that the app is
               listening. */
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center">
              <span className="mx-auto mb-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-xs">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
              </span>
              <p className="text-sm font-bold text-gray-900">
                {seatsFree === 0 ? 'No seats free' : 'Listening for nearby trips'}
              </p>
              <p className="mx-auto mt-1 max-w-[16rem] text-[11px] font-medium text-gray-500">
                {seatsFree === 0
                  ? 'Set a passenger down, or lower the walk-in count, to start receiving offers again.'
                  : 'Offers appear here the moment a passenger books nearby. You do not need to keep this open.'}
              </p>
            </div>
          ) : (
            /* One request per card, laid out top to bottom: where the trip
               goes, what it is worth, then the two decisions. The previous
               single-row layout truncated both place names to a few characters
               and put Accept beside Decline at thumb width, which is the pair
               you least want to mis-tap. */
            <div className="space-y-3">
              {activeRequests.map((req) => {
                const isCharter = isExclusiveTrip(req.vehicleType);

                return (
                /* Kept deliberately short — a rider scans this list on a phone,
                   so fitting three or four trips on screen matters more than
                   breathing room. Route, price and both actions in three rows. */
                <div
                  key={req.id}
                  className={`rounded-xl border p-3 transition hover:shadow-md ${
                    isCharter
                      ? 'border-2 border-indigo-300 bg-indigo-50 hover:border-indigo-400'
                      : 'border-gray-200 bg-white hover:border-amber-400 hover:bg-amber-50'
                  }`}
                >
                  {/* A charter is a different deal, not just a different price:
                      the fare is flat, the party hires the whole vehicle, and
                      accepting it means taking no one else. Worth saying before
                      a rider taps Accept, not after. */}
                  {isCharter && (
                    <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-white">
                      <Users className="h-3 w-3 shrink-0" />
                      <span>Pakyaw charter · whole vehicle, no other passengers</span>
                    </div>
                  )}

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
                    {isCharter && ' · flat fare, not per passenger'}
                    {req.notes ? ` · "${req.notes}"` : ''}
                  </p>

                  {/* 48px targets: larger touch targets for rapid driver decisions.
                      Accept takes the remaining width so the destructive choice
                      is never the easier tap. */}
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => onDeclineRequest(req.id)}
                      className="flex h-12 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-4 text-sm font-bold text-rose-700 transition active:scale-95 hover:bg-rose-200 hover:border-rose-400 hover:shadow-sm"
                    >
                      <X className="h-4 w-4" />
                      <span>Decline</span>
                    </button>
                    <button
                      onClick={() => {
                        // Earnings and trip count are credited on completion,
                        // not on acceptance — otherwise every ride counts twice.
                        onAcceptRequest(req.id);
                      }}
                      className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-lg text-base font-extrabold shadow-sm transition active:scale-95 hover:shadow-md ${
                        isCharter
                          ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                          : 'bg-amber-400 text-gray-900 hover:bg-amber-500'
                      }`}
                    >
                      <Plus className="h-5 w-5" />
                      <span>{isCharter ? `Accept charter · ₱${req.totalFare}` : 'Accept'}</span>
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
