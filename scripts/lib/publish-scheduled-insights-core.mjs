/**
 * Core publish logic extracted for reconciliation + CLI reuse.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ROOT } from './insights-v2-paths.mjs';
import { selectNextDueArticle } from './editorial-status.mjs';
import { prepareScheduledArticle } from './prepare-scheduled-article.mjs';
import { isWeekday } from './business-days.mjs';
import { isProtectedInternalLinkSlug } from './insights-related-links.mjs';
import { enrollSocialOnPublish } from './enroll-social-on-publish.mjs';
import { EDITORIAL_STATUSES } from './editorial-status.mjs';
import {
  isArticlePublishedOnDisk,
  articleDestPath,
} from './publishing-state-machine.mjs';
import { upsertPlannedCard, findEarliestScheduledArticle } from './unlock-next-insight.mjs';
import { buildPublishedCardHtml, dateParts } from './insights-index-cards.mjs';
import { syncInsightsPublicSurfaces } from './insights-public-sync.mjs';
import { insightLastmodFromArticle } from './sitemap-lastmod.mjs';
import { canonicalHeroPath, integrateCanonicalHero, configFor } from './local-visual-worker.mjs';
import { markHeroPending } from './insights-package-readiness.mjs';

const SCHEDULE_PATH = PATHS.schedule;
const INDEX_PATH = PATHS.insightsIndex;
const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');
const LLMS_PATH = path.join(ROOT, 'llms.txt');

function cardHtml(article) {
  return buildPublishedCardHtml(article);
}

function sitemapEntry(article) {
  const ymd = insightLastmodFromArticle(article) || dateParts(article.publishAt).ymd;
  return `  <url>
    <loc>https://readiness.coaretail.com/insights/${article.slug}/</loc>
    <lastmod>${ymd}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
`;
}

function llmsLine(article) {
  const { ymd } = dateParts(article.publishAt);
  return `- [${article.llmsLabel}](https://readiness.coaretail.com/insights/${article.slug}/): Insights Column（${ymd}）
`;
}

function insertAfterMarker(content, marker, insertion) {
  if (!content.includes(marker)) {
    throw new Error(`Marker not found: ${marker}`);
  }
  return content.replace(marker, `${marker}\n${insertion.replace(/\n$/, '')}`);
}

function removePlannedCard(indexHtml, slug) {
  const re = new RegExp(
    `\\s*<article class="insight-card planned"[^>]*data-scheduled-slug="${slug}"[\\s\\S]*?</article>`,
    'g'
  );
  return indexHtml.replace(re, '');
}

function updateFooterDate(content, ymd) {
  return content.replace(
    /Version 1\.0 · Last Updated \d{4}-\d{2}-\d{2}/,
    `Version 1.0 · Last Updated ${ymd}`
  );
}

function updateInsightsLastmod(sitemap, ymd) {
  return sitemap.replace(
    /(<loc>https:\/\/readiness\.coaretail\.com\/insights\/<\/loc>\s*<lastmod>)\d{4}-\d{2}-\d{2}/,
    `$1${ymd}`
  );
}

/**
 * Sync schedule entry when article exists on disk but schedule still says scheduled.
 */
export function recoverPublishedScheduleEntry(schedule, slug, now = new Date()) {
  const entry = schedule.articles.find((a) => a.slug === slug);
  if (!entry || !isArticlePublishedOnDisk(slug)) return { recovered: false };
  if (entry.status === EDITORIAL_STATUSES.PUBLISHED) return { recovered: false, slug };
  entry.status = EDITORIAL_STATUSES.PUBLISHED;
  entry.publishedAt = entry.publishedAt || now.toISOString();
  return { recovered: true, slug };
}

export function missingHeroHoldMessage(slug, publishAt) {
  return `HERO_PENDING_HOLD: ${slug} assets/insights/${slug}/hero.webp is missing. Not publishing web-only. Slot remains scheduled at ${publishAt}.`;
}

/**
 * Keep a due article scheduled when its canonical hero is absent.
 * Does not change publishAt or status.
 */
export function applyMissingHeroHold(entry, { now = new Date(), dryRun = false } = {}) {
  if (!entry || dryRun) return;
  entry.lastPublishFailure = 'HERO_PENDING';
  markHeroPending(entry, { now });
  delete entry.heroReadyAt;
}

/**
 * @returns {{ updated: boolean, published: string[], skipped: string[], errors: string[], held: object[] }}
 */
