import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Driver, LocationPoint, RideBooking } from '../types';
import { getStreetRoute, LatLng } from '../utils/dumagueteRouting';

interface DumagueteMapProps {
  pickup: LocationPoint | null;
  dropoff: LocationPoint | null;
  drivers: Driver[];
  activeDriver?: Driver | null;
  driverLocation?: { lat: number; lng: number } | null;
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
  drivers = [],
  activeDriver,
  driverLocation,
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

    if (activeDriver && driverLocation && rideStatus === 'driver_arriving' && pickup) {
      waypoints = [
        { lat: driverLocation.lat, lng: driverLocation.lng },
        { lat: pickup.lat, lng: pickup.lng },
      ];
    } else if (rideStatus === 'in_transit' && driverLocation && dropoff) {
      // Merged location during transit
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

    // 1. Render Pickup Marker (If NOT in transit) - Red Map Pin (No background padding circle)
    if (pickup && !isInTransit) {
      const pickupIcon = L.divIcon({
        className: 'custom-pickup-pin',
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
      const pickupMarker = L.marker([pickup.lat, pickup.lng], { icon: pickupIcon }).addTo(map);
      markersRef.current['pickup'] = pickupMarker;
    }

    // 2. Render Destination Dropoff Marker - Green Map Pin (No background padding circle)
    if (dropoff) {
      const dropoffIcon = L.divIcon({
        className: 'custom-dropoff-pin',
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
      const dropoffMarker = L.marker([dropoff.lat, dropoff.lng], { icon: dropoffIcon }).addTo(map);
      markersRef.current['dropoff'] = dropoffMarker;
    }

    // 3. Merged GPS Pin when Passenger Hopped In / In Transit
    if (isInTransit && driverLocation && activeDriver) {
      const mergedIcon = L.divIcon({
        className: 'custom-merged-gps-pin',
        html: `
          <div class="relative flex flex-col items-center">
            <div class="flex items-center gap-1.5 bg-gray-900 text-amber-400 font-bold px-3 py-1.5 rounded-full shadow-lg border border-amber-400/40">
              <span class="text-base">🛺</span>
              <span class="text-xs text-white">+</span>
              <span class="text-base">👤</span>
            </div>
            <div class="mt-1 bg-gray-900 text-amber-400 text-[9px] font-bold px-2 py-0.5 rounded-md shadow-sm whitespace-nowrap uppercase tracking-widest">
              PASSENGER ONBOARD
            </div>
          </div>
        `,
        iconSize: [110, 45],
        iconAnchor: [55, 22],
      });

      const mergedMarker = L.marker([driverLocation.lat, driverLocation.lng], { icon: mergedIcon }).addTo(map);
      markersRef.current['merged_gps'] = mergedMarker;
    }

    // 4. Active Rider / Driver Mode Pin
    if (isDriverMode) {
      if (driverLocation || activeDriver) {
        const lat = driverLocation ? driverLocation.lat : activeDriver ? activeDriver.currentLat : 9.3082;
        const lng = driverLocation ? driverLocation.lng : activeDriver ? activeDriver.currentLng : 123.3075;

        const riderIcon = L.divIcon({
          className: 'custom-rider-pin',
          html: `
            <div class="relative flex flex-col items-center">
              <div class="w-10 h-10 bg-gray-900 text-amber-400 rounded-full shadow-lg border border-amber-400 flex items-center justify-center text-lg">
                🛺
              </div>
              <div class="mt-1 bg-gray-900 text-amber-400 text-[9px] font-bold px-2 py-0.5 rounded-full shadow-sm whitespace-nowrap">
                MY LIVE RIDER LOCATION
              </div>
            </div>
          `,
          iconSize: [40, 48],
          iconAnchor: [20, 20],
        });

        const riderMarker = L.marker([lat, lng], { icon: riderIcon }).addTo(map);
        markersRef.current['my_rider'] = riderMarker;
      }

      // Render pooled passengers' pickups & dropoffs in rider view
      pooledRides.forEach((ride, idx) => {
        const pMarker = L.marker([ride.pickupLocation.lat, ride.pickupLocation.lng], {
          icon: L.divIcon({
            className: 'pooled-pickup-pin',
            html: `
              <div class="bg-blue-600 text-white text-[10px] font-bold px-2 py-1 rounded-lg shadow-sm">
                Pax #${idx + 1} Pickup: ${ride.pickupLocation.name.split(' ')[0]}
              </div>
            `,
            iconSize: [110, 25],
            iconAnchor: [55, 12],
          }),
        }).addTo(map);

        const dMarker = L.marker([ride.dropoffLocation.lat, ride.dropoffLocation.lng], {
          icon: L.divIcon({
            className: 'pooled-dropoff-pin',
            html: `
              <div class="bg-amber-400 text-gray-900 text-[10px] font-bold px-2 py-1 rounded-lg shadow-sm">
                Pax #${idx + 1} Dropoff: ${ride.dropoffLocation.name.split(' ')[0]}
              </div>
            `,
            iconSize: [110, 25],
            iconAnchor: [55, 12],
          }),
        }).addTo(map);

        markersRef.current[`pooled_p_${ride.id}`] = pMarker;
        markersRef.current[`pooled_d_${ride.id}`] = dMarker;
      });
    } else {
      // Passenger mode: every other pedicab currently on duty, so the map shows
      // the real fleet rather than an empty city.
      drivers
        .filter((d) => d.isOnline && d.id !== activeDriver?.id)
        .forEach((d) => {
          const idleIcon = L.divIcon({
            className: 'custom-idle-driver-pin',
            html: `
              <div class="w-7 h-7 bg-white text-gray-700 rounded-full shadow-md border border-gray-300 flex items-center justify-center text-sm opacity-90">
                🛺
              </div>
            `,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          });

          const marker = L.marker([d.currentLat, d.currentLng], { icon: idleIcon })
            .addTo(map)
            .bindTooltip(`${d.unitNumber} • available`, { direction: 'top' });
          markersRef.current[`idle_${d.id}`] = marker;
        });

      // Show assigned driver if matched
      if (!isInTransit && activeDriver) {
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
                ${activeDriver.unitNumber}
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
    drivers,
    activeDriver,
    driverLocation,
    rideStatus,
    routeStreetCoords,
    isDriverMode,
    pooledRides,
  ]);

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

      {/* Street Route Active Status Badge */}
      <div className="absolute bottom-4 left-4 z-10 bg-gray-900/90 backdrop-blur-sm text-white px-3.5 py-2 rounded-xl border border-gray-800 shadow-lg text-[11px] font-medium flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
        <span>
          {isDriverMode
            ? 'Rider View: Active Route & Onboard Passengers Only'
            : rideStatus === 'in_transit'
            ? 'Passenger On Board'
            : 'Dumaguete Street Route'}
        </span>
      </div>
    </div>
  );
};
