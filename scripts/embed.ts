import 'dotenv/config';
import { selectAll, run, pool } from '../server/db';
import { initKb, initKbVector, EMBEDDING_DIMS } from '../server/kb/store';
import { OpenAiProvider } from '../server/ai/provider';

/**
 * Embeds knowledge-base chunks that need it.
 *
 * This is the only script in the project that spends money. It embeds a row
 * only when the row has no vector, or when its text changed since the vector
 * was made, so re-running after an ingest costs cents-of-cents rather than
 * repeating the whole corpus.
 *
 *   npm run embed -- --dry-run   report what would be embedded, spend nothing
 *   npm run embed                embed pending rows
 */

/** text-embedding-3-small's published rate, USD per 1M input tokens. */
const USD_PER_MILLION_TOKENS = 0.02;

/** Inputs per API call. Large enough to be efficient, small enough to retry cheaply. */
const BATCH = 96;

interface PendingRow {
  id: string;
  content: string;
  content_hash: string;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey && !dryRun) {
    console.error('OPENAI_API_KEY is not set. Add it to .env first.');
    process.exit(1);
  }

  await initKb();
  const ok = await initKbVector();
  if (!ok) {
    console.error('pgvector unavailable — cannot store embeddings.');
    process.exit(1);
  }

  const pending = await selectAll<PendingRow>(
    `SELECT id, content, content_hash
       FROM kb_chunks
      WHERE embedding IS NULL
         OR embedded_hash IS DISTINCT FROM content_hash
      ORDER BY tier, id`
  );

  const [{ total }] = await selectAll<{ total: number }>(
    'SELECT count(*)::int AS total FROM kb_chunks'
  );

  const chars = pending.reduce((n, r) => n + r.content.length, 0);
  const tokens = Math.round(chars / 4);
  const cost = (tokens / 1_000_000) * USD_PER_MILLION_TOKENS;

  console.log(`\nChunks in knowledge base: ${total}`);
  console.log(`Needing embedding:        ${pending.length}`);
  console.log(`Estimated tokens:         ~${tokens.toLocaleString()}`);
  console.log(`Estimated cost:           ~$${cost.toFixed(4)}\n`);

  if (!pending.length) {
    console.log('Everything is already embedded. Nothing to do, nothing spent.');
    await pool.end();
    return;
  }

  if (dryRun) {
    console.log('Dry run — no API calls made, nothing spent.');
    await pool.end();
    return;
  }

  const provider = new OpenAiProvider(apiKey!);

  // Prove the key and model work on one short input before committing to the
  // whole corpus. A bad key should cost one token, not the full run.
  process.stdout.write('Verifying API key with a single short embedding... ');
  const probe = await provider.embed(['Dumaguete City']);
  if (probe[0]?.length !== EMBEDDING_DIMS) {
    console.error(`\nUnexpected embedding size ${probe[0]?.length}, expected ${EMBEDDING_DIMS}.`);
    process.exit(1);
  }
  console.log(`ok (${probe[0].length} dims)\n`);

  let done = 0;
  const started = Date.now();

  for (let i = 0; i < pending.length; i += BATCH) {
    const slice = pending.slice(i, i + BATCH);
    const vectors = await provider.embed(slice.map((r) => r.content));

    if (vectors.length !== slice.length) {
      throw new Error(`Expected ${slice.length} vectors, got ${vectors.length}`);
    }

    // One statement per batch: a VALUES list joined back onto the table. The
    // first tuple carries casts so Postgres can type the whole list.
    const tuples = slice
      .map((_, j) => (j === 0 ? '(?::text, ?::text, ?::text)' : '(?,?,?)'))
      .join(',');

    const params = slice.flatMap((row, j) => [
      row.id,
      `[${vectors[j].join(',')}]`,
      row.content_hash,
    ]);

    await run(
      `UPDATE kb_chunks AS k
          SET embedding = v.emb::vector, embedded_hash = v.h
         FROM (VALUES ${tuples}) AS v(id, emb, h)
        WHERE k.id = v.id`,
      ...params
    );

    done += slice.length;
    process.stdout.write(`\r  embedded ${done}/${pending.length}`);
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n\nDone in ${secs}s. Actual cost is close to the ~$${cost.toFixed(4)} estimate.`);

  const [after] = await selectAll<{ n: number }>(
    'SELECT count(embedding)::int AS n FROM kb_chunks'
  );
  console.log(`Embedded rows now: ${after.n}/${total}`);

  await pool.end();
}

main().catch(async (err) => {
  console.error('\nEmbedding failed:', err?.message ?? err);
  await pool.end().catch(() => {});
  process.exit(1);
});
