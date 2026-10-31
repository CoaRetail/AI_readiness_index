/**
 * TMVU-03 — Internal link automation for public / non-ABIS Insights.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getScheduledSeoPackage } from './insights-seo-package.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');

/** Protected ABIS slugs — never link to/from; never auto-unprotect. */
export const PROTECTED_INTERNAL_LINK_SLUGS = new Set([
  'interaction-contract',
  'consent-data-design',
  'abis-intro',
  'abis-ari-bridge',
  'standards-landscape',
  'abis-readiness-gap',
]);

/** @type {Record<string, string[]>} */
export const TOPIC_FAMILIES = {
  aiSearch: [
    'ai-search-shift',
    'recommendation-logic',
    'ari-vs-geo-seo',
    'cloudflare-aeo',
    'search-departure-ai',
    'iab-ai-visibility',
    'semantic-web-ai',
    'faq-for-agents',
    'citation-vs-action',
  ],
  visibility: [
    'vis',
    'blind',
    'checklist',
    'files',
    'llms-txt',
    'schema',
    'org-schema-basics',
    'entity-consistency',
    'grounds',
  ],
  authority: ['auth', 'trust', 'wrong', 'reviews', 'policy-clarity'],
  actionability: [
    'act',
    'book',
    'pay',
    'price',
    'availability-signals',
    'purchase-path-design',
    'execution-readiness',
    'agent-handoff',
    'http-402',
    'zentoshin',
  ],
  business: [
    'why-ari',
    'exec',
    'readiness-baseline',
    'exec-readiness-kpi',
    'vendor-selection',
    'marketing-info-design',
    'content-ops-ai',
    'agent-experience',
    'three-pillars-ops',
    'competitor-blind-spot',
  ],
  aiAgent: ['mcp-business-api', 'multi-agent-compare', 'hiring-readiness'],
};

const JOURNEY_ORDER = ['visibility', 'aiSearch', 'authority', 'actionability', 'business', 'aiAgent'];

