import { selectAll } from '../db';
import type { KbTier } from '../kb/types';

export interface RetrievedChunk {
  id: string;
  tier: KbTier;
  source: string;
  sourceUrl: string | null;
  title: string;
  section: string | null;
  content: string;
  sourceYear: number | null;
  score: number;
}

/**
 * Questions whose answer must come from the official tier.
 *
 * This is not a nicety. The ingested Wikivoyage page states the pedicab fare is
 * "regulated at ₱9 per person for trips of up to 3 km"; the real TMO baseline is
 * ₱15. 61 of 271 reference-tier chunks carry peso figures, most from 2017-2020.
 * A system prompt asking the model to "prefer official sources" would not
 * reliably survive a chunk that states a number that confidently, so the filter
 * happens in SQL instead.
 *
 * Includes Cebuano/Tagalog price words — "tagpila"/"pila"/"magkano" — since
 * passengers in Dumaguete ask that way. "pila" also means queue, but a false
 * positive only narrows retrieval to authoritative rows, which is the safe
 * direction to fail.
 */
const FARE_OR_LEGAL =
  /\b(fare|fares|price|prices|pricing|cost|costs|charge|charged|rate|rates|how much|magkano|tagpila|pila|discount|senior|pwd|student|surcharge|pakyaw|overcharg\w*|ordinance|law|legal|liability|liable|franchise|permit|complaint|violation|fine|penalty|tmo|refuse|report)\b|₱|\bphp\b|\bpeso/i;

export function requiresOfficialTier(query: string): boolean {
  return FARE_OR_LEGAL.test(query);
}

export interface RetrieveOptions {
  topK?: number;
  /** Overrides the automatic classification. Used by tests. */
  forceTiers?: KbTier[];
}

/**
 * Keyword retrieval over Postgres full-text search.
 *
 * Used until the corpus is embedded, and kept afterwards as the fallback when a
 * query embeds to nothing useful. Costs no API tokens, which is what makes the
 * whole tool layer testable before an API key exists.
 */
async function keywordSearch(query: string, tiers: KbTier[], topK: number) {
  const tierList = tiers.map(() => '?').join(',');

  const ranked = await selectAll<RetrievedChunk>(
    `SELECT id, tier, source, source_url AS "sourceUrl", title, section, content,
            source_year AS "sourceYear",
            ts_rank(to_tsvector('english', content), plainto_tsquery('english', ?)) AS score
       FROM kb_chunks
      WHERE tier IN (${tierList})
        AND to_tsvector('english', content) @@ plainto_tsquery('english', ?)
      ORDER BY score DESC
      LIMIT ?`,
    query,
    ...tiers,
    query,
    topK
  );

  if (ranked.length) return ranked;

  // plainto_tsquery ANDs every term, so a long natural question often matches
  // nothing. Fall back to the longest word as a substring probe.
  const longest = (query.match(/[\p{L}]{4,}/gu) ?? []).sort((a, b) => b.length - a.length)[0];
  if (!longest) return [];

  return selectAll<RetrievedChunk>(
    `SELECT id, tier, source, source_url AS "sourceUrl", title, section, content,
            source_year AS "sourceYear", 0.01 AS score
       FROM kb_chunks
      WHERE tier IN (${tierList}) AND content ILIKE ?
      LIMIT ?`,
    ...tiers,
    `%${longest}%`,
    topK
  );
}

/** True once Phase 5 has populated embeddings. */
export async function hasEmbeddings(): Promise<boolean> {
  try {
    const [r] = await selectAll<{ n: number }>(
      'SELECT count(embedding)::int AS n FROM kb_chunks'
    );
    return (r?.n ?? 0) > 0;
  } catch {
    return false; // column does not exist yet
  }
}

/**
 * Cosine distance added per year of age when ranking.
 *
 * dumaguete.com carries several ferry pages written years apart. Pure
 * similarity ranked a 2021 page listing a shipping line that has since stopped
 * operating alongside a 2024 page with the current schedule, because both are
 * equally *about* ferries. Age is the tiebreaker similarity cannot see.
 *
 * Kept small on purpose: cosine distance here spans roughly 0.2–0.4 between a
 * good and a mediocre match, so at 0.012/year a decade of age costs 0.12 —
 * enough to reorder near-equal chunks, never enough to promote an irrelevant one.
 */
const AGE_PENALTY_PER_YEAR = 0.012;
const MAX_PENALTY_YEARS = 10;

