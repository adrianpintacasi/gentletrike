import React, { useEffect, useRef, useState } from 'react';
import { Driver, LocationPoint, PooledStop, RideBooking } from '../types';
import { bearingDegrees, getStreetRoute, haversineKm, LatLng } from '../utils/dumagueteRouting';
import { sequenceStops } from '../../shared/dispatch';
import { Crosshair, MapPinOff, MessageSquare, Layers, ShieldCheck } from 'lucide-react';
import { DUMAGUETE_LOCATIONS } from '../data/dumagueteData';
import { loadGoogleMaps, MAP_ID } from '../utils/loadGoogleMaps';

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
    default: return { bg: 'bg-trust-slate', svg: `<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>` };
  }
};

const DUMAGUETE_CENTRE = { lat: 9.3082, lng: 123.3075 };

/** How long the camera takes to settle on a newly framed trip. */
const FRAME_ANIMATION_MS = 700;

/**
 * The closest and furthest the framing camera will go.
 * Clamping zoom between 14.5 and 16.5 guarantees local street-level clarity
 * and strictly prevents zooming out to multi-island regional archipelago view.
 */
const MIN_FRAME_ZOOM = 14.5;
const MAX_FRAME_ZOOM = 16.5;

/** Tile size the Maps projection is defined against. */
const WORLD_PX = 256;

/** Mercator y for a latitude, in the projection's own radians. */
const mercatorY = (lat: number): number => {
  const s = Math.sin((lat * Math.PI) / 180);
  return Math.log((1 + s) / (1 - s)) / 2;
};

/**
 * Where the vehicle sits in the visible strip of map, top to bottom.
 *
 * Not the middle. Centring it wastes half the screen on road already driven —
 * the useful half is what is coming. Roughly two-thirds down is what every
 * navigation view settles on, and it leaves the pin clear of the sheet.
 */
const FOLLOW_ANCHOR = 0.64;

/** Metres per pixel at a given zoom and latitude, for screen-to-world offsets. */
const metresPerPixel = (lat: number, zoom: number): number =>
  (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);

/**
 * Move `km` from a point along a compass bearing.
 *
 * Used to look ahead of the vehicle rather than at it. Doing the offset in world
 * coordinates along the map's own heading is what makes it survive rotation —
 * a pixel offset would have to be un-rotated by hand, and would drift every
 * time the map turned.
 */
