/**
 * Moved to shared/fare.ts so the server (Gently's `estimate_fare` tool) and the
 * browser bill from one implementation. Re-exported here so existing UI imports
 * keep working.
 */
export {
  BASE_DISTANCE_KM,
  farePerPassenger,
  totalFare,
  fareBreakdown,
} from '../../shared/fare';

export type { FareBreakdown } from '../../shared/fare';