/** Undated chunks are assumed this old rather than treated as brand new. */
const ASSUMED_AGE_YEARS = 8;

async function vectorSearch(embedding: number[], tiers: KbTier[], topK: number) {
  const tierList = tiers.map(() => '?').join(',');
  const literal = `[${embedding.join(',')}]`;

  return selectAll<RetrievedChunk>(
    `WITH scored AS (
       SELECT id, tier, source, source_url AS "sourceUrl", title, section, content,
              source_year AS "sourceYear",
              (embedding <=> ?::vector) AS distance,
              LEAST(
                GREATEST(
                  EXTRACT(YEAR FROM now())::int
                    - COALESCE(source_year, EXTRACT(YEAR FROM now())::int - ${ASSUMED_AGE_YEARS}),
                  0
                ),
                ${MAX_PENALTY_YEARS}
              ) AS age_years
         FROM kb_chunks
        WHERE tier IN (${tierList}) AND embedding IS NOT NULL
     )
     SELECT id, tier, source, "sourceUrl", title, section, content, "sourceYear",
            1 - distance AS score
       FROM scored
      ORDER BY distance + age_years * ${AGE_PENALTY_PER_YEAR}
      LIMIT ?`,
    literal,
    ...tiers,
    topK
  );
}

/**
 * Retrieve context for a question.
 *
 * `embed` is injected rather than imported so the mock provider can run the
 * whole pipeline without an API key — pass undefined and this uses keyword
 * search.
 */
export async function retrieve(
  query: string,
  embed?: (text: string) => Promise<number[]>,
  opts: RetrieveOptions = {}
): Promise<{ chunks: RetrievedChunk[]; tiers: KbTier[]; mode: 'vector' | 'keyword' }> {
  const topK = opts.topK ?? 4;

  const tiers: KbTier[] =
    opts.forceTiers ??
    (requiresOfficialTier(query)
      ? ['official']
      : ['official', 'local', 'reference']);

  if (embed && (await hasEmbeddings())) {
    try {
      const vec = await embed(query);
      const chunks = await vectorSearch(vec, tiers, topK);
      if (chunks.length) return { chunks, tiers, mode: 'vector' };
    } catch (err) {
      console.error('Vector search failed, falling back to keyword:', (err as Error).message);
    }
  }

  return { chunks: await keywordSearch(query, tiers, topK), tiers, mode: 'keyword' };
}

/**
 * Render chunks for the prompt.
 *
 * Reference-tier text gets an explicit age note. The corpus contains 2017-era
 * prices presented in the present tense; without the note the model repeats
 * them as current fact.
 */
export function formatContext(chunks: RetrievedChunk[]): string {
  if (!chunks.length) return '(no matching knowledge-base entries)';

  const thisYear = new Date().getFullYear();

  return chunks
    .map((c, i) => {
      if (c.tier === 'official') return `[${i + 1}] (AUTHORITATIVE)\n${c.content}`;

      const age = c.sourceYear ? thisYear - c.sourceYear : null;

      // The local tier is a maintained Dumaguete site with real publication
      // dates. Its ferry schedules and office listings are the best information
      // available, so Gently must be allowed to actually use them — an earlier
      // blanket "never state a schedule from background" made it refuse to
      // answer a question the corpus could answer correctly.
      if (c.tier === 'local') {
        const note =
          age === null
            ? 'local source, undated'
            : age <= 2
              ? `local source, published ${c.sourceYear} — current enough to quote`
              : `local source from ${c.sourceYear}, about ${age} years old`;
        return (
          `[${i + 1}] (${note}. You MAY give these details; add a brief note that ` +
          `schedules and rates can change and are worth confirming.)\n${c.content}`
        );
      }

      // Reference tier is encyclopedic and frequently ancient. The Wikivoyage
      // section naming "Delta shipping lines" and "GL shipping lines" as the
      // Siquijor operators carries no "(updated YYYY)" stamp at all, so a
      // year-gated warning never fired and defunct companies were presented as
      // current fact. Undated here means "assume old".
      const refAge =
        age === null
          ? 'UNDATED — assume it is many years old'
          : `written in ${c.sourceYear}, about ${age} years old`;

      return (
        `[${i + 1}] (background reference, ${refAge} — do NOT present company names, ` +
        `schedules, prices or opening hours from this as current. Prefer a local source ` +
        `above if one is present.)\n${c.content}`
      );
    })
    .join('\n\n');
}