/** Explicit overrides — filtered by availability at runtime. */
export const RELATED_INSIGHTS_OVERRIDES = {
  'llms-txt': ['schema', 'blind', 'files'],
  schema: ['llms-txt', 'files'],
  files: ['llms-txt', 'schema'],
  grounds: ['blind', 'llms-txt', 'schema'],
  blind: ['vis', 'checklist', 'ari-vs-geo-seo'],
  vis: ['blind', 'checklist'],
  checklist: ['blind', 'vis'],
  auth: ['trust', 'reviews'],
  trust: ['auth', 'reviews'],
  wrong: ['trust', 'auth'],
  book: ['pay', 'act'],
  pay: ['book', 'price'],
  price: ['act', 'pay'],
  act: ['price', 'book'],
  'ai-search-shift': ['ai-search-52-percent', 'blind', 'citation-vs-action'],
  'recommendation-logic': ['citation-vs-action', 'grounds', 'reviews'],
  'ari-vs-geo-seo': ['ai-search-shift', 'recommendation-logic', 'readiness-baseline'],
  'cloudflare-aeo': ['ai-search-52-percent', 'ai-search-shift', 'ari-vs-geo-seo'],
  'search-departure-ai': ['ai-search-52-percent', 'ai-search-shift', 'cloudflare-aeo'],
  'iab-ai-visibility': ['cloudflare-aeo', 'citation-vs-action', 'recommendation-logic'],
  'execution-readiness': ['book', 'pay'],
  exec: ['why-ari', 'grounds'],
  'why-ari': ['exec', 'readiness-baseline'],
  reviews: ['trust', 'price'],
  'http-402': ['pay', 'zentoshin'],
  zentoshin: ['http-402', 'pay'],
  'citation-vs-action': ['ai-search-shift', 'recommendation-logic'],
  'competitor-blind-spot': ['why-ari', 'exec', 'blind', 'citation-vs-action'],
  'three-pillars-ops': ['why-ari', 'exec-readiness-kpi'],
  'readiness-baseline': ['why-ari', 'checklist'],
  'org-schema-basics': ['schema', 'entity-consistency'],
  'entity-consistency': ['org-schema-basics', 'auth'],
  'faq-for-agents': ['schema', 'llms-txt'],
  'semantic-web-ai': ['schema', 'ai-search-shift'],
  'mcp-business-api': ['execution-readiness', 'agent-handoff'],
  'agent-handoff': ['execution-readiness', 'mcp-business-api'],
  'purchase-path-design': ['pay', 'availability-signals'],
  'availability-signals': ['purchase-path-design', 'book'],
  'policy-clarity': ['trust', 'wrong'],
  'vendor-selection': ['execution-readiness', 'book'],
  'marketing-info-design': ['content-ops-ai', 'why-ari'],
  'content-ops-ai': ['marketing-info-design', 'three-pillars-ops'],
  'agent-experience': ['execution-readiness', 'agent-handoff'],
  'exec-readiness-kpi': ['readiness-baseline', 'three-pillars-ops'],
  'ai-search-52-percent': ['search-departure-ai', 'ai-search-shift', 'cloudflare-aeo'],
  'multi-agent-compare': ['ai-search-shift', 'recommendation-logic'],
  'hiring-readiness': ['execution-readiness', 'agent-experience'],
  'gemini-utm-and-st-source': ['google-ai-coexistence-measurement', 'gsc-ai-impressions-how-to-read', 'aio-external-link-ai-mode-rct'],
  'cloudflare-pay-per-use': ['cloudflare-ai-traffic-search-agent-training', 'ai-contribution-pilot-economics', 'citation-vs-action'],
  'ai-content-manual-factcheck': ['september-2026-spam-update', 'content-ops-ai', 'wrong'],
  'court-record-on-clicks': ['aio-external-link-ai-mode-rct', 'google-ai-coexistence-measurement', 'gsc-ai-impressions-how-to-read'],
  'ai-crawler-discovery-paths': ['files', 'schema', 'cloudflare-ai-traffic-search-agent-training'],
  'barcelona-ai-features-on-seo': ['schema-not-ai-citation-cheat-code', 'gsc-ai-impressions-how-to-read', 'september-2026-spam-update'],
  'preferred-source-counts-and-ai-include': ['gsc-ai-impressions-how-to-read', 'branded-queries-ai-overviews', 'ai-mode-information-monitoring'],
  'ai-best-for-product-labels': ['recommendation-logic', 'openai-product-discovery-agentic-commerce', 'bing-edge-ai-mode-naming'],
  'shopify-agentic-holiday-legibility': ['shopify-ai-vs-organic-structured-catalog', 'citation-vs-action', 'openai-product-discovery-agentic-commerce'],
  'business-panel-ai-overview-study': ['branded-queries-ai-overviews', 'entity-consistency', 'reviews'],
  'chatgpt-ads-measurement-so-far': ['uk-cma-choice-screens-three-shelves', 'openai-product-discovery-agentic-commerce', 'court-record-on-clicks'],
  'security-patch-week-ai-trust': ['chatgpt-retrieval-citation-practice', 'schema-not-ai-citation-cheat-code'],
  'answers-without-opening-sources': ['cited-or-remembered', 'fabricated-citation-watch', 'chatgpt-retrieval-citation-practice'],
  'within-domain-citation-features': ['schema-not-ai-citation-cheat-code', 'schema', 'answers-without-opening-sources'],
  'deepseek-authority-tiers': ['chatgpt-retrieval-citation-practice', 'files', 'within-domain-citation-features'],
  'ai-referral-volume-and-conversion': ['chatgpt-as-direct', 'gsc-ai-impressions-how-to-read', 'mentioned-is-not-recommended'],
  'how-many-runs-before-ai-visibility': ['mentioned-is-not-recommended', 'ai-referral-volume-and-conversion', 'cited-or-remembered'],
  'shopping-agents-fail-before-payment': ['chatgpt-seller-rank', 'openai-product-discovery-agentic-commerce', 'execution-readiness'],
  'cloudflare-openai-chatgpt-index': ['cloudflare-aeo', 'ai-crawler-discovery-paths', 'files'],
  'ai-mode-global-ads-product-links': ['chatgpt-ads-measurement-so-far', 'ai-referral-volume-and-conversion', 'court-record-on-clicks'],
  'merchant-ucp-agentic-performance-api': ['chatgpt-ads-measurement-so-far', 'ai-referral-volume-and-conversion', 'pay'],
  'industry-ai-citation-source-mix': ['within-domain-citation-features', 'mentioned-is-not-recommended', 'how-many-runs-before-ai-visibility'],
};


