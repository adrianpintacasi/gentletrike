import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Driver, LocationPoint, RideBooking } from '../types';
import { getStreetRoute, LatLng } from '../utils/dumagueteRouting';

interface DumagueteMapProps {
  pickup: LocationPoint | null;
  dropoff: LocationPoint | null;
  activeDriver?: Driver | null;
  driverLocation?: { lat: number; lng: number } | null;
  /** Compass heading of the rider's own device, for the arrow in driver mode. */
  driverHeading?: number | null;
  rideStatus?: string;
  pooledRides?: RideBooking[];
  isDriverMode?: boolean;
  /** Which end the next tap fills, or null when tapping does nothing. */
  nextPinTarget?: 'pickup' | 'dropoff' | null;
  onMapClickLocation?: (lat: number, lng: number) => void;
}

export const DumagueteMap: React.FC<DumagueteMapProps> = ({
  pickup,
  dropoff,
  activeDriver,
  driverLocation,
  driverHeading,
  rideStatus,
  pooledRides = [],
  isDriverMode = false,
  nextPinTarget,
  onMapClickLocation,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ [key: string]: L.Marker }>({});
  const routePolylineRef = useRef<L.Polyline | null>(null);
  const routePolylineGlowRef = useRef<L.Polyline | null>(null);

  // Real-time compass rotation for the rider's arrow. Driven imperatively from
  // the device-orientation sensor rather than React state, so it can update at
  // sensor speed without re-rendering the whole map on every tick.
  const arrowElRef = useRef<HTMLElement | null>(null);
  const arrowRotationRef = useRef(0); // accumulated degrees (may exceed 360)
  const compassActiveRef = useRef(false);

  const [routeStreetCoords, setRouteStreetCoords] = useState<LatLng[]>([]);

  // View-control state. `userAdjustedView` latches once the passenger moves the
  // map themselves; `programmaticMove` marks moves we made, so our own
  // fitBounds is not mistaken for a user gesture.
  const userAdjustedViewRef = useRef(false);
  const programmaticMoveRef = useRef(false);
  const programmaticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Route we have already framed, so a new pickup/dropoff pair fits exactly once. */
  const fittedRouteRef = useRef<string | null>(null);

  /** Wrap a view change so the zoomstart it raises is not read as user input. */
  const moveMap = (apply: (map: L.Map) => void) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    programmaticMoveRef.current = true;
    if (programmaticTimerRef.current) clearTimeout(programmaticTimerRef.current);
    // Safety net: if the view was already correct, no moveend fires to clear it.
    programmaticTimerRef.current = setTimeout(() => {
      programmaticMoveRef.current = false;
    }, 800);
    apply(map);
  };

  // Identity of the current trip. Driver GPS deliberately does not appear here:
  // the map must not chase a moving pedicab around.
  const routeSignature = [
    pickup?.lat, pickup?.lng, pickup?.isCustomPinned,
    dropoff?.lat, dropoff?.lng, dropoff?.isCustomPinned,
  ].join('|');

  // Ref to store latest click handler to prevent stale closures
  const onMapClickLocationRef = useRef(onMapClickLocation);
  useEffect(() => {
    onMapClickLocationRef.current = onMapClickLocation;
  }, [onMapClickLocation]);

  // Initialize Map with White Minimalist Tile Layer
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [9.3082, 123.3075],
      zoom: 15,
      zoomControl: false,
    });

    // White Minimalist Tile Layer (CartoDB Positron)
    const tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    });
    
    tileLayer.addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    mapInstanceRef.current = map;

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (onMapClickLocationRef.current) {
        onMapClickLocationRef.current(e.latlng.lat, e.latlng.lng);
      }
    });

    // Once the passenger pans or zooms, the view is theirs. Markers re-render
    // every few seconds as GPS and the fleet poll come in, and any automatic
    // recentre on those would yank the map back while they are reading it.
    // Only the Center button hands control back.
    map.on('dragstart', () => {
      userAdjustedViewRef.current = true;
    });
    map.on('zoomstart', () => {
      // fitBounds/setView also raise zoomstart, so ignore our own moves.
      if (!programmaticMoveRef.current) userAdjustedViewRef.current = true;
    });
    map.on('moveend', () => {
      programmaticMoveRef.current = false;
    });

    const resizeObserver = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    });
    resizeObserver.observe(mapContainerRef.current);

    // Initial size invalidate after render
    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      resizeObserver.disconnect();
      if (programmaticTimerRef.current) clearTimeout(programmaticTimerRef.current);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Fetch street routing coordinates (OSRM street geometry)
  useEffect(() => {
    let waypoints: LatLng[] = [];

    // Before pickup, the passenger wants to watch the rider closing in on them,
    // so route from the pedicab to the pickup point. `driver_assigned` matters
    // as much as `driver_arriving` — it is the status set the instant a rider
    // accepts, and leaving it out meant the map still showed the whole trip.
    const headingToPickup =
      rideStatus === 'driver_assigned' || rideStatus === 'driver_arriving';

    if (headingToPickup && driverLocation && pickup) {
      waypoints = [
        { lat: driverLocation.lat, lng: driverLocation.lng },
        { lat: pickup.lat, lng: pickup.lng },
      ];
    } else if (rideStatus === 'in_transit' && driverLocation && dropoff) {
      // Passenger is aboard: the route becomes the run to the destination they
      // pinned when booking.
      waypoints = [
        { lat: driverLocation.lat, lng: driverLocation.lng },
        { lat: dropoff.lat, lng: dropoff.lng },
      ];
    } else if (pickup && dropoff) {
      waypoints = [
        { lat: pickup.lat, lng: pickup.lng },
        { lat: dropoff.lat, lng: dropoff.lng },
      ];
    } else if (pooledRides.length > 0 && isDriverMode) {
      waypoints = [];
      if (driverLocation) {
        waypoints.push({ lat: driverLocation.lat, lng: driverLocation.lng });
      }
      pooledRides.forEach((r) => {
        waypoints.push({ lat: r.pickupLocation.lat, lng: r.pickupLocation.lng });
        waypoints.push({ lat: r.dropoffLocation.lat, lng: r.dropoffLocation.lng });
      });
    }

    if (waypoints.length >= 2) {
      // A request goes out every time the driver moves, so responses can land
      // out of order. Ignore any that resolve after this effect has been
      // superseded, otherwise the route snaps back to a stale geometry.
      let cancelled = false;
      getStreetRoute(waypoints).then((route) => {
        if (!cancelled) setRouteStreetCoords(route.coords);
      });
      return () => {
        cancelled = true;
      };
    }

    // Keep the existing reference when it is already empty. Handing back a new
    // [] would be a state change, re-render, and re-run this effect forever.
    setRouteStreetCoords((prev) => (prev.length === 0 ? prev : []));
  }, [pickup, dropoff, activeDriver, driverLocation, rideStatus, pooledRides, isDriverMode]);

  // Render Markers and Polyline (Sleek pins, no heavy black borders)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear old markers
    (Object.values(markersRef.current) as L.Marker[]).forEach((m) => m.remove());
    markersRef.current = {};

    if (routePolylineRef.current) {
      routePolylineRef.current.remove();
      routePolylineRef.current = null;
    }
    if (routePolylineGlowRef.current) {
      routePolylineGlowRef.current.remove();
      routePolylineGlowRef.current = null;
    }

    const isInTransit = rideStatus === 'in_transit';

    // 1. Pickup — GREEN pin. Green means "get on here", red means "journey
    //    ends here", and the rider's pooled pins below follow the same rule so
    //    both sides of a trip read the map identically.
    if (pickup && !isInTransit) {
      const pickupIcon = L.divIcon({
        className: 'custom-pickup-pin',
        html: `
          <div class="relative flex flex-col items-center filter drop-shadow-md">
            <svg class="w-9 h-9 text-emerald-600" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
          </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
      });
      const pickupMarker = L.marker([pickup.lat, pickup.lng], { icon: pickupIcon }).addTo(map);
      markersRef.current['pickup'] = pickupMarker;
    }

    // 2. Destination — RED pin.
    if (dropoff) {
      const dropoffIcon = L.divIcon({
        className: 'custom-dropoff-pin',
        html: `
          <div class="relative flex flex-col items-center filter drop-shadow-md">
            <svg class="w-9 h-9 text-red-600" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
          </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
      });
      const dropoffMarker = L.marker([dropoff.lat, dropoff.lng], { icon: dropoffIcon }).addTo(map);
      markersRef.current['dropoff'] = dropoffMarker;
    }

    // 3. Searching: pulse rings over the pickup point so the wait reads as
    //    something actively happening rather than a frozen map.
    if (pickup && rideStatus === 'searching_driver') {
      const radarIcon = L.divIcon({
        className: 'gt-radar-icon',
        html: `<div class="gt-radar"><span></span><span></span><span></span></div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      const radarMarker = L.marker([pickup.lat, pickup.lng], {
        icon: radarIcon,
        interactive: false,
        zIndexOffset: -500,
      }).addTo(map);
      markersRef.current['searching_radar'] = radarMarker;
    }

    // 4. The rider's own device: a heading arrow, not a trike badge. It turns
    //    with them so they can read it like a navigation cursor.
    if (isDriverMode) {
      if (driverLocation || activeDriver) {
        const lat = driverLocation ? driverLocation.lat : activeDriver ? activeDriver.currentLat : 9.3082;
        const lng = driverLocation ? driverLocation.lng : activeDriver ? activeDriver.currentLng : 123.3075;
        const rotation = typeof driverHeading === 'number' ? driverHeading : 0;

        // A navigation chevron in the Waze / Google Maps idiom, in solid black.
        // No outline — the light basemap already gives it plenty of contrast,
        // and the drop shadow keeps it from disappearing over dark tiles.
        const riderIcon = L.divIcon({
          className: 'custom-rider-pin',
          html: `
            <div class="gt-heading-arrow" style="transform: rotate(${rotation}deg);">
              <svg viewBox="0 0 40 40" width="40" height="40" fill="none">
                <circle cx="20" cy="20" r="17" fill="#111827" fill-opacity="0.12"/>
                <path d="M20 6 L31 32 L20 26.2 L9 32 Z"
                      fill="#111827" stroke-linejoin="round"/>
              </svg>
            </div>
          `,
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        });

        const riderMarker = L.marker([lat, lng], { icon: riderIcon }).addTo(map);
        markersRef.current['my_rider'] = riderMarker;

        // This effect recreates the arrow element, so re-grab it and, if the
        // compass is already live, restore the accumulated rotation — otherwise
        // it would snap back to the GPS-based angle baked into the icon HTML.
        const el = riderMarker.getElement()?.querySelector(
          '.gt-heading-arrow'
        ) as HTMLElement | null;
        arrowElRef.current = el;
        if (el && compassActiveRef.current) {
          el.style.transform = `rotate(${arrowRotationRef.current}deg)`;
        }
      }

      // Each pooled passenger becomes two map pins along the route: green to
      // collect them, red to drop them. The numbered badge keeps the pair
      // identifiable when several passengers are aboard, without the map
      // turning into a wall of text labels.
      pooledRides.forEach((ride, idx) => {
        const pin = (colour: string, seat: number) =>
          L.divIcon({
            className: colour === 'emerald' ? 'pooled-pickup-pin' : 'pooled-dropoff-pin',
            html: `
              <div class="relative filter drop-shadow-md">
                <svg class="w-9 h-9 ${
                  colour === 'emerald' ? 'text-emerald-600' : 'text-red-600'
                }" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                </svg>
                <span class="absolute inset-x-0 top-[6px] text-center text-[11px] font-black text-white">
                  ${seat}
                </span>
              </div>
            `,
            iconSize: [36, 36],
            iconAnchor: [18, 36],
          });

        const pMarker = L.marker([ride.pickupLocation.lat, ride.pickupLocation.lng], {
          icon: pin('emerald', idx + 1),
        })
          .addTo(map)
          .bindTooltip(`Pick up #${idx + 1}: ${ride.pickupLocation.name}`, {
            direction: 'top',
          });

        const dMarker = L.marker([ride.dropoffLocation.lat, ride.dropoffLocation.lng], {
          icon: pin('red', idx + 1),
        })
          .addTo(map)
          .bindTooltip(`Drop off #${idx + 1}: ${ride.dropoffLocation.name}`, {
            direction: 'top',
          });

        markersRef.current[`pooled_p_${ride.id}`] = pMarker;
        markersRef.current[`pooled_d_${ride.id}`] = dMarker;
      });
    } else {
      // Passenger mode deliberately shows no roaming pedicabs. Only the rider
      // who has actually accepted this booking appears, so the map never
      // implies a nearby trike the passenger has not been matched with.

      // The matched pedicab. Deliberately the same trike-in-a-black-circle
      // before and after pickup — the passenger keeps following one familiar
      // marker for the whole trip instead of it changing shape mid-ride.
      if (activeDriver) {
        const lat = driverLocation ? driverLocation.lat : activeDriver.currentLat;
        const lng = driverLocation ? driverLocation.lng : activeDriver.currentLng;

        const driverIcon = L.divIcon({
          className: 'custom-driver-pin',
          html: `
            <div class="relative flex flex-col items-center">
              <div class="w-10 h-10 bg-gray-900 text-amber-400 rounded-full shadow-lg border border-amber-400 flex items-center justify-center text-lg">
                🛺
              </div>
              <div class="mt-1 bg-gray-900 text-amber-400 text-[9px] font-bold px-2 py-0.5 rounded-full shadow-sm whitespace-nowrap">
                ${isInTransit ? 'ONBOARD' : activeDriver.unitNumber}
              </div>
            </div>
          `,
          iconSize: [40, 48],
          iconAnchor: [20, 20],
        });

        const driverMarker = L.marker([lat, lng], { icon: driverIcon }).addTo(map);
        markersRef.current[`active_driver_${activeDriver.id}`] = driverMarker;
      }
    }

    // 5. Draw Street-Aligned Route Polyline
    const validCoords = routeStreetCoords.filter(
      (c) => c && typeof c.lat === 'number' && typeof c.lng === 'number' && Number.isFinite(c.lat) && Number.isFinite(c.lng)
    );

    if (validCoords.length >= 2) {
      const latLngTuples: [number, number][] = validCoords.map((c) => [c.lat, c.lng]);

      const polylineOuter = L.polyline(latLngTuples, {
        color: '#1F2937',
        weight: 5,
        opacity: 0.8,
      }).addTo(map);

      const polylineInner = L.polyline(latLngTuples, {
        color: '#F59E0B',
        weight: 3,
        opacity: 1,
      }).addTo(map);

      routePolylineRef.current = polylineOuter;
      routePolylineGlowRef.current = polylineInner;
    }
    // Framing the view is deliberately NOT done here. This effect re-runs on
    // every driver GPS ping and fleet poll, so recentring from it is what threw
    // the map back to Dumaguete centre while the passenger was zoomed in.
  }, [
    pickup,
    dropoff,
    activeDriver,
    driverLocation,
    driverHeading,
    rideStatus,
    routeStreetCoords,
    isDriverMode,
    pooledRides,
  ]);

  // Rotate the rider's arrow from the phone's compass, in real time, so it
  // points where the device faces even while standing still — like Waze.
  useEffect(() => {
    if (!isDriverMode) return;
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return;

    const readHeading = (e: DeviceOrientationEvent): number | null => {
      // iOS exposes a ready-made compass heading (0 = north, clockwise).
      const iosHeading = (e as unknown as { webkitCompassHeading?: number })
        .webkitCompassHeading;
      if (typeof iosHeading === 'number' && !Number.isNaN(iosHeading)) {
        return iosHeading;
      }
      // Elsewhere, absolute orientation gives alpha counter-clockwise from north.
      if (e.absolute && typeof e.alpha === 'number') {
        return (360 - e.alpha) % 360;
      }
      return null;
    };

    const handleOrientation = (e: DeviceOrientationEvent) => {
      const target = readHeading(e);
      if (target === null) return;

      if (!compassActiveRef.current) {
        // First real reading: adopt it outright so the arrow doesn't sweep
        // from 0° on activation.
        compassActiveRef.current = true;
        arrowRotationRef.current = target;
      } else {
        // Accumulate the shortest signed turn, so 350°→10° nudges +20° rather
        // than unwinding 340° the wrong way.
        const current = arrowRotationRef.current;
        const delta = (((target - current) % 360) + 540) % 360 - 180;
        if (Math.abs(delta) < 1) return; // ignore sensor jitter
        arrowRotationRef.current = current + delta;
      }

      const el = arrowElRef.current;
      if (el) el.style.transform = `rotate(${arrowRotationRef.current}deg)`;
    };

    // deviceorientationabsolute is the reliable compass feed on Android/Chrome;
    // fall back to the plain event where it is not offered.
    const eventName =
      'ondeviceorientationabsolute' in window
        ? 'deviceorientationabsolute'
        : 'deviceorientation';

    window.addEventListener(eventName, handleOrientation as EventListener, true);
    return () => {
      window.removeEventListener(eventName, handleOrientation as EventListener, true);
      compassActiveRef.current = false;
    };
  }, [isDriverMode]);

  /**
   * Frame the trip exactly once, when it is genuinely new.
   *
   * Skipped entirely if the passenger has taken over the view, or if either end
   * was just dropped by hand on the map — pinning means they were already
   * looking exactly where they wanted to be.
   */
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (fittedRouteRef.current === routeSignature) return;
    if (!pickup && !dropoff) return;

    const pinnedByHand = pickup?.isCustomPinned || dropoff?.isCustomPinned;
    if (userAdjustedViewRef.current || pinnedByHand) {
      // Treat it as framed so it will not snap later when the route resolves.
      fittedRouteRef.current = routeSignature;
      return;
    }

    const validCoords = routeStreetCoords.filter(
      (c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng)
    );

    if (validCoords.length >= 2) {
      const bounds = L.latLngBounds(
        validCoords.map((c) => [c.lat, c.lng] as [number, number])
      );
      if (bounds.isValid()) {
        moveMap((map) => map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 }));
        fittedRouteRef.current = routeSignature;
      }
      return;
    }

    // Only one end chosen so far: centre on it, but wait for the road geometry
    // before declaring this route framed.
    const single = pickup ?? dropoff;
    if (single && Number.isFinite(single.lat) && Number.isFinite(single.lng)) {
      moveMap((map) => map.setView([single.lat, single.lng], 16));
    }
  }, [routeSignature, routeStreetCoords, pickup, dropoff]);

  /** Explicit "give me the overview back" — the one thing that resets the view. */
  const handleCenterDumaguete = () => {
    userAdjustedViewRef.current = false;
    fittedRouteRef.current = routeSignature;

    const validCoords = routeStreetCoords.filter(
      (c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng)
    );

    if (validCoords.length >= 2) {
      const bounds = L.latLngBounds(
        validCoords.map((c) => [c.lat, c.lng] as [number, number])
      );
      if (bounds.isValid()) {
        moveMap((map) => map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 }));
        return;
      }
    }

    if (pickup && dropoff) {
      moveMap((map) =>
        map.fitBounds(
          L.latLngBounds([
            [pickup.lat, pickup.lng],
            [dropoff.lat, dropoff.lng],
          ]),
          { padding: [50, 50] }
        )
      );
    } else if (pickup) {
      moveMap((map) => map.setView([pickup.lat, pickup.lng], 16));
    } else if (dropoff) {
      moveMap((map) => map.setView([dropoff.lat, dropoff.lng], 16));
    } else {
      moveMap((map) => map.setView([9.3082, 123.3075], 15));
    }
  };

  return (
    <div
      className={`relative w-full h-full min-h-[420px] bg-white rounded-2xl overflow-hidden border border-gray-200 shadow-md ${
        nextPinTarget ? 'cursor-crosshair' : ''
      }`}
    >
      {/*
        Leaflet's container. Its className MUST stay a constant string.
        Leaflet adds its own classes (leaflet-container, leaflet-grab, …) to
        this element at runtime, and almost all of Leaflet's CSS is scoped
        under .leaflet-container. If React ever re-renders with a different
        className it overwrites the attribute wholesale, silently stripping
        those classes and leaving a blank map. The cursor therefore lives on
        the wrapper above, which React is free to control.
      */}
      <div ref={mapContainerRef} className="w-full h-full z-0 bg-white" />

      {/* Tapping the map always pins, so say plainly what the next tap will do.
          Sized and styled to match the Center button, and kept narrow enough
          that the two never overlap. */}
      {nextPinTarget && (
        <div className="absolute top-4 left-4 z-20 max-w-[calc(100%-8rem)] bg-amber-50/95 backdrop-blur-sm text-amber-900 px-3.5 py-2.5 rounded-xl shadow-md border border-amber-200 text-xs font-bold truncate">
          {nextPinTarget === 'pickup'
            ? 'Tap the map to set your pickup'
            : 'Tap the map to set your drop-off'}
        </div>
      )}

      {/* Recenter View Button */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={handleCenterDumaguete}
          className="bg-white hover:bg-gray-50 text-gray-900 font-bold text-xs px-3.5 py-2.5 rounded-xl shadow-md border border-gray-200 flex items-center gap-1.5 transition active:scale-95"
        >
          <span>🎯</span>
          <span className="hidden sm:inline">Center</span>
        </button>
      </div>

      {/* Street Route Active Status Badge. Driver mode is checked first — the
          passenger's "searching" message must never leak onto the rider's own
          map, even when this same device also has a booking in flight. */}
      <div className="absolute bottom-4 left-4 z-10 bg-gray-900/90 backdrop-blur-sm text-white px-3.5 py-2 rounded-xl border border-gray-800 shadow-lg text-[11px] font-medium flex items-center gap-2 max-w-[calc(100%-2rem)]">
        {isDriverMode ? (
          pooledRides.length === 0 ? (
            <>
              {/* Idle and on duty — waiting for a booking to come in. */}
              <span className="w-3 h-3 rounded-full border-2 border-amber-400 border-t-transparent animate-spin shrink-0" />
              <span className="truncate">Searching for passengers…</span>
            </>
          ) : (
            <>
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
              <span className="truncate">
                {pooledRides.length} passenger{pooledRides.length > 1 ? 's' : ''} on your route
              </span>
            </>
          )
        ) : rideStatus === 'searching_driver' ? (
          <>
            {/* A spinner, not a pulse — the wait needs to look like work in progress. */}
            <span className="w-3 h-3 rounded-full border-2 border-amber-400 border-t-transparent animate-spin shrink-0" />
            <span className="truncate">Looking for a nearby rider in Dumaguete…</span>
          </>
        ) : (
          <>
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
            <span className="truncate">
              {rideStatus === 'driver_assigned' || rideStatus === 'driver_arriving'
                ? 'Rider on the way to your pickup point'
                : rideStatus === 'in_transit'
                ? 'On board — heading to your destination'
                : 'Dumaguete Street Route'}
            </span>
          </>
        )}
      </div>
    </div>
  );
};
