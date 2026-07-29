import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Driver,
  LocationPoint,
  RideBooking,
  TransportMode,
} from './types';
import {
  DUMAGUETE_LOCATIONS,
  VEHICLE_DETAILS,
} from './data/dumagueteData';
import * as api from './api';
import { useAuth } from './context/AuthContext';
import { AuthPage } from './components/AuthPage';
import { StaffLoginPage } from './components/StaffLoginPage';
import {
  bearingDegrees,
  getStreetRoute,
  haversineKm,
  type RouteResult,
} from './utils/dumagueteRouting';
import { totalFare } from './utils/fare';
import { usePolling } from './hooks/usePolling';
import { Navbar } from './components/Navbar';
import { DumagueteMap } from './components/DumagueteMap';
import { RideBookingPanel } from './components/RideBookingPanel';
import { ActiveRideView } from './components/ActiveRideView';
import { AdminDashboard } from './components/AdminDashboard';
import { GentleAiAssistant } from './components/GentleAiAssistant';
import { FareMatrixModal } from './components/FareMatrixModal';
import { DriverModePanel } from './components/DriverModePanel';
import { RideCompleteModal } from './components/RideCompleteModal';
import {
  Bell,
  X,
  Compass,
} from 'lucide-react';

/** How often each role asks the server what changed. */
const PASSENGER_POLL_MS = 2500;
const DRIVER_POLL_MS = 3000;

export default function App() {
  const { user, isLoading, logout } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center font-sans">
        <p className="text-sm font-bold text-gray-600">Loading GentleTrike...</p>
      </div>
    );
  }

  if (!user) {
    // Admins/staff have their own isolated door at /staff.
    const path = window.location.pathname.replace(/\/+$/, '');
    return path === '/staff' ? <StaffLoginPage /> : <AuthPage />;
  }

  // Rule-based access: an admin only ever sees the TMO dashboard (standalone,
  // no passenger/rider chrome or app navbar).
  if (user.role === 'admin') {
    return <AdminDashboard />;
  }

  return <MainApp user={user} onLogout={() => void logout()} />;
}

