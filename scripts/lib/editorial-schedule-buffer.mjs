import fs from 'node:fs';
import path from 'node:path';
import { businessDaysFrom, isoAtJst, isOpenPublishDay } from './business-days.mjs';
import { EDITORIAL_STATUSES } from './editorial-status.mjs';
import { isSameBufferLedgerEntry } from './buffer-ledger.mjs';
import { normalizeEditorialIntent } from './editorial-intent.mjs';

export const SLOT_TYPES = Object.freeze({ DAILY_PRIMARY: 'DAILY_PRIMARY' });
export const PUBLICATION_STATES = Object.freeze({
  PLANNED: 'PLANNED',
  SCHEDULED: 'SCHEDULED',
  PUBLISHING: 'PUBLISHING',
  PUBLISHED: 'PUBLISHED',
  CANCELLED: 'CANCELLED',
  SUPERSEDED: 'SUPERSEDED',
});

const DAILY_PRIMARY_TIME = '10:00';

export function publicationIdFor(slotDate, sequence = 1) {
  return `PUB-${slotDate.replaceAll('-', '')}-DAILY-${String(sequence).padStart(3, '0')}`;
}

export function publicationEventFor(entry) {
  const date = slotDateOf(entry);
  if (!date) return null;
  return {
    publicationId: entry.publicationId || publicationIdFor(date),
    slotDate: date,
    slotType: entry.slotType || SLOT_TYPES.DAILY_PRIMARY,
    slug: entry.slug,
    status: entry.publicationState || (isPublished(entry) ? PUBLICATION_STATES.PUBLISHED : PUBLICATION_STATES.SCHEDULED),
    scheduledPublishAt: entry.scheduledPublishAt || entry.publishAt,
    socialSchedule: {
      linkedin: isoAtJst(date, '11:30'),
      facebook: isoAtJst(date, '11:45'),
      x: isoAtJst(date, '12:00'),
    },
  };
}

export function futurePrimarySlots(schedule, now = new Date()) {
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
  return (schedule?.articles || []).filter((entry) => {
    const date = slotDateOf(entry);
    return isPrimaryCandidate(entry) && date > today && !isPublished(entry);
  }).length;
}

export function bufferDepthState(count) {
  return count >= 5 ? 'HEALTHY' : count > 0 ? 'LOW' : 'EMPTY';
}

function slotDateOf(entry) {
  return entry?.slotDate || entry?.publishAt?.slice(0, 10) || entry?.scheduledPublishAt?.slice(0, 10) || null;
}

function isPublished(entry) {
  return entry?.status === EDITORIAL_STATUSES.PUBLISHED || entry?.publicationState === PUBLICATION_STATES.PUBLISHED;
}

function isPrimaryCandidate(entry) {
  return entry?.slotType === SLOT_TYPES.DAILY_PRIMARY || Boolean(entry?.publishAt);
}

function eventFor(entry, date, sequence = 1, { preservePublicationId = true } = {}) {
  const scheduledPublishAt = isoAtJst(date, DAILY_PRIMARY_TIME);
  return {
    ...entry,
    publicationId: preservePublicationId && entry.publicationId ? entry.publicationId : publicationIdFor(date, sequence),
    slotDate: date,
    slotType: SLOT_TYPES.DAILY_PRIMARY,
    scheduledPublishAt,
    publishAt: scheduledPublishAt,
    publicationState: entry.publicationState || (isPublished(entry) ? PUBLICATION_STATES.PUBLISHED : PUBLICATION_STATES.SCHEDULED),
  };
}

function channelHasBufferIdentity(post) {
  return Object.values(post?.channels || {}).some((channel) => Boolean(channel?.bufferUpdateId));
}

function bufferImpactFor(entry, bufferQueue) {
  const date = slotDateOf(entry);
  const post = bufferQueue.find((candidate) => isSameBufferLedgerEntry(candidate, entry.slug, date));
  if (!post) return { slug: entry.slug, publicationDate: date, state: 'NOT_QUEUED', bufferReplanRequired: false };
  const queued = channelHasBufferIdentity(post) || post.status === 'buffer_queued' || post.status === 'partially_queued';
  return {
    slug: entry.slug,
    publicationDate: date,
    state: queued ? 'QUEUED' : 'PENDING',
    bufferReplanRequired: queued,
    bufferUpdateIds: Object.values(post.channels || {}).map((channel) => channel?.bufferUpdateId).filter(Boolean),
  };
}

