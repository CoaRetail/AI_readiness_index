/**
 * Core multi-channel Buffer dispatcher logic (testable, no side effects in exports).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './insights-v2-paths.mjs';
import { toJstDateString, isWeekday, charCountNoSpace } from './business-days.mjs';
import { EDITORIAL_STATUSES } from './editorial-status.mjs';
import { syncLinkedInQueueFromBuffer } from './sync-linkedin-queue.mjs';
import {
  CHANNEL_KEYS,
  CHANNEL_STATUSES,
  CONTENT_LIMITS,
  EXISTING_BUFFER_SENTINEL,
  isBufferDuplicateScheduleError,
  parseChannelsArg,
  validateChannelKeys,
} from './social-channels.mjs';
import { resolvePublishAt, addMinutesJst, toBufferDueAt } from './social-schedule.mjs';
import { normalizePublicationDate } from './buffer-ledger.mjs';
import { getChannelId, isChannelConfigured } from './buffer-client.mjs';
import { findDuplicatedSocialUnits, formatDuplicatedSocialUnit } from './social-copy-units.mjs';

function resolveChannelPublishAt(ch, channel, article, now) {
  let publishAt = resolvePublishAt(channel.publishAt, now, 30);
  if (ch === 'x' && article.channels.facebook?.publishAt) {
    const fbResolved = resolvePublishAt(article.channels.facebook.publishAt, now, 30);
    const xMin = addMinutesJst(new Date(fbResolved), 15).iso;
    if (new Date(publishAt).getTime() < new Date(xMin).getTime()) {
      publishAt = xMin;
    }
  }
  return publishAt;
}

export function readJsonFile(p, fallback = null) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writeJsonFile(p, data, { dryRun = false } = {}) {
  if (dryRun) return false;
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return true;
}

export function appendJsonLog(p, entry, { dryRun = false } = {}) {
  const log = readJsonFile(p, { entries: [], updatedAt: null });
  log.entries.push(entry);
  log.updatedAt = new Date().toISOString();
  writeJsonFile(p, log, { dryRun });
}

export function loadChannelText(contentFile) {
  const abs = path.isAbsolute(contentFile) ? contentFile : path.join(ROOT, contentFile);
  if (!fs.existsSync(abs)) throw new Error(`Missing content: ${abs}`);
  return fs.readFileSync(abs, 'utf8').trim();
}

export function validateChannelContent(channelKey, text, articleUrl) {
  const limits = CONTENT_LIMITS[channelKey];
  const len = text.length;
  const errors = [];

  if (!text.includes(articleUrl)) errors.push('URL missing');
  if (len < limits.min || len > limits.max) {
    errors.push(`length ${len} outside ${limits.min}-${limits.max}`);
  }
  const tags = (text.match(/#\w+/g) || []).length;
  if (tags < limits.hashtags[0] || tags > limits.hashtags[1]) {
    errors.push(`hashtag count ${tags} outside ${limits.hashtags.join('-')}`);
  }
  if (channelKey === 'linkedin' && !text.includes('#AgentReadiness')) {
    errors.push('missing #AgentReadiness');
  }
  for (const unit of findDuplicatedSocialUnits(text)) {
    errors.push(formatDuplicatedSocialUnit(unit));
  }

  return { ok: errors.length === 0, errors };
}

export function isChannelQueued(channel) {
  if (!channel) return false;
  if (channel.bufferUpdateId === EXISTING_BUFFER_SENTINEL) return true;
  if (channel.bufferUpdateId) return true;
  return channel.status === CHANNEL_STATUSES.QUEUED;
}

export function isChannelEligible(channel, { requestedChannels }) {
  if (!channel) return false;
  if (isChannelQueued(channel)) return false;
  if (channel.status === CHANNEL_STATUSES.SKIPPED) return false;
  const transferable = new Set([
    CHANNEL_STATUSES.SCHEDULED,
    CHANNEL_STATUSES.ARTICLE_PUBLISHED,
    CHANNEL_STATUSES.READY,
    CHANNEL_STATUSES.URL_UNAVAILABLE,
    CHANNEL_STATUSES.FAILED,
    CHANNEL_STATUSES.RECONCILE_REQUIRED,
  ]);
  return transferable.has(channel.status);
}

/**
 * Verification-based Buffer pick — no fixed transfer-day clock dependency.
 * Eligible when slug is production-verified (schedule) and has pending channels.
 *
 * @param {object} queue buffer queue.json
 * @param {{ forceSlug?: string|null, schedule?: object|null }} opts
 */
