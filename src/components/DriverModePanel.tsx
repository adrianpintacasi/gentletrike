import React from 'react';
import { Driver, RideBooking } from '../types';
import { Power, MapPin, ArrowRight, Users, Plus, X, CheckCircle } from 'lucide-react';

interface DriverModePanelProps {
  currentDriver: Driver;
  activeRequests: RideBooking[];
  acceptedPooledRides?: RideBooking[];
  onAcceptRequest: (rideId: string) => void;
  onDeclineRequest: (rideId: string) => void;
  onAdvanceRideStatus: (rideId: string, status: RideBooking['status']) => void;
  onToggleOnline: (isOnline: boolean) => void;
  onExitDriverMode: () => void;
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
  onExitDriverMode,
}) => {
  // Earnings and trip counts are the server's numbers, credited on completion.
  const earningsToday = currentDriver.earningsToday ?? 0;
  const tripsCompletedToday = currentDriver.tripsToday ?? 0;

  const currentCapacityCount = acceptedPooledRides.reduce((sum, r) => sum + r.passengers, 0);

  return (
    <div className="bg-white text-gray-900 rounded-2xl border border-gray-200 shadow-md p-5 md:p-6 flex flex-col gap-5">
      {/* Driver Header */}
      <div className="flex flex-wrap items-center justify-between border-b border-gray-100 pb-4 gap-3">
        <div className="flex items-center gap-3">
          <img
            src={currentDriver.avatar}
            alt={currentDriver.name}
            className="w-12 h-12 rounded-xl object-cover border border-gray-200 shadow-xs"
          />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base text-gray-900">{currentDriver.name}</h3>
              <span className="text-[11px] bg-amber-100 text-amber-900 font-bold px-2 py-0.5 rounded-md border border-amber-200">
                {currentDriver.unitNumber}
              </span>
            </div>
            <p className="text-xs text-gray-500 font-medium">
              Verified Dumaguete Rider • ★ {currentDriver.rating}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Online / Offline Status Toggle Button */}
          <button
            onClick={() => onToggleOnline(!currentDriver.isOnline)}
            className={`px-3.5 py-2 rounded-xl font-extrabold text-xs flex items-center gap-1.5 transition shadow-xs active:scale-95 ${
              currentDriver.isOnline
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-rose-600 text-white hover:bg-rose-700'
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            <span>{currentDriver.isOnline ? 'ONLINE' : 'OFFLINE'}</span>
          </button>
          <button
            onClick={onExitDriverMode}
            className="text-xs font-bold text-gray-700 hover:bg-gray-100 px-3 py-2 rounded-xl border border-gray-200 transition"
          >
            Passenger App
          </button>
        </div>
      </div>

      {/* Driver Metrics Dashboard */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-amber-50 p-4 rounded-xl border border-amber-200">
        <div>
          <span className="text-[10px] text-amber-900 font-bold uppercase tracking-wider block">
            Today's Earnings:
          </span>
          <p className="text-xl font-extrabold text-gray-900">₱{earningsToday}</p>
        </div>
        <div>
          <span className="text-[10px] text-amber-900 font-bold uppercase tracking-wider block">
            Trips Completed:
          </span>
          <p className="text-xl font-extrabold text-gray-900">{tripsCompletedToday} rides</p>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <span className="text-[10px] text-amber-900 font-bold uppercase tracking-wider block">
            Pooled Capacity:
          </span>
          <div className="flex items-center gap-1.5 mt-1">
            <Users className="w-4 h-4 text-amber-800" />
            <span className="text-sm font-bold text-gray-900">
              {currentCapacityCount} / 6 Seats Filled
            </span>
          </div>
        </div>
      </div>

      {/* Accepted Passengers Pool — the rider drives each trip through its stages */}
      {acceptedPooledRides.length > 0 && (
        <div className="bg-gray-900 text-white p-4 rounded-xl border border-gray-800 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <span>🤝</span> Passengers Onboard / Route:
            </h4>
            <span className="text-[10px] bg-amber-400 text-gray-900 font-bold px-2 py-0.5 rounded-md">
              {acceptedPooledRides.length} Active Pooled
            </span>
          </div>

          <div className="space-y-2">
            {acceptedPooledRides.map((ride, idx) => {
              const nextStage = NEXT_STAGE[ride.status];

              return (
                <div
                  key={ride.id}
                  className="bg-gray-800 border border-gray-700 p-3 rounded-lg space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs text-amber-300 font-bold">
                        <span className="bg-amber-400 text-gray-900 rounded-full w-4 h-4 text-[10px] flex items-center justify-center font-bold shrink-0">
                          {idx + 1}
                        </span>
                        <span className="truncate">{ride.pickupLocation.name.split(' ')[0]}</span>
                        <ArrowRight className="w-3 h-3 text-gray-400 shrink-0" />
                        <span className="truncate">{ride.dropoffLocation.name.split(' ')[0]}</span>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {ride.passengers} pax • ₱{ride.totalFare} •{' '}
                        {ride.paymentMethod.toUpperCase()} • {ride.distanceKm} km
                      </p>
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-wider bg-amber-400 text-gray-900 px-2 py-0.5 rounded-md shrink-0">
                      {ride.status.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {nextStage && (
                      <button
                        onClick={() => onAdvanceRideStatus(ride.id, nextStage.status)}
                        className="flex-1 text-xs font-extrabold bg-amber-400 hover:bg-amber-300 text-gray-900 px-3 py-2 rounded-lg shadow-xs transition active:scale-95 flex items-center justify-center gap-1.5"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        <span className="truncate">{nextStage.label}</span>
                      </button>
                    )}
                    <button
                      onClick={() => onAdvanceRideStatus(ride.id, 'completed')}
                      className={`text-xs font-extrabold bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-2 rounded-lg shadow-xs transition active:scale-95 flex items-center justify-center gap-1 ${
                        nextStage ? 'shrink-0' : 'flex-1'
                      }`}
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>Complete • ₱{ride.totalFare}</span>
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
            <div className="space-y-2.5">
              {activeRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-3.5 bg-gray-50 border border-gray-200 hover:border-amber-400 rounded-xl flex flex-wrap items-center justify-between gap-3 transition"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-gray-900 truncate">
                      <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span className="truncate">{req.pickupLocation.name}</span>
                      <ArrowRight className="w-3 h-3 text-gray-400 shrink-0" />
                      <span className="truncate">{req.dropoffLocation.name}</span>
                    </div>
                    <p className="text-xs text-gray-600 font-medium">
                      {req.passengers} Pax • {req.vehicleType.replace('_', ' ').toUpperCase()} • {req.distanceKm} km
                    </p>
                    {req.notes && (
                      <p className="text-[11px] font-medium text-amber-900 bg-amber-100/80 px-2 py-0.5 rounded-md inline-block">
                        "{req.notes}"
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right mr-1">
                      <span className="text-lg font-bold text-gray-900">₱{req.totalFare}</span>
                    </div>

                    {/* Decline Option */}
                    <button
                      onClick={() => onDeclineRequest(req.id)}
                      className="bg-rose-100 text-rose-800 hover:bg-rose-200 font-bold text-xs px-3 py-2 rounded-xl transition active:scale-95 flex items-center gap-1 border border-rose-200"
                      title="Decline request"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Decline</span>
                    </button>

                    {/* Accept Option */}
                    <button
                      onClick={() => {
                        // Earnings and trip count are credited on completion,
                        // not on acceptance — otherwise every ride counts twice.
                        onAcceptRequest(req.id);
                      }}
                      className="bg-amber-400 text-gray-900 hover:bg-amber-300 font-extrabold text-xs px-3.5 py-2 rounded-xl shadow-xs transition active:scale-95 flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
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
