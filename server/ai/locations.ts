import { DUMAGUETE_LOCATIONS } from '../../src/data/dumagueteData';
import type { LocationPoint } from '../../src/types';
import { haversineKm } from '../../shared/geo';
import { searchPlaces, type GeocodeResult } from '../geocode';

/**
 * Resolve free text to somewhere in Dumaguete that GentleTrike can drive to.
 *
 * The model writes what the passenger said — "Silliman", "the boulevard",
 * "that bakery on Perdices" — not an id. Anything Gently quotes a fare on has
 * to be a real point on the map, so resolution happens here rather than letting
 * the model invent coordinates.
 *
 * Two stages. The curated pickup points are tried first: they are free, offline,
 * instant, and cover most of what passengers ask for. Only on a miss does the
 * geocoder run, which is what lets Gently book the other several thousand places
 * in the city. The city boundary still applies — searchPlaces filters to the
 * service area — because each municipality has its own fare matrix and we can
 * only price this one.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'from', 'at', 'in', 'of', 'and', 'city', 'dumaguete',
  'near', 'go', 'going', 'please', 'me', 'my', 'i',
]);

const normalize = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

const tokens = (s: string) =>
  normalize(s).split(' ').filter((t) => t.length > 2 && !STOPWORDS.has(t));

/**
 * Places passengers ask about that GentleTrike cannot actually take them to.
 *
 * These exist because a name can look bookable and not be. "Valencia" is the
 * worst case: the app has a "Valencia Jeepney & Bus Terminal", but that terminal
 * is on Colon St in downtown Dumaguete — it is where you catch a jeepney to
 * Valencia, not Valencia itself, which is ~9 km inland. Fuzzy matching happily
 * scored the town name against the terminal's name and quoted ₱17 for a 1.14 km
 * hop, then offered to book it. A passenger could have confirmed that believing
 * they were going up the mountain.
 *
 * Checked BEFORE fuzzy resolution, because the terminal would otherwise win on
 * name overlap alone.
 */
interface OutsidePlace {
  /** Human description for the reply. */
  description: string;
  /**
   * How people actually reach it, and from where.
   *
   * Stated per place rather than left to the model. Given only a list of
   * terminals to choose from, it will slot an unfamiliar town into whichever
   * looks plausible — it once told a passenger to catch a ferry to Sibulan,
   * which is five kilometres up the coast by road.
   */
  onward: string;
}

const BY_LAND_SOUTH = 'a southbound bus or jeepney from the Ceres Bus Terminal — it is reached by road, no boat involved';
const BY_LAND_NORTH = 'a northbound bus or jeepney from the Ceres Bus Terminal — it is reached by road, no boat involved';
const BY_JEEPNEY_VALENCIA = 'a jeepney from the Valencia Jeepney & Bus Terminal on Colon Street — it is reached by road, no boat involved';

const OUT_OF_COVERAGE: Record<string, OutsidePlace> = {
  valencia: {
    description: 'Valencia town (about 9 km inland from the city)',
    onward: BY_JEEPNEY_VALENCIA,
  },
  casaroro: {
    description: 'Casaroro Falls, in Valencia',
    onward: `${BY_JEEPNEY_VALENCIA}, then a habal-habal to the trailhead`,
  },
  pulangbato: {
    description: 'Pulangbato Falls, in Valencia',
    onward: `${BY_JEEPNEY_VALENCIA}, then a habal-habal onward`,
  },
  sibulan: {
    description: 'Sibulan town (the next town north, about 5 km up the coast)',
    onward: BY_LAND_NORTH,
  },
  bacong: { description: 'Bacong', onward: BY_LAND_SOUTH },
  dauin: { description: 'Dauin', onward: BY_LAND_SOUTH },
  zamboanguita: { description: 'Zamboanguita', onward: BY_LAND_SOUTH },
  bais: { description: 'Bais City', onward: BY_LAND_NORTH },
  tanjay: { description: 'Tanjay City', onward: BY_LAND_NORTH },
  amlan: { description: 'Amlan', onward: BY_LAND_NORTH },
  manjuyod: {
    description: 'Manjuyod Sandbar',
    onward: `${BY_LAND_NORTH}, then a boat chartered from Manjuyod or Bais`,
  },
  apo: {
    description: 'Apo Island',
    onward: `${BY_LAND_SOUTH} to Malatapay in Zamboanguita, then a boat from Malatapay`,
  },
  siquijor: { description: 'Siquijor island', onward: 'a ferry from Dumaguete Port' },
  bohol: { description: 'Bohol', onward: 'a ferry from Dumaguete Port' },
  cebu: { description: 'Cebu', onward: 'a ferry from Dumaguete Port' },
};

/**
 * Words that mean the passenger really does want an in-city point.
 *
 * "airport" matters as much as "terminal": Sibulan town is out of coverage but
 * Sibulan Airport is a bookable pickup point, and the two share a name.
 */
const TERMINAL_WORDS = /\b(terminal|jeepney|bus|station|port|pier|wharf|airport|dgt)\b/i;

