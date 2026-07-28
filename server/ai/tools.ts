import { getStreetRoute } from '../../shared/geo';
import { fareBreakdown } from '../../shared/fare';
import { VEHICLE_DETAILS, isTransportMode, type TransportMode } from '../../shared/transport';
import { LOCATION_NAMES, resolveLocation, detectOutOfCoverage } from './locations';
import { formatContext, retrieve } from './retrieve';

/**
 * The tools Gently may call.
 *
 * Fares and routes are computed here, never written by the model. The previous
 * prompt asked the model to do ceiling arithmetic in its head and warned it
 * "Never multiply fractions by ₱2!" — a losing strategy. shared/fare.ts already
 * implements the ordinance correctly, so the model's job is reduced to choosing
 * arguments.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'search_knowledge',
    description:
      'Search the Dumaguete knowledge base for places, food, festivals, history, ' +
      'transport tips, ordinances, and TMO procedures. Use for any factual question ' +
      'about the city. Always call this before answering a factual question.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A focused search phrase, not the whole user message.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'estimate_fare',
    description:
      'Compute the exact, official fare for a trip. ALWAYS use this for any question ' +
      'about price or cost. Never calculate a fare yourself.',
    parameters: {
      type: 'object',
      properties: {
        pickup: { type: 'string', description: 'Pickup place name as the passenger said it.' },
        dropoff: { type: 'string', description: 'Destination place name.' },
        vehicleType: {
          type: 'string',
          enum: ['pedicab_standard', 'habal_habal', 'multicab'],
          description: 'Defaults to pedicab_standard.',
        },
        passengers: { type: 'integer', description: 'Number of passengers. Defaults to 1.' },
      },
      required: ['pickup', 'dropoff'],
    },
  },
  {
    name: 'plan_route',
    description:
      'Get the real road distance and travel time between two places in Dumaguete, ' +
      'without fare information.',
    parameters: {
      type: 'object',
      properties: {
        pickup: { type: 'string' },
        dropoff: { type: 'string' },
      },
      required: ['pickup', 'dropoff'],
    },
  },
  {
    name: 'draft_booking',
    description:
      'Prepare a ride for the passenger to confirm. This does NOT book anything — it ' +
      'returns a summary the passenger must approve by tapping Confirm. Use when the ' +
      'passenger asks to book, order, or get a ride.',
    parameters: {
      type: 'object',
      properties: {
        pickup: { type: 'string' },
        dropoff: { type: 'string' },
        vehicleType: { type: 'string', enum: ['pedicab_standard', 'habal_habal', 'multicab'] },
        passengers: { type: 'integer' },
        notes: { type: 'string', description: 'Optional note for the driver.' },
      },
      required: ['pickup', 'dropoff'],
    },
  },
];

export interface ToolResult {
  /** Text handed back to the model. */
  content: string;
  /**
   * Structured payload for the UI. A draft_booking result carries the data the
   * Confirm button submits; the model never gets to submit it itself.
   */
  data?: Record<string, unknown>;
}

const unknownPlace = (which: string, value: string): ToolResult => ({
  content:
    `Could not identify the ${which} "${value}". Ask the passenger to choose one of ` +
    `these GentleTrike pickup points: ${LOCATION_NAMES.join(', ')}.`,
});

/** Below this the "match" is noise; asking beats quoting a fare for the wrong place. */
const MIN_CONFIDENCE = 0.34;

function resolvePair(pickup: string, dropoff: string) {
  // Coverage first. A place like "Valencia" would otherwise fuzzy-match the
  // downtown "Valencia Jeepney & Bus Terminal" and produce a confident fare for
  // entirely the wrong trip.
  for (const [which, value] of [['pickup', pickup], ['destination', dropoff]] as const) {
    const outside = detectOutOfCoverage(value);
    if (outside) {
      return {
        error: {
          content:
            `OUT OF COVERAGE — do not quote a fare or draft a booking for this.\n` +
            `The ${which} "${value}" refers to ${outside.description}, which is outside ` +
            `Dumaguete City and NOT a GentleTrike bookable point.\n` +
            `Tell the passenger GentleTrike only books trips within Dumaguete City, and ` +
            `that the usual way is to take a GentleTrike ride to the right terminal or ` +
            `port and continue from there (Valencia Jeepney & Bus Terminal for Valencia, ` +
            `Casaroro and Pulangbato; Dumaguete Port for Siquijor, Bohol and Cebu). ` +
            `Offer to book them a ride to that terminal or port instead.`,
        } as ToolResult,
      };
    }
  }

  const from = resolveLocation(pickup);
  if (!from || from.confidence < MIN_CONFIDENCE) return { error: unknownPlace('pickup', pickup) };

  const to = resolveLocation(dropoff);
  if (!to || to.confidence < MIN_CONFIDENCE) return { error: unknownPlace('destination', dropoff) };

  if (from.location.id === to.location.id) {
    return {
      error: {
        content: `Pickup and destination resolved to the same place (${from.location.name}). Ask the passenger to clarify.`,
      } as ToolResult,
    };
  }

  return { from: from.location, to: to.location };
}

