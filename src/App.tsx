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
import { DumagueteMap } from './components/DumagueteMap';
import { RideBookingPanel } from './components/RideBookingPanel';
import { ActiveRideView } from './components/ActiveRideView';
import { AdminDashboard } from './components/AdminDashboard';
import { GentleAiAssistant } from './components/GentleAiAssistant';
import { DriverModePanel } from './components/DriverModePanel';
import { RideCompleteModal } from './components/RideCompleteModal';
import { BottomSheet, type SheetSnap } from './components/BottomSheet';
import { BottomNav, BOTTOM_NAV_HEIGHT, type NavTab } from './components/BottomNav';
import { simulatedLocation, LOCATION_PRESETS } from './utils/simulatedLocation';
import { vehicleDetail } from '../shared/transport';
import { SectionTabs } from './components/SectionTabs';
import { DriverPinned } from './components/SheetPinned';
import { IncomingRequestCard } from './components/IncomingRequestCard';
import { RiderChatPanel } from './components/RiderChatPanel';
import { HomeRider } from './components/HomeRider';
import { HomePassenger } from './components/HomePassenger';
import { MenuPage } from './components/MenuPage';
import { LocationPickerMap } from './components/LocationPickerMap';
import { SearchTimeoutCard, SEARCH_TIMEOUT_MS } from './components/SearchTimeoutCard';
import { FareMatrixPage } from './components/FareMatrixPage';
import { useIsDesktop } from './hooks/useMediaQuery';
import { useTheme } from './hooks/useTheme';
import { useUnreadMessages } from './hooks/useUnreadMessages';
import { Bell, X, ArrowLeft, Sparkles } from 'lucide-react';

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
  user: {
    id: string;
    name: string;
    role: 'passenger' | 'rider' | 'admin';
    contact_number?: string;
  };
  onLogout: () => void;
}) {
  const canUseRiderMode = user.role === 'rider' || user.role === 'admin';
  const isPassenger = user.role === 'passenger' || user.role === 'admin';
  // Navigation & Modal States
  const [isDriverMode, setIsDriverMode] = useState(user.role === 'rider');
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [isAiGuideOpen, setIsAiGuideOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Phone shell. Below `lg` the map owns the viewport and everything else lives
  // in a sheet over it; at `lg` and above the original two-column layout is
  // still the right shape, so both trees exist and exactly one is mounted.
  const isDesktop = useIsDesktop();
  // Kept although nothing reads the class it sets yet: it holds the stored
  // preference, so shipping a dark palette becomes a styling job rather than a
  // re-plumbing one. See the note in MenuPage's Settings screen.
  useTheme();
  /**
   * The number, kept locally so Settings can update it without a reload.
   * Seeded from the session and overwritten when the user changes it.
   */
  const [contactNumber, setContactNumber] = useState(user.contact_number);
  const menuUser = useMemo(
    () => ({ ...user, contact_number: contactNumber }),
    [user, contactNumber]
  );
  const [navTab, setNavTab] = useState<NavTab>('home');
  /** Which Menu page to land on — Home's "See all" jumps straight to history. */
  const [menuScreen, setMenuScreen] = useState<
    'root' | 'history' | 'reports' | 'details' | 'settings'
  >('root');

  /**
   * Where the passenger is in the booking flow.
   *
   * A single value rather than a pile of booleans, because these states are
   * genuinely exclusive and the bugs come from combinations that should not
   * exist — a pickup map open over a live trip, say.
   *
   *   idle      nothing started; the tab bar is theirs
   *   pinDrop   full-screen map choosing a destination
   *   pinPickup full-screen map confirming the pickup
   *   details   passengers, vehicle, payment, notes, BOOK
   */
  const [bookingStage, setBookingStage] = useState<
    'idle' | 'pinDrop' | 'pinPickup' | 'details'
  >('idle');

  /**
   * Which screen the map picker was opened from.
   *
   * Picking is entered from two places that want opposite things afterwards:
   * from "where to?" the column should stay on the search, but from the booking
   * form it must stay on the form — changing a pickup mid-booking should not
   * throw the passenger back to Home with a half-filled trip behind them.
   */
  const [pickOrigin, setPickOrigin] = useState<'search' | 'details'>('search');
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('half');
  /** Sheet height in px, so the map can keep its route clear of the sheet. */
  const [sheetHeight, setSheetHeight] = useState(0);
  /** Thread opened from the pinned row, shown over everything else. */
  const [chatRideId, setChatRideId] = useState<string | null>(null);

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

  /**
   * Rides already handed over to the completion prompt.
   *
   * Finishing a trip clears `activeRide`, but a poll that went out moments
   * earlier is still in flight, and its response arrives afterwards carrying
   * the same ride with status `completed`. Setting that back put a finished
   * trip on screen for good: the status effect had already seen the
   * transition, so it never fired again, and `effectiveTab` pins the app to
   * the ride screen for as long as `activeRide` exists. The passenger was
   * stranded on "Trip completed" with no way back to the home screen.
   */
  const finishedRides = useRef<Set<string>>(new Set());

  const pollActiveRide = useCallback(async () => {
    if (!activeRideId) return;
    try {
      const ride = await api.getRide(activeRideId);
      if (abandonedRides.current.has(ride.id)) return;
      if (finishedRides.current.has(ride.id)) return;
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
    if (!status || prev === status) return;

    /*
     * A first sighting is normally just this device catching up with a trip
     * already under way, and announcing it would be noise — hence the old
     * `prev === null` bail.
     *
     * A finished trip is not that. It is the last thing this ride will ever
     * say, and the passenger is owed the receipt whether or not this device
     * happened to watch the trip happen. Swallowing it skipped the rating
     * prompt outright and left the completed ride sitting in `activeRide`,
     * which pins the whole app to the trip screen.
     */
    const settled = status === 'completed' || status === 'cancelled';
    if (prev === null && !settled) return;

    if (status === 'driver_assigned') {
    } else if (status === 'driver_arriving') {
    } else if (status === 'in_transit') {
    } else if (status === 'completed') {
      // Hold the finished ride so its rider details stay on screen for the
      // rating prompt. The booking form only returns once that is dismissed.
      if (activeRide) {
        finishedRides.current.add(activeRide.id);
        setCompletedRide(activeRide);
      }
      setActiveRide(null);
    } else if (status === 'cancelled') {
      if (activeRide) finishedRides.current.add(activeRide.id);
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
    if (user.role === 'rider' && !myDriver) {
      void enterDriverMode();
    }
  }, [user.role, myDriver, enterDriverMode]);


  // Publish this phone's real GPS while on duty, so passengers watching the map
  // see the actual pedicab move rather than a scripted animation.
  useEffect(() => {
    if (!isDriverMode || !myDriver?.id || !myDriver.isOnline) return;

    // Same override on the rider's side, so both halves of a demo can stand in
    // the same simulated place. Published once rather than watched — a fixed
    // point has nothing to report on a timer.
    if (simulatedLocation) {
      const { lat, lng } = simulatedLocation;
      setMyPosition({ lat, lng, heading: null });
      api.updateDriver(myDriver.id, { lat, lng }).catch(() => {
        /* a dropped ping is not worth interrupting the rider over */
      });
      return;
    }

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

    // A simulated fix replaces the watch entirely. Testing that the app behaves
    // correctly in Cebu is otherwise impossible from a desk in Dumaguete, and
    // the browser has no reason to lie on our behalf.
    if (simulatedLocation) {
      setPassengerPosition({
        lat: simulatedLocation.lat,
        lng: simulatedLocation.lng,
        heading: null,
      });
      return;
    }

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
      pickedOnMap: true,
    };

    if (target === 'pickup') {
      setPickup(provisional);
    } else {
      setDropoff(provisional);
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
        pickedOnMap: true,
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
    } catch (err) {
      reportError(err, 'Could not send your booking. Check your connection.');
    } finally {
      setIsBooking(false);
    }
  };

  /** Dismiss the post-trip prompt and hand back a clean booking screen. */
  const handleFinishTrip = () => {
    setCompletedRide(null);
    // Belt and braces. `effectiveTab` forces the ride screen for as long as
    // `activeRide` is set, so anything left here outranks the `setNavTab`
    // below and the passenger never reaches Home. The trip is over; nothing
    // about it should still be live.
    setActiveRide(null);
    setPickup(null);
    setDropoff(null);
    setNotes('');
    setPassengers(1);
    setIsPakyawNegotiated(false);
    setRoute(null);
    // The trip is over, so the booking flow is over with it. Without this the
    // passenger was left on a trip screen for a ride that had already finished.
    setBookingStage('idle');
    setNavTab('home');
  };

  /**
   * Record a passenger the rider picked up off the app.
   *
   * Applied optimistically because the control is a stepper — waiting for a
   * round trip per tap makes it feel broken — then reconciled with whatever the
   * server clamps it to, since the server, not the client, decides what fits.
   */
  /**
   * Set how many this rider's own unit seats.
   *
   * Optimistic like the walk-in stepper, and reconciled the same way: the
   * server clamps to the vehicle class ceiling, which is the franchise limit,
   * so its answer is the one that counts.
   */
  const handleSetSeatCapacity = useCallback(
    async (seats: number) => {
      if (!myDriver) return;
      setMyDriver((current) => (current ? { ...current, seatCapacity: seats } : current));
      try {
        const updated = await api.updateDriver(myDriver.id, { seatCapacity: seats });
        setMyDriver(updated);
      } catch (err) {
        reportError(err, 'Could not update your seat count.');
      }
    },
    [myDriver?.id]
  );

  const handleSetWalkInSeats = useCallback(
    async (seats: number) => {
      if (!myDriver) return;
      setMyDriver((current) => (current ? { ...current, walkInSeats: seats } : current));
      try {
        const updated = await api.updateDriver(myDriver.id, { walkInSeats: seats });
        setMyDriver(updated);
      } catch (err) {
        reportError(err, 'Could not update your passenger count.');
      }
    },
    [myDriver?.id]
  );

  const handleCancelRide = async () => {
    if (!activeRide) return;
    const id = activeRide.id;

    // Hide it immediately so the screen responds to the tap, but remember that
    // we did — an in-flight poll must not resurrect it while the cancel travels.
    abandonedRides.current.add(id);
    setActiveRide(null);

    try {
      await api.cancelRide(id);
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

  /**
   * Once a trip is live the road matters more than the form, so the sheet drops
   * to its smallest snap and the map takes the screen — the next action stays
   * pinned and visible. This fires only on the transition, so a rider who
   * deliberately opens the sheet afterwards is not fought by it.
   */
  // Polled in the background so a passenger message is announced on the pinned
  // row even while the rider has the sheet shut and is watching the road.
  const { unread: driverUnread, markRead: markDriverRead } = useUnreadMessages(
    useMemo(() => acceptedPooledRides.map((r) => r.id), [acceptedPooledRides]),
    'driver'
  );

  const { unread: passengerUnread, markRead: markPassengerRead } = useUnreadMessages(
    useMemo(() => (activeRide ? [activeRide.id] : []), [activeRide?.id]),
    'user'
  );

  const passengerUnreadCount = activeRide ? passengerUnread[activeRide.id] ?? 0 : 0;

  /**
   * Announce an incoming message.
   *
   * The unread badge only helps someone already looking at the chat button. A
   * passenger watching the map, or a rider watching the road, needs telling.
   */
  const previousUnreadTotal = useRef(0);

  useEffect(() => {
    const total = Object.keys(driverUnread).reduce(
      (sum, key) => sum + (driverUnread[key] ?? 0),
      0
    );
    if (total > previousUnreadTotal.current && !chatRideId) {
      showToast(total === 1 ? 'New message from your passenger' : `${total} unread messages`);
    }
    previousUnreadTotal.current = total;
  }, [driverUnread, chatRideId, showToast]);

  /** The ride whose thread is open, resolved back to the live object. */
  const chatRide = useMemo(
    () => acceptedPooledRides.find((r) => r.id === chatRideId) ?? null,
    [acceptedPooledRides, chatRideId]
  );

  // A thread that is on screen has been seen; clearing on open is what stops
  // the badge sitting at 3 while the rider reads the messages behind it.
  useEffect(() => {
    if (chatRideId) void markDriverRead(chatRideId);
  }, [chatRideId, markDriverRead]);

  /* ------------------------------------------------- account: history & totals */

  const [history, setHistory] = useState<api.HistoryRide[]>([]);
  const [reports, setReports] = useState<api.MyReport[]>([]);
  const [todayTotals, setTodayTotals] = useState<api.TodayTotals | null>(null);
  const [isAccountLoading, setIsAccountLoading] = useState(true);

  /**
   * Refetched whenever a trip finishes, because that is exactly when both the
   * history and the day's totals become wrong. `/me/today` derives its figures
   * from completed trips rather than a stored counter, so it rolls over at
   * Dumaguete midnight without anything having to reset it.
   */
  const loadAccountData = useCallback(async () => {
    try {
      const [rides, filed, totals] = await Promise.all([
        api.listMyHistory(),
        api.listMyReports(),
        api.getTodayTotals(),
      ]);
      setHistory(rides);
      setReports(filed);
      setTodayTotals(totals);
    } catch (err) {
      console.error('Could not load account data:', err);
    } finally {
      setIsAccountLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccountData();
  }, [loadAccountData]);

  const hasLiveTrip = isDriverMode ? acceptedPooledRides.length > 0 : !!activeRide;
  const previousLiveTrip = useRef(hasLiveTrip);

  /**
   * A booking in flight owns the screen.
   *
   * Once a ride exists the passenger is committed to it, so the flow is forced
   * back on regardless of which tab they were reading — this is what stops a
   * booking vanishing behind the Fares tab, and it survives a reload because
   * the ride is reclaimed from the server rather than held only in memory.
   */
  useEffect(() => {
    if (!activeRide) return;
    setBookingStage('details');
    setNavTab('ride');
  }, [activeRide?.id]);

  /* ------------------------------------------------------- picking a point */

  const picking = !isDriverMode && (bookingStage === 'pinDrop' || bookingStage === 'pinPickup');

  /**
   * Where the picker opens.
   *
   * An end already chosen wins, so re-opening does not throw away a choice;
   * otherwise it opens on the passenger, which is both where a pickup belongs
   * and the most useful place to start looking for a destination.
   */
  const pickerCentre = useMemo(() => {
    const existing = bookingStage === 'pinDrop' ? dropoff : pickup;
    if (existing) return { lat: existing.lat, lng: existing.lng };
    if (passengerPosition) return { lat: passengerPosition.lat, lng: passengerPosition.lng };
    return null;
  }, [bookingStage, dropoff?.lat, dropoff?.lng, pickup?.lat, pickup?.lng, passengerPosition?.lat, passengerPosition?.lng]);

  /**
   * Backing out of the picker.
   *
   * Returns to the booking form only when there is a booking to return to —
   * both ends settled. Otherwise the map reverts to its ordinary state and the
   * column goes back to where it was, rather than jumping forward to a form for
   * a trip the passenger has just declined to define.
   */
  /**
   * Whether the picker has ever been opened this session.
   *
   * Toggling it in and out of the tree built a brand new google.maps.Map each
   * time, and Dynamic Maps bills per map load — so opening and closing the
   * picker ten times cost twenty loads. Once mounted it stays, hidden behind
   * the ordinary map, and toggling is then free.
   */
  const [pickerMounted, setPickerMounted] = useState(false);

  useEffect(() => {
    if (picking) setPickerMounted(true);
  }, [picking]);

  const cancelPicking = useCallback(() => {
    if (pickOrigin === 'details') {
      setBookingStage('details');
      return;
    }
    setBookingStage(pickup && dropoff ? 'details' : 'idle');
  }, [pickOrigin, pickup, dropoff]);

  /** Name a point standing on the passenger's own fix for what it is. */
  const asCurrentLocation = useCallback(
    (place: LocationPoint): LocationPoint => {
      if (!passengerPosition) return place;
      const atFix =
        haversineKm(
          { lat: place.lat, lng: place.lng },
          { lat: passengerPosition.lat, lng: passengerPosition.lng }
        ) < 0.03;
      return atFix ? { ...place, name: 'Current Location', address: place.name } : place;
    },
    [passengerPosition?.lat, passengerPosition?.lng]
  );

  const confirmPicked = useCallback(
    (place: LocationPoint) => {
      if (bookingStage === 'pinDrop') {
        setDropoff(place);
        /*
         * Confirm the pickup next — the same step a destination chosen by
         * search or from recents leads to.
         *
         * This used to go straight to the details form, on the reasoning that
         * the pickup already defaults to the passenger's own fix and asking
         * again would be asking a question that has an answer. That reasoning
         * stopped being applied when the search path started confirming the
         * pickup, and the two routes to the same place quietly diverged: pin a
         * destination on the map and you were never shown where you would be
         * collected from.
         *
         * The exception is a change made from inside the details form. There
         * the pickup is already settled and the passenger asked to change one
         * specific thing, so they go back to the form they came from.
         */
        setBookingStage(pickOrigin === 'details' ? 'details' : 'pinPickup');
      } else {
        setPickup(asCurrentLocation(place));
        setBookingStage('details');
      }
      setPickOrigin('search');
    },
    [bookingStage, pickOrigin, asCurrentLocation]
  );

  /**
   * The pickup defaults to the passenger's current location, always.
   *
   * Filled in as soon as a destination exists so the details screen opens with
   * both ends known and a route already drawn, rather than a "set your pickup"
   * placeholder over a question the app can answer itself.
   */
  useEffect(() => {
    if (!dropoff || pickup || !passengerPosition || isDriverMode) return;

    let cancelled = false;
    const { lat, lng } = passengerPosition;

    void api
      .reverseGeocode(lat, lng)
      .then(({ place, inServiceArea }) => {
        if (cancelled || !inServiceArea) return;
        setPickup({
          id: `gps_${Date.now()}`,
          name: 'Current Location',
          address: place.name,
          lat,
          lng,
          isCustomPinned: true,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setPickup({
          id: `gps_${Date.now()}`,
          name: 'Current Location',
          address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
          lat,
          lng,
          isCustomPinned: true,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [dropoff?.id, pickup, passengerPosition?.lat, passengerPosition?.lng, isDriverMode]);

  /**
   * Give up on the booking and go back to Home.
   *
   * Only reachable before a ride exists — once one is out there, leaving means
   * cancelling it, which is a different action with a different consequence for
   * whichever rider is already on the way.
   */
  const abandonBooking = useCallback(() => {
    setBookingStage('idle');
    setDropoff(null);
    setPickup(null);
    setNotes('');
    setPassengers(1);
    setNavTab('home');
  }, []);

  /**
   * The phone's back gesture leaves the booking instead of the app.
   *
   * A passenger who swipes back expects to undo the last step, not to be thrown
   * out to the browser. Each stage pushes an entry so back unwinds it.
   */
  useEffect(() => {
    if (bookingStage === 'idle' || activeRide) return;

    window.history.pushState({ gentletrike: bookingStage }, '');
    const onPop = () => {
      if (bookingStage === 'details') abandonBooking();
      else setBookingStage(dropoff ? 'details' : 'idle');
    };

    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [bookingStage, activeRide, dropoff, abandonBooking]);

  /**
   * How long this request has gone unanswered.
   *
   * Ticks once a second only while genuinely searching, so nothing runs during
   * a trip that already has a rider.
   */
  const [searchTimedOut, setSearchTimedOut] = useState(false);
  const [waitAcknowledged, setWaitAcknowledged] = useState(false);

  useEffect(() => {
    if (activeRide?.status !== 'searching_driver') {
      setSearchTimedOut(false);
      setWaitAcknowledged(false);
      return;
    }

    const startedAt = new Date(
      activeRide.createdAt.includes('T')
        ? activeRide.createdAt
        : `${activeRide.createdAt.replace(' ', 'T')}Z`
    ).getTime();

    const check = () => {
      if (Number.isNaN(startedAt)) return;
      setSearchTimedOut(Date.now() - startedAt >= SEARCH_TIMEOUT_MS);
    };

    check();
    const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, [activeRide?.id, activeRide?.status, activeRide?.createdAt]);

  /** The passenger is mid-flow and must not be able to wander off. */
  const inBookingFlow =
    !isDriverMode && (bookingStage !== 'idle' || !!activeRide);

  /**
   * Whether anything would be lost by leaving.
   *
   * Choosing a destination — by search or on the map — commits nothing, so the
   * tab bar stays. Once the details screen is open there is a part-filled form
   * to lose, and once a ride exists there is a rider on the way.
   *
   * It is also the point where the tab bar would stop working: `effectiveTab`
   * is pinned to 'ride' from here on, so the tabs would change state and render
   * nothing. A visible control that does nothing is worse than no control.
   *
   * Which is exactly why the pin stages count when they were opened from the
   * details form. Re-picking a pickup or a drop-off leaves `bookingStage` on
   * 'pinPickup' for as long as the map is open, and reading that as "nothing
   * committed" brought the tab bar back over a half-filled booking — tabs that
   * `effectiveTab` was already overruling. The condition below must stay in
   * step with it.
   */
  const committed =
    !isDriverMode &&
    (bookingStage === 'details' || !!activeRide || (picking && pickOrigin === 'details'));

  const showNavbar = !committed;

  /**
   * Which section actually renders.
   *
   * Forcing it rather than only setting `navTab` on the ride's arrival: that
   * effect keys on the ride id, so it fired once and never again — tapping Home
   * afterwards left `navTab` on 'home' and the booking simply disappeared.
   * While a booking is live there is only one thing to show, so this stops
   * asking and shows it.
   *
   * Picking a point is deliberately excluded. Choosing a destination changes
   * the *map*, not the page: the column keeps showing "Where to?" so the search
   * and the map are two views of one question, rather than the form for a later
   * step appearing beside a map that has not answered this one yet.
   */
  const effectiveTab: NavTab =
    bookingStage === 'details' || activeRide || (picking && pickOrigin === 'details')
      ? 'ride'
      : navTab;

  /**
   * When the phone shows the map at all.
   *
   * Filling in a booking is a form — pickup, vehicle, seats, payment, notes —
   * and gets the whole screen like every other form. The map earns the screen
   * once there is something on it worth watching: a rider being found, a route
   * being driven, or a rider's own queue.
   */
  const showMap = isDriverMode || !!activeRide;

  // A finished trip is the one event that changes every number on the Account
  // and Home screens at once.
  useEffect(() => {
    if (completedRide) void loadAccountData();
  }, [completedRide, loadAccountData]);

  useEffect(() => {
    if (hasLiveTrip === previousLiveTrip.current) return;
    previousLiveTrip.current = hasLiveTrip;
    setSheetSnap(hasLiveTrip ? 'peek' : 'half');
  }, [hasLiveTrip]);

  /**
   * Each stage of a live trip re-collapses the sheet.
   *
   * A rider being assigned, arriving, or setting off is exactly when the map
   * matters most, so the sheet gets out of the way and leaves the status card
   * showing. The passenger can still drag it up, and it stays up until the next
   * stage changes.
   */
  useEffect(() => {
    if (!activeRide) return;
    setSheetSnap('peek');
  }, [activeRide?.status]);

  /**
   * The working panel for whoever is signed in. Built once and handed to either
   * layout, so the desktop column and the phone sheet can never drift apart.
   */
  const panelContent = isDriverMode ? (
    myDriver ? (
      <DriverModePanel
        currentDriver={myDriver}
        activeRequests={incomingRequests}
        acceptedPooledRides={acceptedPooledRides}
        onAcceptRequest={handleAcceptDriverRequest}
        onDeclineRequest={handleDeclineDriverRequest}
        onAdvanceRideStatus={handleAdvanceRideStatus}
        onToggleOnline={handleToggleOnline}
        onSetWalkInSeats={handleSetWalkInSeats}
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
    <div className="space-y-3">
      {searchTimedOut && !waitAcknowledged && (
        <SearchTimeoutCard
          pickup={activeRide.pickupLocation}
          vehicleType={activeRide.vehicleType}
          onKeepWaiting={() => setWaitAcknowledged(true)}
          onRebook={() => {
            // Cancel first: leaving the old request open would have two trips
            // out for one passenger and a rider accepting the abandoned one.
            void handleCancelRide();
            setBookingStage('pinPickup');
          }}
        />
      )}
      <ActiveRideView
        ride={activeRide}
        driverLocation={driverLocation}
        onCancelRide={handleCancelRide}
      />
    </div>
  ) : (
    <RideBookingPanel
      locations={locations}
      pickup={pickup}
      dropoff={dropoff}
      onSelectPickup={setPickup}
      onSelectDropoff={setDropoff}
      onUseCurrentLocation={handleUseCurrentLocation}
      position={passengerPosition}
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
      onOpenFareGuide={() => setNavTab('fares')}
      onClearPickup={() => setPickup(null)}
      onClearDropoff={() => setDropoff(null)}
      onPinPickup={() => {
        setPickOrigin('details');
        setBookingStage('pinPickup');
      }}
      onPinDropoff={() => {
        setPickOrigin('details');
        setBookingStage('pinDrop');
      }}
      onCancelBooking={inBookingFlow && !activeRide ? abandonBooking : undefined}
    />
  );

  const mapElement = (
    <DumagueteMap
      pickup={
        isDriverMode ? null : activeRide?.pickupLocation ?? (inBookingFlow ? pickup : null)
      }
      dropoff={
        isDriverMode ? null : activeRide?.dropoffLocation ?? (inBookingFlow ? dropoff : null)
      }
      activeDriver={trackedDriver}
      driverLocation={driverLocation}
      driverHeading={driverHeading}
      passengerLocation={isDriverMode ? null : passengerPosition}
      rideStatus={activeRide?.status}
      // Only a passenger has one, and only on a shared trike. A rider already
      // has the whole picture in `pooledRides`.
      poolPath={isDriverMode ? undefined : activeRide?.poolPath}
      riderStatus={
        isDriverMode && myDriver
          ? {
              online: myDriver.isOnline,
              waiting: incomingRequests.length,
              seatsFree: Math.max(
                0,
                (myDriver.seatCapacity ?? vehicleDetail(myDriver.vehicleType).maxPassengers) -
                  acceptedPooledRides.reduce((n, r) => n + (r.passengers || 1), 0) -
                  (myDriver.walkInSeats ?? 0)
              ),
            }
          : undefined
      }
      pooledRides={acceptedPooledRides}
      isDriverMode={isDriverMode}
      nextPinTarget={isDriverMode || activeRide || !inBookingFlow ? null : nextPinTarget}
      onMapClickLocation={inBookingFlow ? handleMapClickLocation : undefined}
      // Desktop lays the map out in its own column, so nothing overlaps it.
      bottomInset={isDesktop ? 0 : sheetHeight}
      fullBleed={!isDesktop}
      // Thirteen labelled pins is most of a phone screen. The desktop column
      // has the room, so they stay there.
      showLandmarks={isDesktop}
      // Live congestion, once there is a confirmed trip to spend it on. While
      // the passenger is still choosing a destination the coloured roads only
      // compete with the route line; once a rider is coming, how bad the
      // National Highway is right now is the most useful thing on the map.
      showTraffic={isDriverMode ? acceptedPooledRides.length > 0 : !!activeRide}
      // Only turn the map while this device is actually moving along the route.
      // `driver_arriving` used to count, which tilted and spun the passenger's
      // map while they were still standing on a corner waiting — the map was
      // following a journey they had not started. Aboard is the moment their
      // own direction of travel becomes a real thing to face.
      followHeading={
        isDriverMode
          ? acceptedPooledRides.length > 0
          : activeRide?.status === 'in_transit'
      }
      /*
       * Unread messages, on the map, for both roles.
       *
       * The passenger already had this. A rider did not, so a waiting question
       * was only visible once they opened the sheet over the road they were
       * driving — which is the one moment they should not have to. The badge now
       * floats on the map for whoever is carrying unread threads, and tapping it
       * opens the conversation directly rather than the sheet.
       */
      unreadMessages={
        isDriverMode
          ? Object.values(driverUnread).reduce<number>((sum, n) => sum + Number(n ?? 0), 0)
          : passengerUnreadCount
      }
      onOpenMessages={
        isDriverMode
          ? () => {
              // The thread with something waiting in it. With several, the one
              // for the trip they are actively driving comes first.
              const waiting =
                acceptedPooledRides.find((r) => (driverUnread[r.id] ?? 0) > 0) ??
                acceptedPooledRides[0];
              if (!waiting) return;
              setChatRideId(waiting.id);
              void markDriverRead(waiting.id);
            }
          : activeRide
            ? () => {
                void markPassengerRead(activeRide.id);
                setSheetSnap('half');
              }
            : undefined
      }
    />
  );

  /**
   * The one row that survives at the smallest snap point.
   *
   * For a rider this is the button they are about to press; for a passenger it
   * is where their trip has got to. Both exist so the sheet can sit at `peek`
   * over a full-height map without hiding the thing the user came here for.
   */
  const pinnedRow = isDriverMode ? (
    myDriver ? (
      <DriverPinned
        driver={myDriver}
        acceptedPooledRides={acceptedPooledRides}
        pendingRequestCount={incomingRequests.length}
        onAdvanceRideStatus={handleAdvanceRideStatus}
        onExpand={() => setSheetSnap('half')}
        // Going on and off duty from the row that is always visible. Hunting
        // for that switch through an opened sheet is the single most common
        // reason a rider touches the phone while parked.
        onToggleOnline={handleToggleOnline}
        onOpenChat={(rideId) => {
          setChatRideId(rideId);
          void markDriverRead(rideId);
        }}
        unread={driverUnread}
      />
    ) : undefined
  ) : undefined;

  /** Whatever the selected tab puts inside the sheet. */
  const sheetContent =
    effectiveTab === 'home' ? (
      isDriverMode && myDriver ? (
        /*
         * A rider lands on the work, not on a dashboard about the work.
         *
         * Home used to be a greeting, a hero card holding one emoji, a duty
         * toggle, four stat tiles and a button that went to the queue — so the
         * screen a rider opens fifty times a shift ended in "now navigate
         * somewhere else". It also carried its own duty toggle and earnings
         * figure alongside the panel's, and the two disagreed.
         *
         * Now: one instrument strip, then the queue itself.
         */
        /*
         * The Drive tab carries the queue and nothing else.
         *
         * The instrument strip that briefly lived here — earnings, trips,
         * rating, weather — moved to the Menu. It was worth knowing, and it was
         * not worth the top third of the screen a rider looks at while deciding
         * whether to take a trip.
         */
        panelContent
      ) : (
        <HomePassenger
          name={user.name}
          history={history}
          today={todayTotals}
          locations={locations}
          position={passengerPosition}
          onSelectDestination={(place) => {
            // Destination settled. Pickup is next, on the map, defaulted to
            // wherever the passenger is standing.
            setDropoff(place);
            setNavTab('ride');
            // This confirm-pickup screen was opened by picking a destination,
            // not from the details form. Saying so matters: `pickOrigin` decides
            // where Cancel goes, and a stale 'details' left over from an earlier
            // booking sent it *forward* into the form instead of back to Home.
            setPickOrigin('search');
            setBookingStage('pinPickup');
          }}
          onPinOnMap={() => {
            // Deliberately does NOT change the tab. Opening the map is still
            // answering "where to?" — only the map changes.
            setPickOrigin('search');
            setBookingStage('pinDrop');
          }}
          onCloseSearch={() => {
            // Closing the search closes the map with it; both were one question.
            if (!activeRide) setBookingStage('idle');
          }}
          onRepeatDestination={(ride) => {
            setDropoff(ride.dropoffLocation);
            setNavTab('ride');
            setPickOrigin('search');
            setBookingStage('pinPickup');
          }}
          onSeeAllHistory={() => {
            setMenuScreen('history');
            setNavTab('menu');
          }}
        />
      )
    ) : effectiveTab === 'fares' ? (
      <FareMatrixPage position={passengerPosition} />
    ) : effectiveTab === 'menu' ? (
      <MenuPage
        onSeatCapacityChange={isDriverMode && myDriver ? handleSetSeatCapacity : undefined}
        riderToday={
          isDriverMode && myDriver ? (
            <HomeRider driver={myDriver} today={todayTotals} position={myPosition} />
          ) : undefined
        }
        user={menuUser}
        driver={myDriver}
        today={todayTotals}
        history={history}
        reports={reports}
        isLoading={isAccountLoading}
        canUseRiderMode={canUseRiderMode}
        isDriverMode={isDriverMode}
        initialScreen={menuScreen}
        onScreenChange={setMenuScreen}
        onContactChanged={setContactNumber}
        onToggleDriverMode={() => {
          if (isDriverMode) setIsDriverMode(false);
          else void enterDriverMode();
        }}
        onLogout={onLogout}
      />
    ) : (
      panelContent
    );

  return (
    <div
      className={
        isDesktop
          ? // The admin dashboard is a long document and needs the page to
            // scroll; the two-column app is exactly one viewport and must not.
            isAdminMode
            ? 'min-h-screen bg-gray-50 font-sans text-gray-900 antialiased'
            : 'h-screen overflow-hidden bg-gray-50 font-sans text-gray-900 antialiased'
          : // The page itself must never scroll — only the sheet's content does.
            'relative h-[100dvh] overflow-hidden bg-gray-50 font-sans text-gray-900 antialiased'
      }
    >
      {/* No app header. The section tabs name where you are, hold Gently, and
          the Account tab holds identity, mode switching and sign-out — so a bar
          repeating all of it was a strip of screen spent saying it twice. */}

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

      {/* Loud on purpose. A simulated fix that someone forgets about produces
          bug reports about problems that do not exist. */}
      {simulatedLocation && (
        <div className="fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-violet-600 px-3 py-1.5 text-center text-[11px] font-semibold text-white shadow-lg">
          <span>
            Simulating location: <strong>{simulatedLocation.name}</strong>
          </span>
          <span className="hidden sm:inline text-violet-200">
            {Object.keys(LOCATION_PRESETS).map((k) => `?at=${k}`).join('  ·  ')}
          </span>
          <a href="?at=off" className="underline decoration-violet-300 hover:text-violet-100">
            use real GPS
          </a>
        </div>
      )}

      {isAdminMode ? (
        <AdminDashboard />
      ) : isDesktop ? (
        <main className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 px-5 py-4 md:px-6 lg:grid-cols-12">
          {/*
            Both columns are exactly one viewport tall and neither grows.
            The page itself never scrolls: the left column scrolls its own
            content, which is what stops a long Fares list stretching the row
            and dragging the map's height along with it.
          */}
          <div className="flex h-[calc(100vh-2rem)] flex-col gap-4 lg:col-span-5">
            {/* Hidden for the whole booking flow, same rule as the phone tab
                bar: there is no leaving a ride half-way. The panel below then
                takes this row's height back, so the column still ends level
                with the map. */}
            {showNavbar && (
              <div className="flex h-[52px] shrink-0 items-center gap-2">
                <SectionTabs
                  tab={effectiveTab}
                  onTabChange={(next) => {
                    setNavTab(next);
                    if (!committed) setBookingStage('idle');
                    if (next !== 'menu') setMenuScreen('root');
                  }}
                  badgeCount={isDriverMode ? incomingRequests.length : 0}
                />

                {/* Beside the strip, not inside it: Gently is not a fourth tab.
                    It goes with the strip during a booking — a passenger
                    deciding a fare wants a chat window; one mid-trip does not. */}
                <button
                  onClick={() => setIsAiGuideOpen(true)}
                  aria-label="Ask Gently"
                  className="flex h-[52px] shrink-0 items-center justify-center gap-1.5 rounded-2xl gt-gently px-3.5 text-xs font-semibold text-gray-900 shadow-sm transition active:scale-95"
                >
                  <Sparkles className="h-4 w-4 shrink-0" />
                  <span className="hidden xl:inline">Ask Gently</span>
                </button>
              </div>
            )}

            <div className="gt-scroll min-h-0 flex-1 overflow-y-auto pr-1">{sheetContent}</div>
          </div>

          {/*
            The map's frame is the fixed thing on this page and everything else
            is measured against it: one viewport tall, top-aligned with the tab
            strip beside it, and — the part that matters — independent of
            whether that strip is showing.

            It used to depend on it. A spacer here mirrored the strip's height,
            so hiding the navbar for a booking grew the map by 68px and resized
            it mid-flow. The strip now occupies the top of the left column
            alone; that column hands the space back to its own panel when the
            strip goes, and the map never moves.
          */}
          <div className="flex h-[calc(100vh-2rem)] flex-col lg:col-span-7">
            <div className="min-h-0 flex-1">
            {/* Picking a point happens on the map that is already here. A
                full-screen picker made sense on a phone, where there was no map
                to begin with; on desktop it covered the very thing the
                passenger was using to decide.

                Both maps stay in the tree once the picker has been used, and
                only their visibility changes — each is then loaded once for the
                session rather than once per toggle. `visibility` rather than
                `display`, so the hidden map keeps its size and does not have to
                re-lay-out when it comes back. */}
            <div className="relative h-full w-full">
              <div
                className="absolute inset-0"
                style={{ visibility: picking ? 'hidden' : 'visible' }}
                aria-hidden={picking}
              >
                {mapElement}
              </div>

              {pickerMounted && (
                <div
                  className="absolute inset-0"
                  style={{ visibility: picking ? 'visible' : 'hidden' }}
                  aria-hidden={!picking}
                >
                  <LocationPickerMap
                    inline
                    mode={bookingStage === 'pinDrop' ? 'destination' : 'pickup'}
                    initialCentre={pickerCentre}
                    locations={locations}
                    onCancel={cancelPicking}
                    onConfirm={confirmPicked}
                  />
                </div>
              )}
            </div>
            </div>
          </div>
        </main>
      ) : showMap ? (
        <>
          {/* The map is the page. It fills the viewport and stays visible at
              every snap point, which is the whole point of this layout. */}
          <div
            className="absolute inset-0"
            onPointerDown={() => {
              // Reaching for the map means wanting to see it. Only collapses —
              // it never opens the sheet, which would fight the gesture.
              if (sheetSnap !== 'peek') setSheetSnap('peek');
            }}
          >
            {mapElement}
          </div>

          {/* Gently gets the one piece of permanent chrome on the map. The
              app-name-and-user pill that used to sit here told the user two
              things they already knew, in the space the map needed. */}
          {showNavbar && (
            <button
              onClick={() => setIsAiGuideOpen(true)}
              className="absolute left-4 top-4 z-20 flex items-center gap-1.5 rounded-xl gt-gently px-3.5 py-2.5 text-xs font-semibold text-gray-900 shadow-lg transition active:scale-95"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Ask Gently
            </button>
          )}

          {/* One offer at a time, over the map, decided with a single gesture.
              The rest of the queue stays in the sheet for when they are parked. */}
          {isDriverMode && incomingRequests.length > 0 && (
            <IncomingRequestCard
              ride={incomingRequests[0]}
              remaining={incomingRequests.length - 1}
              onAccept={handleAcceptDriverRequest}
              onDecline={handleDeclineDriverRequest}
            />
          )}

          <BottomSheet
            snap={sheetSnap}
            onSnapChange={setSheetSnap}
            bottomOffset={BOTTOM_NAV_HEIGHT}
            onHeightChange={setSheetHeight}
            pinned={pinnedRow}
          >
            {sheetContent}
          </BottomSheet>

          {showNavbar && (
            <BottomNav
              variant={isDriverMode ? 'rider' : 'passenger'}
              tab={effectiveTab}
              onTabChange={(next) => {
                setNavTab(next);
                // Walking away from "where to?" ends it. Otherwise the picker
                // stayed open behind the Menu and the map never came back.
                if (!committed) setBookingStage('idle');
                if (next !== 'menu') setMenuScreen('root');
              }}
              badgeCount={isDriverMode ? incomingRequests.length : 0}
            />
          )}
        </>
      ) : (
        /* Home, Fares, Account and the booking form are whole screens, not
           panels over a map. Nothing on them is about where you are right now,
           so spending half the display on a map was half the display wasted. */
        <>
          <div
            className="gt-scroll h-[100dvh] overflow-y-auto overscroll-contain px-5 pt-5 sm:px-6"
            style={{ paddingBottom: BOTTOM_NAV_HEIGHT + 16 }}
          >
            {sheetContent}
          </div>

          {showNavbar && (
            <button
              onClick={() => setIsAiGuideOpen(true)}
              className="fixed right-4 top-4 z-30 flex items-center gap-1.5 rounded-xl gt-gently px-3.5 py-2.5 text-xs font-semibold text-gray-900 shadow-lg transition active:scale-95"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Ask Gently
            </button>
          )}

          {showNavbar && (
            <BottomNav
              variant={isDriverMode ? 'rider' : 'passenger'}
              tab={effectiveTab}
              onTabChange={(next) => {
                setNavTab(next);
                // Walking away from "where to?" ends it. Otherwise the picker
                // stayed open behind the Menu and the map never came back.
                if (!committed) setBookingStage('idle');
                if (next !== 'menu') setMenuScreen('root');
              }}
              badgeCount={isDriverMode ? incomingRequests.length : 0}
            />
          )}
        </>
      )}

      <GentleAiAssistant
        isOpen={isAiGuideOpen}
        onClose={() => setIsAiGuideOpen(false)}
        pickupName={pickup?.name}
        dropoffName={dropoff?.name}
        // So Gently resolves "the mall" as the one they can reach, not the one
        // whose name matched best somewhere else in the country.
        position={passengerPosition}
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
            }}
      />

      {/* Over everything, reachable in one tap from the pinned row — a rider
          hunting for a thread is a rider reading their phone while driving. */}
      {/* On a phone there is no map on screen to pick from, so the picker takes
          the window. Desktop renders the same component inline, in the column
          the map already occupies. */}
      {picking && !isDesktop && (
        <LocationPickerMap
          mode={bookingStage === 'pinDrop' ? 'destination' : 'pickup'}
          initialCentre={pickerCentre}
          locations={locations}
          onCancel={cancelPicking}
          onConfirm={confirmPicked}
        />
      )}

      {chatRide && (
        <div className="fixed inset-0 z-50 flex items-end bg-gray-900/40 backdrop-blur-sm sm:items-center sm:justify-center">
          <div className="w-full max-w-lg rounded-t-3xl bg-white p-3 shadow-2xl sm:rounded-3xl">
            <RiderChatPanel ride={chatRide} onClose={() => setChatRideId(null)} />
          </div>
        </div>
      )}

      {completedRide && (
        <RideCompleteModal ride={completedRide} onClose={handleFinishTrip} />
      )}
    </div>
  );
}