export interface OutOfCoverage {
  /** The token that matched, e.g. "valencia". */
  place: string;
  /** Human description for the reply. */
  description: string;
  /** The correct way to get there, so the model never invents one. */
  onward: string;
}

/**
 * Detect a destination outside the app's bookable area.
 *
 * Returns null when the passenger clearly means the in-city terminal
 * ("Valencia terminal"), which IS bookable.
 */
export function detectOutOfCoverage(input: string): OutOfCoverage | null {
  if (!input?.trim() || TERMINAL_WORDS.test(input)) return null;

  for (const token of tokens(input)) {
    const hit = OUT_OF_COVERAGE[token];
    if (hit) return { place: token, ...hit };
  }
  return null;
}

/** Common ways passengers refer to these places that the official names miss. */
const ALIASES: Record<string, string> = {
  boulevard: 'rizal_blvd',
  blvd: 'rizal_blvd',
  rizal: 'rizal_blvd',
  silliman: 'silliman_portal',
  su: 'silliman_portal',
  port: 'dumaguete_port',
  pier: 'dumaguete_port',
  ferry: 'dumaguete_port',
  robinsons: 'robinsons_place',
  robinson: 'robinsons_place',
  lee: 'lee_super_plaza',
  airport: 'sibulan_airport',
  sibulan: 'sibulan_airport',
  market: 'public_market',
  painitan: 'public_market',
  capitol: 'freedom_park',
  cathedral: 'cathedral_belltower',
  belfry: 'cathedral_belltower',
  campanario: 'cathedral_belltower',
  sansrival: 'sans_rival_bistro',
  citymall: 'city_mall',
  hospital: 'holy_child_hospital',
  // Deliberately no bare "valencia" alias — that is a town 9 km away, not this
  // downtown terminal. detectOutOfCoverage() handles it; "valencia terminal"
  // still resolves here through the name match below.
  bantayan: 'bantayan_piapi',
};

export interface ResolvedLocation {
  location: LocationPoint;
  /** 0-1. Below ~0.34 the match is a guess and the caller should ask instead. */
  confidence: number;
  /**
   * Fraction of the passenger's words this point actually accounts for.
   *
   * Confidence alone cannot tell "Silliman" from "Foundation University": both
   * score against Silliman University Portal because they share the word
   * "university", and with sixteen points and words like university, port,
   * market and hospital in their names, near-misses are common. Coverage
   * separates them — the first explains every word, the second explains half.
   */
  coverage: number;
}

/**
 * Every curated point that matches, best first.
 *
 * The runners-up matter as much as the winner. "Terminal" describes both Ceres
 * Bus Terminal and the Valencia Jeepney & Bus Terminal equally well, and
 * returning only the best match meant whichever happened to come first in the
 * data was chosen silently — sending a passenger across town without ever
 * mentioning there was a choice.
 */
