import { getStreetRoute } from '../../shared/geo';
import { fareBreakdown } from '../../shared/fare';
import { VEHICLE_DETAILS, isTransportMode, type TransportMode } from '../../shared/transport';
import { resolvePlace, detectOutOfCoverage, type PlaceResolution } from './locations';
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
        pickup: {
          type: 'string',
          description:
            'Pickup place as the passenger said it. Any place in Dumaguete City works — a ' +
            'business, landmark, street or barangay, not only the listed pickup points.',
        },
        dropoff: { type: 'string', description: 'Destination place. Any place in Dumaguete City.' },
        vehicleType: {
          type: 'string',
          enum: ['pedicab_standard', 'pakyaw_charter'],
          description:
            'Defaults to pedicab_standard. pakyaw_charter is the same trike hired ' +
            'whole at a negotiated price, not a different vehicle.',
        },
        passengers: { type: 'integer', description: 'Number of passengers. Defaults to 1.' },
      },
      required: ['pickup', 'dropoff'],
    },
  },
  {
    name: 'plan_route',
    description:
      'Get the real road distance and travel time between any two places in Dumaguete ' +
      'City, without fare information.',
    parameters: {
      type: 'object',
      properties: {
        pickup: { type: 'string', description: 'Any place in Dumaguete City.' },
        dropoff: { type: 'string', description: 'Any place in Dumaguete City.' },
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
        pickup: { type: 'string', description: 'Any place in Dumaguete City.' },
        dropoff: { type: 'string', description: 'Any place in Dumaguete City.' },
        vehicleType: { type: 'string', enum: ['pedicab_standard', 'pakyaw_charter'] },
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
    `Could not find "${value}" anywhere in Dumaguete City for the ${which}. Ask the ` +
    `passenger, in ONE short sentence, to describe it another way — a street, a nearby ` +
    `landmark, or the full business name. Do NOT list the app's pickup points at them.`,
});

/**
 * The passenger has not said where they are yet.
 *
 * Distinct from a place that could not be found: there is nothing to look up,
 * so reporting a failed search invites the model to apologise and recite the
 * pickup list. It only needs to ask a question.
 */
const missingPlace = (which: string): ToolResult => ({
  content:
    `The passenger has not said where the ${which} is. Ask them one short, direct ` +
    `question — for example "Where should I pick you up?" — and nothing else. Do NOT ` +
    `list the app's pickup points, and do not apologise.`,
});

/**
 * Which places to connect a passenger's words to, before anything is priced.
 *
 * Resolution reaches the whole city, not just the curated pickup points, so
 * "take me to the bakery on Perdices" now works. Three things can still go
 * wrong, and each has to be handled differently: the place is outside the city
 * (offer the terminal), the words match several places (ask), or nothing matches
 * (ask). None of them may end in a guessed fare.
 */
async function resolvePair(
  pickup: string,
  dropoff: string,
  /** Where the passenger is, so both ends resolve near them rather than by name alone. */
  near?: { lat: number; lng: number }
) {
  // Nothing to look up is not the same as nothing found.
  if (!pickup.trim()) return { error: missingPlace('pickup') };
  if (!dropoff.trim()) return { error: missingPlace('destination') };

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
            `Dumaguete City. GentleTrike's fares follow the Dumaguete City ordinance, and ` +
            `each town sets its own rates, so the app cannot price a trip there.\n` +
            `Tell the passenger this, then offer BOTH options:\n` +
            `1. The onward journey is: ${outside.onward}. State exactly this and nothing ` +
            `else — do NOT substitute a different terminal, port, or mode of travel, and ` +
            `never mention a ferry or boat unless it appears in that sentence. Offer to ` +
            `book them a GentleTrike ride to wherever that journey starts.\n` +
            `2. A pakyaw charter, where they hire a whole vehicle and agree a flat price ` +
            `directly with the driver. Mention it as the option for going all the way, but ` +
            `do NOT quote a figure or draft it — the price is negotiated, not metered.`,
        } as ToolResult,
      };
    }
  }

  const [from, to] = await Promise.all([
    resolvePlace(pickup, near),
    resolvePlace(dropoff, near),
  ]);

  if (from.kind !== 'resolved') return { error: unresolved('pickup', pickup, from) };
  if (to.kind !== 'resolved') return { error: unresolved('destination', dropoff, to) };

  if (from.location.id === to.location.id) {
    return {
      error: {
        content: `Pickup and destination resolved to the same place (${from.location.name}). Ask the passenger to clarify.`,
      } as ToolResult,
    };
  }

  return { from: from.location, to: to.location };
}

/** Explain a failed resolution to the model in terms of what it should do next. */
function unresolved(
  which: string,
  value: string,
  r: Exclude<PlaceResolution, { kind: 'resolved' }>
): ToolResult {
  if (r.kind === 'not-found') return unknownPlace(which, value);

  return {
    content:
      `AMBIGUOUS ${which.toUpperCase()} — do not pick one yourself and do not quote a fare yet.\n` +
      `"${value}" matches more than one place in Dumaguete:\n` +
      r.options.map((o, i) => `${i + 1}. ${o.name}${o.address ? ` (${o.address})` : ''}`).join('\n') +
      `\nAsk the passenger which one they mean, then call this tool again with that name.`,
  };
}

const mode = (v: unknown): TransportMode => (isTransportMode(v) ? v : 'pedicab_standard');
const headsOf = (v: unknown): number => Math.max(1, Math.min(12, Math.floor(Number(v)) || 1));

export interface ToolContext {
  embed?: (text: string) => Promise<number[]>;
  /**
   * Where the passenger is standing.
   *
   * Place resolution is biased by position, so this is what makes "the mall"
   * mean the one they can reach. Without it, the same words resolve to whichever
   * place on earth matched the string best — which is how a passenger in Cebu
   * gets quoted a fare to a mall in Negros.
   */
  near?: { lat: number; lng: number };
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
      const pair = await resolvePair(String(args.pickup ?? ''), String(args.dropoff ?? ''), ctx.near);
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
      const pair = await resolvePair(String(args.pickup ?? ''), String(args.dropoff ?? ''), ctx.near);
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
