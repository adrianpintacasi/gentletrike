// Defined in shared/ alongside the rate table the server bills from.
import type { TransportMode } from '../shared/transport';
export type { TransportMode };

export type RideStatus =
  | 'idle'
  | 'searching_driver'
  | 'driver_assigned'
  | 'driver_arriving'
  | 'in_transit'
  | 'completed'
  | 'cancelled';

export interface LocationPoint {
  id: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  popularFor?: string;
  /** Not one of the app's own curated points — came from GPS, search or a pin. */
  isCustomPinned?: boolean;
  /**
   * The user placed this themselves by tapping the map.
   *
   * Narrower than `isCustomPinned`, and deliberately so: the map uses this to
   * decide whether the camera may move. Somebody who just dropped a pin was
   * already looking exactly where they wanted, so the view is left alone —
   * whereas a place that arrived from GPS or a search carries no such claim on
   * the camera. `isCustomPinned` was standing in for this and is true in nearly
   * every booking, which meant the trip was almost never framed.
   */
  pickedOnMap?: boolean;
  category?: 'shopping' | 'transport' | 'hospital' | 'park' | 'food' | 'landmark' | 'port' | 'airport' | 'bridge' | 'sports';
}

export interface Driver {
  id: string;
  name: string;
  vehicleType: TransportMode;
  unitNumber: string;
  plateNumber: string;
  rating: number;
  tripsCompleted: number;
  phone: string;
  avatar: string;
  currentLat: number;
  currentLng: number;
  isOnline: boolean;
  /** Server-tracked daily totals, credited when a trip is completed. */
  earningsToday?: number;
  /** Seats taken by passengers who did not book through the app. */
  walkInSeats?: number;
  /**
   * What this unit actually seats.
   *
   * The rate card's figure is the legal ceiling for the vehicle class, not a
   * measurement of any one trike. The rider sets this; the server clamps it to
   * the ceiling so the franchise limit still holds.
   */
  seatCapacity?: number;
  tripsToday?: number;
  /** TMO standing. Only 'verified' riders may go online. */
  verificationStatus?: 'verified' | 'pending' | 'suspended' | 'declined';
}

export interface RideBooking {
  id: string;
  /** The signed-in user who booked the trip. */
  passengerId?: string;
  pickupLocation: LocationPoint;
  dropoffLocation: LocationPoint;
  vehicleType: TransportMode;
  passengers: number;
  distanceKm: number;
  estimatedMinutes: number;
  baseFare: number;
  totalFare: number;
  isPakyawNegotiated: boolean;
  paymentMethod: 'cash' | 'gcash';
  notes?: string;
  assignedDriver?: Driver;
  /** Attached only for the rider carrying this trip, so they can make contact. */
  passengerName?: string;
  /** Null when the passenger signed up without a number. */
  passengerPhone?: string | null;
  status: RideStatus;
  createdAt: string;
  /** Seconds spent waiting for a rider. Null once one has accepted. */
  searchingSeconds?: number | null;
  /** Waiting long enough that the passenger is told no rider has taken it yet. */
  searchStalled?: boolean;
  /**
   * The rider's committed stops between where they are now and this trip's end.
   *
   * Present only on a shared trip, and only for the passenger it belongs to.
   * Without it a pooled passenger's map draws a straight run from the rider to
   * their own destination, which is not the journey they are on — the rider
   * has other people to collect and set down in between, and those detours are
   * the whole reason the trip costs less.
   *
   * Ends at this passenger's own drop-off. Where the rider goes afterwards is
   * not theirs to see.
   */
  poolPath?: PooledStop[];
}

/**
 * One stop on the rider's path, as much of it as a fellow passenger may see.
 *
 * Coordinates and nothing else. A shared trip means stopping where strangers
 * get on and off, which is unavoidable and visible from the seat — but who
 * they are, where they are going, and what they paid are not part of it.
 */
export interface PooledStop {
  lat: number;
  lng: number;
  kind: 'pickup' | 'dropoff';
  /** True when the stop is this passenger's own. */
  mine: boolean;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'driver' | 'system';
  text: string;
  time: string;
}
