/**
 * Operational reconciliation: publish → verify → buffer with partial recovery.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from './insights-v2-paths.mjs';
import { EDITORIAL_STATUSES } from './editorial-status.mjs';
import { toJstDateString } from './business-days.mjs';
import { normalizePublicationDate } from './buffer-ledger.mjs';
import { resolvePublishAt } from './social-schedule.mjs';
import { CHANNEL_KEYS } from './social-channels.mjs';
import {
  processArticleChannels,
  pickBufferEligibleArticle,
  readJsonFile,
  writeJsonFile,
} from './buffer-dispatcher.mjs';
import { createBufferPost, getBufferConfig } from './buffer-client.mjs';
import { verifyArticleUrl } from './url-verify.mjs';
import { publishDueArticles } from './publish-scheduled-insights-core.mjs';
import { verifyProductionWithBoundedRetry } from './publish-verification.mjs';
import { verifyProductionSocialAssets } from './insights-social-media.mjs';
import {
  OPERATIONAL_STATES,
  deriveScheduleOperationalState,
  deriveBufferOperationalState,
  findBufferPost,
  isProductionVerified,
  listPublishDueArticles,
  listVerificationPending,
  markProductionVerified,
} from './publishing-state-machine.mjs';
import {
  recordPipelineFailure,
  clearPipelineFailure,
} from './publishing-failure-state.mjs';
import { recoverAllPublishDayGaps, findGapScanWindow, listWeekdayGaps } from './publish-day-gap-recovery.mjs';
import { refreshSitemapFile } from './sitemap-lastmod.mjs';

export function bumpBufferTimesForArticle(bufferPost, now = new Date()) {
  if (!bufferPost?.channels) return false;
  let changed = false;
  for (const ch of CHANNEL_KEYS) {
    const channel = bufferPost.channels[ch];
    if (!channel || channel.bufferUpdateId) continue;
    const bumped = resolvePublishAt(channel.publishAt, now, 30);
    if (bumped && bumped !== channel.publishAt) {
      channel.publishAt = bumped;
      channel.updatedAt = now.toISOString();
      changed = true;
    }
  }
  if (changed) {
    bufferPost.updatedAt = now.toISOString();
  }
  return changed;
}

export function buildHealthReportMarkdown({
  now,
  todayYmd,
  slug,
  scheduleState,
  bufferState,
  publishResult,
  verifyResult,
  bufferResult,
  pipelineStatus,
}) {
  const lines = [
    `# Pipeline Health — ${todayYmd}`,
    '',
    `> Reconciliation run: ${now.toISOString()}`,
    '',
    '## TODAY',
    '',
    `slug: ${slug || '(none)'}`,
    '',
    '## WEB',
  ];

  if (slug) {
    lines.push(
      `scheduled: ${scheduleState?.publishAt?.slice(11, 16) || '—'}`,
      `published: ${scheduleState?.status === EDITORIAL_STATUSES.PUBLISHED ? 'true' : 'false'}`,
      `productionVerified: ${isProductionVerified(scheduleState) ? 'true' : 'false'}`
    );
  } else {
    lines.push('published: n/a', 'productionVerified: n/a');
  }

  lines.push('', '## BUFFER');
  if (bufferState?.channels) {
    for (const ch of CHANNEL_KEYS) {
      const c = bufferState.channels[ch];
      if (!c) continue;
      const label = c.bufferUpdateId ? 'queued' : c.status || 'pending';
      lines.push(`${ch}: ${label}`);
    }
  } else {
    lines.push('(no buffer entry)');
  }

  lines.push('', '## PIPELINE', `status: ${pipelineStatus}`);

  if (publishResult?.published?.length) {
    lines.push(`publish: ${publishResult.published.join(', ')}`);
  }
  if (publishResult?.held?.length) {
    lines.push('hero hold (HERO_PENDING, slot remains scheduled):');
    for (const hold of publishResult.held) {
      lines.push(`- ${hold.slug} at ${hold.publishAt}: assets/insights/${hold.slug}/hero.webp missing; web-only publish withheld`);
    }
  }
  if (verifyResult) {
    lines.push(`verify: ${verifyResult.ok ? 'ok' : verifyResult.reason} (${verifyResult.attempts || 0} attempts)`);
  }
  if (bufferResult?.results?.length) {
    lines.push('buffer actions:');
    for (const r of bufferResult.results) {
      lines.push(`- ${r.channel}: ${r.action}${r.reason ? ` (${r.reason})` : ''}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function resolvePipelineStatus(scheduleEntry, bufferPost) {
  const op = deriveScheduleOperationalState(scheduleEntry, { bufferPost });
  if (op === OPERATIONAL_STATES.COMPLETE || op === OPERATIONAL_STATES.BUFFER_QUEUED) {
    const bufOp = bufferPost ? deriveBufferOperationalState(bufferPost) : op;
    if (bufOp === OPERATIONAL_STATES.COMPLETE) return 'COMPLETE';
  }
  if ([OPERATIONAL_STATES.PUBLISH_DUE, OPERATIONAL_STATES.VERIFICATION_PENDING].includes(op)) {
    return 'RECOVERING';
  }
  if ([OPERATIONAL_STATES.BUFFER_PARTIAL, OPERATIONAL_STATES.BUFFER_FAILED].includes(op)) {
    return 'RECOVERING';
  }
  if (op === OPERATIONAL_STATES.PUBLISHED_VERIFIED) return 'RECOVERING';
  if (op === OPERATIONAL_STATES.SCHEDULED) return 'WAITING';
  if (op === OPERATIONAL_STATES.COMPLETE) return 'COMPLETE';
  return op.toUpperCase();
}

/**
 * @returns {Promise<object>}
 */