export function pickBufferEligibleArticle(queue, { forceSlug = null, publicationDate = null, schedule = null } = {}) {
  if (!queue?.posts?.length) return null;

  const verifiedEntries = (schedule?.articles || [])
    .filter((a) => a.productionVerifiedAt)
    .map((a) => ({
      slug: a.slug,
      publicationDate: normalizePublicationDate({ articlePublishAt: a.publishAt }),
    }));

  const candidates = queue.posts.filter((p) => {
    if (forceSlug && p.slug !== forceSlug) return false;
    if (p.status === EDITORIAL_STATUSES.HOLD) return false;
    if (publicationDate && normalizePublicationDate(p) !== publicationDate) return false;
    const pDate = normalizePublicationDate(p);
    if (!verifiedEntries.some((a) => a.slug === p.slug && (!a.publicationDate || a.publicationDate === pDate))) return false;

    const pending = CHANNEL_KEYS.some((ch) => {
      const c = p.channels?.[ch];
      return c && isChannelEligible(c, { requestedChannels: CHANNEL_KEYS });
    });
    return pending;
  });

  if (!candidates.length) return null;

  return candidates.sort((a, b) => {
    const ta = a.articlePublishAt ? new Date(a.articlePublishAt).getTime() : 0;
    const tb = b.articlePublishAt ? new Date(b.articlePublishAt).getTime() : 0;
    return ta - tb;
  })[0];
}

export function pickTodayArticle(queue, todayYmd, { forceSlug = null, now = new Date() } = {}) {
  if (forceSlug) {
    const forced = queue.posts.find((p) => p.slug === forceSlug);
    if (forced?.status === EDITORIAL_STATUSES.HOLD) {
      return { error: `editorial_hold cannot be transferred: ${forceSlug}`, exitCode: 1 };
    }
  }

  const candidates = queue.posts.filter((p) => {
    if (forceSlug) return p.slug === forceSlug;
    if (p.status === EDITORIAL_STATUSES.HOLD) return false;
    if (!p.bufferTransferAt) return false;
    return toJstDateString(new Date(p.bufferTransferAt)) === todayYmd;
  });

  if (!candidates.length) return { article: null };

  const eligible = candidates.filter((p) => {
    if (p.status === EDITORIAL_STATUSES.HOLD) return false;
    const transferable = new Set([
      EDITORIAL_STATUSES.SCHEDULED,
      'article_published',
      'ready_for_buffer',
      'article_url_unavailable',
      'buffer_transfer_failed',
      'partially_queued',
      'buffer_queued',
    ]);
    if (!transferable.has(p.status)) return false;
    // Fully queued articles with no pending channels are done
    if (p.status === 'buffer_queued' && p.channels) {
      const pending = CHANNEL_KEYS.some((ch) => {
        const c = p.channels[ch];
        return c && isChannelEligible(c, { requestedChannels: CHANNEL_KEYS });
      });
      if (!pending) return false;
    }
    if (forceSlug) return p.slug === forceSlug;
    return true;
  });

  return { article: eligible[0] || null };
}

export function countPendingChannels(article, requestedChannels) {
  return requestedChannels.filter((ch) => {
    const c = article.channels?.[ch];
    return c && isChannelEligible(c, { requestedChannels });
  }).length;
}

/** A delivery is complete only when every required channel is independently queued. */
export function isBufferDeliveryComplete(article, requestedChannels = CHANNEL_KEYS) {
  return requestedChannels.every((ch) => {
    const channel = article?.channels?.[ch];
    return channel && isChannelQueued(channel);
  });
}

/**
 * Process one article across channels. Mutates article in place unless dryRun.
 * @returns {Promise<{updated: boolean, results: object[], exitCode: number}>}
 */