function validatePlan(schedule, proposed, { slug, targetDate, slotType }) {
  const errors = [];
  if (!slug || !/^[-a-z0-9]+$/.test(slug)) errors.push('INVALID_SLUG');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate || '')) errors.push('INVALID_TARGET_DATE');
  if (slotType !== SLOT_TYPES.DAILY_PRIMARY) errors.push('UNSUPPORTED_SLOT_TYPE');
  if (targetDate && !isOpenPublishDay(targetDate)) errors.push('TARGET_DATE_NOT_BUSINESS_DAY');

  const target = schedule.articles.find((entry) => slotDateOf(entry) === targetDate && isPrimaryCandidate(entry));
  if (target && isPublished(target)) errors.push('TARGET_SLOT_ALREADY_PUBLISHED');

  const sameEvent = schedule.articles.find((entry) => entry.slug === slug && slotDateOf(entry) === targetDate);
  if (sameEvent) errors.push('DUPLICATE_PUBLICATION_EVENT');

  const ids = new Set();
  const dates = new Set();
  for (const entry of proposed) {
    if (!isPrimaryCandidate(entry)) continue;
    const date = slotDateOf(entry);
    if (!date) continue;
    const publicationId = entry.publicationId || publicationIdFor(date);
    const dateKey = `${date}::${entry.slotType || SLOT_TYPES.DAILY_PRIMARY}`;
    if (dates.has(dateKey)) errors.push(`DUPLICATE_PRIMARY_SLOT:${date}`);
    dates.add(dateKey);
    if (ids.has(publicationId)) errors.push(`DUPLICATE_PUBLICATION_ID:${publicationId}`);
    ids.add(publicationId);
  }

  return { errors };
}

export function planEmergencyInsertion(schedule, {
  slug,
  targetDate,
  slotType = SLOT_TYPES.DAILY_PRIMARY,
  bufferQueue = [],
  editorialIntent = null,
} = {}) {
  const before = structuredClone(schedule);
  const entries = schedule.articles || [];
  const target = entries.find((entry) => slotDateOf(entry) === targetDate && isPrimaryCandidate(entry));
  if (target && isPublished(target)) {
    return { safe: false, reason: 'TARGET_SLOT_ALREADY_PUBLISHED', before, after: before, displaced: [], bufferImpact: [] };
  }
  if (target && target.slug === slug && target.publicationId === publicationIdFor(targetDate)) {
    return { safe: true, reason: 'ALREADY_APPLIED', before, after: before, displaced: [], bufferImpact: [], idempotent: true };
  }

  const ordered = entries
    .filter((entry) => isPrimaryCandidate(entry) && !isPublished(entry) && slotDateOf(entry) && slotDateOf(entry) >= targetDate)
    .sort((a, b) => slotDateOf(a).localeCompare(slotDateOf(b)));
  const dates = businessDaysFrom(targetDate, ordered.length + 1);
  const proposedEntries = entries.map((entry) => ({ ...entry }));
  const shifts = new Map();
  ordered.forEach((entry, index) => shifts.set(entry.slug, dates[index + 1]));

  for (const entry of proposedEntries) {
    const shiftedDate = shifts.get(entry.slug);
    if (shiftedDate && !isPublished(entry)) Object.assign(entry, eventFor(entry, shiftedDate, 1, { preservePublicationId: false }));
  }
  const normalizedIntent = normalizeEditorialIntent(editorialIntent);
  proposedEntries.push(eventFor({
    slug,
    status: EDITORIAL_STATUSES.SCHEDULED,
    publicationState: PUBLICATION_STATES.SCHEDULED,
    ...(normalizedIntent ? { editorialIntent: normalizedIntent } : {}),
  }, targetDate));
  proposedEntries.sort((a, b) => {
    const ad = slotDateOf(a) || '9999-99-99';
    const bd = slotDateOf(b) || '9999-99-99';
    return ad.localeCompare(bd) || String(a.slug).localeCompare(String(b.slug));
  });

  const proposed = { ...before, articles: proposedEntries };
  const validation = validatePlan(before, proposedEntries, { slug, targetDate, slotType });
  const displaced = ordered.map((entry) => ({ slug: entry.slug, from: slotDateOf(entry), to: shifts.get(entry.slug) }));
  const bufferImpact = ordered.map((entry) => bufferImpactFor(entry, bufferQueue));
  if (bufferImpact.some((impact) => impact.bufferReplanRequired)) {
    validation.errors.push('BUFFER_REPLAN_REQUIRED');
  }
  return {
    safe: validation.errors.length === 0,
    reason: validation.errors[0] || 'OK',
    errors: validation.errors,
    before,
    after: validation.errors.length === 0 ? proposed : before,
    displaced,
    bufferImpact,
    heroImpact: displaced.map(({ slug: displacedSlug }) => ({ slug: displacedSlug, action: 'REUSE_IF_PRESENT' })),
  };
}

export function applyEmergencyInsertion({ schedulePath, ...options }) {
  const schedule = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
  const plan = planEmergencyInsertion(schedule, options);
  if (options.dryRun || !plan.safe) return plan;
  const tempPath = path.join(path.dirname(schedulePath), `.${path.basename(schedulePath)}.${process.pid}.tmp`);
  fs.writeFileSync(tempPath, JSON.stringify(plan.after, null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, schedulePath);
  return { ...plan, applied: true };
}
