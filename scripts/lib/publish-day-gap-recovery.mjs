/**
 * Detect weekday publish slots with no scheduled article and recover by pull-forward.
 */
import fs from 'node:fs';
import { PATHS } from './insights-v2-paths.mjs';
import { toJstDateString, isClosedPublishDate, isOpenPublishDay, nextPublishDayAfterUnlock } from './business-days.mjs';
import {
  findEarliestScheduledArticle,
  findPublishedOnDate,
  findScheduledOnDate,
} from './unlock-next-insight.mjs';
import { EDITORIAL_STATUSES } from './editorial-status.mjs';

export function findLatestScheduledArticle(schedule) {
  return (
    schedule.articles
      .filter((a) => a.status === EDITORIAL_STATUSES.SCHEDULED && a.publishAt)
      .sort((a, b) => new Date(b.publishAt).getTime() - new Date(a.publishAt).getTime())[0] || null
  );
}
import { rescheduleArticlePublishDay } from './reschedule-publish-day.mjs';

function heldPublishEntries(schedule) {
  const held = schedule?.policy?.heldPublishDates;
  return Array.isArray(held) ? held : [];
}

/**
 * A future slot that already has an explicit reservation.
 * Gap recovery must not move it onto an earlier open day.
 */
export function isReservedFuturePublication(article, now = new Date()) {
  if (!article || article.status !== EDITORIAL_STATUSES.SCHEDULED) return false;
  const slot = String(article.slotDate || article.scheduledPublishAt || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slot)) return false;
  return slot > toJstDateString(now);
}

/** A weekday left empty because an article was held, not cancelled. */
export function isHeldPublishDate(schedule, ymd) {
  const date = String(ymd || '').slice(0, 10);
  return heldPublishEntries(schedule).some((entry) => String(entry?.date || '').slice(0, 10) === date);
}

function heldPublishEntriesInWindow(schedule, startYmd, endYmd) {
  return heldPublishEntries(schedule).filter((entry) => {
    const date = String(entry?.date || '').slice(0, 10);
    if (!date) return false;
    if (startYmd && date < startYmd) return false;
    if (endYmd && date > endYmd) return false;
    return true;
  });
}

export function listWeekdayGaps(schedule, { startYmd, endYmd } = {}) {
  const gaps = [];
  let ymd = startYmd;
  while (ymd <= endYmd) {
    if (isOpenPublishDay(ymd) && !isHeldPublishDate(schedule, ymd)) {
      const scheduled = findScheduledOnDate(schedule, ymd);
      const published = findPublishedOnDate(schedule, ymd);
      if (!scheduled && !published) gaps.push(ymd);
    }
    ymd = nextPublishDayAfterUnlock(ymd);
  }
  return gaps;
}

export function findGapScanWindow(schedule, now = new Date()) {
  const todayYmd = toJstDateString(now);
  const earliest = findEarliestScheduledArticle(schedule);
  const latest = findLatestScheduledArticle(schedule);
  const startYmd = nextPublishDayAfterUnlock(todayYmd);
  const endYmd = latest?.publishAt?.slice(0, 10) || earliest?.publishAt?.slice(0, 10) || startYmd;
  return { startYmd, endYmd, earliest, latest };
}

/**
 * Pull the earliest future scheduled article onto the first gap day.
 */
export function recoverPublishDayGap({
  schedule,
  now = new Date(),
  maxPullForwardDays = 14,
  dryRun = false,
} = {}) {
  const { startYmd, endYmd } = findGapScanWindow(schedule, now);
  const gaps = listWeekdayGaps(schedule, { startYmd, endYmd });
  if (!gaps.length) {
    const held = heldPublishEntriesInWindow(schedule, startYmd, endYmd);
    if (held.length) {
      return {
        recovered: false,
        reason: held[0].reason || 'held_not_cancelled',
        held,
        startYmd,
        endYmd,
      };
    }
    return { recovered: false, reason: 'no_gap', startYmd, endYmd };
  }

  const gapYmd = gaps[0];
  if (!isOpenPublishDay(gapYmd) || isClosedPublishDate(gapYmd)) {
    return { recovered: false, reason: 'closed_publish_day', gaps, startYmd, endYmd, gapYmd };
  }
  if (isHeldPublishDate(schedule, gapYmd)) {
    const held = heldPublishEntries(schedule).find((entry) => String(entry?.date || '').slice(0, 10) === gapYmd);
    return {
      recovered: false,
      reason: held?.reason || 'held_not_cancelled',
      held,
      gaps,
      startYmd,
      endYmd,
      gapYmd,
    };
  }
  const candidate = schedule.articles
    .filter((a) => a.status === EDITORIAL_STATUSES.SCHEDULED && a.publishAt)
    .filter((a) => a.publishAt.slice(0, 10) > gapYmd)
    .sort((a, b) => new Date(a.publishAt).getTime() - new Date(b.publishAt).getTime())[0];
  if (!candidate?.publishAt) {
    return { recovered: false, reason: 'no_scheduled_candidate', gaps, startYmd, endYmd, gapYmd };
  }
  if (isReservedFuturePublication(candidate, now)) {
    return {
      recovered: false,
      reason: 'reserved_future_slot',
      slug: candidate.slug,
      gaps,
      startYmd,
      endYmd,
      gapYmd,
      earliestYmd: candidate.publishAt.slice(0, 10),
    };
  }

  const fromYmd = candidate.publishAt.slice(0, 10);
  const pullDays = Math.round(
    (new Date(`${fromYmd}T00:00:00+09:00`).getTime() - new Date(`${gapYmd}T00:00:00+09:00`).getTime()) /
    (24 * 60 * 60 * 1000),
  );
  if (pullDays <= 0 || pullDays > maxPullForwardDays) {
    return {
      recovered: false,
      reason: 'candidate_out_of_window',
      gaps,
      earliest: candidate.slug,
      earliestYmd: fromYmd,
      pullDays,
      startYmd,
      endYmd,
      gapYmd,
    };
  }

  if (dryRun) {
    return { recovered: true, dryRun: true, slug: candidate.slug, fromYmd, toYmd: gapYmd, gaps, startYmd, endYmd };
  }

  const result = rescheduleArticlePublishDay({ slug: candidate.slug, publishYmd: gapYmd, dryRun: false });
  return { recovered: true, ...result, fromYmd, toYmd: gapYmd, gaps, startYmd, endYmd };
}

/**
 * Fill every weekday gap before the earliest scheduled article by pull-forward.
 */
export function recoverAllPublishDayGaps({
  now = new Date(),
  maxPullForwardDays = 14,
  dryRun = false,
  maxIterations = 10,
} = {}) {
  const recoveries = [];
  for (let i = 0; i < maxIterations; i += 1) {
    const schedule = JSON.parse(fs.readFileSync(PATHS.schedule, 'utf8'));
    const recovery = recoverPublishDayGap({ schedule, now, maxPullForwardDays, dryRun });
    if (!recovery.recovered) {
      return { recovered: recoveries.length > 0, recoveries, last: recovery };
    }
    recoveries.push(recovery);
    if (dryRun) break;
  }
  return { recovered: recoveries.length > 0, recoveries };
}
