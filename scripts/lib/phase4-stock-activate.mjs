/**
 * Phase 4 — Controlled HOLD_READY → SCHEDULED activation (schedule-only).
 * No Buffer/LinkedIn queue mutation. No article/hero/social regeneration.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ROOT } from './insights-v2-paths.mjs';
import { EDITORIAL_STATUSES } from './editorial-status.mjs';
import { isoAtJst, isOpenPublishDay } from './business-days.mjs';
import {
  publicationIdFor,
  PUBLICATION_STATES,
  SLOT_TYPES,
  publicationEventFor,
  planEmergencyInsertion,
} from './editorial-schedule-buffer.mjs';
import {
  PACKAGE_STATES,
  heroExists,
  loadSchedule,
  saveSchedule,
} from './insights-package-readiness.mjs';
import {
  findScheduledOnDate,
  upsertPlannedCard,
} from './unlock-next-insight.mjs';
import {
  formatSocialValidationFailure,
  validateSocialContentForSlug,
} from './validate-social-content.mjs';
import { prepareScheduledArticle } from './prepare-scheduled-article.mjs';
import { validateHoldStockIntegration, configFor } from './local-visual-worker.mjs';
import { computeStockHealth as phase3Inventory } from './phase3-stock-build.mjs';

/** Phase 4 batch 2 — C.M.E authorized HOLD_READY → SCHEDULED after Silver Week. */
export const AUTHORIZED_ACTIVATIONS = Object.freeze([
  {
    slug: 'weighted-ai-visibility-stack',
    slotDate: '2026-09-24',
    publishAt: '2026-09-24T10:00:00+09:00',
  },
  {
    slug: 'shopify-ai-vs-organic-structured-catalog',
    slotDate: '2026-09-25',
    publishAt: '2026-09-25T10:00:00+09:00',
  },
  {
    slug: 'google-ai-coexistence-measurement',
    slotDate: '2026-09-28',
    publishAt: '2026-09-28T10:00:00+09:00',
  },
  {
    slug: 'gemini-3-8-ai-mode-visibility',
    slotDate: '2026-09-29',
    publishAt: '2026-09-29T10:00:00+09:00',
  },
  {
    slug: 'geo-social-citation-authority',
    slotDate: '2026-09-30',
    publishAt: '2026-09-30T10:00:00+09:00',
  },
  {
    slug: 'gsc-ai-impressions-how-to-read',
    slotDate: '2026-10-01',
    publishAt: '2026-10-01T10:00:00+09:00',
  },
  {
    slug: 'schema-not-ai-citation-cheat-code',
    slotDate: '2026-10-02',
    publishAt: '2026-10-02T10:00:00+09:00',
  },
  {
    slug: 'chatgpt-retrieval-citation-practice',
    slotDate: '2026-10-06',
    publishAt: '2026-10-06T10:00:00+09:00',
  },
]);

const HOLD_STOCK_SLUGS = Object.freeze([
  'weighted-ai-visibility-stack',
  'shopify-ai-vs-organic-structured-catalog',
  'google-ai-coexistence-measurement',
  'gemini-3-8-ai-mode-visibility',
  'geo-social-citation-authority',
  'gsc-ai-impressions-how-to-read',
  'schema-not-ai-citation-cheat-code',
  'chatgpt-retrieval-citation-practice',
]);

/** Slugs that must remain HOLD_READY — excludes anything listed in the current activation plan. */
const REMAINING_HOLD_SLUGS = Object.freeze(
  HOLD_STOCK_SLUGS.filter((slug) => !AUTHORIZED_ACTIVATIONS.some((act) => act.slug === slug)),
);

const PROTECTED_SCHEDULED = Object.freeze({
  'competitors-visible-company-missing': '2026-09-11T10:00:00+09:00',
  'execution-readiness': '2026-09-14T10:00:00+09:00',
  'html-observation-check-limits': '2026-09-15T10:00:00+09:00',
  'seo-meo-ai-recommendation-gap': '2026-09-16T10:00:00+09:00',
  'cloudflare-ai-traffic-search-agent-training': '2026-09-17T10:00:00+09:00',
  'niq-similarweb-agentic-shelf-measurement': '2026-09-18T10:00:00+09:00',
});

