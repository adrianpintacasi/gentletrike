import { chunkPage, htmlToText, splitWikiSections, decodeEntities } from './clean';
import type { KbChunk } from './types';

const USER_AGENT =
  'GentleTrike/0.1 (Dumaguete ride-hailing student project; contact via repo)';

/**
 * MediaWiki throttles hard — an unthrottled sweep of nine pages returned
 * "You are making too many requests" partway through. This delay is the
 * difference between a complete corpus and a silently truncated one.
 */
const REQUEST_DELAY_MS = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText} for ${url}`);
    (err as any).status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Retry transient failures.
 *
 * Without this a single dropped request silently truncated the corpus: the
 * WordPress pagination loop caught the error, stopped early, and the prune step
 * then deleted every chunk the run had failed to re-fetch. One network blip
 * cost 121 chunks. 4xx responses other than 429 are not retried — those mean
 * "no such page", which is the legitimate end of pagination.
 */
async function getJsonWithRetry(url: string, attempts = 3): Promise<any> {
  let lastErr: unknown;

  for (let i = 1; i <= attempts; i++) {
    try {
      return await getJson(url);
    } catch (err) {
      lastErr = err;
      const status = (err as any)?.status;
      if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) throw err;
      if (i < attempts) await sleep(REQUEST_DELAY_MS * i * 2);
    }
  }

  throw lastErr;
}

/** A source's output plus whether it finished cleanly enough to prune against. */
export interface SourceResult {
  chunks: KbChunk[];
  /** False if any page failed — the caller must then NOT prune this source. */
  complete: boolean;
}

// ---------------------------------------------------------------------------
// Reference tier — MediaWiki
// ---------------------------------------------------------------------------

export interface WikiTarget {
  host: 'en.wikivoyage.org' | 'en.wikipedia.org';
  title: string;
}

export const WIKI_TARGETS: WikiTarget[] = [
  // Wikivoyage is the travel-guide voice, and its Dumaguete page has a section
  // literally titled "By pedicab" — the single most on-topic page anywhere.
  { host: 'en.wikivoyage.org', title: 'Dumaguete' },
  { host: 'en.wikivoyage.org', title: 'Siquijor' },
  { host: 'en.wikivoyage.org', title: 'Negros Oriental' },
  { host: 'en.wikipedia.org', title: 'Dumaguete' },
  { host: 'en.wikipedia.org', title: 'Negros Oriental' },
  { host: 'en.wikipedia.org', title: 'Silliman University' },
  { host: 'en.wikipedia.org', title: 'Valencia, Negros Oriental' },
  { host: 'en.wikipedia.org', title: 'Sibulan' },
  { host: 'en.wikipedia.org', title: 'Dauin' },
  // Deliberately omitted: "Bacong, Negros Oriental" is a 37-byte redirect stub.
];

/** Sections that are navigation or citation scaffolding, never answers. */
const WIKI_SKIP_SECTIONS =
  /^(References|External links|See also|Further reading|Notes|Bibliography|Gallery|Citations)/i;

export async function fetchWikiPage(target: WikiTarget): Promise<KbChunk[]> {
  const url =
    `https://${target.host}/w/api.php?action=query&prop=extracts&explaintext=1` +
    `&titles=${encodeURIComponent(target.title)}&format=json&formatversion=2`;

  const data = await getJsonWithRetry(url);
  const page = data?.query?.pages?.[0];
  if (!page || page.missing || !page.extract) return [];

  const sections = splitWikiSections(page.extract).filter(
    (s) => !WIKI_SKIP_SECTIONS.test(s.section)
  );

  return chunkPage({
    tier: 'reference',
    source: target.host.includes('wikivoyage') ? 'wikivoyage' : 'wikipedia',
    sourceUrl: `https://${target.host}/wiki/${encodeURIComponent(target.title)}`,
    title: target.title,
    sections,
  });
}

