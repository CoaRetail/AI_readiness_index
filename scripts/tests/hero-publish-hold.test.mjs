import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applyMissingHeroHold,
  missingHeroHoldMessage,
  publishDueArticles,
} from '../lib/publish-scheduled-insights-core.mjs';
import { buildHealthReportMarkdown } from '../lib/publishing-reconcile.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEDULE_PATH = path.join(ROOT, 'insights/_scheduled/schedule.json');

test('missing hero hold keeps status and publishAt', () => {
  const entry = {
    slug: 'bing-edge-ai-mode-naming',
    status: 'scheduled',
    publishAt: '2026-10-13T10:00:00+09:00',
    packageReadiness: 'PACKAGE_READY',
    heroReadyAt: '2026-10-01T12:00:00.000Z',
  };
  applyMissingHeroHold(entry, { now: new Date('2026-10-13T01:00:00.000Z'), dryRun: false });
  assert.equal(entry.status, 'scheduled');
  assert.equal(entry.publishAt, '2026-10-13T10:00:00+09:00');
  assert.equal(entry.packageReadiness, 'HERO_PENDING');
  assert.equal(entry.lastPublishFailure, 'HERO_PENDING');
  assert.equal(entry.heroReadyAt, undefined);
  assert.match(missingHeroHoldMessage(entry.slug, entry.publishAt), /Not publishing web-only/);
  assert.match(missingHeroHoldMessage(entry.slug, entry.publishAt), /Slot remains scheduled/);
});

test('dry-run publish holds a due article when hero.webp is missing and does not write the schedule', () => {
  const before = fs.readFileSync(SCHEDULE_PATH);
  const indexBefore = fs.readFileSync(path.join(ROOT, 'insights/index.html'));
  const result = publishDueArticles({
    now: new Date('2026-10-13T10:00:00+09:00'),
    dryRun: true,
    heroExists: () => false,
  });
  assert.deepEqual(result.published, []);
  assert.equal(result.held[0]?.slug, 'bing-edge-ai-mode-naming');
  assert.equal(result.held[0].status, 'scheduled');
  assert.equal(result.held[0].publishAt, '2026-10-13T10:00:00+09:00');
  assert.match(result.errors[0], /HERO_PENDING_HOLD: bing-edge-ai-mode-naming/);
  assert.match(result.errors[0], /web-only/);
  assert.equal(fs.readFileSync(SCHEDULE_PATH).equals(before), true);
  assert.equal(fs.readFileSync(path.join(ROOT, 'insights/index.html')).equals(indexBefore), true);
  const health = buildHealthReportMarkdown({
    now: new Date('2026-10-13T10:00:00+09:00'),
    todayYmd: '2026-10-13',
    slug: 'bing-edge-ai-mode-naming',
    scheduleState: { status: 'scheduled', publishAt: '2026-10-13T10:00:00+09:00' },
    publishResult: result,
    pipelineStatus: 'WAITING',
  });
  assert.match(health, /hero hold/);
  assert.match(health, /web-only publish withheld/);
});
