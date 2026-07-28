import { createHash } from 'node:crypto';
import { run, selectAll, tx } from '../db';
import type { KbChunk } from './types';

/**
 * `content_hash` is what keeps re-ingest cheap. Embeddings are the only part of
 * this pipeline that costs money, so Phase 5 embeds a row only when its hash
 * changed. Re-running ingest after a wiki edit re-embeds a handful of chunks,
 * not the whole corpus.
 *
 * The `embedding` column is added in the vector-store step; ingest deliberately
 * leaves it NULL so the corpus can be built and inspected without an API key.
 */
const KB_SCHEMA = `
  CREATE TABLE IF NOT EXISTS kb_chunks (
    id           TEXT PRIMARY KEY,
    tier         TEXT NOT NULL,
    source       TEXT NOT NULL,
    source_url   TEXT,
    title        TEXT NOT NULL,
    section      TEXT,
    content      TEXT NOT NULL,
    source_year  INTEGER,
    content_hash TEXT NOT NULL,
    updated_at   TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
  );

  CREATE INDEX IF NOT EXISTS idx_kb_tier   ON kb_chunks(tier);
  CREATE INDEX IF NOT EXISTS idx_kb_source ON kb_chunks(source);
`;

export async function initKb(): Promise<void> {
  await run(KB_SCHEMA);
}

/** Dimensions returned by text-embedding-3-small. */
export const EMBEDDING_DIMS = 1536;

/**
 * Add the vector column and its index.
 *
 * Separate from initKb() because ingest must work on a database without
 * pgvector — the corpus is built and inspected long before an API key exists.
 * Returns false if the extension is unavailable, so callers can report a clear
 * cause instead of a raw SQL error.
 */
export async function initKbVector(log = console.log): Promise<boolean> {
  const [avail] = await selectAll<{ name: string }>(
    "SELECT name FROM pg_available_extensions WHERE name = 'vector'"
  );
  if (!avail) {
    log('  pgvector is NOT available on this database.');
    return false;
  }

  await run('CREATE EXTENSION IF NOT EXISTS vector');
  const [v] = await selectAll<{ extversion: string }>(
    "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
  );
  log(`  pgvector ${v?.extversion ?? '?'} enabled`);

  await run(
    `ALTER TABLE kb_chunks ADD COLUMN IF NOT EXISTS embedding vector(${EMBEDDING_DIMS})`
  );

  // Which content_hash the stored vector was built from. Embedding is the only
  // step that costs money, so a re-ingest must re-embed exactly the rows whose
  // text changed — not the whole corpus.
  await run('ALTER TABLE kb_chunks ADD COLUMN IF NOT EXISTS embedded_hash TEXT');

  // HNSW gives better recall/latency than ivfflat and needs no training pass.
  // At ~1k rows Postgres may well seq-scan anyway; the index is for headroom.
  try {
    await run(
      `CREATE INDEX IF NOT EXISTS idx_kb_embedding
         ON kb_chunks USING hnsw (embedding vector_cosine_ops)`
    );
    log('  HNSW cosine index ready');
  } catch (err) {
    log(`  HNSW unavailable (${(err as Error).message.split('\n')[0]}); falling back to ivfflat`);
    await run(
      `CREATE INDEX IF NOT EXISTS idx_kb_embedding
         ON kb_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50)`
    );
    log('  ivfflat cosine index ready');
  }

  return true;
}

export interface KbStatus {
  total: number;
  embedded: number;
  byTier: { tier: string; n: number }[];
  bySource: { source: string; n: number }[];
  hasVector: boolean;
}

