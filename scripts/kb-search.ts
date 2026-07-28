import 'dotenv/config';
import { pool } from '../server/db';
import { retrieve, requiresOfficialTier } from '../server/ai/retrieve';
import { OpenAiProvider } from '../server/ai/provider';

/**
 * Query the knowledge base from the terminal, the same way Gently's
 * search_knowledge tool does.
 *
 *   npm run kb:search -- "where can I take a date"
 *   npm run kb:search -- --keyword "pedicab fare"    (skip embeddings, free)
 *
 * Each search embeds one short string, so the cost is a rounding error — but
 * --keyword makes it exactly zero.
 */
async function main() {
  const args = process.argv.slice(2);
  const keywordOnly = args.includes('--keyword');
  const query = args.filter((a) => !a.startsWith('--')).join(' ').trim();

  if (!query) {
    console.error('Usage: npm run kb:search -- "your question"');
    process.exit(1);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const provider = !keywordOnly && apiKey ? new OpenAiProvider(apiKey) : null;
  const embed = provider ? async (t: string) => (await provider.embed([t]))[0] : undefined;

  const { chunks, tiers, mode } = await retrieve(query, embed);

  console.log(`\nquery:  "${query}"`);
  console.log(`mode:   ${mode}${requiresOfficialTier(query) ? '  (classified as fare/legal)' : ''}`);
  console.log(`tiers:  ${tiers.join(', ')}`);
  console.log(`hits:   ${chunks.length}\n`);

  chunks.forEach((c, i) => {
    console.log(`[${i + 1}] score ${c.score.toFixed(3)} · ${c.tier} · ${c.source}${c.sourceYear ? ` · ${c.sourceYear}` : ''}`);
    console.log(`    ${c.title}${c.section ? ` — ${c.section}` : ''}`);
    console.log(`    ${c.content.replace(/\s+/g, ' ').slice(0, 200)}...\n`);
  });

  await pool.end();
}

main().catch(async (err) => {
  console.error('kb-search failed:', err?.message ?? err);
  await pool.end().catch(() => {});
  process.exit(1);
});
