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
  isCustomPinned?: boolean;
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
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'driver' | 'system';
  text: string;
  time: string;
}