/** Published-only intent when no scheduled SEO package exists. */
const PUBLISHED_INTENT = {
  act: 'A',
  'ai-search-shift': 'A',
  auth: 'B',
  blind: 'A',
  book: 'A',
  checklist: 'A',
  'citation-vs-action': 'B',
  'competitor-blind-spot': 'B',
  exec: 'B',
  files: 'A',
  grounds: 'B',
  'http-402': 'A',
  'llms-txt': 'A',
  pay: 'A',
  price: 'A',
  'recommendation-logic': 'A',
  reviews: 'A',
  schema: 'A',
  trust: 'B',
  vis: 'A',
  'why-ari': 'B',
  wrong: 'B',
  zentoshin: 'A',
};

const slugToFamily = new Map();
for (const [family, slugs] of Object.entries(TOPIC_FAMILIES)) {
  for (const s of slugs) slugToFamily.set(s, family);
}

export function isProtectedInternalLinkSlug(slug) {
  return PROTECTED_INTERNAL_LINK_SLUGS.has(slug);
}

export function loadSchedule(root = ROOT) {
  const schedulePath = path.join(root, 'insights/_scheduled/schedule.json');
  return JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
}

export function getPublishedSlugsFromFilesystem(root = ROOT) {
  const insightsDir = path.join(root, 'insights');
  return fs
    .readdirSync(insightsDir)
    .filter((d) => {
      if (d.startsWith('_')) return false;
      return fs.existsSync(path.join(insightsDir, d, 'index.html'));
    })
    .sort();
}

function decodeHtmlEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/**
 * @param {string} slug
 * @param {string} [root]
 */
export function getArticleMetadata(slug, root = ROOT) {
  const seo = getScheduledSeoPackage(slug);
  if (seo) {
    return {
      slug,
      h1: seo.h1,
      intent: seo.intent,
      primarySearchIntent: seo.primarySearchIntent,
      title: seo.h1,
    };
  }

  for (const rel of [`insights/${slug}`, `insights/_scheduled/${slug}`]) {
    const htmlPath = path.join(root, rel, 'index.html');
    if (!fs.existsSync(htmlPath)) continue;
    const html = fs.readFileSync(htmlPath, 'utf8');
    const h1 = decodeHtmlEntities(html.match(/<h1>([^<]+)<\/h1>/)?.[1] || slug);
    return {
      slug,
      h1,
      intent: PUBLISHED_INTENT[slug] || 'B',
      primarySearchIntent: '',
      title: h1,
    };
  }

  return { slug, h1: slug, intent: 'B', primarySearchIntent: '', title: slug };
}

/**
 * @param {string} slug
 * @param {{ mode?: 'published'|'scheduled', publishAt?: string|null, schedule?: object|null, root?: string }} [context]
 */
export function getAvailableRelatedCandidates(slug, context = {}) {
  const root = context.root || ROOT;
  if (isProtectedInternalLinkSlug(slug)) return [];

  const published = getPublishedSlugsFromFilesystem(root);
  const mode = context.mode || 'published';

  if (mode === 'published') {
    return published.filter((s) => s !== slug && !isProtectedInternalLinkSlug(s));
  }

  const schedule = context.schedule || loadSchedule(root);
  const candidates = new Set(published.filter((s) => !isProtectedInternalLinkSlug(s)));
  const targetTime = context.publishAt ? new Date(context.publishAt).getTime() : Number.POSITIVE_INFINITY;

  for (const art of schedule.articles) {
    if (art.slug === slug) continue;
    if (isProtectedInternalLinkSlug(art.slug)) continue;
    if (art.status === 'published') {
      candidates.add(art.slug);
      continue;
    }
    if (art.publishAt && new Date(art.publishAt).getTime() <= targetTime) {
      candidates.add(art.slug);
    }
  }

  candidates.delete(slug);
  return [...candidates].sort();
}

function sharedKeywordScore(a, b) {
  const metaA = getArticleMetadata(a);
  const metaB = getArticleMetadata(b);
  const wordsA = new Set(
    `${metaA.h1} ${metaA.primarySearchIntent}`.toLowerCase().split(/[\s・、。，]+/).filter((w) => w.length >= 2),
  );
  const wordsB = `${metaB.h1} ${metaB.primarySearchIntent}`.toLowerCase().split(/[\s・、。，]+/);
  let score = 0;
  for (const w of wordsB) {
    if (w.length >= 2 && wordsA.has(w)) score += 1;
  }
  return Math.min(score, 2);
}

