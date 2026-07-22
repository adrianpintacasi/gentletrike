import { Driver, LocationPoint, RideBooking, TransportMode } from './types';

/**
 * Stable per-device id. There are no accounts in GentleTrike — this is what
 * lets a phone reclaim its own ride (or its pedicab unit) after a reload.
 */
function readOrCreateClientId(): string {
  const KEY = 'gentletrike:clientId';
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const fresh =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Private browsing with storage blocked: fall back to a per-session id.
    return `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export const CLIENT_ID = readOrCreateClientId();

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });

  const raw = await res.text();
  let body: any = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ApiError(`Server returned a non-JSON response`, res.status);
    }
  }

  if (!res.ok) {
    throw new ApiError(body?.error || `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });

const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

/* ----------------------------------------------------------------- drivers */

export const listDrivers = (onlineOnly = false) =>
  request<{ drivers: Driver[] }>(`/drivers${onlineOnly ? '?online=1' : ''}`).then(
    (r) => r.drivers
  );

export const claimDriver = (driverId?: string) =>
  post<{ driver: Driver }>('/drivers/claim', { clientId: CLIENT_ID, driverId }).then(
    (r) => r.driver
  );

export const updateDriver = (
  driverId: string,
  update: { lat?: number; lng?: number; isOnline?: boolean }
) => patch<{ driver: Driver }>(`/drivers/${driverId}`, update).then((r) => r.driver);

export const listDriverRides = (driverId: string) =>
  request<{ rides: RideBooking[] }>(`/drivers/${driverId}/rides`).then((r) => r.rides);

/* ------------------------------------------------------------------- rides */

export interface CreateRideInput {
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
}

export const createRide = (input: CreateRideInput) =>
  post<{ ride: RideBooking }>('/rides', { ...input, passengerId: CLIENT_ID }).then(
    (r) => r.ride
  );

export const getRide = (rideId: string) =>
  request<{ ride: RideBooking }>(`/rides/${rideId}`).then((r) => r.ride);

export const listOpenRides = (driverId: string) =>
  request<{ rides: RideBooking[] }>(
    `/rides/open?driverId=${encodeURIComponent(driverId)}`
  ).then((r) => r.rides);

export const listMyRides = () =>
  request<{ rides: RideBooking[] }>(
    `/passengers/${encodeURIComponent(CLIENT_ID)}/rides`
  ).then((r) => r.rides);

export const acceptRide = (rideId: string, driverId: string) =>
  post<{ ride: RideBooking }>(`/rides/${rideId}/accept`, { driverId }).then(
    (r) => r.ride
  );

export const declineRide = (rideId: string, driverId: string) =>
  post<{ ok: true }>(`/rides/${rideId}/decline`, { driverId });

export const setRideStatus = (rideId: string, status: RideBooking['status']) =>
  post<{ ride: RideBooking }>(`/rides/${rideId}/status`, { status }).then((r) => r.ride);

export const cancelRide = (rideId: string) =>
  post<{ ride: RideBooking }>(`/rides/${rideId}/cancel`, {}).then((r) => r.ride);

/* ---------------------------------------------------------------- messages */

export const listMessages = (rideId: string) =>
  request<{ messages: { id: string; sender: string; text: string; time: string }[] }>(
    `/rides/${rideId}/messages`
  ).then((r) => r.messages);

export const sendMessage = (rideId: string, sender: 'user' | 'driver', text: string) =>
  post<{ ok: true; id: string }>(`/rides/${rideId}/messages`, { sender, text });

/* ------------------------------------------------------------- TMO reports */

export const submitTmoReport = (input: {
  rideId?: string;
  driverId?: string;
  violationType: string;
  demandedFare?: number;
  details?: string;
  contactNumber?: string;
}) => post<{ referenceCode: string }>('/tmo-reports', input).then((r) => r.referenceCode);

/* ------------------------------------------------------------------ AI bot */

export const askAssistant = (body: {
  prompt: string;
  pickup?: string;
  dropoff?: string;
  vehicleType?: string;
}) => post<{ reply: string }>('/dumaguete/ai-assistant', body).then((r) => r.reply);