const FORBIDDEN_SLOT_WINDOWS = Object.freeze([
  { start: '2026-09-19', end: '2026-09-23', reason: 'silver_week' },
]);

const PROTECTED_STATUSES = new Set([
  EDITORIAL_STATUSES.SCHEDULED,
  EDITORIAL_STATUSES.PUBLISHED,
]);

function forbiddenSlotReason(slotDate) {
  const window = FORBIDDEN_SLOT_WINDOWS.find((w) => slotDate >= w.start && slotDate <= w.end);
  return window ? window.reason : null;
}

function isProtectedEntryIntact(entry, publishAt) {
  if (!entry || entry.publishAt !== publishAt) return false;
  if (!PROTECTED_STATUSES.has(entry.status)) return false;
  if (entry.status === EDITORIAL_STATUSES.PUBLISHED) {
    const historical = entry.scheduledPublishAt || entry.publishAt;
    return historical === publishAt;
  }
  return true;
}

function assertHoldReady(entry) {
  if (!entry) return { ok: false, reason: 'missing_entry' };
  if (entry.status !== EDITORIAL_STATUSES.HOLD) return { ok: false, reason: 'not_editorial_hold' };
  if (entry.packageReadiness !== PACKAGE_STATES.HOLD_READY) return { ok: false, reason: `package_${entry.packageReadiness}` };
  if (entry.publishAt) return { ok: false, reason: 'publishAt_already_set' };
  return { ok: true };
}

function promoteEntry(entry, { slotDate, publishAt, now }) {
  entry.status = EDITORIAL_STATUSES.SCHEDULED;
  entry.publishAt = publishAt;
  entry.scheduledPublishAt = publishAt;
  entry.slotDate = slotDate;
  entry.slotType = SLOT_TYPES.DAILY_PRIMARY;
  entry.publicationState = PUBLICATION_STATES.SCHEDULED;
  entry.publicationId = publicationIdFor(slotDate);
  entry.activatedAt = now.toISOString();
  entry.holdReady = false;
  delete entry.holdReadyAt;
  if (heroExists(entry.slug)) {
    entry.packageReadiness = PACKAGE_STATES.PACKAGE_READY;
    entry.heroReadyAt = entry.heroReadyAt || now.toISOString();
  }
}