function journeyAdjacency(f1, f2) {
  const i1 = JOURNEY_ORDER.indexOf(f1);
  const i2 = JOURNEY_ORDER.indexOf(f2);
  if (i1 < 0 || i2 < 0) return false;
  return Math.abs(i1 - i2) === 1;
}

/**
 * @param {string} sourceSlug
 * @param {string} candidateSlug
 * @param {{ orphanCounts?: Record<string, number> }} [opts]
 */
export function scoreRelatedCandidate(sourceSlug, candidateSlug, opts = {}) {
  if (sourceSlug === candidateSlug) return -Infinity;
  if (isProtectedInternalLinkSlug(candidateSlug)) return -Infinity;

  const src = getArticleMetadata(sourceSlug);
  const cand = getArticleMetadata(candidateSlug);
  const f1 = slugToFamily.get(sourceSlug);
  const f2 = slugToFamily.get(candidateSlug);

  let score = 0;
  if (f1 && f2 && f1 === f2) score += 3;
  if (src.intent && cand.intent && src.intent === cand.intent) score += 2;
  score += sharedKeywordScore(sourceSlug, candidateSlug);
  if (f1 && f2 && journeyAdjacency(f1, f2)) score += 1;

  const orphanCounts = opts.orphanCounts || {};
  if ((orphanCounts[candidateSlug] || 0) === 0) score += 1;

  return score;
}

/**
 * @param {string} slug
 * @param {{ mode?: 'published'|'scheduled', publishAt?: string|null, schedule?: object|null, root?: string, targetCount?: number }} [context]
 * @returns {{ slug: string, href: string, anchor: string }[]}
 */
export function selectRelatedInsights(slug, context = {}) {
  if (isProtectedInternalLinkSlug(slug)) return [];

  const targetCount = context.targetCount ?? 2;
  const maxCount = 3;
  const minCount = 1;
  const availableSet = new Set(getAvailableRelatedCandidates(slug, context));
  if (!availableSet.size) return [];

  /** @type {{ slug: string, href: string, anchor: string }[]} */
  const results = [];
  const overrides = RELATED_INSIGHTS_OVERRIDES[slug] || [];

  for (const s of overrides) {
    if (results.length >= maxCount) break;
    if (!availableSet.has(s) || results.some((r) => r.slug === s)) continue;
    const meta = getArticleMetadata(s, context.root);
    results.push({ slug: s, href: `/insights/${s}/`, anchor: meta.h1 });
  }

  if (results.length >= targetCount) return results.slice(0, maxCount);

  const orphanCounts = context.orphanCounts || {};
  const scored = [...availableSet]
    .filter((s) => !results.some((r) => r.slug === s))
    .map((s) => ({ slug: s, score: scoreRelatedCandidate(slug, s, { orphanCounts }) }))
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));

  for (const { slug: s, score } of scored) {
    if (results.length >= maxCount) break;
    if (score <= 0 && results.length >= minCount) continue;
    const meta = getArticleMetadata(s, context.root);
    results.push({ slug: s, href: `/insights/${s}/`, anchor: meta.h1 });
  }

  if (!results.length && scored.length) {
    const meta = getArticleMetadata(scored[0].slug, context.root);
    results.push({ slug: scored[0].slug, href: `/insights/${scored[0].slug}/`, anchor: meta.h1 });
  }

  return results.slice(0, maxCount);
}

/**
 * @param {{ mode?: 'published'|'scheduled', publishAt?: string|null, schedule?: object|null, root?: string }} [context]
 */
export function computeIncomingRelatedCounts(context = {}) {
  const root = context.root || ROOT;
  /** @type {Record<string, number>} */
  const counts = {};
  const slugs = [
    ...getPublishedSlugsFromFilesystem(root),
    ...fs
      .readdirSync(path.join(root, 'insights/_scheduled'))
      .filter((d) => fs.statSync(path.join(root, 'insights/_scheduled', d)).isDirectory()),
  ];

  for (const slug of slugs) {
    if (isProtectedInternalLinkSlug(slug)) continue;
    const ctx =
      fs.existsSync(path.join(root, 'insights', slug, 'index.html'))
        ? { mode: 'published', root, orphanCounts: {} }
        : {
            mode: 'scheduled',
            root,
            schedule: context.schedule || loadSchedule(root),
            publishAt: getSchedulePublishAt(slug, root),
            orphanCounts: {},
          };
    for (const rel of selectRelatedInsights(slug, ctx)) {
      counts[rel.slug] = (counts[rel.slug] || 0) + 1;
    }
  }
  return counts;
}

