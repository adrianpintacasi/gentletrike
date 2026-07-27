import { Driver, LocationPoint, RideBooking, TransportMode } from './types';
import type { User, UserRole } from './types/auth';

const AUTH_TOKEN_KEY = 'gentletrike:authToken';

function readAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeAuthToken(token: string): void {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    /* private browsing — session only */
  }
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = readAuthToken();
  const headers: Record<string, string> = {};
  if (init?.body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
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

/* ------------------------------------------------------------------- auth */

function persistAuth(user: User, token: string): User {
  writeAuthToken(token);
  return user;
}

export const register = (
  email: string,
  password: string,
  name: string,
  role: UserRole,
  unitNumber?: string
) =>
  post<{ user: User; token: string }>('/auth/register', {
    email,
    password,
    name,
    role,
    unitNumber,
  }).then(({ user, token }) => persistAuth(user, token));

export const login = (email: string, password: string) =>
  post<{ user: User; token: string }>('/auth/login', { email, password }).then(
    ({ user, token }) => persistAuth(user, token)
  );

export const logout = async () => {
  try {
    await post<{ ok: true }>('/auth/logout', {});
  } finally {
    clearAuthToken();
  }
};

export const getMe = () =>
  request<{ user: User }>('/auth/me').then((r) => r.user);

export const listUsers = () =>
  request<{ users: User[] }>('/auth/users').then((r) => r.users);

export const createUser = (data: Partial<User> & { password?: string; unitNumber?: string }) =>
  request<{ user: User }>('/auth/users', {
    method: 'POST',
    body: JSON.stringify(data),
  }).then((r) => r.user);

export const deleteUser = (id: string) =>
  request<{ ok: boolean }>(`/auth/users/${id}`, {
    method: 'DELETE',
  }).then((r) => r.ok);

/* ------------------------------------------------------------ admin stats */

export interface DailyStat {
  day: string;
  trips: number;
  averageFare: number;
}

export interface RouteStat {
  route: string;
  trips: number;
}

export interface DailyStatsResponse {
  dailyStats: DailyStat[];
  busiestRoutes: RouteStat[];
  totalCompletedTrips: number;
}

export const getDailyStats = () => request<DailyStatsResponse>('/admin/stats/daily');

/* ----------------------------------------------------------------- drivers */

export const listDrivers = (onlineOnly = false) =>
  request<{ drivers: Driver[] }>(`/drivers${onlineOnly ? '?online=1' : ''}`).then(
    (r) => r.drivers
  );

export const claimDriver = (driverId?: string) =>
  post<{ driver: Driver }>('/drivers/claim', { driverId }).then((r) => r.driver);

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
  post<{ ride: RideBooking }>('/rides', input).then((r) => r.ride);

export const getRide = (rideId: string) =>
  request<{ ride: RideBooking }>(`/rides/${rideId}`).then((r) => r.ride);

export const listOpenRides = (driverId: string) =>
  request<{ rides: RideBooking[] }>(
    `/rides/open?driverId=${encodeURIComponent(driverId)}`
  ).then((r) => r.rides);

export const listMyRides = () =>
  request<{ rides: RideBooking[] }>('/me/rides').then((r) => r.rides);

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

/* ----------------------------------------------------------------- ratings */

export const rateRide = (rideId: string, stars: number, comment?: string) =>
  post<{ ok: true; stars: number }>(`/rides/${rideId}/rating`, { stars, comment });

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
