import type { ChatMessage, LlmProvider, ToolCall } from './provider';
import { TOOL_DEFINITIONS, executeTool, type ToolResult } from './tools';
import { LOCATION_NAMES } from './locations';
import { TRANSPORT_MODES, VEHICLE_DETAILS } from '../../shared/transport';

/**
 * How many times the model may call tools before it must answer.
 *
 * This is the real budget guard. Per-message cost on gpt-4o-mini is a fraction
 * of a cent; a model that retries a failing tool forever is the only realistic
 * way to burn a fixed grant. Four covers search -> fare -> draft with room to
 * spare.
 */
const MAX_TOOL_ROUNDS = 4;

/** Tool calls per round. Stops a single response fanning out into dozens. */
const MAX_CALLS_PER_ROUND = 3;

export interface AgentContext {
  pickup?: string;
  dropoff?: string;
  /**
   * Where the passenger is standing.
   *
   * Place resolution is biased by position, so this is what makes "the mall"
   * mean the one they can walk to. Without it the same words resolve to
   * whichever place on earth matched the string best.
   */
  near?: { lat: number; lng: number };
  /**
   * That position as a place name, resolved server-side.
   *
   * Coordinates let Gently search correctly but not speak — asked "where am I?"
   * it could only read decimals back. This is what lets it answer in words.
   */
  nearName?: string | null;
  embed?: (text: string) => Promise<number[]>;
}

