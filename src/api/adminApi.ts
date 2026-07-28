import type { User, AdminSubRole } from '../types/auth';

const AUTH_TOKEN_KEY = 'gentletrike:authToken';

function readAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
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

  const res = await fetch(`/api/admin${path}`, {
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

export interface OverviewStats {
  totalRiders: number;
  totalDrivers: number;
  totalRides: number;
  activeReports: number;
  onlineRiders: number;
  pendingVerifications: number;
  suspendedAccounts: number;
  ridesToday: number;
}

export interface StatusBreakdown {
  name: string;
  value: number;
}

export interface VolumeData {
  date: string;
  rides: number;
  completed: number;
  cancelled: number;
}

export interface PeakHourData {
  day: number;
  hour: number;
  count: number;
}

export interface DriverRejection {
  driver_id: string;
  driver_name: string;
  unit_number: string;
  rejections_count: number;
  reasons: string;
}

export interface CancellationItem {
  id: string;
  cancelled_by: string;
  cancel_reason: string;
  pickup: string;
  dropoff: string;
  created_at: string;
}

export interface FlaggedDriver {
  id: string;
  name: string;
  unit_number: string;
  rating: number;
  declines_count: number;
  cancellations_count: number;
}

export interface TmoReportItem {
  id: string;
  reference_code: string;
  ride_id: string | null;
  driver_id: string | null;
  driver_name: string | null;
  driver_unit: string | null;
  violation_type: string;
  demanded_fare: number | null;
  details: string | null;
  contact_number: string | null;
  status: 'pending' | 'investigating' | 'resolved';
  filed_by: string | null;
  complainant_name: string | null;
  complainant_contact: string | null;
  ride_pickup: string | null;
  ride_dropoff: string | null;
  ride_distance: number | null;
  admin_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface AuditLogItem {
  id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  target_type: string;
  target_id: string | null;
  details: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface DemandForecastItem {
  hour: string;
  predictedDemand: number;
  confidence: number;
}

export interface DriverRiskItem {
  id: string;
  name: string;
  unitNumber: string;
  riskScore: number;
  riskBadge: 'Low' | 'Medium' | 'High';
  reportsCount: number;
  declinesCount: number;
  cancellationsCount: number;
}

/* API Methods */

export const getOverviewStats = () => request<OverviewStats>('/stats/overview');

export const getStatusBreakdown = () =>
  request<{ breakdown: StatusBreakdown[] }>('/stats/ride-status').then((r) => r.breakdown);

export const getVolumeData = (period: 'day' | 'week' | 'month' = 'week') =>
  request<{ volume: VolumeData[] }>(`/stats/ride-volume?period=${period}`).then((r) => r.volume);

export const getPeakHours = () =>
  request<{ peakHours: PeakHourData[] }>('/stats/peak-hours').then((r) => r.peakHours);

export const getRejections = () =>
  request<{ rejections: DriverRejection[] }>('/rejections').then((r) => r.rejections);

export const getCancellations = () =>
  request<{ summary: { riderInitiated: number; driverInitiated: number }; cancellations: CancellationItem[] }>('/cancellations');

export const getFlaggedDrivers = () =>
  request<{ flaggedDrivers: FlaggedDriver[] }>('/flagged-users').then((r) => r.flaggedDrivers);

export const getReports = (filters?: { category?: string; status?: string }) => {
  // Only include filters that are actually set. Passing an object with
  // `undefined` values to URLSearchParams stringifies them as the literal
  // "undefined", which the server would then treat as a real filter value.
  const params = new URLSearchParams();
  if (filters?.category) params.set('category', filters.category);
  if (filters?.status) params.set('status', filters.status);
  const query = params.toString();
  return request<{ reports: TmoReportItem[] }>(`/reports${query ? `?${query}` : ''}`).then((r) => r.reports);
};

export const getReportStats = () =>
  request<{ categoryBreakdown: { category: string; count: number }[] }>('/reports/stats').then((r) => r.categoryBreakdown);

export const updateReport = (id: string, update: { status?: string; adminNotes?: string }) =>
  request<{ report: TmoReportItem }>(`/reports/${id}`, { method: 'PATCH', body: JSON.stringify(update) }).then((r) => r.report);

export const getRepeatOffenders = () =>
  request<{ repeatOffenders: any[] }>('/reports/repeat-offenders').then((r) => r.repeatOffenders);

export const getAdminDrivers = (search?: string) =>
  request<{ drivers: any[] }>(`/drivers${search ? `?search=${encodeURIComponent(search)}` : ''}`).then((r) => r.drivers);

export const getDriverProfile = (id: string) =>
  request<{ driver: any; reports: any[] }>(`/drivers/${id}/profile`);

export const updateDriverVerification = (id: string, status: string) =>
  request<{ ok: boolean }>(`/drivers/${id}/verification`, { method: 'PATCH', body: JSON.stringify({ status }) });

export const getAdminRiders = (search?: string) =>
  request<{ riders: User[] }>(`/riders${search ? `?search=${encodeURIComponent(search)}` : ''}`).then((r) => r.riders);

export interface ActivationRequest {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  contact_number: string | null;
  role: string;
  account_status: 'suspended' | 'banned';
  activation_request: string;
  activation_requested_at: string;
}

export const getActivationRequests = () =>
  request<{ requests: ActivationRequest[] }>('/activation-requests').then((r) => r.requests);

export const resolveActivationRequest = (id: string, action: 'approve' | 'dismiss') =>
  request<{ ok: boolean }>(`/activation-requests/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });

export const getAuditLogs = (employeeId?: string, action?: string) => {
  const params = new URLSearchParams();
  if (employeeId) params.append('employeeId', employeeId);
  if (action) params.append('action', action);
  return request<{ auditLogs: AuditLogItem[] }>(`/audit-log${params.toString() ? `?${params.toString()}` : ''}`).then((r) => r.auditLogs);
};

export const getDemandForecast = () =>
  request<{ forecast: DemandForecastItem[]; model: string }>('/ai/demand-forecast');

export const getDriverRiskScores = () =>
  request<{ riskScores: DriverRiskItem[] }>('/ai/driver-risk').then((r) => r.riskScores);

export const categorizeReportText = (text: string) =>
  request<{ suggestedCategory: string; urgency: string; note: string }>('/ai/categorize', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });

export const askAdminChatbot = (query: string) =>
  request<{ reply: string }>('/chatbot', {
    method: 'POST',
    body: JSON.stringify({ query }),
  }).then((r) => r.reply);