export function publishDueArticles({
  now = new Date(),
  forceSlug = null,
  dryRun = false,
  allowWeekend = false,
  heroExists = null,
} = {}) {
  const result = { updated: false, published: [], skipped: [], errors: [], held: [] };

  if (!forceSlug && !allowWeekend && !isWeekday(now)) {
    return { ...result, reason: 'weekend' };
  }

  const schedule = JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf8'));
  const selected = selectNextDueArticle(schedule.articles, now, forceSlug);
  const due = selected ? [selected] : [];

  if (!due.length) {
    return result;
  }

  let indexHtml = fs.readFileSync(INDEX_PATH, 'utf8');
  let sitemap = fs.readFileSync(SITEMAP_PATH, 'utf8');
  let llms = fs.readFileSync(LLMS_PATH, 'utf8');

  const ordered = [...due].sort(
    (a, b) => new Date(a.publishAt).getTime() - new Date(b.publishAt).getTime()
  );

  for (const article of ordered) {
    const entry = schedule.articles.find((a) => a.slug === article.slug);
    if (entry && !dryRun) {
      entry.publishAttemptedAt = now.toISOString();
      entry.publishAttemptCount = (entry.publishAttemptCount || 0) + 1;
      delete entry.lastPublishFailure;
      result.updated = true;
    }
    const dest = articleDestPath(article.slug);

    if (isArticlePublishedOnDisk(article.slug)) {
      if (entry && entry.status !== EDITORIAL_STATUSES.PUBLISHED) {
        entry.status = EDITORIAL_STATUSES.PUBLISHED;
        entry.publishedAt = entry.publishedAt || now.toISOString();
        result.updated = true;
      }
      result.skipped.push(article.slug);
      continue;
    }

    if (isProtectedInternalLinkSlug(article.slug)) {
      result.errors.push(`PROTECTED_ABIS:${article.slug}`);
      if (entry && !dryRun) entry.lastPublishFailure = 'PROTECTED_ABIS';
      continue;
    }

    const src = path.join(ROOT, 'insights/_scheduled', article.slug);
    const srcIndex = path.join(src, 'index.html');

    if (!fs.existsSync(srcIndex)) {
      result.errors.push(`missing_scheduled_html:${article.slug}`);
      if (entry && !dryRun) entry.lastPublishFailure = 'missing_scheduled_html';
      continue;
    }

    const hasHero = typeof heroExists === 'function'
      ? heroExists(article.slug)
      : fs.existsSync(canonicalHeroPath(configFor(ROOT), article.slug));
    if (!hasHero) {
      const message = missingHeroHoldMessage(article.slug, article.publishAt);
      console.error(message);
      result.errors.push(message);
      result.held.push({
        slug: article.slug,
        reason: 'HERO_PENDING',
        publishAt: article.publishAt,
        status: entry?.status || article.status,
      });
      applyMissingHeroHold(entry, { now, dryRun });
      continue;
    }

    const prepared = prepareScheduledArticle(article.slug, { strict: true });
    if (!prepared.ok) {
      result.errors.push(`quality_gate:${article.slug}`);
      if (entry && !dryRun) entry.lastPublishFailure = 'quality_gate';
      continue;
    }

    const { ymd } = dateParts(article.publishAt);

    if (!dryRun) {
      fs.renameSync(src, dest);
    }

    if (!indexHtml.includes(`data-insight-slug="${article.slug}"`)) {
      indexHtml = insertAfterMarker(indexHtml, '<!-- INSIGHTS_CARDS_START -->', cardHtml(article));
    }
    indexHtml = removePlannedCard(indexHtml, article.slug);

    if (!dryRun) {
      const publishConfig = configFor(ROOT);
      if (fs.existsSync(canonicalHeroPath(publishConfig, article.slug))) {
        fs.writeFileSync(INDEX_PATH, indexHtml, 'utf8');
        integrateCanonicalHero(publishConfig, article.slug, { root: ROOT });
        indexHtml = fs.readFileSync(INDEX_PATH, 'utf8');
      }
    }
    indexHtml = updateFooterDate(indexHtml, ymd);

    if (!sitemap.includes(`/insights/${article.slug}/`)) {
      sitemap = insertAfterMarker(sitemap, '<!-- INSIGHTS_URLS_START -->', sitemapEntry(article));
    }
    sitemap = updateInsightsLastmod(sitemap, ymd);

    if (!llms.includes(`/insights/${article.slug}/`)) {
      llms = insertAfterMarker(llms, '# INSIGHTS_LLMS_START', llmsLine(article));
    }

    if (entry) {
      entry.status = EDITORIAL_STATUSES.PUBLISHED;
      entry.publicationState = 'PUBLISHED';
      entry.publishedAt = now.toISOString();
      delete entry.lastPublishFailure;
      if (!dryRun) {
        const social = enrollSocialOnPublish(entry);
        if (social.enrolled) {
          result.socialEnrolled = result.socialEnrolled || [];
          result.socialEnrolled.push(entry.slug);
        }
      }
    }

    result.published.push(article.slug);
    result.updated = true;
  }

  const nextPlanned = findEarliestScheduledArticle(schedule);
  if (nextPlanned) {
    indexHtml = upsertPlannedCard(indexHtml, nextPlanned, schedule);
  }

  if (result.updated && !dryRun) {
    fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(schedule, null, 2) + '\n', 'utf8');
    const synced = syncInsightsPublicSurfaces({ updateFooter: true });
    result.freshnessSlugs = synced.freshnessSlugs || [];
  }

  return result;
}