function pointAhead(from: LatLng, bearingDeg: number, km: number): LatLng {
  const R = 6371;
  const d = km / R;
  const b = (bearingDeg * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lng1 = (from.lng * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );

  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

/** Slow at both ends, quick through the middle — a camera, not a cut. */
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * The camera a set of bounds implies — worked out, not applied.
 *
 * `fitBounds` is the usual way to answer this, but it answers by *moving*: it
 * snaps, and there is no way to ask it what it would have done. Deriving the
 * camera ourselves is the whole basis of the animation, because it means
 * knowing where the map is going before it starts going there.
 *
 * Returns world coordinates rather than a LatLng, since interpolating a pan
 * has to happen in the projection's flat space to travel in a straight line.
 */
function cameraForBounds(
  map: google.maps.Map,
  bounds: google.maps.LatLngBounds,
  padding: { top: number; right: number; bottom: number; left: number }
): { center: google.maps.Point; zoom: number } | null {
  const projection = map.getProjection();
  const div = map.getDiv() as HTMLElement | null;
  if (!projection || !div) return null;

  const width = Math.max(120, div.clientWidth - padding.left - padding.right);
  const height = Math.max(120, div.clientHeight - padding.top - padding.bottom);

  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();

  const latFraction = Math.max(0.00005, (mercatorY(ne.lat()) - mercatorY(sw.lat())) / (2 * Math.PI));
  let lngSpan = ne.lng() - sw.lng();
  if (lngSpan < 0) lngSpan += 360;
  const lngFraction = Math.max(0.00005, lngSpan / 360);

  const calculatedZoom = Math.min(
    Math.log2(height / WORLD_PX / latFraction),
    Math.log2(width / WORLD_PX / lngFraction)
  );

  const zoom = Number.isFinite(calculatedZoom)
    ? Math.max(MIN_FRAME_ZOOM, Math.min(calculatedZoom, MAX_FRAME_ZOOM))
    : 15.5;

  // Padding is not symmetric — the bottom sheet eats the lower half of a phone
  // screen — so the trip's centre is not the camera's centre. Shift by half the
  // difference, converted from pixels to world units at the zoom we will land
  // on. Without this the route sits behind the sheet on a phone.
  const scale = Math.pow(2, zoom);
  const dx = (padding.left - padding.right) / 2;
  const dy = (padding.top - padding.bottom) / 2;

  const middle = projection.fromLatLngToPoint(bounds.getCenter());
  if (!middle) return null;

  return {
    center: new google.maps.Point(middle.x - dx / scale, middle.y - dy / scale),
    zoom,
  };
}

/**
 * Whether two polylines describe the same road.
 *
 * Compared by endpoints and length rather than every vertex: the router returns
 * a fresh array each call, and walking a few hundred points to notice they are
 * identical costs more than the redraw it prevents.
 */
function sameRoute(a: LatLng[], b: LatLng[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length || a.length === 0) return false;

  const close = (p: LatLng, q: LatLng) =>
    Math.abs(p.lat - q.lat) < 1e-6 && Math.abs(p.lng - q.lng) < 1e-6;

  const mid = Math.floor(a.length / 2);
  return (
    close(a[0], b[0]) && close(a[a.length - 1], b[b.length - 1]) && close(a[mid], b[mid])
  );
}


/**
 * Turn a marker's HTML into a positioned DOM node.
 *
 * Advanced markers place the *bottom centre* of their content on the coordinate,
 * which is what a teardrop pin wants. Icons that should sit centred on their
 * point — the landmark dots, the heading arrows — are pushed down half their own
 * height by an outer wrapper, so any transform on the inner element (the compass
 * rotation, for one) survives untouched.
 */
function markerContent(html: string, anchor: 'bottom' | 'centre'): HTMLElement {
  const outer = document.createElement('div');
  outer.innerHTML = html.trim();
  if (anchor === 'centre') outer.style.transform = 'translateY(50%)';
  return outer;
}

type MarkerStore = Record<string, google.maps.marker.AdvancedMarkerElement>;

/** Detach every marker from the map. Setting `map` to null is the removal API. */
function clearMarkers(store: MarkerStore): void {
  for (const key of Object.keys(store)) store[key].map = null;
}

/**
 * Create a marker, or move the one that is already there.
 *
 * The effect below used to clear every marker and build them again on each run,
 * and it runs on every GPS ping, driver poll and route change. Destroying a DOM
 * node and inserting a replacement in the same place is exactly what a flicker
 * looks like. Reusing the element means a marker that only moved just moves.
 */
function upsertMarker(
  store: MarkerStore,
  key: string,
  map: google.maps.Map,
  position: google.maps.LatLngLiteral,
  html: string,
  anchor: 'bottom' | 'centre',
  options: { zIndex?: number; title?: string; clickable?: boolean } = {}
): google.maps.marker.AdvancedMarkerElement {
  const existing = store[key];

  if (existing) {
    existing.position = position;
    if (options.zIndex !== undefined) existing.zIndex = options.zIndex;
    const content = existing.content as HTMLElement | null;
    // Only touch the DOM when the markup genuinely differs; rewriting identical
    // innerHTML restarts every CSS animation inside it.
    if (content && content.dataset.html !== html) {
      content.innerHTML = html.trim();
      content.dataset.html = html;
    }
    if (content && options.title) content.title = options.title;
    return existing;
  }

  const content = markerContent(html, anchor);
  content.dataset.html = html;
  if (options.title) content.title = options.title;

  const marker = new google.maps.marker.AdvancedMarkerElement({
    map,
    position,
    content,
    ...(options.zIndex !== undefined ? { zIndex: options.zIndex } : {}),
    ...(options.clickable ? { gmpClickable: true } : {}),
  });
  store[key] = marker;
  return marker;
}

/** Detach markers whose keys were not written on this pass. */
function pruneMarkers(store: MarkerStore, keep: Set<string>): void {
  for (const key of Object.keys(store)) {
    if (keep.has(key)) continue;
    store[key].map = null;
    delete store[key];
  }
}

/**
 * Camera pitch while navigating, in degrees.
 *
 * Enough to raise the buildings and open the road out ahead; past about 60 the
 * near foreground swells and the route disappears over the horizon.
 */
const NAVIGATION_TILT = 47.5;

/** Below this zoom the vector basemap does not extrude buildings at all. */
const BUILDINGS_MIN_ZOOM = 16;

/**
 * How far ahead along the route to aim the camera.
 *
 * Far enough that a single bend does not swing the view, close enough that the
 * turn being taken is the one the map is pointing at.
 */
const LOOK_AHEAD_KM = 0.06;

/** Fraction of the remaining turn applied per update, so rotation eases. */
const HEADING_EASING = 0.35;

/**
 * How long the drawn position takes to reach a new fix.
 *
 * Slightly longer than the ~1s the browser takes to deliver the next one, so
 * the marker is still moving when it arrives and never visibly stalls between
 * updates. Too long and it lags behind the road; this is close to the interval.
 */
const SELF_EASE_MS = 1100;

/**
 * Bearing from the start of the path to a point a fixed *distance* along it.
 *
 * Walking by distance rather than by vertex count is the whole point: the
 * router's spacing is not uniform, so counting points gives a look-ahead that
 * changes length as the road does.
 */
function courseAhead(path: LatLng[], km: number): number | null {
  if (path.length < 2) return null;

  const from = path[0];
  let travelled = 0;

  for (let i = 1; i < path.length; i++) {
    travelled += haversineKm(path[i - 1], path[i]);
    if (travelled >= km) return bearingDegrees(from, path[i]);
  }

  // Route shorter than the look-ahead — aim at the end of it.
  return bearingDegrees(from, path[path.length - 1]);
}

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
  /**
   * The rider's committed stops, when this passenger is sharing the trike.
   *
   * Ends at this passenger's own drop-off. Given, the map draws the road the
   * rider will really take; withheld, it falls back to the direct line, which
   * is correct for a trip nobody else is on.
   */
  poolPath?: PooledStop[];
  /**
   * The rider's live duty state, for the status chip.
   *
   * The chip used to show a spinner and the words "Searching for passengers",
   * whatever was actually true — off duty, full, or three offers waiting. A
   * spinner also says "loading", which is the one thing it never meant.
   */
  riderStatus?: { online: boolean; waiting: number; seatsFree: number };
  pooledRides?: RideBooking[];
  isDriverMode?: boolean;
  /** Which end the next tap fills, or null when tapping does nothing. */
  nextPinTarget?: 'pickup' | 'dropoff' | null;
  onMapClickLocation?: (lat: number, lng: number) => void;
  /**
   * Pixels of the map hidden behind the bottom sheet on a phone.
   *
   * Framing a route without this puts half of it under the sheet, so the
   * passenger fits a trip on screen and then cannot see where it goes.
   */
  bottomInset?: number;
  /** Full-bleed on a phone; a rounded card inside the desktop column. */
  fullBleed?: boolean;
  /**
   * Draw Google's live traffic layer over the roads.
   *
   * Left to the caller rather than defaulted on. Congestion is worth colouring
   * the roads for when a trip is actually happening; on the idle home map it is
   * decoration that competes with the route line for the same pixels.
   */
  /**
   * Draw the saved pickup points as pins.
   *
   * Thirteen labelled dots over a phone-sized map is most of the screen, and a
   * passenger who is about to search for a destination is not helped by them.
   * Kept for the desktop column, where there is room.
   */
  showLandmarks?: boolean;
  /** Opens the emergency safety assistance modal with hotline dialers */
  onOpenSafetyModal?: () => void;
}

export const DumagueteMap: React.FC<DumagueteMapProps> = ({
  pickup,
  dropoff,
  activeDriver,
  driverLocation,
  passengerLocation,
  driverHeading,
  rideStatus,
  poolPath,
  riderStatus,
  pooledRides = [],
  isDriverMode = false,
  nextPinTarget,
  onMapClickLocation,
  bottomInset = 0,
  fullBleed = false,
  showLandmarks = true,
  showTraffic = false,
  followHeading = false,
  unreadMessages = 0,
  onOpenMessages,
  onOpenSafetyModal,
}) => {
  const [trafficOn, setTrafficOn] = useState(showTraffic);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  /** Best-known position at the moment the map is built. See the init effect. */
  const openingCentreRef = useRef<LatLng | null>(null);
  /** Whether the camera has reached the user yet. See the follow effect. */
  const hasCentredOnSelfRef = useRef(false);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Record<string, google.maps.marker.AdvancedMarkerElement>>({});
  const routePolylineRef = useRef<google.maps.Polyline | null>(null);
  const routePolylineGlowRef = useRef<google.maps.Polyline | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Real-time compass rotation for the rider's arrow. Driven imperatively from
  // the device-orientation sensor rather than React state, so it can update at
  // sensor speed without re-rendering the whole map on every tick.
  const arrowElRef = useRef<HTMLElement | null>(null);
  const arrowRotationRef = useRef(0); // accumulated degrees (may exceed 360)
  const compassActiveRef = useRef(false);
  /** Live compass bearing, 0-360 from north. Null until the sensor reports. */
  const compassHeadingRef = useRef<number | null>(null);
  /** Bumped on each compass reading so the map's heading effect re-runs. */
  const [compassTick, setCompassTick] = useState(0);

  const [routeStreetCoords, setRouteStreetCoords] = useState<LatLng[]>([]);

  // View-control state. `userAdjustedView` latches once the passenger moves the
  // map themselves; `programmaticMove` marks moves we made, so our own
  // fitBounds is not mistaken for a user gesture.
  const userAdjustedViewRef = useRef(false);
  const programmaticMoveRef = useRef(false);
  const programmaticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Route we have already framed, so a new pickup/dropoff pair fits exactly once. */
  const fittedRouteRef = useRef<string | null>(null);

  /**
   * This device's own position.
   *
   * In rider mode `driverLocation` is the rider's own GPS; for a passenger it
   * is the trike they are watching, so their own fix is the separate one. Both
   * answer the same question — where is the person holding this phone — and the
   * camera needs one answer, not two.
   */
  const rawSelfLocation = isDriverMode
    ? driverLocation ?? null
    : passengerLocation
      ? { lat: passengerLocation.lat, lng: passengerLocation.lng }
      : null;

  /*
   * The position drawn on screen, eased between fixes.
   *
   * We are not using a Google positioning SDK — there is no such thing for the
   * web. Position comes from the browser's own `navigator.geolocation`, which
   * delivers a discrete fix roughly once a second. The Google Maps app looks
   * smooth because it fuses GPS with the accelerometer and gyroscope and draws
   * an interpolated position sixty times a second; a web page gets neither
   * sensor fusion nor those callbacks.
   *
   * What a web page can do is interpolate. Rather than teleporting the marker a
   * whole second's travel at a time, this walks it from the last drawn point to
   * the newest fix over the interval between them. Same data, same accuracy —
   * it simply stops arriving as a series of jumps.
   */
  const [smoothSelf, setSmoothSelf] = useState<LatLng | null>(rawSelfLocation);
  const easeFromRef = useRef<LatLng | null>(null);
  const easeToRef = useRef<LatLng | null>(null);
  const easeStartRef = useRef(0);
  const easeRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!rawSelfLocation) {
      setSmoothSelf(null);
      return;
    }

    const from = easeToRef.current ?? rawSelfLocation;
    const jumpKm = haversineKm(from, rawSelfLocation);

    // A teleport is not motion: a first fix, a simulated location, or a jump no
    // vehicle could have made is adopted outright rather than slid to.
    if (jumpKm > 0.25) {
      easeFromRef.current = null;
      easeToRef.current = rawSelfLocation;
      setSmoothSelf(rawSelfLocation);
      return;
    }

    easeFromRef.current = from;
    easeToRef.current = rawSelfLocation;
    easeStartRef.current = performance.now();

    if (easeRafRef.current !== null) cancelAnimationFrame(easeRafRef.current);

    const step = () => {
      const a = easeFromRef.current;
      const b = easeToRef.current;
      if (!a || !b) return;

      const t = Math.min(1, (performance.now() - easeStartRef.current) / SELF_EASE_MS);
      setSmoothSelf({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      });
      easeRafRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };

    easeRafRef.current = requestAnimationFrame(step);
    return () => {
      if (easeRafRef.current !== null) cancelAnimationFrame(easeRafRef.current);
    };
  }, [rawSelfLocation?.lat, rawSelfLocation?.lng]);

  const selfLocation = smoothSelf ?? rawSelfLocation;

  /**
   * Padding that keeps a framed route clear of the sheet and the top pills.
   *
   * The 60px gap below only applies when there is no sheet. `bottomInset` is
   * already the sheet's exact height, so adding a full gap on top of it spent
   * another 60px of a phone's usable strip on nothing — and that strip is the
   * scarcest thing on the screen.
   */
  const framePadding = () => {
    const div = mapInstanceRef.current?.getDiv() as HTMLElement | null;
    const maxBottom = div ? Math.min(bottomInset, div.clientHeight * 0.42) : Math.min(bottomInset, 220);
    return {
      top: 72,
      right: 48,
      bottom: (maxBottom > 0 ? 16 : 48) + maxBottom,
      left: 48,
    };
  };

  /** Wrap a view change so the zoom change it raises is not read as user input. */
  const moveMap = (apply: (map: google.maps.Map) => void) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    programmaticMoveRef.current = true;
    if (programmaticTimerRef.current) clearTimeout(programmaticTimerRef.current);
    // Safety net: if the view was already correct, no idle fires to clear it.
    programmaticTimerRef.current = setTimeout(() => {
      programmaticMoveRef.current = false;
    }, 800);
    apply(map);
  };

  /** The facing currently applied to the map, so framing can preserve it. */
  const appliedHeadingRef = useRef<number | null>(null);

  /** In-flight framing animation, so a new one or a user gesture can stop it. */
  const frameAnimationRef = useRef<number | null>(null);

  const stopFraming = () => {
    if (frameAnimationRef.current !== null) {
      cancelAnimationFrame(frameAnimationRef.current);
      frameAnimationRef.current = null;
    }
  };

  useEffect(() => stopFraming, []);

  /**
   * Ease the camera onto a set of bounds instead of snapping to them.
   *
   * `fitBounds` arrives in a single frame, which on a phone reads less as a
   * camera move than as the map having been replaced — and when the jump is
   * large it is easy to mistake for a stall. Interpolating pan and zoom
   * together over {@link FRAME_ANIMATION_MS} keeps the roads under the route
   * continuous, so the eye follows them out to the wider view.
   *
   * Only possible because the map is a vector map: raster maps quantise zoom to
   * integers, which would make this eight visible steps rather than a movement.
   */
  const frameBounds = (bounds: google.maps.LatLngBounds) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    stopFraming();

    const padding = framePadding();
    const target = cameraForBounds(map, bounds, padding);
    const projection = map.getProjection();
    const from = map.getCenter();
    const fromZoom = map.getZoom();
    const start = from && projection ? projection.fromLatLngToPoint(from) : null;

    // Anything missing — no projection yet, a zero-sized container — and the
    // honest fallback is street scale centering.
    if (!target || !projection || !start || fromZoom == null || prefersReducedMotion()) {
      const facing = appliedHeadingRef.current;
      moveMap((m) => {
        const center = bounds.getCenter();
        m.setCenter(center);
        m.setZoom(15.5);
        if (facing !== null) m.setHeading(((facing % 360) + 360) % 360);
      });
      return;
    }

    const began = performance.now();

    const step = () => {
      if (!mapInstanceRef.current) return;
      const progress = Math.min(1, (performance.now() - began) / FRAME_ANIMATION_MS);
      const eased = easeInOutCubic(progress);

      const centre = projection.fromPointToLatLng(
        new google.maps.Point(
          start.x + (target.center.x - start.x) * eased,
          start.y + (target.center.y - start.y) * eased
        )
      );

      // Routed through moveMap so every frame refreshes the "this was us"
      // guard: an animation raises a stream of zoom_changed events, and one of
      // them landing outside the guard would latch the view as user-adjusted
      // and stop the map following ever again.
      moveMap((m) =>
        m.moveCamera({
          ...(centre ? { center: centre } : {}),
          zoom: fromZoom + (target.zoom - fromZoom) * eased,
          // Carried explicitly. Omitting it relies on moveCamera merging rather
          // than replacing, and a heading silently lost here is invisible until
          // somebody is following a road by it.
          ...(appliedHeadingRef.current !== null
            ? { heading: ((appliedHeadingRef.current % 360) + 360) % 360 }
            : {}),
        })
      );

      frameAnimationRef.current = progress < 1 ? requestAnimationFrame(step) : null;
    };

    frameAnimationRef.current = requestAnimationFrame(step);
  };

  // Identity of the current trip. Driver GPS deliberately does not appear here:
  // the map must not chase a moving pedicab around.
  const routeSignature = [
    pickup?.lat, pickup?.lng, pickup?.pickedOnMap,
    dropoff?.lat, dropoff?.lng, dropoff?.pickedOnMap,
  ].join('|');

  /**
   * Whether the map itself turns with the phone.
   *
   * Only for a rider, and only when there is no route to steer by. A route is
   * the better source while one exists — it knows a bend is coming before the
   * rider reaches it, where the compass only ever reports where the handlebars
   * are pointing right now. But most of a shift has no route, and that is
   * exactly when a north-up map is hardest to read against the road.
   *
   * The trade-off is real and worth knowing: on a mount this is excellent, and
   * held in the hand the map turns as the wrist does.
   */
  const mapFollowsCompass = isDriverMode && routeStreetCoords.length < 2;

  if (!mapInstanceRef.current && rawSelfLocation) {
    openingCentreRef.current = rawSelfLocation;
  }

  /** Both ends known and the road geometry in — there is a whole trip to show. */
  const hasWholeTrip = !!pickup && !!dropoff && routeStreetCoords.length >= 2;

  /**
   * Which leg of the journey is on screen.
   *
   * Coarser than the ride status on purpose. The camera should move when the
   * journey changes *shape* — a rider starts coming, a passenger gets in — and
   * not every time the server relabels a status. Three phases, three framings:
   *
   *   quote     the trip being priced, pickup to drop-off
   *   approach  the rider closing in, their position to the pickup
   *   transit   aboard, their position to the destination
   *
   * The route effect below reads the same value, so the line being drawn and
   * the camera framing it can never disagree about which leg this is.
   */
  const ridePhase: 'quote' | 'approach' | 'transit' =
    rideStatus === 'in_transit'
      ? 'transit'
      : rideStatus === 'driver_assigned' || rideStatus === 'driver_arriving'
        ? 'approach'
        : 'quote';

  /**
   * The rider's stops between here and one end of this passenger's trip.
   *
   * On a shared trike the honest line from the rider to a passenger runs
   * through everyone the rider collects or sets down first. Slicing the path
   * at the passenger's own pickup gives the approach; the whole path ends at
   * their drop-off and gives the ride.
   *
   * Null whenever the trip is not shared, which is the ordinary case — the
   * caller then falls back to the direct route, and nothing changes.
   */
  const pooledLegTo = (kind: 'pickup' | 'dropoff'): LatLng[] | null => {
    if (!poolPath || poolPath.length === 0) return null;
    const end = poolPath.findIndex((s) => s.mine && s.kind === kind);
    if (end === -1) return null;
    return poolPath.slice(0, end + 1).map((s) => ({ lat: s.lat, lng: s.lng }));
  };

  /**
   * What the pooled path looks like, ignoring exactly where its stops are.
   *
   * Enough to notice a stop being consumed — someone else collected, someone
   * else set down — which reshapes this passenger's journey and so deserves a
   * re-framing. The coordinates are left out on purpose: the ordering can
   * re-optimise as the rider moves, and re-framing the map over a swap between
   * two stops that are equally far away would be motion without information.
   */
  const poolSignature = poolPath
    ? poolPath.map((s) => `${s.kind}${s.mine ? '*' : ''}`).join(',')
    : '';

  /**
   * What "already framed" means.
   *
   * The trip's identity is not enough on its own: the same trip framed against
   * a half-open sheet and against a peeking one wants two different cameras.
   * Booking happens with the sheet at 0.55 of the screen and the ride begins
   * with it at 0.26, so a route framed during booking — into a strip about
   * 60px tall — stayed at that far-too-wide zoom for the whole trip, even once
   * the sheet dropped and gave it four times the room.
   *
   * Keying on the visible area as well means the sheet settling re-frames the
   * route, which is now an eased move rather than a jump. The sheet reports
   * only on settle and never mid-drag, so this cannot thrash. On desktop
   * `bottomInset` is a constant 0, so nothing here changes.
   *
   * The phase belongs here for the same reason. A rider accepting swaps the
   * drawn line from "your trip" to "the rider coming to get you", but the
   * pickup and drop-off it is keyed on have not moved — so the camera sat on
   * the old framing and the passenger watched a rider approach from off
   * screen. Note what is deliberately *not* here: the driver's live position.
   * Framing on that would re-frame the map on every GPS ping.
   */
  const frameKey = `${routeSignature}|${bottomInset}|${ridePhase}|${poolSignature}`;

  // Ref to store latest click handler to prevent stale closures
  const onMapClickLocationRef = useRef(onMapClickLocation);
  useEffect(() => {
    onMapClickLocationRef.current = onMapClickLocation;
  }, [onMapClickLocation]);

  // Initialise the map once the API script has landed.
  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !mapContainerRef.current || mapInstanceRef.current) return;

        const map = new google.maps.Map(mapContainerRef.current, {
          /*
           * Open on the user if their fix has landed, otherwise Dumaguete.
           *
           * Read from a ref, not the prop, because this effect runs exactly
           * once and must not re-run when a position arrives — rebuilding the
           * map bills another load. The follow camera moves it the moment a fix
           * exists; this only decides what is on screen for the second before
           * that, and Dumaguete was the wrong answer for anyone who is not
           * there.
           */
          center: openingCentreRef.current ?? DUMAGUETE_CENTRE,
          zoom: 15,
          minZoom: 13.5,
          maxZoom: 19,
          // Advanced markers require a Map ID; styling now lives in the cloud
          // console rather than in a tile URL.
          mapId: MAP_ID,
          disableDefaultUI: true,
          zoomControl: true,
          // Right-centre keeps the zoom buttons clear of the Center pill above
          // and the bottom sheet below, at every snap point.
          zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER },
          clickableIcons: false,
          gestureHandling: 'greedy',
        });

        mapInstanceRef.current = map;

        map.addListener('click', (event: google.maps.MapMouseEvent) => {
          if (event.latLng && onMapClickLocationRef.current) {
            onMapClickLocationRef.current(event.latLng.lat(), event.latLng.lng());
          }
        });

        // Once the passenger pans or zooms, the view is theirs. Markers
        // re-render every few seconds as GPS and the fleet poll come in, and any
        // automatic recentre on those would yank the map back while they are
        // reading it. Only the Center button hands control back.
        map.addListener('dragstart', () => {
          userAdjustedViewRef.current = true;
          // A hand on the map outranks a camera move already under way.
          stopFraming();
        });
        map.addListener('zoom_changed', () => {
          // fitBounds/setZoom also change zoom, so ignore our own moves. The
          // animation check is belt and braces: `idle` can fire between frames
          // and clear the guard, and a zoom raised by our own rAF loop must
          // never be read as the user reaching for the map.
          if (!programmaticMoveRef.current && frameAnimationRef.current === null) {
            userAdjustedViewRef.current = true;
          }
        });
        map.addListener('idle', () => {
          programmaticMoveRef.current = false;
        });

        setIsReady(true);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      });

    return () => {
      cancelled = true;
      if (programmaticTimerRef.current) clearTimeout(programmaticTimerRef.current);
      clearMarkers(markersRef.current);
      markersRef.current = {};
      routePolylineRef.current?.setMap(null);
      routePolylineGlowRef.current?.setMap(null);
      if (mapInstanceRef.current) {
        google.maps.event.clearInstanceListeners(mapInstanceRef.current);
        mapInstanceRef.current = null;
      }
    };
  }, []);

  /**
   * Google's live traffic, drawn over the roads.
   *
   * The layer is built once and then attached or detached with `setMap`.
   * Constructing a new one per toggle would re-request the tiles and flash the
   * roads, which is the same mistake the markers used to make.
   *
   * It costs nothing extra: the traffic layer rides on the map load already
   * paid for, unlike the routing call, which does change SKU when it is asked
   * to account for traffic.
   */
  const trafficLayerRef = useRef<google.maps.TrafficLayer | null>(null);
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isReady) return;

    if (!trafficLayerRef.current) {
      trafficLayerRef.current = new google.maps.TrafficLayer({ autoRefresh: true });
    }
    const isEnabled = trafficOn ?? showTraffic;
    trafficLayerRef.current.setMap(isEnabled ? map : null);
  }, [isReady, trafficOn, showTraffic]);

  // Fetch street routing coordinates (Routes API geometry, via /api/route)
  useEffect(() => {
    let waypoints: LatLng[] = [];

    // Before pickup, the passenger wants to watch the rider closing in on them,
    // so route from the pedicab to the pickup point — through any stop the
    // rider is making first, on a shared trike.
    if (ridePhase === 'approach' && driverLocation && pickup) {
      waypoints = [
        { lat: driverLocation.lat, lng: driverLocation.lng },
        ...(pooledLegTo('pickup') ?? [{ lat: pickup.lat, lng: pickup.lng }]),
      ];
    } else if (ridePhase === 'transit' && driverLocation && dropoff) {
      // Passenger is aboard: the route becomes the run to the destination they
      // pinned when booking, by way of whoever else is sharing the trike.
      waypoints = [
        { lat: driverLocation.lat, lng: driverLocation.lng },
        ...(pooledLegTo('dropoff') ?? [{ lat: dropoff.lat, lng: dropoff.lng }]),
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
          // A passenger already aboard has no pickup left to make, but where they
          // got on is still what their journey is measured against.
          pickup:
            r.status === 'in_transit'
              ? null
              : { lat: r.pickupLocation.lat, lng: r.pickupLocation.lng },
          dropoff: { lat: r.dropoffLocation.lat, lng: r.dropoffLocation.lng },
          origin: { lat: r.pickupLocation.lat, lng: r.pickupLocation.lng },
        }))
      ).forEach((s) => waypoints.push(s.at));
    }

    if (waypoints.length >= 2) {
      // A request goes out every time the driver moves, so responses can land
      // out of order. Ignore any that resolve after this effect has been
      // superseded, otherwise the route snaps back to a stale geometry.
      let cancelled = false;
      // Traffic-aware only once a trip is running. A fare quote is charged on
      // distance, so paying the higher-tier routing call for it would buy a
      // number the ordinance ignores.
      const live = ridePhase !== 'quote';

      getStreetRoute(waypoints, { trafficAware: live }).then((route) => {
        if (cancelled) return;
        // Only accept genuinely different geometry. Traffic-aware routes are
        // deliberately not cached, so an unchanged road came back as a brand
        // new array on every GPS ping — a state change, and with it a full
        // teardown and rebuild of every marker on the map.
        setRouteStreetCoords((previous) =>
          sameRoute(previous, route.coords) ? previous : route.coords
        );
      });
      return () => {
        cancelled = true;
      };
    }

    // Keep the existing reference when it is already empty. Handing back a new
    // [] would be a state change, re-render, and re-run this effect forever.
    setRouteStreetCoords((prev) => (prev.length === 0 ? prev : []));
  }, [
    pickup,
    dropoff,
    activeDriver,
    driverLocation,
    ridePhase,
    poolSignature,
    pooledRides,
    isDriverMode,
  ]);

  /**
   * The saved pickup points, drawn once.
   *
   * These were built inside the effect below, which tears down every marker it
   * owns and rebuilds them. That effect re-runs on each driver poll, GPS ping
   * and route change — several times a second — so thirteen fixed landmarks
   * were being destroyed and recreated continuously. That was the flicker.
   */
  const landmarkMarkersRef = useRef<MarkerStore>({});

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isReady) return;

    clearMarkers(landmarkMarkersRef.current);
    landmarkMarkersRef.current = {};

    const { AdvancedMarkerElement } = google.maps.marker;

    if (!isDriverMode && showLandmarks) {
      DUMAGUETE_LOCATIONS.forEach((loc) => {
        // Always render landmarks - keep them visible even when selected as pickup/dropoff
        const styles = getCategoryStyles(loc.category);

        const marker = new AdvancedMarkerElement({
          map,
          position: { lat: loc.lat, lng: loc.lng },
          zIndex: -200, // behind the actual ride markers
          gmpClickable: true,
          content: markerContent(
            `
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
            'centre'
          ),
        });

        // Allow clicking the landmark to select it as the pickup/drop-off point
        marker.addListener('click', () => {
          onMapClickLocationRef.current?.(loc.lat, loc.lng);
        });

        landmarkMarkersRef.current[`landmark_${loc.id}`] = marker;
      });
    }


    return () => {
      clearMarkers(landmarkMarkersRef.current);
      landmarkMarkersRef.current = {};
    };
  }, [isReady, isDriverMode, showLandmarks]);

  // Render Markers and Polyline (Sleek pins, no heavy black borders)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isReady) return;

    // Keys written this pass; anything else is pruned at the end. Wiping first
    // meant every marker was destroyed and rebuilt on each run — the flicker.
    const live = new Set<string>();

    routePolylineRef.current?.setMap(null);
    routePolylineRef.current = null;
    routePolylineGlowRef.current?.setMap(null);
    routePolylineGlowRef.current = null;

    const isInTransit = rideStatus === 'in_transit';

    /** The teardrop both ends of a trip are drawn with. */
    const teardrop = (colour: string) => `
      <div class="relative flex flex-col items-center filter drop-shadow-md">
        <svg class="w-9 h-9 ${colour}" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
      </div>
    `;

    // 1. Pickup — GREEN pin. Green means "get on here", red means "journey
    //    ends here", and the rider's pooled pins below follow the same rule so
    //    both sides of a trip read the map identically.
    if (pickup && !isInTransit) {
      upsertMarker(markersRef.current, 'pickup', map,
        { lat: pickup.lat, lng: pickup.lng }, teardrop('text-emerald-600'), 'bottom');
      live.add('pickup');
    }

    // 2. Destination — RED pin.
    if (dropoff) {
      upsertMarker(markersRef.current, 'dropoff', map,
        { lat: dropoff.lat, lng: dropoff.lng }, teardrop('text-red-600'), 'bottom');
      live.add('dropoff');
    }

    // 3. Searching: pulse rings over the pickup point so the wait reads as
    //    something actively happening rather than a frozen map.
    if (pickup && rideStatus === 'searching_driver') {
      upsertMarker(markersRef.current, 'searching_radar', map,
        { lat: pickup.lat, lng: pickup.lng },
        `<div class="gt-radar"><span></span><span></span><span></span></div>`,
        'centre', { zIndex: -500 });
      live.add('searching_radar');
    }

    // 4. The rider's own device: a heading arrow, not a trike badge. It turns
    //    with them so they can read it like a navigation cursor.
    if (isDriverMode) {
      /*
       * No position, no marker.
       *
       * This fell back to the city centre, so a rider whose first fix had not
       * landed saw their own chevron sitting in Dumaguete — a vehicle drawn at
       * a coordinate nobody was at, which is worse than drawing nothing for the
       * second before the fix arrives.
       */
      const here = driverLocation ?? (activeDriver
        ? { lat: activeDriver.currentLat, lng: activeDriver.currentLng }
        : null);

      if (here) {
        const lat = here.lat;
        const lng = here.lng;
        const rotation = typeof driverHeading === 'number' ? driverHeading : 0;

        // A navigation chevron in the Waze / Google Maps idiom, in solid black.
        // No outline — the light basemap already gives it plenty of contrast,
        // and the drop shadow keeps it from disappearing over dark tiles.
        const arrowHtml = `
            <div class="gt-heading-arrow" style="transform: rotate(${rotation}deg);">
              <svg viewBox="0 0 40 40" width="40" height="40" fill="none">
                <circle cx="20" cy="20" r="17" fill="#111827" fill-opacity="0.12"/>
                <path d="M20 6 L31 32 L20 26.2 L9 32 Z"
                      fill="#111827" stroke-linejoin="round"/>
              </svg>
            </div>
          `;

        const riderMarker = upsertMarker(markersRef.current, 'my_rider', map,
          { lat, lng }, arrowHtml, 'centre', { zIndex: 400 });
        live.add('my_rider');
        const content = riderMarker.content as HTMLElement;

        // This effect recreates the arrow element, so re-grab it and, if the
        // compass is already live, restore the accumulated rotation — otherwise
        // it would snap back to the GPS-based angle baked into the icon HTML.
        const el = content.querySelector('.gt-heading-arrow') as HTMLElement | null;
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
      if (pooledRides.length > 0) {
        const numberedPin = (colour: 'emerald' | 'red', passenger: number) => `
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
        `;

        const ridesById = new Map(pooledRides.map((r) => [r.id, r]));
        const origin = driverLocation
          ? { lat: driverLocation.lat, lng: driverLocation.lng }
          : activeDriver
          ? { lat: activeDriver.currentLat, lng: activeDriver.currentLng }
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
            origin: { lat: r.pickupLocation.lat, lng: r.pickupLocation.lng },
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

          const key = `pooled_${stop.kind}_${ride.id}`;
          // Advanced markers have no tooltip of their own; the native title
          // attribute carries the same text on hover and long-press.
          upsertMarker(markersRef.current, key, map,
            { lat: stop.at.lat, lng: stop.at.lng },
            numberedPin(isPickup ? 'emerald' : 'red', who), 'bottom',
            {
              title: `Stop ${stop.order} · ${
                isPickup ? 'Pick up' : 'Drop off'
              } passenger ${who} · ${place.name}`,
            });
          live.add(key);
        });
      }
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

        const driverKey = `active_driver_${activeDriver.id}`;
        upsertMarker(markersRef.current, driverKey, map, { lat, lng },
          `
            <div class="relative flex flex-col items-center">
              <div class="w-11 h-11 bg-trust-slate text-trike-gold rounded-full shadow-lg border-2 border-trike-gold flex items-center justify-center filter drop-shadow-md">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 17h16" />
                  <path d="M9 17v-4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4" />
                  <circle cx="7" cy="17" r="2" fill="#F0A830" stroke="#123B3D" stroke-width="1.5" />
                  <circle cx="17" cy="17" r="2" fill="#F0A830" stroke="#123B3D" stroke-width="1.5" />
                  <path d="M7 11V7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v4" />
                  <circle cx="12" cy="7" r="1.5" fill="#F0A830" />
                </svg>
              </div>
              <div class="mt-1 bg-trust-slate text-trike-gold text-[9px] font-display font-black px-2 py-0.5 rounded-full shadow-md whitespace-nowrap border border-cream-400/30">
                ${isInTransit ? 'ONBOARD' : activeDriver.unitNumber || 'UNIT #104'}
              </div>
            </div>
          `, 'centre', { zIndex: 300 });
        live.add(driverKey);
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

        const meHtml = `
            <div class="gt-me-arrow" style="transform: rotate(${rotation}deg);">
              <svg viewBox="0 0 40 40" width="34" height="34" fill="none">
                <circle cx="20" cy="20" r="18" fill="#3b82f6" fill-opacity="0.15"/>
                <path d="M20 3 L27 15 L20 12 L13 15 Z" fill="#2563eb"/>
                <circle cx="20" cy="21" r="8" fill="#3b82f6" stroke="#ffffff" stroke-width="3"/>
              </svg>
            </div>
          `;

        // Below the pickup and rider pins — useful context, not the subject.
        const meMarker = upsertMarker(markersRef.current, 'my_passenger', map,
          { lat: passengerLocation.lat, lng: passengerLocation.lng },
          meHtml, 'centre', { zIndex: -100, title: 'You are here' });
        live.add('my_passenger');

        /*
         * Hand this arrow to the compass, exactly as the rider's is.
         *
         * The listener writes to whatever element this ref holds, and it only
         * ever held the rider's chevron — so ungating the listener alone left
         * the passenger's arrow still turning from GPS course, which is null
         * while standing still. This effect rebuilds the element, so it is
         * re-grabbed and any accumulated rotation restored.
         */
        const meContent = meMarker.content as HTMLElement | null;
        const meEl = meContent?.querySelector('.gt-me-arrow') as HTMLElement | null;
        arrowElRef.current = meEl;
        if (meEl && compassActiveRef.current) {
          meEl.style.transform = `rotate(${arrowRotationRef.current}deg)`;
        }
      }
    }

    // 5. Draw Street-Aligned Route Polyline
    const validCoords = routeStreetCoords.filter(
      (c) => c && typeof c.lat === 'number' && typeof c.lng === 'number' && Number.isFinite(c.lat) && Number.isFinite(c.lng)
    );

    if (validCoords.length >= 2) {
      const path = validCoords.map((c) => ({ lat: c.lat, lng: c.lng }));

      routePolylineRef.current = new google.maps.Polyline({
        map,
        path,
        strokeColor: '#1F2937',
        strokeWeight: 7,
        strokeOpacity: 0.85,
        zIndex: 1,
      });

      routePolylineGlowRef.current = new google.maps.Polyline({
        map,
        path,
        strokeColor: '#F59E0B',
        strokeWeight: 4,
        strokeOpacity: 1,
        zIndex: 2,
      });
    }
    // Anything not written this pass belonged to a previous state.
    pruneMarkers(markersRef.current, live);

    // Framing the view is deliberately NOT done here. This effect re-runs on
    // every driver GPS ping and fleet poll, so recentring from it is what threw
    // the map back to Dumaguete centre while the passenger was zoomed in.
  }, [
    isReady,
    pickup,
    dropoff,
    activeDriver,
    driverLocation,
    rideStatus,
    routeStreetCoords,
    isDriverMode,
    pooledRides,
    // Redraws the passenger's arrow as they move and turn.
    passengerLocation?.lat,
    passengerLocation?.lng,
    passengerLocation?.heading,
  ]);

  /**
   * Tilt the camera, which is also what raises the buildings.
   *
   * There is no "show buildings" switch in the Maps JavaScript API. Extruded
   * buildings are a property of the *vector* basemap, and they only appear once
   * the camera is tilted off vertical and zoomed in far enough — a flat map is
   * drawn as a plan, so there is nothing to raise.
   *
   * Applied while following a route, for either role: at that point the map is
   * being read like a windscreen, and the buildings are what make a junction
   * recognisable from inside a moving trike. A stationary map stays flat, where
   * tilt costs legibility and buys nothing.
   */
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isReady) return;

    /*
     * A rider's map is a navigation view whether or not anyone is aboard.
     *
     * Tilt used to require an accepted trip, so a rider cruising for work — the
     * state they spend most of a shift in — got a flat north-up map, then had it
     * tip over the moment they accepted. The view should not change character
     * because a booking arrived; it is the same road either way.
     */
    const navigating = isDriverMode || followHeading;
    map.setTilt(navigating ? NAVIGATION_TILT : 0);

    /*
     * Buildings only render above roughly this zoom, so a tilted camera looking
     * at the whole city would be tilted at nothing.
     *
     * Riders only. A rider is steering and wants the next two corners in
     * detail; a passenger aboard wants to watch their trip go by, and forcing
     * them to street level here immediately undid the framing that had just
     * zoomed out to show them the whole run to their destination. They keep
     * the tilt — which is the part that reads as "moving" — without the floor.
     */
    if (navigating && isDriverMode && (map.getZoom() ?? 0) < BUILDINGS_MIN_ZOOM) {
      map.setZoom(BUILDINGS_MIN_ZOOM);
    }
  }, [isReady, isDriverMode, followHeading, pooledRides.length]);

  /**
   * Follow the route: keep the traveller centred, facing the way they are going.
   *
   * Not the device compass. A compass turns when the *phone* turns, so a rider
   * glancing down spun the whole map.
   *
   * Nor a fixed number of vertices ahead, which is what made the last version
   * lurch: the router emits points at wildly different spacing, so "eight
   * points" is thirty metres on a straight and four around a corner, and the
   * bearing between them swings accordingly. The look-ahead is measured in
   * metres instead, then eased toward rather than snapped to — a turn arrives
   * as a turn, not as a jump.
   */
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isReady) return;

    /*
     * Two sources, in order of quality.
     *
     * A route is better: it knows the road bends before the rider reaches the
     * bend, so the map turns into a corner rather than after it. But a rider
     * cruising for work has no route, and this effect used to give up there and
     * leave the map pointing north — which is why the arrow appeared to travel
     * sideways across the screen. The GPS course is the fallback: coarser and
     * always a step behind, and far better than a map that does not turn.
     */
    /*
     * Three sources, best first.
     *
     * A route knows the road ahead. Failing that, the compass reports where the
     * phone is pointing and works while standing still — the case GPS cannot
     * serve at all, since a stationary vehicle has no course. GPS course is the
     * last resort, for devices with no magnetometer.
     */
    const source =
      routeStreetCoords.length >= 2
        ? courseAhead(routeStreetCoords, LOOK_AHEAD_KM)
        : mapFollowsCompass && compassHeadingRef.current !== null
          ? compassHeadingRef.current
          : isDriverMode
            ? driverHeading ?? null
            : null;

    if (!followHeading && !isDriverMode) {
      if (appliedHeadingRef.current !== null) {
        appliedHeadingRef.current = null;
        map.setHeading(0);
      }
      return;
    }

    const target = source;
    if (target === null) return;

    const previous = appliedHeadingRef.current;

    if (previous === null) {
      // First lock-on: adopt the course outright rather than sweeping to it
      // from north.
      appliedHeadingRef.current = target;
      map.setHeading(target);
    } else {
      // Shortest signed turn, so 350° to 10° is +20° and not -340°.
      const delta = (((target - previous) % 360) + 540) % 360 - 180;

      // Below this the road is straight and the wobble is GPS noise.
      if (Math.abs(delta) < 4) return;

      const eased = previous + delta * HEADING_EASING;
      appliedHeadingRef.current = eased;
      map.setHeading(((eased % 360) + 360) % 360);
    }

  }, [isReady, followHeading, isDriverMode, driverHeading, routeStreetCoords, compassTick, mapFollowsCompass]);




  /*
   * Turn the self marker from the phone's compass, for both roles.
   *
   * It was gated to riders, so a passenger's arrow turned only from GPS course
   * — which is null whenever they are not moving, which is the entire time they
   * are standing on a road waiting to be collected. Their arrow pointed
   * wherever they last walked, which is worse than not drawing one.
   *
   * Only the marker. A passenger's map stays north-up: they are reading it, not
   * steering by it, and a map that swings while you are trying to check a pin
   * is harder to use rather than easier. The rider's map still turns, because
   * they are driving.
   */
  useEffect(() => {
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

      compassHeadingRef.current = target;

      /*
       * The arrow only turns while the map does not.
       *
       * Once the map itself is rotated to the way the phone is pointing, "the
       * way the phone is pointing" is straight up the screen — so a rotating
       * arrow on a rotating map turns twice and reads as spinning.
       */
      // When the map itself is turning to match, the marker must not: both
      // rotating means it turns twice and reads as spinning.
      const el = arrowElRef.current;
      if (el) {
        el.style.transform = mapFollowsCompass
          ? 'rotate(0deg)'
          : `rotate(${arrowRotationRef.current}deg)`;
      }

      // Coarse: the map eases toward this, so a degree of jitter costs nothing
      // and re-rendering on every raw sensor event costs a great deal.
      setCompassTick((n) => (n + 1) % 1000);
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
  }, [mapFollowsCompass]);

  /**
   * Follow the user.
   *
   * A map that stays where it was put is a picture; a rider driving a route
   * needs the map to come with them. It moves on every fix unless the user has
   * dragged the map themselves, which latches until they press Center.
   *
   * A whole trip on screen outranks this. Framing the route and then following
   * the user are contradictory instructions, and following was winning: the fit
   * ran, then the very next GPS fix — a second later — panned straight back to
   * the passenger and left the far end of the route off screen. Someone reading
   * a route wants the route; only a driver actually navigating it (which is
   * what `followHeading` means) wants the camera pinned to themselves.
   */
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isReady || !selfLocation) return;
    if (userAdjustedViewRef.current) return;
    if (!followHeading && hasWholeTrip) return;
    // A framing move already under way is a deliberate answer to a leg of the
    // journey having just changed. Panning mid-flight would fight it and land
    // somewhere neither wanted; the next fix picks following back up.
    if (frameAnimationRef.current !== null) return;

    /*
     * Look ahead of the vehicle, not at it.
     *
     * panTo centres the marker in the whole map element — but the bottom of
     * that element is under the sheet, so the pin sat on the sheet's edge and
     * vanished behind it whenever the sheet was dragged up. And centring is
     * wrong even with no sheet: it spends half the screen on road already
     * driven.
     *
     * The camera is offset forward along the map's own heading, which is what
     * makes it correct at any rotation — a pixel offset would need un-rotating
     * by hand and would drift each time the map turned.
     */
    /*
     * The first fix jumps; every one after it glides.
     *
     * Where the map opened on the fallback centre and the passenger is in
     * another province, panTo animates the camera across the sea — several
     * seconds of ocean that reads as the app being lost. Only the first move
     * has that problem, and only because the starting point was a guess.
     */
    const firstFix = !hasCentredOnSelfRef.current;
    hasCentredOnSelfRef.current = true;

    moveMap((m) => {
      const div = m.getDiv() as HTMLElement | null;
      const height = div?.clientHeight ?? 0;
      const visible = Math.max(140, height - bottomInset);
      const shiftPx = height / 2 - visible * FOLLOW_ANCHOR;

      if (height === 0 || shiftPx <= 1) {
        if (firstFix) m.setCenter(selfLocation);
        else m.panTo(selfLocation);
        return;
      }

      const km = (shiftPx * metresPerPixel(selfLocation.lat, m.getZoom() ?? 17)) / 1000;
      const target = pointAhead(selfLocation, m.getHeading() ?? 0, km);
      if (firstFix) m.setCenter(target);
      else m.panTo(target);
    });
  }, [
    isReady,
    selfLocation?.lat,
    selfLocation?.lng,
    followHeading,
    hasWholeTrip,
    // Dragging the sheet changes how much map is visible, which changes where
    // in the world the camera has to sit for the pin to stay in view.
    bottomInset,
  ]);

  /** Build bounds from a list of points; null when there is nothing to frame. */
  const boundsOf = (points: LatLng[]): google.maps.LatLngBounds | null => {
    const valid = points.filter((c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng));
    if (valid.length < 2) return null;
    const bounds = new google.maps.LatLngBounds();
    valid.forEach((c) => bounds.extend({ lat: c.lat, lng: c.lng }));
    return bounds.isEmpty() ? null : bounds;
  };

  /**
   * Frame whatever leg of the journey is current, once per leg.
   *
   * Once both ends are known this happens unconditionally. The exemptions that
   * used to sit here — the passenger had dragged the view, or an end had been
   * dropped by hand — are about a single point, and a second point changes the
   * question being asked. Nobody who has just named both ends of a trip wants
   * to keep staring at one of them.
   *
   * `followHeading` used to bail out here too, on the grounds that a followed
   * camera belongs to the traveller. That is right between legs and wrong at
   * the boundary: the moment a passenger climbs aboard is exactly when they
   * want to see the whole run to their destination. The `frameKey` guard is
   * what makes both true at once — it fires once per leg per visible area, so
   * the transition gets its framing and the following that comes after it is
   * never interrupted again.
   *
   * Riders are untouched by all of this: driver mode passes no pickup or
   * drop-off, so the guard below returns before anything moves.
   */
  useEffect(() => {
    if (!mapInstanceRef.current || !isReady) return;
    if (fittedRouteRef.current === frameKey) return;
    if (!pickup && !dropoff) return;

    const bounds = hasWholeTrip ? boundsOf(routeStreetCoords) : null;
    if (bounds) {
      frameBounds(bounds);
      fittedRouteRef.current = frameKey;
      return;
    }

    // Only one end so far. Here the old exemptions still hold: a point the
    // passenger placed on the map, or a view they dragged there themselves, is
    // already the view they asked for.
    if (userAdjustedViewRef.current || pickup?.pickedOnMap || dropoff?.pickedOnMap) {
      // Deliberately not marked as framed — when the second end arrives and the
      // road geometry lands, the trip above still gets its one fit.
      return;
    }

    // Centre on the one end there is, without declaring the trip framed — the
    // road geometry for the full route may still be on its way.
    const single = pickup ?? dropoff;
    if (single && Number.isFinite(single.lat) && Number.isFinite(single.lng)) {
      moveMap((map) => {
        map.setCenter({ lat: single.lat, lng: single.lng });
        map.setZoom(16);
      });
    }
  }, [isReady, followHeading, frameKey, hasWholeTrip, routeStreetCoords, pickup, dropoff]);

  /** Explicit "give me the overview back" — the one thing that resets the view. */
  /**
   * Centre on the user.
   *
   * It used to fall through to the city centre whenever there was no route,
   * which is why pressing it on an idle map threw the view across town. The
   * question this button answers is "where am I", so the user's own position is
   * the first answer, not the last.
   */
  const handleCenterDumaguete = () => {
    userAdjustedViewRef.current = false;

    if (selfLocation) {
      // Facing is left alone while navigating: snapping back to north here undid
      // the orientation the rider was steering by.
      if (!followHeading) {
        appliedHeadingRef.current = null;
        mapInstanceRef.current?.setHeading(0);
      }
      moveMap((map) => {
        map.panTo(selfLocation);
        map.setZoom(Math.max(map.getZoom() ?? 0, 17));
      });
      return;
    }

    // No fix yet — permission not granted, or indoors. Fall back to the trip,
    // then to the city.
    appliedHeadingRef.current = null;
    mapInstanceRef.current?.setHeading(0);
    fittedRouteRef.current = frameKey;

    const routeBounds = boundsOf(routeStreetCoords);
    if (routeBounds) {
      frameBounds(routeBounds);
      return;
    }

    /*
     * No fix and no trip: stay put.
     *
     * This fell through to the city centre, so pressing "my location" in Cebu
     * with the GPS still warming up threw the view 250 km across the sea — the
     * one button whose entire promise is "show me where I am".
     */
    const single = pickup ?? dropoff;
    if (!single) return;

    moveMap((map) => {
      map.setCenter({ lat: single.lat, lng: single.lng });
      map.setZoom(16);
    });
  };

  return (
    <div
      className={`relative w-full h-full bg-white overflow-hidden ${
        fullBleed ? '' : 'min-h-[420px] rounded-2xl border border-gray-200 shadow-md'
      } ${nextPinTarget ? 'cursor-crosshair' : ''}`}
    >
      <div ref={mapContainerRef} className="w-full h-full bg-white" />

      {/* A missing browser key or Map ID fails silently otherwise: the container
          renders, stays grey, and looks like a layout bug rather than config. */}
      {loadError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-gray-50 px-6 text-center">
          <MapPinOff className="h-7 w-7 text-gray-400" />
          <p className="text-sm font-bold text-gray-900">Map unavailable</p>
          <p className="max-w-xs text-xs font-medium text-gray-500">{loadError}</p>
        </div>
      )}

      {!loadError && !isReady && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-gray-50">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
        </div>
      )}

      {!MAP_ID && isReady && (
        <div className="absolute inset-x-3 top-3 z-30 rounded-xl border border-amber-200 bg-amber-50/95 px-3 py-2 text-[11px] font-bold text-amber-900 shadow-md backdrop-blur-sm">
          VITE_GOOGLE_MAPS_MAP_ID is not set — pins cannot render without a Map ID.
        </div>
      )}

      {/* No "tap the map to set…" banner: the crosshair cursor and the empty
          field in the sheet already say it, and on a phone the banner was one
          more thing covering the map. */}

      {/* Right-Hand Floating Stack: My Location, Traffic Layers, Safety Shield, Messages */}
      <div className="absolute right-4 top-20 z-10 flex flex-col items-center gap-2">
        {/* Centering / My Location Button */}
        <button
          onClick={handleCenterDumaguete}
          title="Center on my location"
          aria-label="Center on my location"
          className="flex h-11 w-11 items-center justify-center rounded-full glass-pill text-trust-slate shadow-md transition active:scale-95 hover:bg-cream-100 border border-cream-300"
        >
          <Crosshair className="h-5 w-5 text-trust-slate" />
        </button>

        {/* Traffic Layer Toggle Button */}
        <button
          onClick={() => setTrafficOn((prev) => !prev)}
          title={trafficOn ? 'Hide live traffic' : 'Show live traffic'}
          aria-label={trafficOn ? 'Hide live traffic' : 'Show live traffic'}
          className={`flex h-11 w-11 items-center justify-center rounded-full shadow-md transition active:scale-95 border ${
            trafficOn
              ? 'bg-trust-slate text-cream-50 border-trust-slate shadow-sm'
              : 'glass-pill text-trust-slate hover:bg-cream-100 border-cream-300'
          }`}
        >
          <Layers className="h-5 w-5" />
        </button>

        {/* Safety & Emergency Toolkit Button (Permanently Accessible) */}
        {onOpenSafetyModal && (
          <button
            onClick={onOpenSafetyModal}
            title="Safety & Emergency Toolkit"
            aria-label="Safety & Emergency Toolkit"
            className="flex h-11 w-11 items-center justify-center rounded-full glass-pill text-sampaguita-green shadow-md transition active:scale-95 hover:bg-cream-100 border border-cream-300"
          >
            <ShieldCheck className="h-5 w-5" />
          </button>
        )}

        {/* Unread Messages Floating Button */}
        {onOpenMessages && (
          <button
            onClick={onOpenMessages}
            aria-label={unreadMessages > 0 ? `${unreadMessages} unread messages` : 'Messages'}
            className="relative flex h-11 w-11 items-center justify-center rounded-full glass-pill text-trust-slate shadow-md transition active:scale-95 hover:bg-cream-100 border border-cream-300"
          >
            <MessageSquare className="h-5 w-5" />
            {unreadMessages > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-sunset-coral px-1 text-[10px] font-bold text-white shadow-xs">
                {unreadMessages > 9 ? '9+' : unreadMessages}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Bottom-Left Driver Status Chip */}
      {isDriverMode && (
        <div
          className="absolute left-4 z-10 flex max-w-[calc(100%-6rem)] items-center gap-2"
          style={{ bottom: bottomInset + 16 }}
        >
          <div className="flex items-center gap-2 rounded-pill glass-pill-dark px-3.5 py-2 text-xs font-display font-bold text-cream-50 shadow-lg transition-all duration-200 truncate">
            {(() => {
              if (riderStatus && !riderStatus.online) {
                return (
                  <>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-cream-500" />
                    <span className="truncate text-cream-300">Off duty</span>
                  </>
                );
              }
              if (pooledRides.length > 0) {
                return (
                  <>
                    <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-trike-gold" />
                    <span className="truncate text-cream-50">
                      {pooledRides.length} passenger{pooledRides.length > 1 ? 's' : ''} on your route
                    </span>
                  </>
                );
              }
              if (riderStatus && riderStatus.seatsFree === 0) {
                return (
                  <>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-sunset-coral" />
                    <span className="truncate text-cream-50">Full — no seats free</span>
                  </>
                );
              }
              if (riderStatus && riderStatus.waiting > 0) {
                return (
                  <>
                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-trike-gold opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-trike-gold" />
                    </span>
                    <span className="truncate text-trike-gold">
                      {riderStatus.waiting} request{riderStatus.waiting > 1 ? 's' : ''} waiting
                    </span>
                  </>
                );
              }
              return (
                <>
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="status-pulse h-2.5 w-2.5" />
                  </span>
                  <span className="truncate text-cream-200">Listening for trips</span>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};