export function validateActivationPlan(schedule, activations = AUTHORIZED_ACTIVATIONS) {
  const errors = [];
  const ids = new Set();
  for (const act of activations) {
    if (!isOpenPublishDay(act.slotDate)) {
      errors.push(`${act.slug}:not_business_day:${act.slotDate}`);
    }
    const forbidden = forbiddenSlotReason(act.slotDate);
    if (forbidden) {
      errors.push(`${act.slug}:forbidden_slot:${forbidden}:${act.slotDate}`);
    }
    const occupant = findScheduledOnDate(schedule, act.slotDate);
    if (occupant && occupant.slug !== act.slug) {
      errors.push(`${act.slotDate}:slot_occupied:${occupant.slug}`);
    }
    const entry = schedule.articles.find((a) => a.slug === act.slug);
    const hold = assertHoldReady(entry);
    if (!hold.ok) errors.push(`${act.slug}:${hold.reason}`);
    const pubId = publicationIdFor(act.slotDate);
    if (ids.has(pubId)) errors.push(`duplicate_publication_id:${pubId}`);
    ids.add(pubId);
    const dupId = schedule.articles.find((a) => a.publicationId === pubId && a.slug !== act.slug);
    if (dupId) errors.push(`publication_id_collision:${pubId}:${dupId.slug}`);
  }
  for (const [slug, publishAt] of Object.entries(PROTECTED_SCHEDULED)) {
    const e = schedule.articles.find((a) => a.slug === slug);
    if (!isProtectedEntryIntact(e, publishAt)) {
      errors.push(`protected_schedule_changed:${slug}`);
    }
  }
  for (const slug of REMAINING_HOLD_SLUGS) {
    const e = schedule.articles.find((a) => a.slug === slug);
    if (!e || e.packageReadiness !== PACKAGE_STATES.HOLD_READY || e.publishAt) {
      errors.push(`remaining_stock_not_hold_ready:${slug}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function activateHoldStock({
  activations = AUTHORIZED_ACTIVATIONS,
  root = ROOT,
  dryRun = false,
  now = new Date(),
} = {}) {
  const schedule = loadSchedule();
  const inventoryBefore = phase3Inventory(schedule);
  const bufferBefore = fs.existsSync(PATHS.bufferQueue)
    ? fs.readFileSync(PATHS.bufferQueue, 'utf8')
    : '';
  const linkedinBefore = fs.existsSync(PATHS.linkedinQueue)
    ? fs.readFileSync(PATHS.linkedinQueue, 'utf8')
    : '';

  const planCheck = validateActivationPlan(schedule, activations);
  if (!planCheck.ok) {
    return { ok: false, reason: 'validation_failed', errors: planCheck.errors, dryRun };
  }

  const results = [];
  for (const act of activations) {
    const entry = schedule.articles.find((a) => a.slug === act.slug);
    const social = validateSocialContentForSlug(act.slug, { root });
    if (!social.ok) {
      return {
        ok: false,
        reason: 'social_validation_failed',
        slug: act.slug,
        errors: social.errors,
        dryRun,
      };
    }
    const heroOk = heroExists(act.slug, root);
    const integration = validateHoldStockIntegration(configFor(root), act.slug, { root });
    if (!heroOk || !integration.ok) {
      return {
        ok: false,
        reason: 'hero_not_ready',
        slug: act.slug,
        heroOk,
        integration,
        dryRun,
      };
    }

    const esb = planEmergencyInsertion(schedule, {
      slug: act.slug,
      targetDate: act.slotDate,
      bufferQueue: [],
    });
    if (!esb.safe && esb.reason !== 'ALREADY_APPLIED') {
      return {
        ok: false,
        reason: 'esb_incompatible',
        slug: act.slug,
        esb,
        dryRun,
      };
    }

    if (!dryRun) {
      promoteEntry(entry, { slotDate: act.slotDate, publishAt: act.publishAt, now });
      const prep = prepareScheduledArticle(act.slug, { strict: true });
      if (!prep.ok) {
        return { ok: false, reason: 'prepare_failed', slug: act.slug, prep, dryRun };
      }
    }

    results.push({
      slug: act.slug,
      slotDate: act.slotDate,
      publishAt: act.publishAt,
      publicationId: publicationIdFor(act.slotDate),
      packageReadiness: PACKAGE_STATES.PACKAGE_READY,
      heroReused: true,
      publicationEvent: publicationEventFor(entry),
      livePath: path.join(root, 'insights', act.slug, 'index.html'),
      liveExists: fs.existsSync(path.join(root, 'insights', act.slug, 'index.html')),
    });
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      batch: 'phase4-batch2',
      results,
      inventoryBefore,
      inventory: inventoryBefore,
    };
  }

  let indexHtml = fs.readFileSync(PATHS.insightsIndex, 'utf8');
  indexHtml = upsertPlannedCard(indexHtml, results[0] ? schedule.articles.find((a) => a.slug === results[0].slug) : null, schedule);
  fs.writeFileSync(PATHS.insightsIndex, indexHtml, 'utf8');
  saveSchedule(schedule);

  const bufferAfter = fs.readFileSync(PATHS.bufferQueue, 'utf8');
  const linkedinAfter = fs.readFileSync(PATHS.linkedinQueue, 'utf8');

  const inventoryAfter = phase3Inventory(loadSchedule());
  const report = {
    batch: 'phase4-batch2',
    activatedAt: now.toISOString(),
    activations: results,
    inventoryBefore,
    inventory: inventoryAfter,
    inventoryAfter,
    bufferMutated: bufferBefore !== bufferAfter,
    linkedinMutated: linkedinBefore !== linkedinAfter,
  };
  fs.mkdirSync(PATHS.reportsDir, { recursive: true });
  fs.writeFileSync(
    path.join(PATHS.reportsDir, 'phase4-stock-activate-report.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf8',
  );

  return {
    ok: true,
    dryRun: false,
    results,
    report,
    bufferMutated: report.bufferMutated,
    linkedinMutated: report.linkedinMutated,
  };
}