export async function processArticleChannels({
  article,
  queue,
  now,
  dryRun,
  requestedChannels,
  verifyArticleUrl,
  createBufferPost,
  getConfig,
  paths,
  verifyProduction = null,
  findExistingBufferPost = null,
}) {
  validateChannelKeys(requestedChannels);

  const verify = verifyProduction
    ? await verifyProduction(article.slug)
    : await verifyArticleUrl(article.slug);
  if (!verify.ok) {
    if (!dryRun) {
      article.status = 'article_url_unavailable';
      article.lastError = verify.reason;
      article.updatedAt = now.toISOString();
      for (const ch of requestedChannels) {
        const c = article.channels[ch];
        if (c && isChannelEligible(c, { requestedChannels })) {
          c.status = CHANNEL_STATUSES.URL_UNAVAILABLE;
          c.lastError = verify.reason;
        }
      }
      appendJsonLog(paths.failedLog, {
        at: now.toISOString(),
        slug: article.slug,
        error: verify.reason,
        dryRun,
      }, { dryRun });
      writeJsonFile(paths.queue, queue, { dryRun });
    }
    return {
      updated: !dryRun,
      results: [],
      exitCode: dryRun ? 0 : 1,
      reason: verifyProduction ? (verify.reason || 'production_not_verified') : 'url_unavailable',
    };
  }

  const mediaUrl = verify.mediaUrl || null;
  const cfg = getConfig();
  const results = [];
  let anyUpdated = false;
  let anyFailed = false;

  for (const ch of requestedChannels) {
    const channel = article.channels?.[ch];
    if (!channel) {
      results.push({ channel: ch, action: 'skip', reason: 'no_channel_entry' });
      continue;
    }

    if (isChannelQueued(channel)) {
      results.push({ channel: ch, action: 'skip', reason: 'already_queued', bufferUpdateId: channel.bufferUpdateId });
      continue;
    }

    if (!isChannelEligible(channel, { requestedChannels })) {
      results.push({ channel: ch, action: 'skip', reason: `status_${channel.status}` });
      continue;
    }

    if (!isChannelConfigured(ch, cfg)) {
      if (dryRun) {
        const publishAt = resolveChannelPublishAt(ch, channel, article, now);
        results.push({
          channel: ch,
          action: 'dry_run',
          postId: 'dry-run-mock-id',
          publishAt,
          dueAtUtc: toBufferDueAt(publishAt),
        });
        continue;
      }
      // Credential outages are operational and must remain retryable.
      channel.lastError = `Missing env ${channel.channelIdEnv}`;
      channel.lastAttemptAt = now.toISOString();
      anyFailed = true;
      anyUpdated = true;
      results.push({ channel: ch, action: 'skip', reason: 'missing_credentials' });
      continue;
    }

    let text;
    try {
      text = loadChannelText(channel.contentFile);
    } catch (err) {
      channel.status = CHANNEL_STATUSES.FAILED;
      channel.lastError = String(err.message);
      channel.attempts = (channel.attempts || 0) + 1;
      channel.lastAttemptAt = now.toISOString();
      anyFailed = true;
      results.push({ channel: ch, action: 'error', error: channel.lastError });
      continue;
    }

    const contentCheck = validateChannelContent(ch, text, article.articleUrl);
    if (!contentCheck.ok) {
      // Hold the channel off Buffer. Short or duplicated copy is not padded
      // and is not sent. FAILED stays retryable once the stored file is fixed.
      channel.status = CHANNEL_STATUSES.FAILED;
      channel.lastError = contentCheck.errors.join('; ');
      channel.attempts = (channel.attempts || 0) + 1;
      channel.lastAttemptAt = now.toISOString();
      channel.updatedAt = now.toISOString();
      anyFailed = true;
      anyUpdated = true;
      results.push({ channel: ch, action: 'held', error: channel.lastError });
      continue;
    }

    const publishAt = resolveChannelPublishAt(ch, channel, article, now);
    const channelId = getChannelId(ch, cfg);

    // Remote-first reconciliation closes the CREATE-success/local-write-failure
    // window. The callback is read-only and must return an exact channel match.
    if (findExistingBufferPost && !dryRun) {
      let existing;
      try {
        existing = await findExistingBufferPost({
          slug: article.slug,
          publicationDate: normalizePublicationDate(article),
          channel: ch,
          channelId,
          publishAt,
          articleUrl: article.articleUrl,
          text,
        });
      } catch (err) {
        channel.status = CHANNEL_STATUSES.RECONCILE_REQUIRED;
        channel.lastError = `remote_reconciliation_failed: ${String(err?.message || err)}`;
        channel.lastAttemptAt = now.toISOString();
        channel.attempts = (channel.attempts || 0) + 1;
        anyFailed = true;
        anyUpdated = true;
        results.push({ channel: ch, action: 'reconcile_required', error: channel.lastError });
        continue;
      }
      if (existing?.id) {
        channel.bufferUpdateId = existing.id;
        channel.status = CHANNEL_STATUSES.QUEUED;
        channel.lastError = null;
        channel.lastAttemptAt = now.toISOString();
        channel.updatedAt = now.toISOString();
        anyUpdated = true;
        results.push({ channel: ch, action: 'reconciled_existing', postId: existing.id });
        continue;
      }
    }

    let createResult;
    try {
      createResult = await createBufferPost({
        channelKey: ch,
        channelId,
        accessToken: cfg.accessToken,
        text,
        dueAt: publishAt,
        mediaUrl,
        dryRun,
      });
    } catch (err) {
      createResult = { postId: null, error: String(err?.message || err), rejected: false };
    }
    const { postId, error, rejected, dueAtUtc } = createResult;

    channel.lastAttemptAt = now.toISOString();
    channel.attempts = (channel.attempts || 0) + 1;

    if (error) {
      if (isBufferDuplicateScheduleError(error)) {
        channel.bufferUpdateId = channel.bufferUpdateId || EXISTING_BUFFER_SENTINEL;
        channel.status = CHANNEL_STATUSES.QUEUED;
        channel.lastError = null;
        anyUpdated = true;
        results.push({ channel: ch, action: 'duplicate_ok', error });
        continue;
      }
      channel.status = rejected ? CHANNEL_STATUSES.REJECTED : CHANNEL_STATUSES.FAILED;
      channel.lastError = error;
      anyFailed = true;
      results.push({ channel: ch, action: 'failed', error });
      if (!dryRun) {
        appendJsonLog(paths.failedLog, {
          at: now.toISOString(),
          slug: article.slug,
          channel: ch,
          error,
          dryRun,
        }, { dryRun });
      }
      continue;
    }

    if (!dryRun) {
      channel.bufferUpdateId = postId;
      channel.status = CHANNEL_STATUSES.QUEUED;
      channel.publishAt = publishAt;
      channel.lastError = null;
      channel.updatedAt = now.toISOString();
      anyUpdated = true;
      appendJsonLog(paths.publishedLog, {
        at: now.toISOString(),
        slug: article.slug,
        channel: ch,
        bufferUpdateId: postId,
        publishAt,
        dueAtUtc,
        dryRun,
      }, { dryRun });
    }

    results.push({
      channel: ch,
      action: dryRun ? 'dry_run' : 'queued',
      postId,
      publishAt,
      dueAtUtc,
      mediaUrl,
      mediaStatus: verify.mediaStatus || (mediaUrl ? 'canonical_hero_verified' : 'text_only'),
    });
  }

  if (!dryRun && anyUpdated) {
    const allQueued = CHANNEL_KEYS.every((ch) => {
      const c = article.channels?.[ch];
      return !c || isChannelQueued(c) || c.status === CHANNEL_STATUSES.SKIPPED;
    });
    const anyPending = CHANNEL_KEYS.some((ch) => {
      const c = article.channels?.[ch];
      return c && isChannelEligible(c, { requestedChannels: CHANNEL_KEYS });
    });

    if (allQueued && !anyPending) {
      article.status = 'buffer_queued';
    } else if (anyUpdated) {
      article.status = 'partially_queued';
    }
    article.updatedAt = now.toISOString();
    writeJsonFile(paths.queue, queue, { dryRun });

    if (!dryRun && article.status === 'buffer_queued') {
      syncLinkedInQueueFromBuffer(article.slug);
    }
  }

  return {
    updated: anyUpdated,
    results,
    exitCode: anyFailed && !dryRun ? 1 : 0,
    deliveryComplete: isBufferDeliveryComplete(article, CHANNEL_KEYS),
  };
}

export { parseChannelsArg, validateChannelKeys, charCountNoSpace };
