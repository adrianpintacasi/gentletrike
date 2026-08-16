import React from 'react';
import { Driver, RideBooking } from '../types';
import type { OpenRide } from '../api';
import { isExclusiveTrip } from '../../shared/dispatch';
import { useRouteOrderedRides } from '../hooks/useRouteOrderedRides';
import { IncomingRequestCard } from './IncomingRequestCard';
import { haversineKm } from '../../shared/geo';
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
  Check,
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
  /*
   * Nearest pickup first.
   *
   * The server ranks by how well a trip fits the rider's existing route, which
   * is the right order for deciding *whether* to pool. For a rider with nothing
   * accepted it reads as arbitrary — the useful order is simply which one they
   * can reach soonest.
   */
  const nearestFirst = React.useMemo(
    () =>
      [...activeRequests].sort(
        (a, b) =>
          haversineKm(
            { lat: currentDriver.currentLat, lng: currentDriver.currentLng },
            { lat: a.pickupLocation.lat, lng: a.pickupLocation.lng }
          ) -
          haversineKm(
            { lat: currentDriver.currentLat, lng: currentDriver.currentLng },
            { lat: b.pickupLocation.lat, lng: b.pickupLocation.lng }
          )
      ),
    [activeRequests, currentDriver.currentLat, currentDriver.currentLng]
  );

  const walkIn = currentDriver.walkInSeats ?? 0;
  const bookedSeats = currentCapacityCount;
  const seatsFree = Math.max(0, seatCapacity - bookedSeats - walkIn);

  // Generate an array of seat states for the visual seating deck
  const seatList = React.useMemo(() => {
    const list: { id: number; status: 'booked' | 'walk-in' | 'free'; label: string }[] = [];
    for (let i = 0; i < seatCapacity; i++) {
      if (i < bookedSeats) {
        list.push({ id: i + 1, status: 'booked', label: 'App' });
      } else if (i < bookedSeats + walkIn) {
        list.push({ id: i + 1, status: 'walk-in', label: 'Walk-in' });
      } else {
        list.push({ id: i + 1, status: 'free', label: 'Free' });
      }
    }
    return list;
  }, [seatCapacity, bookedSeats, walkIn]);

  return (
    <div className="flex flex-col gap-3.5 text-trust-slate font-sans">
      {/* Duty, capacity & visual seats card */}
      <div className="p-3.5 rounded-card bg-cream-50 border border-cream-300 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={handleToggleOnline}
              disabled={isTogglingOnline}
              aria-pressed={currentDriver.isOnline}
              aria-label={currentDriver.isOnline ? 'End shift' : 'Start shift'}
              title={currentDriver.isOnline ? 'On duty — tap to end shift' : 'Off duty — tap to start'}
              className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full shadow-sm transition-all active:scale-95 ${
                currentDriver.isOnline
                  ? 'bg-sampaguita-green text-white hover:bg-sampaguita-green/90 ring-4 ring-sampaguita-green/20'
                  : 'bg-cream-200 text-cream-600 hover:bg-cream-300'
              } ${isTogglingOnline ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              {isTogglingOnline ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <Power className="h-5 w-5" />
              )}
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-base font-display font-extrabold text-trust-slate">
                  {currentDriver.isOnline ? 'On Duty' : 'Off Duty'}
                </p>
                {currentDriver.isOnline && (
                  <span className="px-2 py-0.5 rounded-pill bg-sampaguita-green/15 text-sampaguita-green text-[10px] font-display font-bold border border-sampaguita-green/30">
                    Live
                  </span>
                )}
              </div>
              <p className="truncate text-xs font-sans font-semibold text-cream-600 mt-0.5">
                {currentDriver.isOnline
                  ? `${seatsFree} of ${seatCapacity} seats free`
                  : 'Tap power to start receiving trips'}
              </p>
            </div>
          </div>

          {/* Walk-in summary chip */}
          <div className="flex shrink-0 items-center gap-1.5 rounded-pill border border-cream-300 bg-cream-100 px-3 py-1.5 shadow-2xs text-xs font-display font-bold text-trust-slate">
            <span className="text-cream-600 font-sans text-[11px]">Walk-in:</span>
            <span className="font-black text-sunset-coral">{walkIn}</span>
            {walkIn > 0 && (
              <button
                onClick={() => onSetWalkInSeats?.(0)}
                className="ml-1 text-[10px] text-cream-500 hover:text-sunset-coral font-sans underline"
                title="Clear all walk-ins"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Visual Seating Deck (1-Tap Interactive) */}
        <div className="pt-2 border-t border-cream-200">
          <div className="flex items-center justify-between mb-1.5">
            <span className="kicker-label text-[10px]">Vehicle Seating Deck (Tap seat to toggle)</span>
            <span className="text-[10px] font-display font-bold text-cream-600">
              {bookedSeats > 0 && <span className="text-trike-gold mr-2">● {bookedSeats} App</span>}
              {walkIn > 0 && <span className="text-sunset-coral mr-2">● {walkIn} Walk-in</span>}
              <span className="text-sampaguita-green">● {seatsFree} Free</span>
            </span>
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {seatList.map((seat) => {
              const isFree = seat.status === 'free';
              const isWalkIn = seat.status === 'walk-in';
              const isBooked = seat.status === 'booked';
              return (
                <button
                  key={seat.id}
                  disabled={isBooked}
                  onClick={() => {
                    if (isFree) {
                      onSetWalkInSeats?.(Math.min(seatCapacity - bookedSeats, walkIn + 1));
                    } else if (isWalkIn) {
                      onSetWalkInSeats?.(Math.max(0, walkIn - 1));
                    }
                  }}
                  title={
                    isBooked
                      ? `Seat #${seat.id} (Booked by App Passenger)`
                      : isWalkIn
                      ? `Seat #${seat.id} (Walk-in: Tap to Free)`
                      : `Seat #${seat.id} (Free: Tap to add Walk-in)`
                  }
                  className={`py-2 px-1 rounded-card border text-center transition-all duration-200 ${
                    isBooked
                      ? 'bg-trike-gold/20 border-trike-gold text-trust-slate font-bold shadow-2xs cursor-default'
                      : isWalkIn
                      ? 'bg-sunset-coral/20 border-sunset-coral text-sunset-coral font-bold shadow-2xs active:scale-95 hover:bg-sunset-coral/30'
                      : 'bg-cream-50 border-cream-300 text-trust-slate font-semibold hover:border-sampaguita-green active:scale-95 hover:bg-sampaguita-green/10'
                  }`}
                >
                  <div className="text-xs font-display font-black leading-none">#{seat.id}</div>
                  <div className="text-[9px] font-sans font-bold leading-none mt-1 capitalize truncate">
                    {seat.label}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Verification notice */}
      {verification !== 'verified' && (
        <div className="flex items-center gap-2 rounded-card border border-trike-gold/40 bg-cream-100 px-3.5 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-trike-gold" />
          <p className="text-xs font-sans font-semibold text-trust-slate">
            {verification === 'pending'
              ? 'Pending TMO verification — you cannot go on duty yet.'
              : `Rider account ${verification}.`}
          </p>
        </div>
      )}

      {/* Accepted Passengers Pool */}
      {routeOrderedRides.length > 1 && (
        <div className="space-y-2.5 rounded-card bg-trust-slate p-3.5 text-cream-50 border border-cream-400/20 shadow-md">
          <div className="flex items-center justify-between">
            <h4 className="kicker-label text-cream-300">
              After this stop
            </h4>
            <span className="rounded-pill bg-trike-gold px-2.5 py-0.5 text-[10px] font-display font-bold text-trust-slate">
              {routeOrderedRides.length - 1} more
            </span>
          </div>

          <div className="space-y-2">
            {routeOrderedRides.slice(1).map((ride, idx) => {
              const nextStage = NEXT_STAGE[ride.status];

              return (
                <div
                  key={ride.id}
                  className="space-y-2 rounded-card border border-cream-400/20 bg-trust-slate/80 p-3"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-trike-gold text-[11px] font-display font-black text-trust-slate">
                      {idx + 1}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-display font-bold leading-snug text-cream-50">
                        {ride.pickupLocation.name}
                      </p>
                      <p className="flex items-center gap-1 truncate text-xs font-display font-bold leading-snug text-trike-gold">
                        <ArrowRight className="h-3 w-3 shrink-0 text-cream-400" />
                        {ride.dropoffLocation.name}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] font-sans text-cream-300">
                        {ride.passengerName ? `${ride.passengerName} · ` : ''}
                        {ride.passengers} pax · {ride.distanceKm} km
                      </p>
                    </div>

                    <div className="flex shrink-0 gap-1.5">
                      {ride.passengerPhone ? (
                        <a
                          href={`tel:${ride.passengerPhone}`}
                          title={`Call ${ride.passengerName ?? 'passenger'}`}
                          className="flex h-9 w-9 items-center justify-center rounded-full bg-cream-50/10 text-trike-gold transition active:scale-95 hover:bg-cream-50/20"
                        >
                          <Phone className="h-4 w-4" />
                        </a>
                      ) : (
                        <span
                          title="This passenger has no contact number on file"
                          className="flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-full bg-cream-50/5 text-cream-500"
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
                        className={`relative flex h-9 w-9 items-center justify-center rounded-full transition active:scale-95 ${
                          chatRideId === ride.id
                            ? 'bg-trike-gold text-trust-slate'
                            : 'bg-cream-50/10 text-trike-gold hover:bg-cream-50/20'
                        }`}
                      >
                        <MessageSquare className="h-4 w-4" />
                        {(unread[ride.id] ?? 0) > 0 && chatRideId !== ride.id && (
                          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-sunset-coral px-1 text-[9px] font-black text-white">
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
                        className="btn-primary flex h-10 flex-1 items-center justify-center gap-1.5 px-2 text-xs font-display font-extrabold shadow-xs"
                      >
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{nextStage.label}</span>
                      </button>
                    )}
                    <button
                      onClick={() => onAdvanceRideStatus(ride.id, 'completed')}
                      className={`flex h-10 items-center justify-center gap-1.5 rounded-pill bg-sampaguita-green px-3 text-xs font-display font-extrabold text-white shadow-xs transition active:scale-95 hover:bg-sampaguita-green/90 ${
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
        /* OFFLINE STATUS CARD */
        <div className="p-7 bg-cream-50 border border-cream-300 rounded-card text-center space-y-3.5 shadow-sm">
          <button
            onClick={handleToggleOnline}
            disabled={isTogglingOnline}
            className={`w-14 h-14 bg-sunset-coral/15 border-2 border-sunset-coral text-sunset-coral hover:bg-sunset-coral hover:text-white rounded-full flex items-center justify-center mx-auto shadow-sm transition-all duration-200 active:scale-95 ${
              isTogglingOnline ? 'opacity-60 cursor-not-allowed' : ''
            }`}
          >
            {isTogglingOnline ? (
              <span className="w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <Power className="w-7 h-7" />
            )}
          </button>
          <div>
            <h4 className="font-display font-black text-lg text-trust-slate">Rider Status: Offline</h4>
            <p className="text-xs font-sans text-cream-700 mt-1 max-w-sm mx-auto font-medium leading-relaxed">
              You are currently offline. Turn ON your duty status to start receiving trip requests in Dumaguete.
            </p>
          </div>
          <button
            onClick={handleToggleOnline}
            disabled={isTogglingOnline}
            className={`btn-primary text-xs font-display font-extrabold px-6 py-3 shadow-md inline-flex items-center gap-2 ${
              isTogglingOnline ? 'opacity-60 cursor-not-allowed' : ''
            }`}
          >
            {isTogglingOnline ? (
              <>
                <span className="w-4 h-4 border-2 border-trust-slate border-t-transparent rounded-full animate-spin" />
                <span>Connecting...</span>
              </>
            ) : (
              <>
                <Power className="w-4 h-4" />
                <span>Start Shift / Go Online</span>
              </>
            )}
          </button>
        </div>
      ) : (
        /* ONLINE REQUESTS QUEUE */
        activeRequests.length > 0 && (
          <div className="pt-2 border-t border-cream-200">
            <div className="mb-2.5 flex items-center justify-between">
              <h4 className="kicker-label text-cream-600">
                {`${activeRequests.length} incoming offer${activeRequests.length > 1 ? 's' : ''}`}
              </h4>
            </div>

            <div className="space-y-2.5 pb-3">
              <IncomingRequestCard
                ride={nearestFirst[0]}
                remaining={nearestFirst.length - 1}
                onAccept={onAcceptRequest}
                onDecline={onDeclineRequest}
              />

              {nearestFirst.length > 1 && (
                <>
                  <p className="px-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Also waiting
                  </p>
                  <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200">
                    {nearestFirst.slice(1).map((req) => (
                      <div key={req.id} className="flex items-center gap-3 px-3.5 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[11px] font-semibold text-gray-500">
                            {req.pickupLocation.name}
                          </p>
                          <p className="truncate text-sm font-bold text-gray-900">
                            {req.dropoffLocation.name}
                          </p>
                          <p className="mt-0.5 text-[11px] font-semibold text-gray-400 tabular-nums">
                            ₱{req.totalFare} · {req.distanceKm} km · {req.passengers} pax
                            {isExclusiveTrip(req.vehicleType) ? ' · pakyaw' : ''}
                          </p>
                        </div>

                        <button
                          onClick={() => onDeclineRequest(req.id)}
                          aria-label="Decline this trip"
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-400 transition active:scale-95 hover:bg-gray-50"
                        >
                          <X className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => onAcceptRequest(req.id)}
                          className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-white transition active:scale-95 hover:bg-emerald-600"
                        >
                          <Check className="h-4 w-4" />
                          Accept
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
};
