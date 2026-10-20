/**
 * Sitemap lastmod.
 *
 * Insight URLs use the publish date, or a later dateModified when a freshness
 * addendum recorded a real content change. Git history is not used for
 * insights: sitewide template commits would mark every article as updated.
 *
 * Other URLs use the later of the source file's last git commit date and any
 * dateModified in that file. That replaces placeholder dates left from the
 * day the URL was first added.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dateParts } from './insights-index-cards.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SITEMAP_ROOT = path.resolve(__dirname, '../..');

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Public URL → source file. agent-readiness is built from oisummit/. */
export const STATIC_SITEMAP_SOURCES = Object.freeze({
  'https://readiness.coaretail.com/': 'index.html',
  'https://readiness.coaretail.com/agent-readiness/': 'oisummit/index.html',
  'https://readiness.coaretail.com/agent-readiness/enterprise/': 'oisummit/enterprise/index.html',
  'https://readiness.coaretail.com/agent-readiness/public/': 'oisummit/public/index.html',
  'https://readiness.coaretail.com/agent-readiness/tech/': 'oisummit/tech/index.html',
  'https://readiness.coaretail.com/framework/': 'framework/index.html',
  'https://readiness.coaretail.com/research/': 'research/index.html',
  'https://readiness.coaretail.com/whitepaper/': 'whitepaper/index.html',
  'https://readiness.coaretail.com/whitepaper/2026/free/': 'whitepaper/2026/free/index.html',
  'https://readiness.coaretail.com/whitepaper/2026/research/': 'whitepaper/2026/research/index.html',
  'https://readiness.coaretail.com/whitepaper/2026/handbook/': 'whitepaper/2026/handbook/index.html',
  'https://readiness.coaretail.com/evidence/': 'evidence/index.html',
  'https://readiness.coaretail.com/news/': 'news/index.html',
  'https://readiness.coaretail.com/methodology.html': 'methodology.html',
  'https://readiness.coaretail.com/report/': 'report/index.html',
  'https://readiness.coaretail.com/improve.html': 'improve.html',
  'https://readiness.coaretail.com/services/': 'services/index.html',
  'https://readiness.coaretail.com/sample/': 'sample/index.html',
  'https://readiness.coaretail.com/cases/': 'cases/index.html',
  'https://readiness.coaretail.com/cases/bar-secret/': 'cases/bar-secret/index.html',
  'https://readiness.coaretail.com/guides/': 'guides/index.html',
  'https://readiness.coaretail.com/guides/ai-search-services/': 'guides/ai-search-services/index.html',
  'https://readiness.coaretail.com/guides/chatgpt-visibility-check/': 'guides/chatgpt-visibility-check/index.html',
  'https://readiness.coaretail.com/guides/inhouse-vs-outsource/': 'guides/inhouse-vs-outsource/index.html',
  'https://readiness.coaretail.com/dental.html': 'dental.html',
});

/**
 * @param {string[]} dates
 */
export function laterYmd(dates) {
  const valid = dates.filter((value) => YMD_RE.test(value || ''));
  if (!valid.length) return null;
  return valid.sort().at(-1);
}

/**
 * @param {string} html
 */
export function extractYmdFields(html, field) {
  const re = new RegExp(`"${field}"\\s*:\\s*"(\\d{4}-\\d{2}-\\d{2})"`, 'g');
  return [...String(html || '').matchAll(re)].map((match) => match[1]);
}

/**
 * Publish date, or a later dateModified when the article records a content change.
 * @param {{ publishYmd?: string|null, modifiedYmd?: string|null }} dates
 */
export function insightLastmodYmd({ publishYmd = null, modifiedYmd = null } = {}) {
  if (modifiedYmd && publishYmd && modifiedYmd > publishYmd) return modifiedYmd;
  return publishYmd || modifiedYmd || null;
}

/**
 * @param {string} root
 * @param {string} relPath
 */