export async function fetchAllWiki(log = console.log): Promise<SourceResult> {
  const out: KbChunk[] = [];
  let complete = true;

  for (const target of WIKI_TARGETS) {
    try {
      const chunks = await fetchWikiPage(target);
      out.push(...chunks);
      log(`  ${target.host}/${target.title}: ${chunks.length} chunks`);
    } catch (err) {
      complete = false;
      log(`  ${target.host}/${target.title}: FAILED — ${(err as Error).message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  return { chunks: out, complete };
}

// ---------------------------------------------------------------------------
// Local tier — dumaguete.com (WordPress REST API)
// ---------------------------------------------------------------------------

const WP_BASE = 'https://dumaguete.com/wp-json/wp/v2';

/**
 * Categories worth ingesting. The site has 1,008 posts, but 461 are "News",
 * 297 "Galleries" and 132 "Videos" — ephemeral or image-only, and useless to a
 * text index. This allowlist targets the evergreen local material.
 */
const WP_CATEGORY_SLUGS = [
  'good-to-know',
  // 'dumaguete-city' is the slug behind the category displayed as "Dumaguete"
  // (131 posts); there is no bare 'dumaguete' slug.
  'dumaguete-city',
  'negros-oriental',
  'festivals-in-negros-oriental',
  'dumaguete-city-negros-oriental',
];

/**
 * The site carries paid/SEO guest posts ("Synthetic Indices Robot: A Simple
 * Guide for New Traders") that sit in local categories but have nothing to do
 * with Dumaguete. Requiring several mentions of a local place name filters them
 * out without maintaining a blocklist of titles.
 */
const LOCALITY_TERMS =
  /\b(dumaguete|negros|siquijor|valencia|sibulan|dauin|bacong|silliman|tanjay|bais|apo island|zamboanguita)\b/gi;
const MIN_LOCALITY_MENTIONS = 3;

export function isLocallyRelevant(text: string): boolean {
  return (text.match(LOCALITY_TERMS) ?? []).length >= MIN_LOCALITY_MENTIONS;
}

interface WpPost {
  id: number;
  date: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
}

async function resolveCategoryIds(log: (s: string) => void): Promise<number[]> {
  const cats: { id: number; slug: string; count: number }[] = await getJsonWithRetry(
    `${WP_BASE}/categories?per_page=100&orderby=count&order=desc`
  );

  const matched = cats.filter((c) => WP_CATEGORY_SLUGS.includes(c.slug));
  for (const c of matched) log(`  category "${c.slug}" -> id ${c.id} (${c.count} posts)`);

  const missing = WP_CATEGORY_SLUGS.filter((s) => !matched.some((c) => c.slug === s));
  if (missing.length) log(`  (no such category: ${missing.join(', ')})`);

  return matched.map((c) => c.id);
}

/** Hard ceiling on ingested articles, so a site-side change can't balloon the corpus. */
const WP_MAX_POSTS = 220;
const WP_PER_PAGE = 50;

/**
 * WordPress "pages" are separate from "posts" and carry this site's evergreen
 * reference material — ferry schedules, government offices, tricycle rates,
 * schools, resorts, tour itineraries. Posts are news and festival coverage.
 * Ingesting only posts is why Gently once answered a ferry question from a
 * years-old Wikivoyage section while a current schedule page sat unindexed.
 */
const WP_MAX_PAGES = 320;

/** Pages shorter than this are navigation stubs, not content. */
const WP_MIN_PAGE_CHARS = 400;

interface WpPage {
  id: number;
  modified: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
}

async function fetchWordPressPages(
  log: (s: string) => void
): Promise<{ chunks: KbChunk[]; complete: boolean }> {
  const out: KbChunk[] = [];
  const seen = new Set<number>();
  let kept = 0;
  let rejected = 0;
  let complete = true;

  for (let page = 1; kept < WP_MAX_PAGES; page++) {
    const url =
      `${WP_BASE}/pages?per_page=${WP_PER_PAGE}&page=${page}` +
      `&orderby=modified&order=desc&_fields=id,modified,link,title,content`;

    let pages: WpPage[];
    try {
      pages = await getJsonWithRetry(url);
    } catch (err) {
      const status = (err as any)?.status;
      if (status !== 400) {
        complete = false;
        log(`  pages: page ${page} failed after retries — ${(err as Error).message}`);
      }
      break;
    }
    if (!Array.isArray(pages) || pages.length === 0) break;

    for (const wp of pages) {
      if (seen.has(wp.id) || kept >= WP_MAX_PAGES) continue;
      seen.add(wp.id);

      const text = htmlToText(wp.content?.rendered ?? '');
      if (text.length < WP_MIN_PAGE_CHARS || !isLocallyRelevant(text)) {
        rejected++;
        continue;
      }

      const title = decodeEntities(wp.title?.rendered ?? '').replace(/<[^>]+>/g, '').trim();

      out.push(
        ...chunkPage({
          tier: 'local',
          source: 'dumaguete.com',
          sourceUrl: wp.link,
          title,
          sections: [{ section: 'Guide', body: text }],
          // Pages are edited in place, so `modified` is the honest freshness
          // signal — a page first published in 2018 and updated last month
          // should not be flagged as eight years old.
          sourceYear: Number(wp.modified?.slice(0, 4)) || null,
        })
      );
      kept++;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  log(`  dumaguete.com pages: ${kept} kept, ${rejected} rejected as thin or off-topic`);
  return { chunks: out, complete };
}

export async function fetchDumagueteCom(log = console.log): Promise<SourceResult> {
  const categoryIds = await resolveCategoryIds(log);
  if (!categoryIds.length) {
    log('  no matching categories — skipping dumaguete.com');
    return { chunks: [], complete: false };
  }
  await sleep(REQUEST_DELAY_MS);

  const out: KbChunk[] = [];
  const seen = new Set<number>();
  let kept = 0;
  let rejected = 0;
  let complete = true;

  for (let page = 1; kept < WP_MAX_POSTS; page++) {
    const url =
      `${WP_BASE}/posts?categories=${categoryIds.join(',')}` +
      `&per_page=${WP_PER_PAGE}&page=${page}&orderby=date&order=desc&_fields=id,date,link,title,content`;

    let posts: WpPost[];
    try {
      posts = await getJsonWithRetry(url);
    } catch (err) {
      const status = (err as any)?.status;
      // 400 is how WordPress says "page beyond the last one" — a clean end.
      // Anything else means we stopped early and must not prune this source.
      if (status !== 400) {
        complete = false;
        log(`  page ${page} failed after retries — ${(err as Error).message}`);
        log('  NOT pruning dumaguete.com this run, to avoid deleting chunks we simply could not re-fetch.');
      }
      break;
    }
    if (!Array.isArray(posts) || posts.length === 0) break;

    for (const post of posts) {
      if (seen.has(post.id) || kept >= WP_MAX_POSTS) continue;
      seen.add(post.id);

      const text = htmlToText(post.content?.rendered ?? '');
      if (!isLocallyRelevant(text)) {
        rejected++;
        continue;
      }

      const title = decodeEntities(post.title?.rendered ?? '').replace(/<[^>]+>/g, '').trim();

      out.push(
        ...chunkPage({
          tier: 'local',
          source: 'dumaguete.com',
          sourceUrl: post.link,
          title,
          sections: [{ section: 'Article', body: text }],
          sourceYear: Number(post.date?.slice(0, 4)) || null,
        })
      );
      kept++;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  log(`  dumaguete.com posts: ${kept} kept, ${rejected} rejected as off-topic`);

  // Pages carry the evergreen reference material; posts carry the news.
  const pages = await fetchWordPressPages(log);

  return {
    chunks: [...out, ...pages.chunks],
    complete: complete && pages.complete,
  };
}