function MainApp({
  user,
  onLogout,
}: {
  user: { id: string; name: string; role: 'passenger' | 'rider' | 'admin' };
  onLogout: () => void;
}) {
  const canUseRiderMode = user.role === 'rider' || user.role === 'admin';
  const isPassenger = user.role === 'passenger' || user.role === 'admin';
  // Navigation & Modal States
  const [isDriverMode, setIsDriverMode] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [isAiGuideOpen, setIsAiGuideOpen] = useState(false);
  const [isFareGuideOpen, setIsFareGuideOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Locations & Route State
  const [locations] = useState<LocationPoint[]>(DUMAGUETE_LOCATIONS);
  const [pickup, setPickup] = useState<LocationPoint | null>(null);
  const [dropoff, setDropoff] = useState<LocationPoint | null>(null);

  // Ride Options State
  const [selectedVehicle, setSelectedVehicle] = useState<TransportMode>('pedicab_standard');
  const [passengers, setPassengers] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'gcash'>('cash');
  const [isPakyawNegotiated, setIsPakyawNegotiated] = useState(false);
  const [customPakyawFare, setCustomPakyawFare] = useState(150);
  const [notes, setNotes] = useState('');
  const [isBooking, setIsBooking] = useState(false);

  // Server-backed state
  const [activeRide, setActiveRide] = useState<RideBooking | null>(null);
  /** A just-finished trip, kept only until the rating prompt is dismissed. */
  const [completedRide, setCompletedRide] = useState<RideBooking | null>(null);
  const [myDriver, setMyDriver] = useState<Driver | null>(null);

  // This device's own GPS while in rider mode. Used directly for the rider's
  // arrow so it moves at GPS speed instead of lagging a server poll behind.
  const [myPosition, setMyPosition] = useState<
    { lat: number; lng: number; heading: number | null } | null
  >(null);
  const lastFixRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastHeadingRef = useRef<number | null>(null);

  // The passenger's own GPS, kept separate from the rider's so switching modes
  // cannot leave one arrow reading the other's heading.
  const [passengerPosition, setPassengerPosition] = useState<
    { lat: number; lng: number; heading: number | null } | null
  >(null);
  const passengerFixRef = useRef<{ lat: number; lng: number } | null>(null);
  const passengerHeadingRef = useRef<number | null>(null);
  // Server-ranked: only trips this rider's vehicle can serve, that fit their
  // remaining seats, and that are worth the diversion from their current route.
  const [incomingRequests, setIncomingRequests] = useState<api.OpenRide[]>([]);
  const [acceptedPooledRides, setAcceptedPooledRides] = useState<RideBooking[]>([]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 4500);
    return () => clearTimeout(t);
  }, [toastMessage]);

  const reportError = useCallback(
    (err: unknown, fallback: string) => {
      const msg = err instanceof api.ApiError ? err.message : fallback;
      showToast(msg);
    },
    [showToast]
  );

  /* ------------------------------------------------------- routed distance */

  // Fares follow the road, not the crow. Dumaguete's streets run about 1.32x
  // longer than the straight line, so charging on haversine undercharged every
  // trip — this asks OSRM for the real driving distance instead.
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [isRouting, setIsRouting] = useState(false);

  useEffect(() => {
    if (!pickup || !dropoff) {
      setRoute(null);
      return;
    }

    let cancelled = false;
    setIsRouting(true);

    getStreetRoute([
      { lat: pickup.lat, lng: pickup.lng },
      { lat: dropoff.lat, lng: dropoff.lng },
    ])
      .then((result) => {
        if (!cancelled) setRoute(result);
      })
      .finally(() => {
        if (!cancelled) setIsRouting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  /* --------------------------------------------------- passenger: live ride */

  // Reclaim an in-flight trip after a reload or a phone lock.
  useEffect(() => {
    if (!isPassenger) return;
    api
      .listMyRides()
      .then((rides) => {
        if (rides.length > 0) setActiveRide(rides[0]);
      })
      .catch(() => {
        /* first load with no server yet — the booking form still works */
      });
  }, [isPassenger]);

  const activeRideId = activeRide?.id ?? null;
  const previousStatus = useRef<string | null>(null);

  /**
   * Rides the passenger has abandoned locally while the cancel request is still
   * in flight. A poll started before the tap resolves afterwards, and without
   * this its response would put the cancelled trip straight back on screen.
   */
  const abandonedRides = useRef<Set<string>>(new Set());

  const pollActiveRide = useCallback(async () => {
    if (!activeRideId) return;
    try {
      const ride = await api.getRide(activeRideId);
      if (abandonedRides.current.has(ride.id)) return;
      setActiveRide(ride);
    } catch (err) {
      if (err instanceof api.ApiError && err.status === 404) setActiveRide(null);
    }
  }, [activeRideId]);

  usePolling(pollActiveRide, PASSENGER_POLL_MS, !!activeRideId && !isDriverMode);

  // Announce status changes the driver made on their own device.
  useEffect(() => {
    const status = activeRide?.status ?? null;
    const prev = previousStatus.current;
    previousStatus.current = status;
    if (!status || prev === null || prev === status) return;

    if (status === 'driver_assigned') {
      showToast(`Matched with ${activeRide?.assignedDriver?.name ?? 'a rider'}!`);
    } else if (status === 'driver_arriving') {
      showToast('Your rider is arriving at the pickup point!');
    } else if (status === 'in_transit') {
      showToast(`On the way to ${activeRide?.dropoffLocation.name}.`);
    } else if (status === 'completed') {
      // Hold the finished ride so its rider details stay on screen for the
      // rating prompt. The booking form only returns once that is dismissed.
      if (activeRide) setCompletedRide(activeRide);
      setActiveRide(null);
    } else if (status === 'cancelled') {
      showToast('This trip was cancelled.');
      setActiveRide(null);
    }
  }, [activeRide?.status, activeRide?.assignedDriver?.name, activeRide?.dropoffLocation.name, showToast]);

  /* ----------------------------------------------------- driver mode: setup */

  const enterDriverMode = useCallback(async () => {
    try {
      const driver = await api.claimDriver();
      setMyDriver(driver);
      setIsDriverMode(true);
      showToast(`Signed in as ${driver.name} (${driver.unitNumber})`);

      // iOS only delivers compass events after an explicit permission grant,
      // and that request must come from a user gesture — which this tap is.
      const OrientationEvent = window.DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<'granted' | 'denied'>;
      };
      if (typeof OrientationEvent?.requestPermission === 'function') {
        try {
          await OrientationEvent.requestPermission();
        } catch {
          /* denied or dismissed — the arrow simply falls back to GPS heading */
        }
      }
    } catch (err) {
      reportError(err, 'Could not sign in to Rider Mode. Is the server running?');
    }
  }, [reportError, showToast]);

  // Auto-enter driver mode for riders upon login
  useEffect(() => {
    if (user.role === 'rider' && !myDriver && !isDriverMode) {
      void enterDriverMode();
    }
  }, [user.role, myDriver, isDriverMode, enterDriverMode]);


  // Publish this phone's real GPS while on duty, so passengers watching the map
  // see the actual pedicab move rather than a scripted animation.
  useEffect(() => {
    if (!isDriverMode || !myDriver?.id || !myDriver.isOnline) return;
    if (!('geolocation' in navigator)) return;

    const driverId = myDriver.id;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        // coords.heading is null whenever the phone is still or the hardware
        // does not supply one, so fall back to the bearing between fixes.
        // Ignore jitter under 5 m, which would spin the arrow while parked.
        let heading =
          typeof pos.coords.heading === 'number' && !Number.isNaN(pos.coords.heading)
            ? pos.coords.heading
            : null;

        const previous = lastFixRef.current;
        if (heading === null && previous) {
          const movedMetres = haversineKm(previous, { lat, lng }) * 1000;
          if (movedMetres > 5) heading = bearingDegrees(previous, { lat, lng });
        }
        if (heading !== null) lastHeadingRef.current = heading;
        lastFixRef.current = { lat, lng };

        setMyPosition({ lat, lng, heading: lastHeadingRef.current });

        api.updateDriver(driverId, { lat, lng }).catch(() => {
          /* a dropped GPS ping is not worth interrupting the driver over */
        });
      },
      () => {
        showToast('Location permission denied — passengers cannot see you move.');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [isDriverMode, myDriver?.id, myDriver?.isOnline, showToast]);

  /**
   * The passenger's own position, drawn as a heading arrow on their map.
   *
   * Never sent to the server — unlike a rider's location, nobody needs to
   * track a passenger. It exists so they can see where they are relative to
   * their pickup point and the approaching trike.
   *
   * Silent on failure: a denied permission just means no arrow. The "Use my
   * location" button explains itself when a passenger asks for it directly;
   * nagging on page load would not.
   */
  useEffect(() => {
    if (isDriverMode || !isPassenger) return;
    if (!('geolocation' in navigator)) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        // Phones report no heading while stationary, so fall back to the
        // bearing between fixes. Under 5 m is GPS jitter and would spin the
        // arrow while the passenger stands still.
        let heading =
          typeof pos.coords.heading === 'number' && !Number.isNaN(pos.coords.heading)
            ? pos.coords.heading
            : null;

        const previous = passengerFixRef.current;
        if (heading === null && previous) {
          const movedMetres = haversineKm(previous, { lat, lng }) * 1000;
          if (movedMetres > 5) heading = bearingDegrees(previous, { lat, lng });
        }
        if (heading !== null) passengerHeadingRef.current = heading;
        passengerFixRef.current = { lat, lng };

        setPassengerPosition({ lat, lng, heading: passengerHeadingRef.current });
      },
      () => {
        /* denied or unavailable — the map simply shows no arrow */
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [isDriverMode, isPassenger]);

  const pollDriverQueues = useCallback(async () => {
    if (!myDriver?.id) return;
    try {
      const [open, mine, fresh] = await Promise.all([
        myDriver.isOnline ? api.listOpenRides(myDriver.id) : Promise.resolve([]),
        api.listDriverRides(myDriver.id),
        api.listDrivers(),
      ]);
      setIncomingRequests(open);
      // Only swap the array when something actually changed. A fresh reference
      // every 3s would re-run the map effect and re-request the OSRM route for
      // an identical set of stops.
      setAcceptedPooledRides((prev) =>
        JSON.stringify(prev) === JSON.stringify(mine) ? prev : mine
      );
      const updated = fresh.find((d) => d.id === myDriver.id);
      if (updated) setMyDriver(updated);
    } catch {
      /* transient — the next tick retries */
    }
  }, [myDriver?.id, myDriver?.isOnline]);

  usePolling(pollDriverQueues, DRIVER_POLL_MS, isDriverMode && !!myDriver?.id);

  /* ------------------------------------------------------------- passenger */

  const handleSwapPickupDropoff = () => {
    setPickup(dropoff);
    setDropoff(pickup);
  };

  /** Whichever end is still empty is what the next tap on the map fills. */
  const nextPinTarget: 'pickup' | 'dropoff' = pickup ? 'dropoff' : 'pickup';

  const handleMapClickLocation = async (lat: number, lng: number) => {
    // A booked trip is fixed; stray taps must not move its endpoints.
    if (activeRide) return;

    const target = nextPinTarget;
    const id = `map_${target === 'pickup' ? 'p' : 'd'}_${Date.now()}`;

    // Drop the pin immediately with a placeholder. Waiting on the lookup would
    // make the map feel unresponsive, and the coordinates are a truthful label
    // until something better arrives.
    const provisional: LocationPoint = {
      id,
      name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      address: 'Looking up this place...',
      lat,
      lng,
      isCustomPinned: true,
    };

    if (target === 'pickup') {
      setPickup(provisional);
      showToast('Pickup pinned. Tap the map again to set your drop-off.');
    } else {
      setDropoff(provisional);
      showToast('Drop-off pinned. Tap again to move it.');
    }

    try {
      const { place, inServiceArea } = await api.reverseGeocode(lat, lng);

      if (!inServiceArea) {
        // Outside the city the fare table does not apply and no rider is
        // listening, so clear it rather than let a passenger book a trip
        // nobody can serve.
        if (target === 'pickup') setPickup(null);
        else setDropoff(null);
        showToast('That spot is outside Dumaguete City — GentleTrike cannot pick up there.');
        return;
      }

      const named: LocationPoint = {
        id,
        name: place.name,
        address: place.address,
        lat,
        lng,
        isCustomPinned: true,
      };

      // Only rename if the pin is still the one we dropped; the passenger may
      // have tapped elsewhere while the lookup was in flight.
      if (target === 'pickup') setPickup((cur) => (cur?.id === id ? named : cur));
      else setDropoff((cur) => (cur?.id === id ? named : cur));
    } catch {
      // Lookup failed — keep the coordinates, which still book correctly.
      const fallback = { ...provisional, address: 'Pinned directly on the Dumaguete map' };
      if (target === 'pickup') setPickup((cur) => (cur?.id === id ? fallback : cur));
      else setDropoff((cur) => (cur?.id === id ? fallback : cur));
    }
  };

  /**
   * Set pickup from the phone's GPS.
   *
   * Uses the already-tracked passengerPosition instead of making a fresh
   * geolocation request. This is more efficient and reliable since the position
   * is already being monitored continuously for the map display.
   */
  const handleUseCurrentLocation = async (): Promise<void> => {
    // Use the already-tracked passenger position
    if (!passengerPosition) {
      showToast('Your location is not available yet. Please wait a moment or pin your pickup on the map instead.');
      return;
    }

    const lat = passengerPosition.lat;
    const lng = passengerPosition.lng;

    try {
      const { place, inServiceArea } = await api.reverseGeocode(lat, lng);

      if (!inServiceArea) {
        showToast('You appear to be outside Dumaguete City — GentleTrike only operates here.');
        return;
      }

      setPickup({
        id: `gps_${Date.now()}`,
        name: place.name,
        address: place.address,
        lat,
        lng,
        isCustomPinned: true,
      });
      showToast(`Pickup set to ${place.name}. Drag the map pin if that is not quite right.`);
    } catch (err) {
      console.error('Reverse geocode error:', err);
      setPickup({
        id: `gps_${Date.now()}`,
        name: 'My current location',
        address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        lat,
        lng,
        isCustomPinned: true,
      });
      showToast('Pickup set to your current location.');
    }
  };

  const handleBookRide = async () => {
    if (!pickup || !dropoff || isBooking) return;

    // Resolve the route now rather than trusting whatever the panel last showed,
    // so the fare charged always matches the road actually travelled.
    const resolved =
      route ??
      (await getStreetRoute([
        { lat: pickup.lat, lng: pickup.lng },
        { lat: dropoff.lat, lng: dropoff.lng },
      ]));

    const dist = resolved.distanceKm;
    const details = VEHICLE_DETAILS[selectedVehicle];
    const finalFare =
      isPakyawNegotiated && customPakyawFare > 0
        ? customPakyawFare
        : totalFare(selectedVehicle, dist, passengers);

    setIsBooking(true);
    try {
      const ride = await api.createRide({
        pickupLocation: pickup,
        dropoffLocation: dropoff,
        vehicleType: selectedVehicle,
        passengers,
        distanceKm: dist,
        estimatedMinutes: resolved.durationMin,
        baseFare: details.baseFare,
        totalFare: finalFare,
        isPakyawNegotiated,
        paymentMethod,
        notes,
      });
      previousStatus.current = ride.status;
      setActiveRide(ride);
      showToast('Request sent! Waiting for a Dumaguete rider to accept...');
    } catch (err) {
      reportError(err, 'Could not send your booking. Check your connection.');
    } finally {
      setIsBooking(false);
    }
  };

  /** Dismiss the post-trip prompt and hand back a clean booking screen. */
  const handleFinishTrip = () => {
    setCompletedRide(null);
    setPickup(null);
    setDropoff(null);
    setNotes('');
    setPassengers(1);
    setIsPakyawNegotiated(false);
    setRoute(null);
  };

  const handleCancelRide = async () => {
    if (!activeRide) return;
    const id = activeRide.id;

    // Hide it immediately so the screen responds to the tap, but remember that
    // we did — an in-flight poll must not resurrect it while the cancel travels.
    abandonedRides.current.add(id);
    setActiveRide(null);

    try {
      await api.cancelRide(id);
      showToast('Trip cancelled.');
    } catch (err) {
      // The cancel did not land, so the trip is still live on the server and a
      // driver can still accept it. Putting it back is the honest thing to do:
      // leaving it hidden strands the passenger with a ride they cannot see.
      abandonedRides.current.delete(id);
      reportError(err, 'Could not cancel the trip. It is still active.');
      try {
        setActiveRide(await api.getRide(id));
      } catch {
        /* ride genuinely gone — leave the booking screen up */
      }
    }
  };

  /* ----------------------------------------------------------- driver mode */

  const handleAcceptDriverRequest = async (rideId: string) => {
    if (!myDriver) return;
    // Drop it from the local queue straight away so a double-tap cannot send
    // two accepts; the poll restores it if the server rejected us.
    setIncomingRequests((prev) => prev.filter((r) => r.id !== rideId));
    try {
      await api.acceptRide(rideId, myDriver.id);
      showToast('Accepted! Added to your GentleTrike multi-stop route.');
    } catch (err) {
      reportError(err, 'Could not accept that trip.');
    }
    void pollDriverQueues();
  };

  const handleDeclineDriverRequest = async (rideId: string) => {
    if (!myDriver) return;
    setIncomingRequests((prev) => prev.filter((r) => r.id !== rideId));
    try {
      await api.declineRide(rideId, myDriver.id);
      showToast('Passenger request declined.');
    } catch (err) {
      reportError(err, 'Could not decline that trip.');
    }
  };

  const handleAdvanceRideStatus = async (
    rideId: string,
    status: RideBooking['status']
  ) => {
    try {
      await api.setRideStatus(rideId, status);
      if (status === 'completed') showToast('Trip completed! Daghang salamat!');
    } catch (err) {
      reportError(err, 'Could not update the trip status.');
    }
    void pollDriverQueues();
  };

  const handleToggleOnline = async (online: boolean) => {
    if (!myDriver) return;
    try {
      const updated = await api.updateDriver(myDriver.id, { isOnline: online });
      setMyDriver(updated);
      showToast(online ? 'Rider status: ONLINE' : 'Rider status: OFFLINE');
    } catch (err) {
      reportError(err, 'Could not change your duty status.');
    }
  };

  /* The pedicab whose position the map should follow. */
  const trackedDriver = isDriverMode ? myDriver : activeRide?.assignedDriver ?? null;

  // Memoised on the coordinates themselves. A fresh object here on every
  // render would churn the map's effect dependencies and, with nothing to
  // route, spin into an endless render loop that leaves the map blank.
  //
  // In rider mode the device's own GPS wins over the server's copy: it is the
  // same pedicab, but local fixes arrive immediately rather than after a poll.
  const driverLocation = useMemo(() => {
    if (isDriverMode && myPosition) {
      return { lat: myPosition.lat, lng: myPosition.lng };
    }
    return trackedDriver
      ? { lat: trackedDriver.currentLat, lng: trackedDriver.currentLng }
      : null;
  }, [
    isDriverMode,
    myPosition?.lat,
    myPosition?.lng,
    trackedDriver?.currentLat,
    trackedDriver?.currentLng,
  ]);

  /* Only the rider's own screen shows a heading arrow. */
  const driverHeading = isDriverMode ? myPosition?.heading ?? null : null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-900 antialiased">
      <Navbar
        user={user}
        isDriverMode={isDriverMode}
        isAdminMode={isAdminMode}
        canUseRiderMode={canUseRiderMode}
        onToggleDriverMode={(driverMode) => {
          if (driverMode) {
            void enterDriverMode();
          } else {
            setIsDriverMode(false);
          }
        }}
        onToggleAdminMode={setIsAdminMode}
        onOpenAiGuide={() => setIsAiGuideOpen(true)}
        onLogout={onLogout}
      />

      {toastMessage && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-amber-400 font-bold text-xs px-4 py-2.5 rounded-full shadow-lg border border-gray-800 flex items-center gap-2 max-w-[92vw]">
          <Bell className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="truncate">{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 text-gray-400 hover:text-white shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {isAdminMode ? (
        <AdminDashboard />
      ) : (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5 w-full space-y-4">
          {isDriverMode ? (
            myDriver ? (
              <DriverModePanel
                currentDriver={myDriver}
                activeRequests={incomingRequests}
                acceptedPooledRides={acceptedPooledRides}
                onAcceptRequest={handleAcceptDriverRequest}
                onDeclineRequest={handleDeclineDriverRequest}
                onAdvanceRideStatus={handleAdvanceRideStatus}
                onToggleOnline={handleToggleOnline}
              />
            ) : (
              <div className="bg-white p-8 rounded-2xl border border-gray-200 shadow-md text-center text-xs font-bold text-gray-600">
                Signing in to Rider Mode...
              </div>
            )
          ) : !isPassenger ? (
            <div className="bg-white p-8 rounded-2xl border border-gray-200 shadow-md text-center text-xs font-bold text-gray-600">
              Your account is set up as a rider. Switch to Rider Mode to accept trips.
            </div>
          ) : activeRide ? (
            <ActiveRideView
              ride={activeRide}
              driverLocation={driverLocation}
              onCancelRide={handleCancelRide}
            />
          ) : (
            <RideBookingPanel
              locations={locations}
              pickup={pickup}
              dropoff={dropoff}
              onSelectPickup={setPickup}
              onSelectDropoff={setDropoff}
              onUseCurrentLocation={handleUseCurrentLocation}
              onSwapPickupDropoff={handleSwapPickupDropoff}
              selectedVehicle={selectedVehicle}
              onSelectVehicle={setSelectedVehicle}
              passengers={passengers}
              onChangePassengers={setPassengers}
              paymentMethod={paymentMethod}
              onChangePaymentMethod={setPaymentMethod}
              isPakyawNegotiated={isPakyawNegotiated}
              onTogglePakyaw={setIsPakyawNegotiated}
              customPakyawFare={customPakyawFare}
              onChangeCustomPakyawFare={setCustomPakyawFare}
              notes={notes}
              onChangeNotes={setNotes}
              onBookRide={handleBookRide}
              isBooking={isBooking}
              distanceKm={route?.distanceKm ?? null}
              estimatedMinutes={route?.durationMin ?? null}
              distanceSource={route?.source ?? null}
              isRouting={isRouting}
              onOpenFareGuide={() => setIsFareGuideOpen(true)}
              onClearPickup={() => setPickup(null)}
              onClearDropoff={() => setDropoff(null)}
            />
          )}

          <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-xs flex items-center justify-between text-xs text-gray-800">
            <div className="flex items-center gap-2.5">
              <Compass className="w-4 h-4 text-amber-500 shrink-0" />
              <div>
                <span className="font-bold text-gray-900 block">Dumaguete Route Guarantee</span>
                <span className="text-[11px] text-gray-500 font-medium">
                  Rides strictly follow real street routes with live GPS navigation.
                </span>
              </div>
            </div>
            <button
              onClick={() => setIsFareGuideOpen(true)}
              className="text-xs font-bold text-gray-900 underline shrink-0 hover:text-amber-600"
            >
              Ordinance
            </button>
          </div>
        </div>

        <div className="lg:col-span-7 w-full h-[480px] lg:h-[calc(100vh-100px)] sticky top-20">
          <DumagueteMap
            pickup={isDriverMode ? null : activeRide?.pickupLocation ?? pickup}
            dropoff={isDriverMode ? null : activeRide?.dropoffLocation ?? dropoff}
            activeDriver={trackedDriver}
            driverLocation={driverLocation}
            driverHeading={driverHeading}
            passengerLocation={isDriverMode ? null : passengerPosition}
            rideStatus={activeRide?.status}
            pooledRides={acceptedPooledRides}
            isDriverMode={isDriverMode}
            nextPinTarget={isDriverMode || activeRide ? null : nextPinTarget}
            onMapClickLocation={handleMapClickLocation}
          />
        </div>
      </main>
      )}

      <GentleAiAssistant
        isOpen={isAiGuideOpen}
        onClose={() => setIsAiGuideOpen(false)}
        pickupName={pickup?.name}
        dropoffName={dropoff?.name}
        canBook={isPassenger && !activeRide}
        bookBlockedReason={
          !isPassenger
            ? 'Sign in as a passenger to book this ride.'
            : activeRide
              ? 'You already have a trip in progress. Finish or cancel it first.'
              : undefined
        }
        onRideBooked={(ride) => {
          // Same handling as a ride booked from the panel, so a Gently booking
          // is tracked, polled, and completed by exactly the same code path.
          previousStatus.current = ride.status;
          setActiveRide(ride);
          showToast('Request sent! Waiting for a Dumaguete rider to accept...');
        }}
      />

      <FareMatrixModal
        isOpen={isFareGuideOpen}
        onClose={() => setIsFareGuideOpen(false)}
      />

      {completedRide && (
        <RideCompleteModal ride={completedRide} onClose={handleFinishTrip} />
      )}
    </div>
  );
}