export async function kbStatus(): Promise<KbStatus> {
  const [ext] = await selectAll<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'vector'"
  );
  const hasVector = (ext?.n ?? 0) > 0;

  const [totals] = await selectAll<{ total: number }>(
    'SELECT count(*)::int AS total FROM kb_chunks'
  );

  // The column only exists once initKbVector() has run.
  let embedded = 0;
  if (hasVector) {
    const [e] = await selectAll<{ n: number }>(
      'SELECT count(embedding)::int AS n FROM kb_chunks'
    );
    embedded = e?.n ?? 0;
  }

  return {
    total: totals?.total ?? 0,
    embedded,
    hasVector,
    byTier: await selectAll('SELECT tier, count(*)::int AS n FROM kb_chunks GROUP BY tier ORDER BY n DESC'),
    bySource: await selectAll('SELECT source, count(*)::int AS n FROM kb_chunks GROUP BY source ORDER BY n DESC'),
  };
}

export const contentHash = (s: string) => createHash('sha1').update(s).digest('hex');

/** Rows per INSERT. Keeps the statement well under any parameter limit. */
const BATCH = 25;

export interface IngestStats {
  inserted: number;
  updated: number;
  unchanged: number;
  pruned: number;
}

/**
 * Write chunks, then remove rows from the same sources that this run did not
 * produce — otherwise an article deleted upstream would answer questions
 * forever. Wrapped in one transaction so a mid-run failure can't leave the
 * corpus half-pruned.
 *
 * `prunableSources` must list only sources that fetched *completely*. Pruning a
 * source whose fetch was cut short deletes chunks that still exist upstream and
 * were merely unreachable this run — which is how a single failed page once
 * destroyed 121 chunks.
 */
export async function upsertChunks(
  chunks: KbChunk[],
  prunableSources?: string[]
): Promise<IngestStats> {
  if (!chunks.length) return { inserted: 0, updated: 0, unchanged: 0, pruned: 0 };

  const sources = [...new Set(chunks.map((c) => c.source))];
  const prunable = new Set(prunableSources ?? sources);

  return tx(async () => {
    const existing = await selectAll<{ id: string; content_hash: string; source: string }>(
      `SELECT id, content_hash, source FROM kb_chunks WHERE source IN (${sources
        .map(() => '?')
        .join(',')})`,
      ...sources
    );
    const before = new Map(existing.map((r) => [r.id, r.content_hash]));

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    const pending = chunks.filter((c) => {
      const prev = before.get(c.id);
      if (prev === undefined) {
        inserted++;
        return true;
      }
      if (prev !== contentHash(c.content)) {
        updated++;
        return true;
      }
      unchanged++;
      return false;
    });

    for (let i = 0; i < pending.length; i += BATCH) {
      const slice = pending.slice(i, i + BATCH);
      const values = slice.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
      const params = slice.flatMap((c) => [
        c.id,
        c.tier,
        c.source,
        c.sourceUrl,
        c.title,
        c.section,
        c.content,
        c.sourceYear,
        contentHash(c.content),
      ]);

      await run(
        `INSERT INTO kb_chunks
           (id, tier, source, source_url, title, section, content, source_year, content_hash)
         VALUES ${values}
         ON CONFLICT (id) DO UPDATE SET
           tier         = EXCLUDED.tier,
           source_url   = EXCLUDED.source_url,
           title        = EXCLUDED.title,
           section      = EXCLUDED.section,
           content      = EXCLUDED.content,
           source_year  = EXCLUDED.source_year,
           content_hash = EXCLUDED.content_hash,
           updated_at   = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`,
        ...params
      );
    }

    const liveIds = new Set(chunks.map((c) => c.id));
    const stale = existing
      .filter((r) => prunable.has(r.source) && !liveIds.has(r.id))
      .map((r) => r.id);

    let pruned = 0;
    for (let i = 0; i < stale.length; i += BATCH) {
      const slice = stale.slice(i, i + BATCH);
      const res = await run(
        `DELETE FROM kb_chunks WHERE id IN (${slice.map(() => '?').join(',')})`,
        ...slice
      );
      pruned += res.changes;
    }

    return { inserted, updated, unchanged, pruned };
  });
}
