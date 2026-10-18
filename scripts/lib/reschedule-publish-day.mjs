/**
 * Move a scheduled article (and channel queues) to a new publish day.
 */
import fs from 'node:fs';
import { PATHS } from './insights-v2-paths.mjs';
import { EDITORIAL_STATUSES } from './editorial-status.mjs';
import { articleTimesForPublishDay, isOpenPublishDay } from './business-days.mjs';
import { buildChannelEntries } from './unlock-next-insight.mjs';
import { isSameBufferLedgerEntry, normalizePublicationDate } from './buffer-ledger.mjs';
import { upsertPlannedCard } from './unlock-next-insight.mjs';

export function rescheduleArticlePublishDay({
  slug,
  publishYmd,
  schedulePath = PATHS.schedule,
  bufferQueuePath = PATHS.bufferQueue,
  linkedinQueuePath = PATHS.linkedinQueue,
  insightsIndexPath = PATHS.insightsIndex,
  dryRun = false,
} = {}) {
  if (!slug || !publishYmd) throw new Error('slug and publishYmd are required');
  if (!isOpenPublishDay(publishYmd)) {
    throw new Error(`publish day is closed: ${publishYmd}`);
  }
  const schedule = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
  const article = schedule.articles.find((entry) => entry.slug === slug);
  if (!article) throw new Error(`schedule entry not found: ${slug}`);
  if (article.status !== EDITORIAL_STATUSES.SCHEDULED) {
    throw new Error(`article is not scheduled: ${slug} (${article.status})`);
  }

  const times = articleTimesForPublishDay(publishYmd);
  const previousYmd = article.publishAt?.slice(0, 10) || null;

  article.publishAt = times.web;
  article.slotDate = publishYmd;
  article.scheduledPublishAt = times.web;
  article.publicationId = article.publicationId?.replace(previousYmd?.replaceAll('-', '') || '', publishYmd.replaceAll('-', '')) ||
    `PUB-${publishYmd.replaceAll('-', '')}-DAILY-001`;

  let bufferQueue = null;
  if (fs.existsSync(bufferQueuePath)) {
    bufferQueue = JSON.parse(fs.readFileSync(bufferQueuePath, 'utf8'));
    const bufPost = bufferQueue.posts.find((post) => isSameBufferLedgerEntry(post, slug, previousYmd) || post.slug === slug);
    if (bufPost) {
      bufPost.articlePublishAt = times.web;
      bufPost.bufferTransferAt = times.bufferTransfer;
      bufPost.channels = buildChannelEntries(slug, times);
      bufPost.updatedAt = new Date().toISOString();
    }
  }

  let linkedinQueue = null;
  if (fs.existsSync(linkedinQueuePath)) {
    linkedinQueue = JSON.parse(fs.readFileSync(linkedinQueuePath, 'utf8'));
    const liPost = linkedinQueue.posts.find((post) => post.slug === slug);
    if (liPost) {
      liPost.id = `ARI-LI-CE-${slug}-${publishYmd}`;
      liPost.articlePublishAt = times.web;
      liPost.bufferTransferAt = times.bufferTransfer;
      liPost.linkedinPublishAt = times.linkedin;
      liPost.updatedAt = new Date().toISOString();
    }
  }

  let html = fs.readFileSync(insightsIndexPath, 'utf8');
  html = upsertPlannedCard(html, article, schedule);

  if (dryRun) {
    return { slug, publishYmd, previousYmd, times, updated: false, dryRun: true };
  }

  fs.writeFileSync(schedulePath, JSON.stringify(schedule, null, 2) + '\n', 'utf8');
  if (bufferQueue) fs.writeFileSync(bufferQueuePath, JSON.stringify(bufferQueue, null, 2) + '\n', 'utf8');
  if (linkedinQueue) fs.writeFileSync(linkedinQueuePath, JSON.stringify(linkedinQueue, null, 2) + '\n', 'utf8');
  fs.writeFileSync(insightsIndexPath, html, 'utf8');

  return { slug, publishYmd, previousYmd, times, updated: true };
}
