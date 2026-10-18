import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { articleTimesForPublishDay, businessDaysFrom } from '../lib/business-days.mjs';
import {
  applyEmergencyInsertion,
  bufferDepthState,
  futurePrimarySlots,
  planEmergencyInsertion,
  publicationEventFor,
  publicationIdFor,
  SLOT_TYPES,
} from '../lib/editorial-schedule-buffer.mjs';

function fixture(start = '2026-09-03') {
  const dates = businessDaysFrom(start, 5);
  return { articles: dates.map((date, i) => ({
    slug: `article-${i + 1}`,
    status: 'scheduled',
    slotDate: date,
    slotType: SLOT_TYPES.DAILY_PRIMARY,
    publishAt: articleTimesForPublishDay(date).web,
  })) };
}

function byDate(schedule) {
  return schedule.articles.filter((entry) => entry.publishAt).sort((a, b) => a.publishAt.localeCompare(b.publishAt));
}

test('A/B normal five-slot schedule and tomorrow insertion cascade', () => {
  const schedule = fixture();
  const plan = planEmergencyInsertion(schedule, { slug: 'urgent-x', targetDate: '2026-09-03' });
  assert.equal(plan.safe, true);
  assert.deepEqual(byDate(plan.after).map((entry) => [entry.slotDate, entry.slug]), [
    ['2026-09-03', 'urgent-x'], ['2026-09-04', 'article-1'], ['2026-09-07', 'article-2'],
    ['2026-09-08', 'article-3'], ['2026-09-09', 'article-4'], ['2026-09-10', 'article-5'],
  ]);
});

test('C/D business-day and month-boundary cascades skip weekends', () => {
  const weekend = planEmergencyInsertion(fixture('2026-09-04'), { slug: 'friday-urgent', targetDate: '2026-09-04' });
  assert.equal(weekend.after.articles.find((e) => e.slug === 'article-1').slotDate, '2026-09-07');
  const month = planEmergencyInsertion(fixture('2026-10-30'), { slug: 'month-urgent', targetDate: '2026-10-30' });
  assert.equal(month.after.articles.find((e) => e.slug === 'article-1').slotDate, '2026-11-02');
  assert.equal(month.after.articles.some((entry) => entry.slotDate === '2026-11-03'), false);
});

test('Culture Day is not a business day for emergency insertion', () => {
  const plan = planEmergencyInsertion(fixture('2026-11-02'), { slug: 'holiday-urgent', targetDate: '2026-11-03' });
  assert.equal(plan.safe, false);
  assert.equal(plan.reason, 'TARGET_DATE_NOT_BUSINESS_DAY');
});

test('E multiple insertions remain deterministic and lose no articles', () => {
  const first = planEmergencyInsertion(fixture(), { slug: 'urgent-a', targetDate: '2026-09-03' });
  const second = planEmergencyInsertion(first.after, { slug: 'urgent-b', targetDate: '2026-09-04' });
  assert.equal(second.safe, true);
  assert.deepEqual(new Set(second.after.articles.map((entry) => entry.slug)).size, 7);
  assert.equal(second.after.articles.filter((entry) => entry.slotType === SLOT_TYPES.DAILY_PRIMARY).length, 7);
});

test('F/G hero absent and existing hero both follow event date without regeneration', () => {
  const absent = planEmergencyInsertion(fixture(), { slug: 'urgent-x', targetDate: '2026-09-03' });
  assert.equal(absent.heroImpact.find((entry) => entry.slug === 'article-1').action, 'REUSE_IF_PRESENT');
  const existing = { ...fixture(), articles: fixture().articles.map((entry) => entry.slug === 'article-1' ? { ...entry, hero: 'canonical' } : entry) };
  const plan = planEmergencyInsertion(existing, { slug: 'urgent-x', targetDate: '2026-09-03' });
  assert.equal(plan.after.articles.find((entry) => entry.slug === 'article-1').hero, 'canonical');
});

