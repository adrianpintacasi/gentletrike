import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Driver, LocationPoint, RideBooking } from '../types';
import { getStreetRoute, LatLng } from '../utils/dumagueteRouting';
import { sequenceStops } from '../../shared/dispatch';
import { DUMAGUETE_LOCATIONS } from '../data/dumagueteData';

const getCategoryStyles = (category?: string) => {
  switch (category) {
    case 'hospital': return { bg: 'bg-red-700', svg: `<path d="M12 5v14M5 12h14"/>` };
    case 'shopping': return { bg: 'bg-purple-600', svg: `<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>` };
    case 'park': return { bg: 'bg-green-600', svg: `<path d="m8 14 4-8 4 8H8Z"/><path d="M12 14v8"/>` };
    case 'food': return { bg: 'bg-orange-500', svg: `<path d="M3 2v7c0 2.2 1.8 4 4 4h0c2.2 0 4-1.8 4-4V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>` };
    case 'transport': return { bg: 'bg-slate-500', svg: `<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>` };
    case 'port': return { bg: 'bg-cyan-600', svg: `<path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M12 10v4"/><path d="M12 2v3"/>` };
    case 'airport': return { bg: 'bg-sky-500', svg: `<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.2-1.1.6L2.5 9l8.1 4.5-3.6 3.6-3.3-.5c-.4-.1-.8.2-1 .6L2 19l4 2 2 4l1.8-.7c.4-.2.7-.6.6-1l-.5-3.3 3.6-3.6 4.5 8.1l2.2-1.2c.4-.2.7-.6.6-1.1z"/>` };
    case 'bridge': return { bg: 'bg-stone-500', svg: `<path d="M22 2v20"/><path d="M2 2v20"/><path d="M2 12h20"/><path d="M8 12v6"/><path d="M16 12v6"/><path d="M2 12c4-8 16-8 20 0"/>` };
    case 'sports': return { bg: 'bg-rose-600', svg: `<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>` };
    case 'landmark':
    default: return { bg: 'bg-blue-600', svg: `<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>` };
  }
};

interface DumagueteMapProps {
  pickup: LocationPoint | null;
  dropoff: LocationPoint | null;
  activeDriver?: Driver | null;
  driverLocation?: { lat: number; lng: number } | null;
  /** The passenger's own device, drawn as a heading arrow on their map. */
  passengerLocation?: { lat: number; lng: number; heading: number | null } | null;
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
  passengerLocation,
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
      // One route through every stop, ordered as the rider will actually drive
      // it. Stringing each trip's pickup and drop-off together in acceptance
      // order drew a zigzag: out to the first drop-off, back for the second
      // pickup. Interleaving the stops is the whole point of pooling.
      waypoints = [];
      const from = driverLocation
        ? { lat: driverLocation.lat, lng: driverLocation.lng }
        : { lat: pooledRides[0].pickupLocation.lat, lng: pooledRides[0].pickupLocation.lng };

      if (driverLocation) waypoints.push(from);

      sequenceStops(
        from,
        pooledRides.map((r) => ({
          rideId: r.id,
          // A passenger already aboard has no pickup left to make.
          pickup:
            r.status === 'in_transit'
              ? null
              : { lat: r.pickupLocation.lat, lng: r.pickupLocation.lng },
          dropoff: { lat: r.dropoffLocation.lat, lng: r.dropoffLocation.lng },
        }))
      ).forEach((s) => waypoints.push(s.at));
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