const mode = (v: unknown): TransportMode => (isTransportMode(v) ? v : 'pedicab_standard');
const headsOf = (v: unknown): number => Math.max(1, Math.min(12, Math.floor(Number(v)) || 1));

export interface ToolContext {
  embed?: (text: string) => Promise<number[]>;
}

export async function executeTool(
  name: string,
  args: Record<string, any>,
  ctx: ToolContext = {}
): Promise<ToolResult> {
  switch (name) {
    case 'search_knowledge': {
      const query = String(args.query ?? '').slice(0, 300);
      if (!query.trim()) return { content: 'No query supplied.' };

      const { chunks, tiers, mode: how } = await retrieve(query, ctx.embed);
      return {
        content: formatContext(chunks),
        data: {
          retrieved: chunks.length,
          tiers,
          mode: how,
          sources: chunks.map((c) => ({ title: c.title, url: c.sourceUrl, year: c.sourceYear })),
        },
      };
    }

    case 'plan_route':
    case 'estimate_fare': {
      const pair = resolvePair(String(args.pickup ?? ''), String(args.dropoff ?? ''));
      if ('error' in pair) return pair.error!;

      const route = await getStreetRoute([
        { lat: pair.from!.lat, lng: pair.from!.lng },
        { lat: pair.to!.lat, lng: pair.to!.lng },
      ]);

      const approx =
        route.source === 'estimate'
          ? ' (road router unreachable; distance is an estimate)'
          : '';

      if (name === 'plan_route') {
        return {
          content:
            `${pair.from!.name} to ${pair.to!.name}: ${route.distanceKm} km, ` +
            `about ${route.durationMin} minutes by road${approx}.`,
          data: { distanceKm: route.distanceKm, durationMin: route.durationMin, source: route.source },
        };
      }

      const vehicle = mode(args.vehicleType);
      const b = fareBreakdown(vehicle, route.distanceKm, headsOf(args.passengers));
      const v = VEHICLE_DETAILS[vehicle];

      return {
        content:
          `OFFICIAL FARE (computed, authoritative — use these exact figures):\n` +
          `${pair.from!.name} to ${pair.to!.name} by ${v.title}: ${b.distanceKm} km${approx}.\n` +
          `Base PHP ${b.baseFare}.00 for the first km, plus ${b.succeedingKm} succeeding km ` +
          `at PHP ${b.perKm}.00 = PHP ${b.farePerPassenger}.00 per passenger.\n` +
          `Total for ${b.passengers} passenger(s): PHP ${b.total}.00. ` +
          `Estimated travel time ${route.durationMin} minutes. ` +
          `This is the full fare GentleTrike will charge; the app applies no discount.`,
        data: { ...b, durationMin: route.durationMin, routeSource: route.source },
      };
    }

    case 'draft_booking': {
      const pair = resolvePair(String(args.pickup ?? ''), String(args.dropoff ?? ''));
      if ('error' in pair) return pair.error!;

      const route = await getStreetRoute([
        { lat: pair.from!.lat, lng: pair.from!.lng },
        { lat: pair.to!.lat, lng: pair.to!.lng },
      ]);

      const vehicle = mode(args.vehicleType);
      const heads = headsOf(args.passengers);
      const b = fareBreakdown(vehicle, route.distanceKm, heads);

      return {
        content:
          `Draft prepared — NOT yet booked. The passenger must tap Confirm.\n` +
          `${pair.from!.name} to ${pair.to!.name}, ${VEHICLE_DETAILS[vehicle].title}, ` +
          `${heads} passenger(s), ${b.distanceKm} km, total PHP ${b.total}.00.\n` +
          `Tell the passenger these details and ask them to confirm.`,
        data: {
          kind: 'booking_draft',
          // Exactly the shape POST /api/rides expects, so the Confirm button
          // submits it unchanged. passengerId is never included — the server
          // takes that from the session.
          draft: {
            pickupLocation: pair.from,
            dropoffLocation: pair.to,
            vehicleType: vehicle,
            passengers: heads,
            distanceKm: b.distanceKm,
            estimatedMinutes: route.durationMin,
            baseFare: b.baseFare,
            totalFare: b.total,
            isPakyawNegotiated: false,
            paymentMethod: 'cash',
            notes: args.notes ? String(args.notes).slice(0, 500) : undefined,
          },
        },
      };
    }

    default:
      return { content: `Unknown tool "${name}".` };
  }
}
