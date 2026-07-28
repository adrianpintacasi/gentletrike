import { DUMAGUETE_LOCATIONS } from '../../src/data/dumagueteData';
import type { LocationPoint } from '../../src/types';

/**
 * Resolve free text to one of the app's pickup points.
 *
 * The model writes what the passenger said — "Silliman", "the boulevard",
 * "robinsons" — not an id. Anything Gently quotes a fare on has to correspond to
 * a real, bookable point, so resolution happens here against the same list the
 * booking UI offers rather than letting the model invent coordinates.
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
const OUT_OF_COVERAGE: Record<string, string> = {
  valencia: 'Valencia town (about 9 km inland from the city)',
  casaroro: 'Casaroro Falls, in Valencia',
  pulangbato: 'Pulangbato Falls, in Valencia',
  siquijor: 'Siquijor island',
  dauin: 'Dauin',
  bacong: 'Bacong',
  zamboanguita: 'Zamboanguita',
  bais: 'Bais City',
  tanjay: 'Tanjay City',
  'apo': 'Apo Island',
  manjuyod: 'Manjuyod Sandbar',
  bohol: 'Bohol',
  cebu: 'Cebu',
};

/** Words that mean the passenger really does want the in-city terminal or port. */
const TERMINAL_WORDS = /\b(terminal|jeepney|bus|station|port|pier|wharf)\b/i;

export interface OutOfCoverage {
  /** The token that matched, e.g. "valencia". */
  place: string;
  /** Human description for the reply. */
  description: string;
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
    const description = OUT_OF_COVERAGE[token];
    if (description) return { place: token, description };
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
}

export function resolveLocation(input: string): ResolvedLocation | null {
  if (!input?.trim()) return null;

  const queryTokens = tokens(input);
  if (!queryTokens.length) return null;

  let best: ResolvedLocation | null = null;

  for (const loc of DUMAGUETE_LOCATIONS) {
    const nameTokens = new Set(tokens(loc.name));
    const addressTokens = new Set(tokens(loc.address ?? ''));
    // `popularFor` is descriptive blurb, not an address. Matching on it is how
    // "Casaroro" and "Pulangbato" both scored against the Valencia terminal,
    // whose blurb reads "Jeepneys to Valencia, Casaroro & Pulangbato Falls".
    // It stays as a weak tiebreaker but can never carry a match on its own.
    const blurbTokens = new Set(tokens(loc.popularFor ?? ''));

    let score = 0;
    let identified = false; // did anything match the actual NAME/alias?

    for (const qt of queryTokens) {
      if (ALIASES[qt] === loc.id) {
        score += 2;
        identified = true;
      } else if (nameTokens.has(qt)) {
        score += 1.5;
        identified = true;
      } else if (addressTokens.has(qt)) {
        score += 0.5;
      } else if (blurbTokens.has(qt)) {
        score += 0.1;
      } else if ([...nameTokens].some((h) => h.startsWith(qt) || qt.startsWith(h))) {
        score += 0.25;
        identified = true;
      }
    }

    if (score === 0) continue;

    // Without a name or alias hit this is a blurb/address coincidence, so keep
    // it below the confidence floor the callers use to decide "ask, don't guess".
    const raw = score / (queryTokens.length * 2);
    const confidence = identified ? Math.min(1, raw) : Math.min(raw, 0.2);

    if (!best || confidence > best.confidence) {
      best = { location: loc, confidence };
    }
  }

  return best;
}

/** Names the model can be shown, so it suggests real options when unsure. */
export const LOCATION_NAMES = DUMAGUETE_LOCATIONS.map((l) => l.name);