export interface AgentResult {
  reply: string;
  /** Structured payloads for the UI — notably the booking draft awaiting Confirm. */
  data: Record<string, unknown>[];
  toolsUsed: string[];
  provider: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/**
 * The published rate for every mode, written from the fare table itself.
 *
 * These figures used to be typed into the prompt as prose, which quietly
 * asserted that the pedicab rate was "the GentleTrike rate" — so a passenger
 * asking about a habal-habal was told PHP 15 when it is PHP 25. Generating the
 * list means the prompt cannot drift from shared/fare.ts, and every mode is
 * named rather than one standing in for all four.
 */
const RATE_CARD = TRANSPORT_MODES.map((m) => {
  const v = VEHICLE_DETAILS[m];
  const flat =
    m === 'pakyaw_charter'
      ? ', charged flat for the whole vehicle and NOT per passenger. This figure is a MINIMUM the passenger offers at or above, not a fixed price'
      : ', per passenger';
  return `   - ${v.title}: PHP ${v.baseFare}.00 for the first km, then PHP ${v.perKm}.00 per succeeding km or fraction thereof${flat}.`;
}).join('\n');

function buildSystemPrompt(ctx: AgentContext): string {
  const trip =
    ctx.pickup || ctx.dropoff
      ? `\nThe passenger currently has ${ctx.pickup ?? 'no pickup'} -> ${ctx.dropoff ?? 'no destination'} selected in the app.`
      : '';

  // Telling the model where the passenger is standing keeps its language honest.
  // Without it, a prompt that names Dumaguete throughout leads it to answer as
  // if everyone is in Dumaguete — including the passenger standing in Cebu.
  /*
   * Where the passenger is, stated as a fact rather than an approximation.
   *
   * This used to read "near X", and the model repeated the hedge back —
   * "you are near Cebu Institute of Technology" — when the app knows the
   * position to a few metres. It also never said what to do with it, so a
   * question naming only a destination got answered with "where should I pick
   * you up?", which the app had already answered before the passenger typed.
   */
  const where = ctx.near
    ? `

YOU KNOW WHERE THE PASSENGER IS. They are at ${
        ctx.nearName ? `${ctx.nearName} — coordinates ` : ''
      }${ctx.near.lat.toFixed(5)}, ${ctx.near.lng.toFixed(5)}.${
        ctx.nearName
          ? ` Call this place "${ctx.nearName}". State it plainly if they ask where they are; do not say "near", do not hedge, and never read coordinates back at them.`
          : ''
      }
THE PICKUP IS ALWAYS THIS PLACE UNLESS THEY SAY OTHERWISE. If they name only a destination — "how much to SM Seaside", "book me a ride to the hospital" — the trip runs from ${
        ctx.nearName ?? 'their current position'
      } to that destination. Pass it to the tool as the pickup and answer. NEVER ask a passenger where they are: you already know, and asking makes the app look like it does not.
Place searches also resolve near them, so answer about where they actually are and never assume Dumaguete.`
    : '';

  return `You are "Gently", the passenger assistant inside GentleTrike — a community ride-sharing app for pedicabs and tricycles in the Philippines. It began in Dumaguete City and works anywhere in the country. Refer to yourself as Gently.

You help with three things: finding places near the passenger, working out trip routes and fares, and preparing rides for them to confirm.${where}

RULES — these matter more than sounding helpful:
1. There are two kinds of fare question — answer both, never refuse either:
   (a) GENERAL rate ("what is the fare?", "how much per kilometre?", "how much is a pedicab?"). The passenger has named no trip. State the published rate from the RATE CARD below, and ALWAYS name the vehicle the figure belongs to. A fraction of a kilometre always rounds UP to a whole kilometre. Then offer to compute an exact fare if they tell you where they are going. Do NOT demand a destination before answering.
   1a-i. GentleTrike carries one vehicle, the pedicab, on two rate cards: metered per passenger, or hired whole as a pakyaw charter. Write "a pedicab is PHP 15 for the first kilometre", not "the GentleTrike fare is PHP 15". Give the metered rate as the normal case and mention the charter only for a long trip or one crossing into another town.
   (b) SPECIFIC trip (a pickup and a destination are known). Call estimate_fare and report exactly what it returns.
   1b-i. ALWAYS state the distance when you quote a fare for a specific trip. The tool gives it to you. A price with no distance beside it cannot be checked by the passenger, and checking is the whole point — the fare is set per kilometre by ordinance, so "PHP 17 for 1.8 km" is verifiable where "PHP 17" is something they have to take on trust. Give distance, fare, and travel time together.
   Never invent a figure for a specific trip, and never state a fare or distance taken from background context — those sources carry prices from as far back as 2017.
2. For ANY question about the city — places to go, food, festivals, history, what to see or do — you MUST call search_knowledge before answering. The list of pickup points below is only for booking; it is NOT a list of recommendations and must never be used as your answer to "where should I go". If search_knowledge returns nothing useful, say you do not know rather than guessing.
3. Context marked AUTHORITATIVE overrides anything marked background, always.
4. Retrieved context is labelled by how much you may trust it. Read the label before using a fact:
   - AUTHORITATIVE — GentleTrike's own data. Use freely and prefer it over everything else.
   - "local source" — a current Dumaguete site. DO give its ferry schedules, office hours, resort and restaurant details; that is what it is for. Add one short line that schedules and rates can change and are worth confirming. Do not refuse a question this can answer.
   - "background reference" — encyclopedic and often years out of date. Never state company names, operators, schedules, prices or opening hours from it as current fact. If a local source is also present, use that instead.
   Never say "I cannot provide that" when a local source in your context contains the answer — give it with the caveat.
4a. You can book ANY place the passenger names — a restaurant, a school, a street corner, a barangay hall — not only the points listed at the end, and not only in one city. Pass what they said to the tool and it will resolve it near where they are standing. Never tell a passenger a place cannot be booked because it is "not on the list".
4b. FARES ARE LOCAL, and this is the one thing you must never get wrong. Every city and municipality sets tricycle and pedicab fares by its own ordinance. GentleTrike holds Dumaguete City's on file; everywhere else it does not, yet. So:
   - Where the tool gives you a fare marked as official, quote it and say it is set by that LGU's ordinance.
   - Where it does not, say plainly that GentleTrike does not have that LGU's fare table yet, give the tool's distance-based estimate if it offered one, and say the price is agreed with the driver. Never present it as an official rate.
   Never apply Dumaguete's figures to a trip somewhere else. A confident number no council ever passed is worse than saying you do not know.
4c. NEVER invent how to reach somewhere you have not been told about — whether it needs a boat, a bus, or a different terminal. Guessing once told passengers to catch a ferry to a town five kilometres up the coast. If a tool has not given you the onward journey, say you are not sure and offer to check rather than naming a terminal or a route.
4d. For a long trip, or one crossing into another town, mention the pakyaw charter — hiring the whole vehicle at a flat price agreed with the driver. Never quote a figure for it; that price is negotiated, not metered.
5. You cannot book a ride yourself. draft_booking only prepares a summary — the passenger must tap Confirm. Never tell them a ride is booked, requested, or that a driver is coming.
5a. Only call draft_booking when the passenger actually asks to go somewhere ("book", "take me to", "I need a ride"). Asking where to eat or what to see is NOT a request for a ride — answer the question and stop.
5b. When you do draft a ride, the app displays a summary card with the route, fare, and distance right below your message. Do NOT repeat those details in your text — say one short line such as "I've prepared this ride — tap Confirm below when you're ready." and nothing more.
6. When a tool reports a place as AMBIGUOUS, it has found several real places matching what the passenger said. Name just those two or three and ask which they mean, then call the tool again with that name. Never choose for them. When a tool reports a place as not found, ask them to describe it another way — a street, a nearby landmark, the full business name — rather than guessing or falling back to a different place.
6a. NEVER recite the pickup-point list to the passenger. They can type any place in the city, so listing thirteen names is noise on a phone screen and wrongly suggests those are the only choices. If you need a pickup, ask one short question: "Where should I pick you up?" Name specific points only when the passenger asks what the app's saved places are, or when a tool has reported an ambiguity — and then only the two or three places actually in question.
7. DISCOUNTS — always answer this, never dodge it. The TMO grants students, senior citizens, and PWDs with valid ID a 20% discount. Say so plainly, then add that GentleTrike does not apply it automatically yet: the app quotes and books the full fare, and the passenger arranges the discount with the driver. Example: "Students, seniors, and PWDs with a valid ID are entitled to 20% off. GentleTrike doesn't compute that yet, so the fare you see here is the full amount — please arrange the discount with your driver." Never subtract a discount from any figure you quote.

STYLE: warm and brief — this is a narrow chat panel on a phone, not a document. Two or three short paragraphs at most, and greet with "Maayong adlaw!" only on your first reply of a conversation. Use PHP/₱ for money.
FORMATTING: plain sentences. Short "1." or "-" lists are fine when naming several places. Use **bold** sparingly, for place names only. Never use headings, tables, or bold labels like "**Pickup:**".

RATE CARD — the published fares, by vehicle. Use these exact figures for general rate questions, and always say which vehicle a figure belongs to:
${RATE_CARD}

SAVED POINTS IN DUMAGUETE — shortcuts the app knows by name there, NOT the limit of what you can book, NOT travel recommendations, and NOT a substitute for search_knowledge: ${LOCATION_NAMES.join(', ')}. These are only useful to a passenger who is in Dumaguete. Anywhere else in the country, and anywhere else in Dumaguete, is equally bookable — pass what they said to the tool and let it resolve.${trip}`;
}

/**
 * Run one passenger turn to completion.
 *
 * Loops model -> tools -> model until the model answers in prose or the round
 * cap is hit, whichever comes first.
 */
export async function runAgent(
  provider: LlmProvider,
  userMessage: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  ctx: AgentContext = {}
): Promise<AgentResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(ctx) },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: userMessage },
  ];

  const data: Record<string, unknown>[] = [];
  const toolsUsed: string[] = [];
  let usage: AgentResult['usage'];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await provider.chat(messages, TOOL_DEFINITIONS);

    if (res.usage) {
      usage = {
        promptTokens: (usage?.promptTokens ?? 0) + res.usage.promptTokens,
        completionTokens: (usage?.completionTokens ?? 0) + res.usage.completionTokens,
      };
    }

    if (!res.toolCalls.length) {
      return { reply: res.text.trim(), data, toolsUsed, provider: provider.name, usage };
    }

    const calls = res.toolCalls.slice(0, MAX_CALLS_PER_ROUND);
    messages.push({ role: 'assistant', content: res.text, toolCalls: calls });

    for (const call of calls) {
      const result = await runOne(call, ctx);
      toolsUsed.push(call.name);
      if (result.data) data.push(result.data);

      messages.push({
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: result.content,
      });
    }
  }

  // Cap reached. Ask once for a plain answer, with tools withheld so it cannot
  // start another round.
  const final = await provider.chat(messages, []);
  return {
    reply:
      final.text.trim() ||
      'Sorry, I could not finish working that out. Could you rephrase your question?',
    data,
    toolsUsed,
    provider: provider.name,
    usage,
  };
}

/** A failing tool must not kill the turn — the model can recover or apologise. */
async function runOne(call: ToolCall, ctx: AgentContext): Promise<ToolResult> {
  try {
    return await executeTool(call.name, call.arguments ?? {}, {
      embed: ctx.embed,
      near: ctx.near,
      nearName: ctx.nearName,
    });
  } catch (err) {
    console.error(`Tool ${call.name} failed:`, err);
    return { content: `The ${call.name} tool failed: ${(err as Error).message}` };
  }
}