test('H/I Buffer impact is safe when pending and fail-closed when queued', () => {
  const pending = planEmergencyInsertion(fixture(), { slug: 'urgent-x', targetDate: '2026-09-03', bufferQueue: [{ slug: 'article-1', articlePublishAt: '2026-09-04T10:00:00+09:00', status: 'scheduled', channels: {} }] });
  assert.equal(pending.safe, true);
  const queued = planEmergencyInsertion(fixture(), { slug: 'urgent-x', targetDate: '2026-09-03', bufferQueue: [{ slug: 'article-1', articlePublishAt: '2026-09-03T10:00:00+09:00', status: 'buffer_queued', channels: { linkedin: { bufferUpdateId: 'verified-id' } } }] });
  assert.equal(queued.safe, false);
  assert.equal(queued.reason, 'BUFFER_REPLAN_REQUIRED');
});

test('J target already published fails closed without mutation', () => {
  const schedule = fixture();
  schedule.articles[0].status = 'published';
  const before = JSON.stringify(schedule);
  const plan = planEmergencyInsertion(schedule, { slug: 'urgent-x', targetDate: '2026-09-03' });
  assert.equal(plan.reason, 'TARGET_SLOT_ALREADY_PUBLISHED');
  assert.equal(JSON.stringify(schedule), before);
});

test('K/L same slug different date is representable; same event is blocked', () => {
  const schedule = fixture();
  schedule.articles[1].slug = 'repeatable';
  const differentDate = planEmergencyInsertion(schedule, { slug: 'repeatable', targetDate: '2026-09-03' });
  assert.equal(differentDate.safe, true);
  const sameEvent = planEmergencyInsertion({ articles: [{ slug: 'repeatable', status: 'scheduled', slotDate: '2026-09-03', publishAt: '2026-09-03T10:00:00+09:00' }] }, { slug: 'repeatable', targetDate: '2026-09-03' });
  assert.equal(sameEvent.reason, 'DUPLICATE_PUBLICATION_EVENT');
});

test('M dry-run and O validation failure perform zero mutations', () => {
  const schedule = fixture();
  const before = JSON.stringify(schedule);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ari-esb-'));
  const schedulePath = path.join(dir, 'schedule.json');
  fs.writeFileSync(schedulePath, before);
  const dry = applyEmergencyInsertion({ schedulePath, slug: 'urgent-x', targetDate: '2026-09-03', dryRun: true });
  assert.equal(dry.safe, true);
  assert.equal(fs.readFileSync(schedulePath, 'utf8'), before);
  const plan = planEmergencyInsertion(schedule, { slug: 'urgent-x', targetDate: '2026-09-06' });
  assert.equal(plan.safe, false);
  assert.equal(JSON.stringify(schedule), before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('N repeated insertion is idempotent', () => {
  const first = planEmergencyInsertion(fixture(), { slug: 'urgent-x', targetDate: '2026-09-03' });
  const second = planEmergencyInsertion(first.after, { slug: 'urgent-x', targetDate: '2026-09-03' });
  assert.equal(second.safe, true);
  assert.equal(second.reason, 'ALREADY_APPLIED');
  assert.deepEqual(second.after, first.after);
});

test('publication IDs are stable event identities', () => {
  assert.equal(publicationIdFor('2026-09-03'), 'PUB-20260903-DAILY-001');
});

test('publication events derive the canonical social schedule and depth metric', () => {
  const schedule = fixture();
  const event = publicationEventFor(schedule.articles[0]);
  assert.equal(event.slotType, 'DAILY_PRIMARY');
  assert.equal(event.socialSchedule.linkedin, '2026-09-03T11:30:00+09:00');
  assert.equal(event.socialSchedule.facebook, '2026-09-03T11:45:00+09:00');
  assert.equal(event.socialSchedule.x, '2026-09-03T12:00:00+09:00');
  assert.equal(futurePrimarySlots(schedule, new Date('2026-09-02T01:00:00Z')), 5);
  assert.equal(bufferDepthState(5), 'HEALTHY');
  assert.equal(bufferDepthState(3), 'LOW');
  assert.equal(bufferDepthState(0), 'EMPTY');
});
