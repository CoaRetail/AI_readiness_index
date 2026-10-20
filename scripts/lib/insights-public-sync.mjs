/**
 * Rebuild public Insights surfaces from schedule.json + on-disk published HTML.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ROOT } from './insights-v2-paths.mjs';
import { EDITORIAL_STATUSES } from './editorial-status.mjs';
import { findEarliestScheduledArticle } from './unlock-next-insight.mjs';
import { isArticlePublishedOnDisk, articleDestPath } from './publishing-state-machine.mjs';
import { isProtectedInternalLinkSlug } from './insights-related-links.mjs';
import { buildPublishedCardHtml, buildPlannedCardHtml, dateParts } from './insights-index-cards.mjs';
import { looksLikeEditorialMemo } from './insights-card-summary.mjs';
import {
  applyStaticSitemapLastmods,
  freshnessSlugsFromSitemap,
  insightLastmodFromArticle,
  parseSitemapLastmods,
} from './sitemap-lastmod.mjs';

const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');
const LLMS_PATH = path.join(ROOT, 'llms.txt');
const INDEX_MARKER_START = '<!-- INSIGHTS_CARDS_START -->';
const INDEX_MARKER_EMPTY = '<p class="empty-note reveal" id="insights-empty"';
const SITEMAP_MARKER = '<!-- INSIGHTS_URLS_START -->';
const LLMS_MARKER = '# INSIGHTS_LLMS_START';

export function listPublishedScheduleArticles(schedule) {
  return schedule.articles
    .filter((a) => a.status === EDITORIAL_STATUSES.PUBLISHED && isArticlePublishedOnDisk(a.slug))
    .filter((a) => !isProtectedInternalLinkSlug(a.slug))
    .sort((a, b) => new Date(b.publishAt || b.publishedAt).getTime() - new Date(a.publishAt || a.publishedAt).getTime());
}

export function resolvePlannedArticle(schedule) {
  const planned = findEarliestScheduledArticle(schedule);
  if (!planned) return null;
  if (planned.status !== EDITORIAL_STATUSES.SCHEDULED) return null;
  if (isProtectedInternalLinkSlug(planned.slug)) return null;
  if (isArticlePublishedOnDisk(planned.slug)) return null;
  return planned;
}

export function buildInsightsIndexCardsBlock(schedule) {
  const published = listPublishedScheduleArticles(schedule);
  const planned = resolvePlannedArticle(schedule);
  const parts = [];
  if (planned) parts.push(buildPlannedCardHtml(planned));
  for (const article of published) parts.push(buildPublishedCardHtml(article));
  return parts.join('\n');
}

/**
 * Drop leftover tails from older publishes that closed the empty note too early.
 * Each run used to leave `</p> hidden>公開中の記事はまだありません。` after the real paragraph.
 */
export function removeDuplicateEmptyNoteFragments(html) {
  const markerAt = html.indexOf('id="insights-empty"');
  if (markerAt < 0) return html;
  const firstClose = html.indexOf('</p>', markerAt);
  if (firstClose < 0) return html;
  const after = firstClose + '</p>'.length;
  const gridClose = html.indexOf('</div>', after);
  if (gridClose < 0) return html;
  const between = html.slice(after, gridClose);
  if (!between.includes('公開中の記事はまだありません') && !between.includes('hidden>')) return html;
  const lineBreak = html.lastIndexOf('\n', gridClose);
  const prefix = lineBreak >= 0 ? html.slice(lineBreak + 1, gridClose) : '';
  const indent = /^[ \t]*$/.test(prefix) ? prefix : '  ';
  return `${html.slice(0, after)}\n${indent}${html.slice(gridClose)}`;
}

export function replaceInsightsIndexCards(html, cardsBlock, { publishedCount, hasPlanned }) {
  const cleaned = removeDuplicateEmptyNoteFragments(html);
  const start = cleaned.indexOf(INDEX_MARKER_START);
  const emptyAt = start < 0 ? -1 : cleaned.indexOf(INDEX_MARKER_EMPTY, start);
  if (start < 0 || emptyAt < 0) throw new Error('insights index card markers not found');
  const gridClose = cleaned.indexOf('</div>', emptyAt);
  if (gridClose < 0) throw new Error('insights index card markers not found');
  const emptyHidden = (publishedCount > 0 || hasPlanned) ? ' hidden' : '';
  const emptyBlock = `    <p class="empty-note reveal" id="insights-empty"${emptyHidden}>
      公開中の記事はまだありません。
    </p>
`;
  const lineBreak = cleaned.lastIndexOf('\n', gridClose);
  const prefix = lineBreak >= 0 ? cleaned.slice(lineBreak + 1, gridClose) : '';
  const indent = /^[ \t]*$/.test(prefix) ? prefix : '  ';
  return `${cleaned.slice(0, start)}${INDEX_MARKER_START}\n${cardsBlock}\n${emptyBlock}${indent}${cleaned.slice(gridClose)}`;
}

function sitemapEntry(article) {
  const ymd = insightLastmodFromArticle(article);
  return `  <url>
    <loc>https://readiness.coaretail.com/insights/${article.slug}/</loc>
    <lastmod>${ymd}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
`;
}

function llmsLine(article) {
  const { ymd } = dateParts(article.publishAt || article.publishedAt);
  const label = article.llmsLabel || article.title;
  return `- [${label}](https://readiness.coaretail.com/insights/${article.slug}/): Insights Column（${ymd}）
`;
}