function getSchedulePublishAt(slug, root) {
  const schedule = loadSchedule(root);
  return schedule.articles.find((a) => a.slug === slug)?.publishAt || null;
}

/**
 * @param {{ slug: string, href: string, anchor: string }[]} related
 */
export function buildRelatedInsightsSectionHtml(related) {
  if (!related.length) return '';
  const items = related
    .map(
      (r) =>
        `        <li>\n          <a href="${r.href}">${escapeHtml(r.anchor)}</a>\n        </li>`,
    )
    .join('\n');
  return `      <section class="related-insights">
        <h2>関連Insights</h2>
        <ul>
${items}
        </ul>
      </section>`;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const RELATED_H2_TITLE_RE = '関連(?:する\\s*)?Insights?';
const RELATED_SECTION_RE = /\s*<section class="related-insights">[\s\S]*?<\/section>\n?/g;
const RELATED_BARE_BLOCK_RE = new RegExp(
  `\\s*<h2>${RELATED_H2_TITLE_RE}<\\/h2>\\s*<ul>[\\s\\S]*?<\\/ul>\\n?`,
  'gi',
);
const ORPHAN_RELATED_SECTION_RE =
  /\s*<section class="related-insights">\s*(?:<\/section>\s*)?(?=\s*<div class="article-cta">)/g;

/**
 * Remove all related-insights blocks (section wrapper and legacy bare h2+ul duplicates).
 * @param {string} html
 */
export function stripRelatedInsightsBlocks(html) {
  let out = html.replace(RELATED_SECTION_RE, '');
  out = out.replace(RELATED_BARE_BLOCK_RE, '');
  out = out.replace(ORPHAN_RELATED_SECTION_RE, '');
  return out;
}

export function countRelatedInsightsBlocks(html) {
  const sections = (html.match(/<section class="related-insights">/g) || []).length;
  const h2 = (html.match(new RegExp(`<h2>${RELATED_H2_TITLE_RE}<\\/h2>`, 'gi')) || []).length;
  const withoutSections = html.replace(RELATED_SECTION_RE, '');
  const bare = (
    withoutSections.match(new RegExp(`<h2>${RELATED_H2_TITLE_RE}<\\/h2>`, 'gi')) || []
  ).length;
  return { sections, h2, bare, total: sections + bare };
}

export function ensureRelatedInsightsCss(html) {
  if (html.includes('.related-insights')) return html;
  const anchor = '.back-link:hover { color: var(--text); }';
  if (html.includes(anchor)) {
    return html.replace(anchor, `${anchor}\n${RELATED_INSIGHTS_CSS}`);
  }
  return html.replace('</style>', `${RELATED_INSIGHTS_CSS}\n</style>`);
}

/**
 * @param {string} html
 * @param {string} slug
 * @param {{ mode?: 'published'|'scheduled', publishAt?: string|null, schedule?: object|null, root?: string }} [context]
 */
export function applyInternalLinksToHtml(html, slug, context = {}) {
  if (isProtectedInternalLinkSlug(slug)) {
    return { html, changed: false, related: [], skipped: 'protected' };
  }

  const marker = '<div class="article-cta">';
  if (!html.includes(marker)) {
    return { html, changed: false, related: [], error: 'missing_cta' };
  }

  const related = selectRelatedInsights(slug, context);
  const sectionHtml = buildRelatedInsightsSectionHtml(related);
  const counts = countRelatedInsightsBlocks(html);
  const existing = extractRelatedInsightLinks(html);
  const sameLinks =
    related.length === existing.length &&
    related.every((r, i) => existing[i]?.slug === r.slug);
  if (sameLinks && counts.sections === 1 && counts.bare === 0 && sectionHtml) {
    return { html, changed: false, related };
  }

  let out = ensureRelatedInsightsCss(stripRelatedInsightsBlocks(html));

  if (sectionHtml) {
    out = out.replace(marker, `${sectionHtml}\n\n      ${marker}`);
  }

  return { html: out, changed: out !== html, related };
}

/**
 * @param {string} html
 * @param {string} slug
 * @param {{ mode?: 'published'|'scheduled', publishAt?: string|null, schedule?: object|null, root?: string }} [context]
 */
export function extractRelatedInsightLinks(html) {
  const section = html.match(/<section class="related-insights">([\s\S]*?)<\/section>/);
  if (!section) return [];
  const links = [];
  const re = /href="(\/insights\/([^"/]+)\/)"/g;
  let m;
  while ((m = re.exec(section[1])) !== null) {
    links.push({ href: m[1], slug: m[2] });
  }
  return links;
}

