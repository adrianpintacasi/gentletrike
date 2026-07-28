/**
 * One retrievable unit of knowledge.
 *
 * `tier` decides precedence when chunks disagree, which they will: the wiki
 * pages carry pedicab prices from 2017 that no longer match the TMO baseline.
 * Retrieval never lets a lower tier answer a fare or legal question.
 */
export type KbTier =
  /** Repo-owned: the ordinance, the fare table, the location list. Always wins. */
  | 'official'
  /** dumaguete.com — current local reporting, but mixed quality. */
  | 'local'
  /** Wikivoyage / Wikipedia — broad, well written, frequently stale. */
  | 'reference';

export interface KbChunk {
  /** Deterministic hash of source+title+section+ordinal, so re-ingest upserts. */
  id: string;
  tier: KbTier;
  /** 'gentletrike' | 'dumaguete.com' | 'wikivoyage' | 'wikipedia' */
  source: string;
  sourceUrl: string;
  title: string;
  /** Heading path within the page, e.g. "Get around > By pedicab". */
  section: string;
  content: string;
  /**
   * Year the underlying text was last known good, when the source states one.
   * Wikivoyage stamps listings "(updated Mar 2020)"; WordPress has a post date.
   * Retrieval uses this to make Gently hedge on aging prices instead of
   * asserting them.
   */
  sourceYear: number | null;
}