export function rebuildInsightsSitemapEntries(sitemap, publishedArticles) {
  const slugs = new Set(publishedArticles.map((a) => a.slug));
  const blockRe = new RegExp(
    `${SITEMAP_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*([\\s\\S]*?)(?=\\n  <url>\\n    <loc>https://readiness\\.coaretail\\.com/methodology)`
  );
  const entries = publishedArticles
    .slice()
    .sort((a, b) => new Date(a.publishAt || a.publishedAt).getTime() - new Date(b.publishAt || b.publishedAt).getTime())
    .map((a) => sitemapEntry(a))
    .join('\n');
  if (!blockRe.test(sitemap)) throw new Error('sitemap insights marker not found');
  let out = sitemap.replace(blockRe, `${SITEMAP_MARKER}\n${entries}`);

  const insightsIndexLastmod = publishedArticles.length
    ? dateParts(publishedArticles[0].publishAt || publishedArticles[0].publishedAt).ymd
    : null;
  if (insightsIndexLastmod) {
    out = out.replace(
      /(<loc>https:\/\/readiness\.coaretail\.com\/insights\/<\/loc>\s*<lastmod>)\d{4}-\d{2}-\d{2}/,
      `$1${insightsIndexLastmod}`
    );
  }

  for (const slug of slugs) {
    if (!out.includes(`/insights/${slug}/`)) {
      throw new Error(`sitemap missing published slug after rebuild: ${slug}`);
    }
  }
  return out;
}

export function rebuildLlmsInsightEntries(llms, publishedArticles) {
  const entries = publishedArticles
    .slice()
    .sort((a, b) => new Date(a.publishAt || a.publishedAt).getTime() - new Date(b.publishAt || b.publishedAt).getTime())
    .map((a) => llmsLine(a))
    .join('');
  const blockRe = new RegExp(
    `${LLMS_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=\\n- \\[Methodology\\])`
  );
  if (!blockRe.test(llms)) throw new Error('llms insights marker not found');
  return llms.replace(blockRe, `${LLMS_MARKER}\n${entries}`);
}

export function updateInsightsIndexFooterDate(html, ymd) {
  return html.replace(
    /Version 1\.0 · Last Updated \d{4}-\d{2}-\d{2}/,
    `Version 1.0 · Last Updated ${ymd}`
  );
}

/**
 * @returns {{ updated: boolean, published: string[], planned: string|null, warnings: string[], freshnessSlugs: string[] }}
 */
export function syncInsightsPublicSurfaces({
  dryRun = false,
  updateFooter = false,
} = {}) {
  const schedule = JSON.parse(fs.readFileSync(PATHS.schedule, 'utf8'));
  const published = listPublishedScheduleArticles(schedule);
  const planned = resolvePlannedArticle(schedule);
  const warnings = [];

  for (const article of schedule.articles) {
    if (article.status === EDITORIAL_STATUSES.PUBLISHED && !isArticlePublishedOnDisk(article.slug)) {
      warnings.push(`schedule_published_missing_html:${article.slug}`);
    }
    if (article.cardSummary && looksLikeEditorialMemo(article.cardSummary) && !article.metaDescription) {
      warnings.push(`editorial_memo_cardSummary:${article.slug}`);
    }
  }

  const cardsBlock = buildInsightsIndexCardsBlock(schedule);
  let indexHtml = fs.readFileSync(PATHS.insightsIndex, 'utf8');
  indexHtml = replaceInsightsIndexCards(indexHtml, cardsBlock, {
    publishedCount: published.length,
    hasPlanned: Boolean(planned),
  });

  if (updateFooter && published.length) {
    const { ymd } = dateParts(published[0].publishAt || published[0].publishedAt);
    indexHtml = updateInsightsIndexFooterDate(indexHtml, ymd);
  }

  let sitemap = fs.readFileSync(SITEMAP_PATH, 'utf8');
  const lastmodsBefore = parseSitemapLastmods(sitemap);
  sitemap = rebuildInsightsSitemapEntries(sitemap, published);
  sitemap = applyStaticSitemapLastmods(sitemap).sitemap;
  const freshnessSlugs = freshnessSlugsFromSitemap(lastmodsBefore, sitemap, published);

  let llms = fs.readFileSync(LLMS_PATH, 'utf8');
  llms = rebuildLlmsInsightEntries(llms, published);

  if (!dryRun) {
    fs.writeFileSync(PATHS.insightsIndex, indexHtml, 'utf8');
    fs.writeFileSync(SITEMAP_PATH, sitemap, 'utf8');
    fs.writeFileSync(LLMS_PATH, llms, 'utf8');
  }

  return {
    updated: !dryRun,
    published: published.map((a) => a.slug),
    planned: planned?.slug || null,
    warnings,
    freshnessSlugs,
  };
}

export function assertNoUnpublishedSurfaceLeak(schedule, { indexHtml, sitemap, llms }) {
  const errors = [];
  const holdOrFuture = schedule.articles.filter((a) => {
    if (a.status === EDITORIAL_STATUSES.HOLD) return true;
    if (a.status === EDITORIAL_STATUSES.SCHEDULED && !isArticlePublishedOnDisk(a.slug)) return true;
    return false;
  });

  for (const article of holdOrFuture) {
    const href = `/insights/${article.slug}/`;
    if (sitemap.includes(href)) errors.push(`sitemap_leak:${article.slug}`);
    if (llms.includes(href)) errors.push(`llms_leak:${article.slug}`);
    if (indexHtml.includes(`data-insight-slug="${article.slug}"`)) {
      errors.push(`index_published_leak:${article.slug}`);
    }
  }

  const plannedCount = (indexHtml.match(/class="insight-card planned"/g) || []).length;
  if (plannedCount > 1) errors.push(`multiple_planned_cards:${plannedCount}`);

  return errors;
}