export function extractFixedCtaLinks(html) {
  const cta = html.match(/<div class="article-cta">([\s\S]*?)<\/div>/);
  if (!cta) return { framework: false, research: false, report: false };
  const block = cta[1];
  return {
    framework: block.includes('href="/framework/"'),
    research: block.includes('href="/research/"'),
    report: block.includes('href="/report/"'),
  };
}

/**
 * @param {string} html
 * @param {string} slug
 * @param {{ mode?: 'published'|'scheduled', publishAt?: string|null, schedule?: object|null, root?: string, requireRelated?: boolean }} [context]
 */
export function validateInternalLinks(html, slug, context = {}) {
  const errors = [];
  const requireRelated = context.requireRelated ?? !isProtectedInternalLinkSlug(slug);

  if (isProtectedInternalLinkSlug(slug)) {
    if (html.includes('related-insights')) errors.push(`${slug}: protected article must not have related-insights section`);
    return errors;
  }

  const cta = extractFixedCtaLinks(html);
  if (!cta.framework) errors.push(`${slug}: missing Framework CTA`);
  if (!cta.research) errors.push(`${slug}: missing Research CTA`);
  if (!cta.report) errors.push(`${slug}: missing ARI Diagnosis (/report/) CTA`);

  const related = extractRelatedInsightLinks(html);
  if (requireRelated && related.length < 1) errors.push(`${slug}: related insights count ${related.length} (min 1)`);
  if (related.length > 3) errors.push(`${slug}: related insights count ${related.length} (max 3)`);

  const slugs = related.map((r) => r.slug);
  if (slugs.includes(slug)) errors.push(`${slug}: self-link in related insights`);
  if (new Set(slugs).size !== slugs.length) errors.push(`${slug}: duplicate related insight links`);

  for (const r of related) {
    if (isProtectedInternalLinkSlug(r.slug)) errors.push(`${slug}: links to protected ABIS slug ${r.slug}`);
    if (r.href.includes('/insights/_scheduled/')) errors.push(`${slug}: private scheduled path in related link`);
  }

  const available = new Set(getAvailableRelatedCandidates(slug, context));
  for (const r of related) {
    if (!available.has(r.slug)) errors.push(`${slug}: unavailable related target ${r.slug}`);
  }

  const root = context.root || ROOT;
  for (const r of related) {
    const livePath = path.join(root, 'insights', r.slug, 'index.html');
    const schedPath = path.join(root, 'insights/_scheduled', r.slug, 'index.html');
    const exists = fs.existsSync(livePath) || fs.existsSync(schedPath);
    if (!exists) errors.push(`${slug}: broken related target ${r.slug}`);
    else if (context.mode === 'published' && !fs.existsSync(livePath)) {
      errors.push(`${slug}: published article links to unpublished ${r.slug}`);
    }
  }

  return errors;
}

export function assertInternalLinks(html, slug, context = {}) {
  const errors = validateInternalLinks(html, slug, context);
  if (errors.length) {
    throw new Error(`Internal link gate failed for ${slug}: ${errors.join('; ')}`);
  }
}

export const RELATED_INSIGHTS_CSS = `.related-insights { margin: 48px 0 0; }
.related-insights h2 { font-size: 1.375rem; font-weight: 600; margin: 0 0 16px; letter-spacing: -0.02em; color: var(--text); }
.related-insights ul { margin: 0 0 0 1.25em; color: var(--text-secondary); }
.related-insights li { margin-bottom: 0.5em; }
.related-insights a { color: var(--text); text-decoration: underline; text-underline-offset: 3px; }`;
