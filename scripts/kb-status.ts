import 'dotenv/config';
import { initKb, initKbVector, kbStatus } from '../server/kb/store';
import { pool } from '../server/db';

/**
 * Prepares the vector column and reports what is in the knowledge base.
 *
 *   npm run kb:status          report only
 *   npm run kb:status -- --init  also create the extension, column, and index
 *
 * Read-only by default so it is safe to run against the shared team database.
 */
async function main() {
  const doInit = process.argv.includes('--init');

  if (doInit) {
    console.log('Preparing kb_chunks + pgvector...');
    await initKb();
    const ok = await initKbVector();
    if (!ok) {
      console.error(
        '\npgvector is not available on this Neon database. Enable it in the Neon\n' +
          'console (Extensions), or retrieval will have to fall back to full-text search.'
      );
      await pool.end();
      process.exit(1);
    }
    console.log();
  }

  const s = await kbStatus();

  console.log('=== Knowledge base ===');
  console.log(`  pgvector installed: ${s.hasVector ? 'yes' : 'no'}`);
  console.log(`  chunks: ${s.total}`);
  console.log(`  embedded: ${s.embedded}/${s.total}${s.embedded === 0 ? '  (nothing embedded yet — no API cost incurred)' : ''}`);

  console.log('  by tier:');
  for (const r of s.byTier) console.log(`    ${r.tier.padEnd(10)} ${r.n}`);
  console.log('  by source:');
  for (const r of s.bySource) console.log(`    ${r.source.padEnd(14)} ${r.n}`);

  await pool.end();
}

main().catch((err) => {
  console.error('kb-status failed:', err);
  process.exit(1);
});