export function gitLastCommitDate(root, relPath) {
  if (!relPath) return null;
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', relPath], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return YMD_RE.test(out) ? out : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} root
 * @param {string} relPath
 */
export function sourceLastmod(root, relPath) {
  const abs = path.join(root, relPath);
  const gitYmd = gitLastCommitDate(root, relPath);
  let modified = [];
  if (fs.existsSync(abs)) {
    modified = extractYmdFields(fs.readFileSync(abs, 'utf8'), 'dateModified');
  }
  return laterYmd([gitYmd, ...modified]);
}

/**
 * @param {{ slug: string, publishAt?: string, publishedAt?: string }} article
 * @param {string} [root]
 */
export function insightLastmodFromArticle(article, root = SITEMAP_ROOT) {
  const fromSchedule = article?.publishAt || article?.publishedAt
    ? dateParts(article.publishAt || article.publishedAt).ymd
    : null;
  const htmlPath = path.join(root, 'insights', article.slug, 'index.html');
  if (!fs.existsSync(htmlPath)) {
    return insightLastmodYmd({ publishYmd: fromSchedule, modifiedYmd: null });
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const published = laterYmd(extractYmdFields(html, 'datePublished')) || fromSchedule;
  const modified = laterYmd(extractYmdFields(html, 'dateModified'));
  return insightLastmodYmd({ publishYmd: published, modifiedYmd: modified });
}

/**
 * @param {string} sitemap
 */
export function parseSitemapLastmods(sitemap) {
  const dates = new Map();
  const re = /<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g;
  let match;
  while ((match = re.exec(sitemap))) {
    dates.set(match[1].trim(), match[2].trim());
  }
  return dates;
}

/**
 * @param {string} sitemap
 * @param {string} loc
 * @param {string} ymd
 */
export function replaceSitemapLastmod(sitemap, loc, ymd) {
  if (!YMD_RE.test(ymd)) return sitemap;
  const escaped = loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(<loc>${escaped}</loc>\\s*<lastmod>)\\d{4}-\\d{2}-\\d{2}(</lastmod>)`);
  if (!re.test(sitemap)) return sitemap;
  return sitemap.replace(re, `$1${ymd}$2`);
}

/**
 * @param {string} sitemap
 * @param {string} [root]
 */
export function applyStaticSitemapLastmods(sitemap, root = SITEMAP_ROOT) {
  let out = sitemap;
  const updated = [];
  for (const [loc, relPath] of Object.entries(STATIC_SITEMAP_SOURCES)) {
    const ymd = sourceLastmod(root, relPath);
    if (!ymd) continue;
    const before = parseSitemapLastmods(out).get(loc);
    if (!before || before === ymd) continue;
    const next = replaceSitemapLastmod(out, loc, ymd);
    if (next !== out) {
      out = next;
      updated.push({ loc, from: before, to: ymd });
    }
  }
  return { sitemap: out, updated };
}

/**
 * Insight URLs whose lastmod moved to a date after publication.
 * @param {Map<string, string>} before
 * @param {string} sitemap
 * @param {{ slug: string, publishAt?: string, publishedAt?: string }[]} articles
 * @param {string} [root]
 */
/**
 * Update lastmod values already present in sitemap.xml.
 * Insight URLs follow front-matter. Other mapped URLs follow git / dateModified.
 * Does not add or remove URLs and does not read schedule.json.
 * @param {{ root?: string, dryRun?: boolean }} [opts]
 */
export function refreshSitemapFile({ root = SITEMAP_ROOT, dryRun = false } = {}) {
  const sitemapPath = path.join(root, 'sitemap.xml');
  const original = fs.readFileSync(sitemapPath, 'utf8');
  const before = parseSitemapLastmods(original);
  let sitemap = original;
  const articles = [];

  for (const [loc, prev] of before) {
    const slug = loc.match(/\/insights\/([^/]+)\/$/)?.[1];
    if (!slug) continue;
    const htmlPath = path.join(root, 'insights', slug, 'index.html');
    if (!fs.existsSync(htmlPath)) continue;
    const html = fs.readFileSync(htmlPath, 'utf8');
    const published = laterYmd(extractYmdFields(html, 'datePublished'));
    const modified = laterYmd(extractYmdFields(html, 'dateModified'));
    const ymd = insightLastmodYmd({ publishYmd: published, modifiedYmd: modified });
    if (ymd && ymd !== prev) sitemap = replaceSitemapLastmod(sitemap, loc, ymd);
    if (published) articles.push({ slug, publishAt: `${published}T12:00:00+09:00` });
  }

  const staticResult = applyStaticSitemapLastmods(sitemap, root);
  sitemap = staticResult.sitemap;
  const freshnessSlugs = freshnessSlugsFromSitemap(before, sitemap, articles, root);
  const changed = sitemap !== original;
  if (changed && !dryRun) fs.writeFileSync(sitemapPath, sitemap, 'utf8');
  return {
    changed,
    freshnessSlugs,
    staticUpdated: staticResult.updated,
    sitemap,
  };
}

export function freshnessSlugsFromSitemap(before, sitemap, articles, root = SITEMAP_ROOT) {
  const after = parseSitemapLastmods(sitemap);
  const slugs = [];
  for (const article of articles) {
    const loc = `https://readiness.coaretail.com/insights/${article.slug}/`;
    const next = after.get(loc);
    const prev = before.get(loc);
    if (!next || next === prev) continue;
    const publishYmd = article.publishAt || article.publishedAt
      ? dateParts(article.publishAt || article.publishedAt).ymd
      : null;
    const htmlPath = path.join(root, 'insights', article.slug, 'index.html');
    const modified = fs.existsSync(htmlPath)
      ? laterYmd(extractYmdFields(fs.readFileSync(htmlPath, 'utf8'), 'dateModified'))
      : null;
    if (modified && publishYmd && modified > publishYmd && next === modified) {
      slugs.push(article.slug);
    }
  }
  return slugs;
}