export async function reconcilePublishingPipeline({
  now = new Date(),
  dryRun = false,
  forceSlug = null,
  verifyFn = verifyArticleUrl,
  verifyWithRetry = verifyProductionWithBoundedRetry,
  createPost = createBufferPost,
  getConfig = getBufferConfig,
  channels = ['linkedin', 'facebook', 'x'],
  skipPublish = false,
  skipVerify = false,
  skipBuffer = false,
  fastVerify = false,
  findExistingBufferPost = null,
} = {}) {
  const todayYmd = toJstDateString(now);
  const summary = {
    now: now.toISOString(),
    todayYmd,
    publish: null,
    verify: [],
    buffer: null,
    updated: false,
    activeSlug: null,
    gapRecovery: null,
    freshnessSlugs: [],
  };

  let schedule = JSON.parse(fs.readFileSync(PATHS.schedule, 'utf8'));
  if (!forceSlug && !skipPublish) {
    const { startYmd, endYmd } = findGapScanWindow(schedule, now);
    const gaps = listWeekdayGaps(schedule, { startYmd, endYmd });
    if (gaps.length) {
      const recovery = recoverAllPublishDayGaps({ now, dryRun });
      summary.gapRecovery = recovery;
      if (recovery.recovered && !dryRun) {
        summary.updated = true;
        schedule = JSON.parse(fs.readFileSync(PATHS.schedule, 'utf8'));
      }
    }
  }

  // A. Publish reconciliation
  if (!skipPublish) {
    const publishResult = publishDueArticles({ now, forceSlug, dryRun });
    summary.publish = publishResult;
    if (publishResult.updated) summary.updated = true;
    if (publishResult.held?.length) {
      for (const hold of publishResult.held) {
        console.error(`HERO_PENDING_HOLD: ${hold.slug} assets/insights/${hold.slug}/hero.webp is missing. Not publishing web-only. Slot remains scheduled at ${hold.publishAt}.`);
      }
    }
    if (publishResult.errors?.length) {
      summary.updated = true;
      for (const err of publishResult.errors) {
        const slug = err.split(':')[1] || 'unknown';
        recordPipelineFailure(
          {
            slug,
            stage: 'publish',
            failureReason: err,
            retryable: true,
            lastSuccessStage: null,
          },
          { dryRun }
        );
      }
    }
  }

  const sitemapRefresh = refreshSitemapFile({ dryRun });
  if (sitemapRefresh.changed && !dryRun) summary.updated = true;
  summary.freshnessSlugs = [...new Set([
    ...(summary.publish?.freshnessSlugs || []),
    ...sitemapRefresh.freshnessSlugs,
  ])];

  schedule = JSON.parse(fs.readFileSync(PATHS.schedule, 'utf8'));
  const queue = readJsonFile(PATHS.bufferQueue, { posts: [] });

  const newlyPublished = summary.publish?.published || [];

  // Determine focus slug: force > just-published > publish_due > verification pending (newest) > buffer eligible
  let focusSlug =
    forceSlug ||
    newlyPublished[newlyPublished.length - 1] ||
    listPublishDueArticles(schedule.articles, now)[0]?.slug ||
    listVerificationPending(schedule.articles)[0]?.slug ||
    null;

  if (!focusSlug) {
    const eligible = pickBufferEligibleArticle(queue, { forceSlug: null, schedule });
    focusSlug = eligible?.slug || null;
  }

  summary.activeSlug = focusSlug;
  const scheduleEntry = focusSlug
    ? schedule.articles.find((a) => a.slug === focusSlug)
    : null;
  const focusPublicationDate = scheduleEntry
    ? normalizePublicationDate({ articlePublishAt: scheduleEntry.publishAt })
    : null;
  let bufferPost = focusSlug ? findBufferPost(queue, focusSlug, focusPublicationDate) : null;

  // B. Production verification
  if (!skipVerify && focusSlug && scheduleEntry) {
    const needsVerify =
      scheduleEntry.status === EDITORIAL_STATUSES.PUBLISHED && !isProductionVerified(scheduleEntry);

    if (needsVerify) {
      const verifyResult = fastVerify || dryRun
        ? await verifyFn(focusSlug)
        : await verifyWithRetry(focusSlug, { verifyFn, dryRun, log: () => {} });

      summary.verify.push({ slug: focusSlug, ...verifyResult });

      if (verifyResult.ok) {
        markProductionVerified(scheduleEntry, new Date().toISOString());
        scheduleEntry.verificationAttemptCount = verifyResult.attempts || 1;
        if (!dryRun) {
          fs.writeFileSync(PATHS.schedule, JSON.stringify(schedule, null, 2) + '\n', 'utf8');
        }
        summary.updated = true;
        clearPipelineFailure(focusSlug, { dryRun, lastSuccessStage: 'published_verified' });
      } else {
        summary.updated = true;
        recordPipelineFailure(
          {
            slug: focusSlug,
            stage: 'production_verification',
            failureReason: verifyResult.reason || 'verify_failed',
            retryable: true,
            lastSuccessStage: 'published',
          },
          { dryRun }
        );
      }
    }
  }

  // C. Buffer reconciliation (verification-based, not fixed clock)
  if (!skipBuffer && focusSlug && scheduleEntry && isProductionVerified(scheduleEntry)) {
    bufferPost = findBufferPost(queue, focusSlug, focusPublicationDate);
    if (bufferPost) {
      bumpBufferTimesForArticle(bufferPost, now);

      const bufferResult = await processArticleChannels({
        article: bufferPost,
        queue,
        now,
        dryRun,
        requestedChannels: channels,
        verifyArticleUrl: verifyFn,
        verifyProduction: (slug) => verifyProductionSocialAssets(slug, { verifyArticle: verifyFn }),
        createBufferPost: createPost,
        getConfig,
        paths: {
          queue: PATHS.bufferQueue,
          publishedLog: PATHS.bufferPublishedLog,
          failedLog: PATHS.bufferFailedLog,
        },
        findExistingBufferPost,
      });

      summary.buffer = bufferResult;
      if (bufferResult.updated) {
        summary.updated = true;
        if (!dryRun) {
          writeJsonFile(PATHS.bufferQueue, queue, { dryRun: false });
        }
      }

      if (bufferResult.exitCode !== 0) {
        recordPipelineFailure(
          {
            slug: focusSlug,
            stage: 'buffer',
            failureReason: bufferResult.reason || 'buffer_partial_or_failed',
            retryable: true,
            lastSuccessStage: 'published_verified',
          },
          { dryRun }
        );
      } else if (bufferResult.updated) {
        clearPipelineFailure(focusSlug, { dryRun, lastSuccessStage: 'buffer_queued' });
      }
    }
  }

  const pipelineStatus = scheduleEntry
    ? resolvePipelineStatus(scheduleEntry, bufferPost)
    : 'IDLE';

  summary.pipelineStatus = pipelineStatus;

  const healthMd = buildHealthReportMarkdown({
    now,
    todayYmd,
    slug: focusSlug,
    scheduleState: scheduleEntry,
    bufferState: bufferPost,
    publishResult: summary.publish,
    verifyResult: summary.verify[0],
    bufferResult: summary.buffer,
    pipelineStatus,
  });

  if (!dryRun) {
    fs.mkdirSync(PATHS.reportsDir, { recursive: true });
    const healthPath = path.join(PATHS.reportsDir, `pipeline-health-${todayYmd}.md`);
    fs.writeFileSync(healthPath, healthMd, 'utf8');
    summary.healthReportPath = healthPath;
  }

  summary.healthMarkdown = healthMd;
  return summary;
}