export function rankLocations(input: string): ResolvedLocation[] {
  if (!input?.trim()) return [];

  const queryTokens = tokens(input);
  if (!queryTokens.length) return [];

  const matches: ResolvedLocation[] = [];

  for (const loc of DUMAGUETE_LOCATIONS) {
    const nameTokens = new Set(tokens(loc.name));
    const addressTokens = new Set(tokens(loc.address ?? ''));
    // `popularFor` is descriptive blurb, not an address. Matching on it is how
    // "Casaroro" and "Pulangbato" both scored against the Valencia terminal,
    // whose blurb reads "Jeepneys to Valencia, Casaroro & Pulangbato Falls".
    // It stays as a weak tiebreaker but can never carry a match on its own.
    const blurbTokens = new Set(tokens(loc.popularFor ?? ''));

    let score = 0;
    let identifiedTokens = 0; // how many words matched the actual NAME/alias?

    for (const qt of queryTokens) {
      if (ALIASES[qt] === loc.id) {
        score += 2;
        identifiedTokens++;
      } else if (nameTokens.has(qt)) {
        score += 1.5;
        identifiedTokens++;
      } else if (addressTokens.has(qt)) {
        score += 0.5;
      } else if (blurbTokens.has(qt)) {
        score += 0.1;
      } else if ([...nameTokens].some((h) => h.startsWith(qt) || qt.startsWith(h))) {
        score += 0.25;
        identifiedTokens++;
      }
    }

    if (score === 0) continue;

    // Without a name or alias hit this is a blurb/address coincidence, so keep
    // it below the confidence floor the callers use to decide "ask, don't guess".
    const raw = score / (queryTokens.length * 2);
    const confidence = identifiedTokens > 0 ? Math.min(1, raw) : Math.min(raw, 0.2);

    matches.push({ location: loc, confidence, coverage: identifiedTokens / queryTokens.length });
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

export function resolveLocation(input: string): ResolvedLocation | null {
  return rankLocations(input)[0] ?? null;
}

/** Names the model can be shown, so it suggests real options when unsure. */
export const LOCATION_NAMES = DUMAGUETE_LOCATIONS.map((l) => l.name);

/** Below this a curated "match" is noise, and the geocoder gets a turn. */
export const MIN_CONFIDENCE = 0.34;

/**
 * Share of the passenger's words a curated point must explain to be used
 * without consulting the map.
 *
 * A shortcut is only a shortcut when it is obviously right. Half a match now
 * defers to the geocoder rather than being accepted, because the cost of
 * deferring is one network call and the cost of accepting is a passenger sent
 * to the wrong campus.
 */
const MIN_COVERAGE = 0.6;

/**
 * How close a second curated point has to be before "terminal" counts as a
 * question rather than an answer.
 *
 * Ties are common with one-word queries, because the shortcut that makes
 * "market" or "port" convenient is the same thing that makes "terminal"
 * genuinely undecidable.
 */
const CURATED_TIE_MARGIN = 0.15;

/** Turn a geocoder hit into a bookable point, flagged as pinned rather than curated. */
const toPoint = (r: GeocodeResult): LocationPoint => ({
  id: `geo:${r.lat.toFixed(5)},${r.lng.toFixed(5)}`,
  name: r.name,
  address: r.address,
  lat: r.lat,
  lng: r.lng,
  isCustomPinned: true,
});

/** How well a geocoder hit answers what the passenger actually typed. */
function geocodeScore(queryTokens: string[], r: GeocodeResult): number {
  const nameTokens = new Set(tokens(r.name));
  const addressTokens = new Set(tokens(r.address ?? ''));

  let score = 0;
  for (const qt of queryTokens) {
    if (nameTokens.has(qt)) score += 1.5;
    else if ([...nameTokens].some((h) => h.startsWith(qt) || qt.startsWith(h))) score += 0.75;
    else if (addressTokens.has(qt)) score += 0.25;
  }
  return score;
}

/**
 * How far ahead the best hit must be before it is taken without asking.
 *
 * A geocoder returns a ranked list with no notion of confidence, so "Sans Rival"
 * and "Sans Rival Bistro" arrive looking equally plausible. Silently taking the
 * first would sometimes send a passenger to the wrong branch of the right shop,
 * which is exactly the failure the curated list's confidence floor exists to
 * prevent — so the same rule applies here.
 */
const AMBIGUITY_MARGIN = 0.75;

/** Closer than this, two hits are the same place described twice. */
const SAME_PLACE_KM = 0.15;

export type PlaceResolution =
  | { kind: 'resolved'; location: LocationPoint; source: 'curated' | 'geocoded' }
  | { kind: 'ambiguous'; options: LocationPoint[] }
  | { kind: 'not-found' };

/** Beyond this from Dumaguete, the app's saved points are somebody else's city. */
const CURATED_RELEVANCE_KM = 40;
const DUMAGUETE_CENTRE = { lat: 9.3068, lng: 123.3054 };

export async function resolvePlace(
  input: string,
  /** Where the passenger is, so results are places they can actually reach. */
  near?: { lat: number; lng: number }
): Promise<PlaceResolution> {
  if (!input?.trim()) return { kind: 'not-found' };

  /*
   * The curated list is Dumaguete's, and only Dumaguete's.
   *
   * Matching it for a passenger standing in Cebu is actively harmful, not
   * merely useless: ask for "Robinsons" there and fuzzy matching happily
   * returns Robinsons Place Dumaguete, 300 km across the sea, with enough
   * confidence to skip the geocoder entirely. Out of range, we go straight to
   * search, which resolves near the passenger.
   */
  const curatedApplies =
    !near ||
    haversineKm(near, { lat: DUMAGUETE_CENTRE.lat, lng: DUMAGUETE_CENTRE.lng }) <=
      CURATED_RELEVANCE_KM;

  const curated = curatedApplies
    ? rankLocations(input).filter(
        (c) => c.confidence >= MIN_CONFIDENCE && c.coverage >= MIN_COVERAGE
      )
    : [];

  if (curated.length) {
    const rivals = curated
      .slice(1)
      .filter(
        (c) =>
          curated[0].confidence - c.confidence < CURATED_TIE_MARGIN &&
          haversineKm(curated[0].location, c.location) > SAME_PLACE_KM
      );

    if (rivals.length) {
      return {
        kind: 'ambiguous',
        options: [curated[0], ...rivals].slice(0, 3).map((c) => c.location),
      };
    }

    return { kind: 'resolved', location: curated[0].location, source: 'curated' };
  }

  const queryTokens = tokens(input);
  if (!queryTokens.length) return { kind: 'not-found' };

  const { results } = await searchPlaces(input, near);
  if (!results.length) return { kind: 'not-found' };

  const ranked = results
    .map((r) => ({ point: toPoint(r), score: geocodeScore(queryTokens, r) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return { kind: 'not-found' };

  // Rivals are only genuine alternatives if they are somewhere else. Two hits
  // for the same mall entrance do not need a question.
  const rivals = ranked
    .slice(1)
    .filter(
      (r) =>
        ranked[0].score - r.score < AMBIGUITY_MARGIN &&
        haversineKm(ranked[0].point, r.point) > SAME_PLACE_KM
    );

  if (rivals.length) {
    return { kind: 'ambiguous', options: [ranked[0], ...rivals].slice(0, 3).map((r) => r.point) };
  }

  return { kind: 'resolved', location: ranked[0].point, source: 'geocoded' };
}