    // 0. Base Landmarks
    DUMAGUETE_LOCATIONS.forEach((loc) => {
      // Always render landmarks - keep them visible even when selected as pickup/dropoff
      
      const styles = getCategoryStyles(loc.category);
      const icon = L.divIcon({
        className: 'custom-landmark-pin',
        html: `
          <div class="group flex flex-col items-center justify-start h-full relative cursor-pointer">
            <div class="w-6 h-6 rounded-full ${styles.bg} text-white flex items-center justify-center shadow-md border-[1.5px] border-white shrink-0 transition-transform group-hover:scale-110">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                ${styles.svg}
              </svg>
            </div>
            <div class="absolute top-7 px-1.5 py-0.5 text-[10px] leading-[1.2] text-gray-900 font-bold text-center drop-shadow-md bg-white/90 backdrop-blur-sm rounded-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none z-10 border border-gray-200/50 shadow-sm" style="text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff;">
              ${loc.name}
            </div>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      const marker = L.marker([loc.lat, loc.lng], {
        icon,
        interactive: true, // required for hover to work
        zIndexOffset: -200, // behind the actual ride markers
      }).addTo(map);

      // Allow clicking the landmark to select it as the pickup/drop-off point
      marker.on('click', () => {
        if (onMapClickLocationRef.current) {
          onMapClickLocationRef.current(loc.lat, loc.lng);
        }
      });

      markersRef.current[`landmark_${loc.id}`] = marker;
    });

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

      // Green collects, red sets down, and the badge is the PASSENGER — so a
      // rider glancing at a red pin knows immediately who gets off there.
      // Numbering by stop position instead would give one passenger's pickup
      // and drop-off two different numbers, which is the one thing the badge
      // needs to make obvious. Driving order lives in the route line, the
      // panel list, and each pin's tooltip.
      const pin = (colour: 'emerald' | 'red', passenger: number) =>
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
                  ${passenger}
                </span>
              </div>
            `,
          iconSize: [36, 36],
          iconAnchor: [18, 36],
        });

      const ridesById = new Map(pooledRides.map((r) => [r.id, r]));
      const origin = driverLocation
        ? { lat: driverLocation.lat, lng: driverLocation.lng }
        : { lat: pooledRides[0].pickupLocation.lat, lng: pooledRides[0].pickupLocation.lng };

      const sequence = sequenceStops(
        origin,
        pooledRides.map((r) => ({
          rideId: r.id,
          pickup:
            r.status === 'in_transit'
              ? null
              : { lat: r.pickupLocation.lat, lng: r.pickupLocation.lng },
          dropoff: { lat: r.dropoffLocation.lat, lng: r.dropoffLocation.lng },
        }))
      );

      // Passengers are numbered by whoever the rider reaches first — the same
      // rule the panel list uses, so "Passenger 2" means the same thing in both.
      const passengerNumber = new Map<string, number>();
      for (const stop of sequence) {
        if (!passengerNumber.has(stop.rideId)) {
          passengerNumber.set(stop.rideId, passengerNumber.size + 1);
        }
      }

      sequence.forEach((stop) => {
        const ride = ridesById.get(stop.rideId);
        if (!ride) return;

        const isPickup = stop.kind === 'pickup';
        const place = isPickup ? ride.pickupLocation : ride.dropoffLocation;
        const who = passengerNumber.get(stop.rideId) ?? 1;

        const marker = L.marker([stop.at.lat, stop.at.lng], {
          icon: pin(isPickup ? 'emerald' : 'red', who),
        })
          .addTo(map)
          .bindTooltip(
            `Stop ${stop.order} · ${isPickup ? 'Pick up' : 'Drop off'} passenger ${who} · ${place.name}`,
            { direction: 'top' }
          );

        markersRef.current[`pooled_${stop.kind}_${ride.id}`] = marker;
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

      /**
       * The passenger's own device.
       *
       * Hidden once the trip is `in_transit`: at that point they are sitting in
       * the trike, so two markers would drift apart on GPS noise and imply the
       * passenger is somewhere the trike is not. The rider's marker already
       * reads "ONBOARD" and stands for both of them.
       */
      if (passengerLocation && !isInTransit) {
        const rotation = passengerLocation.heading ?? 0;

        const meIcon = L.divIcon({
          className: 'custom-me-pin',
          html: `
            <div class="gt-me-arrow" style="transform: rotate(${rotation}deg);">
              <svg viewBox="0 0 40 40" width="34" height="34" fill="none">
                <circle cx="20" cy="20" r="18" fill="#3b82f6" fill-opacity="0.15"/>
                <path d="M20 3 L27 15 L20 12 L13 15 Z" fill="#2563eb"/>
                <circle cx="20" cy="21" r="8" fill="#3b82f6" stroke="#ffffff" stroke-width="3"/>
              </svg>
            </div>
          `,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });

        const meMarker = L.marker([passengerLocation.lat, passengerLocation.lng], {
          icon: meIcon,
          // Below the pickup and rider pins — useful context, not the subject.
          zIndexOffset: -100,
        })
          .addTo(map)
          .bindTooltip('You are here', { direction: 'top' });

        markersRef.current['my_passenger'] = meMarker;
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
    // Redraws the passenger's arrow as they move and turn.
    passengerLocation?.lat,
    passengerLocation?.lng,
    passengerLocation?.heading,
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

      {/* Recenter View Button - Larger for mobile touch targets */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={handleCenterDumaguete}
          className="bg-white hover:bg-gray-50 text-gray-900 font-bold text-sm px-4 py-3 rounded-xl shadow-md border border-gray-200 flex items-center gap-2 transition active:scale-95"
        >
          <span className="text-base">🎯</span>
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
