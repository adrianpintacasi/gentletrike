import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildOfficialChunks } from '../server/kb/official';
import { fetchAllWiki, fetchDumagueteCom } from '../server/kb/sources';
import type { KbChunk } from '../server/kb/types';

/**
 * Builds the Gently knowledge base.
 *
 * Costs nothing to run: every source is a free public API and no embeddings are
 * created here. `--dry-run` additionally touches no database, so chunk quality
 * can be reviewed before anything is written to the shared team Neon instance.
 *
 *   npm run ingest:dry     inspect the corpus, write a JSON preview
 *   npm run ingest         write to Neon (idempotent; safe to re-run)
 */

const DRY_RUN = process.argv.includes('--dry-run');
const PREVIEW_PATH = path.join(process.cwd(), 'data', 'kb-preview.json');

function summarize(chunks: KbChunk[]): void {
  const chars = chunks.reduce((n, c) => n + c.content.length, 0);

  const byTier = new Map<string, number>();
  const bySource = new Map<string, number>();
  for (const c of chunks) {
    byTier.set(c.tier, (byTier.get(c.tier) ?? 0) + 1);
    bySource.set(c.source, (bySource.get(c.source) ?? 0) + 1);
  }

  console.log('\n=== Corpus ===');
  console.log(`  chunks: ${chunks.length}`);
  console.log(`  characters: ${chars.toLocaleString()} (~${Math.round(chars / 4).toLocaleString()} tokens)`);
  console.log(`  median chunk: ${median(chunks.map((c) => c.content.length))} chars`);

  console.log('  by tier:');
  for (const [t, n] of [...byTier].sort((a, b) => b[1] - a[1])) console.log(`    ${t.padEnd(10)} ${n}`);
  console.log('  by source:');
  for (const [s, n] of [...bySource].sort((a, b) => b[1] - a[1])) console.log(`    ${s.padEnd(14)} ${n}`);

  const years = chunks.map((c) => c.sourceYear).filter((y): y is number => !!y);
  if (years.length) {
    const dated = new Map<number, number>();
    for (const y of years) dated.set(y, (dated.get(y) ?? 0) + 1);
    const top = [...dated].sort((a, b) => b[0] - a[0]).slice(0, 8);
    console.log(`  dated chunks: ${years.length}/${chunks.length} — ${top.map(([y, n]) => `${y}:${n}`).join('  ')}`);
  }

  // One-time embedding cost, at text-embedding-3-small's published rate.
  const tokens = chars / 4;
  console.log(`  estimated one-time embedding cost: ~$${((tokens / 1_000_000) * 0.02).toFixed(4)}`);
}

const median = (nums: number[]): number => {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

async function main() {
  console.log(DRY_RUN ? 'Ingest (dry run — no database writes)\n' : 'Ingest -> Neon\n');

  console.log('Official tier (repo data):');
  const official = buildOfficialChunks();

  console.log('\nReference tier (MediaWiki, throttled):');
  const wiki = await fetchAllWiki();

  console.log('\nLocal tier (dumaguete.com):');
  const local = await fetchDumagueteCom();

  const chunks = [...official, ...wiki.chunks, ...local.chunks];

  // Only sources that fetched completely may have their missing rows deleted.
  // A truncated fetch must never prune, or a transient network error silently
  // shrinks the knowledge base.
  const prunable = ['gentletrike'];
  if (wiki.complete) prunable.push('wikivoyage', 'wikipedia');
  if (local.complete) prunable.push('dumaguete.com');

  const incomplete = [
    ...(wiki.complete ? [] : ['wiki']),
    ...(local.complete ? [] : ['dumaguete.com']),
  ];
  if (incomplete.length) {
    console.log(`\n  WARNING: incomplete fetch for ${incomplete.join(', ')} — those sources will not be pruned.`);
  }

  // A duplicate id would silently drop a chunk during upsert.
  const ids = new Set<string>();
  const deduped = chunks.filter((c) => (ids.has(c.id) ? false : (ids.add(c.id), true)));
  if (deduped.length !== chunks.length) {
    console.log(`\n  note: dropped ${chunks.length - deduped.length} duplicate ids`);
  }

  summarize(deduped);

  if (DRY_RUN) {
    fs.mkdirSync(path.dirname(PREVIEW_PATH), { recursive: true });
    fs.writeFileSync(PREVIEW_PATH, JSON.stringify(deduped, null, 2));
    console.log(`\nPreview written to ${PREVIEW_PATH}`);
    console.log('Nothing was written to the database.');
    return;
  }

  // Imported lazily: server/db.ts throws at import time when DATABASE_URL is
  // unset, and a dry run must work without any database configured.
  const { initKb, upsertChunks } = await import('../server/kb/store');
  const { pool } = await import('../server/db');

  console.log('\nWriting to Neon...');
  await initKb();
  const stats = await upsertChunks(deduped, prunable);
  console.log(
    `  inserted ${stats.inserted}, updated ${stats.updated}, ` +
      `unchanged ${stats.unchanged}, pruned ${stats.pruned}`
  );

  await pool.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error('\nIngest failed:', err);
  process.exit(1);
});
