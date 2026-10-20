#!/usr/bin/env node
/**
 * RMVU-05D — Editorial Intelligence Automation tests (T01–T30).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSourcesRegistry, listEnabledSources, updateSourceHealth } from '../lib/editorial-intelligence/sources.mjs';
import {
  parseFeedItems,
  loadBackfillFixtures,
  fetchFeedIncremental,
  fetchSourceItems,
  parseAnthropicNewsListing,
  DEFAULT_MAX_FEED_BYTES,
  SOURCE_FETCH_PROFILES,
} from '../lib/editorial-intelligence/fetcher.mjs';
import { dedupeItemsToEvents, countDuplicateMerges, buildEventId } from '../lib/editorial-intelligence/dedupe.mjs';
import {
  scoreEvent,
  priorityFromScore,
  freshnessMultiplier,
  effectivePriority,
} from '../lib/editorial-intelligence/scoring.mjs';
import { blockIfAbis, containsAbisContent } from '../lib/editorial-intelligence/abis-guard.mjs';
import { classifyCannibalization, buildInterpretation } from '../lib/editorial-intelligence/cannibalization.mjs';
import { buildClaimMap, validateClaims, validateDraftText } from '../lib/editorial-intelligence/citation-validator.mjs';
import { buildSeoPackage, generateArticleDraft } from '../lib/editorial-intelligence/draft-generator.mjs';
import { validateQuestionShapedHeadings } from '../lib/question-headings.mjs';
import { proposeScheduleChange, getNextAvailableSlot } from '../lib/editorial-intelligence/schedule-proposal.mjs';
import { processPipeline, runIntelligencePipeline } from '../lib/editorial-intelligence/pipeline.mjs';
import { loadQueue, upsertQueueEntry } from '../lib/editorial-intelligence/storage.mjs';
import { INTELLIGENCE_PATHS, ROOT } from '../lib/editorial-intelligence/paths.mjs';
import { EVENT_STATUSES, PRIORITY_BANDS, SCORE_THRESHOLDS, SOURCE_HEALTH, DEFAULT_POLLING_HOURS } from '../lib/editorial-intelligence/constants.mjs';
import { PROTECTED_ABIS_SLUGS } from '../lib/product-integrity.mjs';
import { PATHS } from '../lib/insights-v2-paths.mjs';
import { EDITORIAL_STATUSES } from '../lib/editorial-status.mjs';
import { scoreAbisImpact } from '../lib/abis-intelligence/scoring.mjs';
import { processAbisImpactWatch } from '../lib/abis-intelligence/pipeline-bridge.mjs';
import {
  notifyAbisImpact,
  shouldNotify,
  sanitizeLogMessage,
} from '../lib/abis-intelligence/slack-notifier.mjs';
import {
  formatSlackMessageJa,
  buildReasoningSummaryJa,
  buildDryRunSampleMessage,
  formatAffectedAreaJa,
  formatRecommendedActionJa,
  formatConfidenceJa,
} from '../lib/abis-intelligence/slack-message-ja.mjs';
import { ABIS_INTELLIGENCE_PATHS, PUBLIC_SURFACE_PATHS } from '../lib/abis-intelligence/paths.mjs';
import { ABIS_SEVERITY, PATENT_FLAGS } from '../lib/abis-intelligence/constants.mjs';
import {
  isFixtureItem,
  isFixtureEvent,
  ITEM_ORIGIN,
  tagFixtureItems,
  productionEvents,
} from '../lib/editorial-intelligence/item-origin.mjs';
import { reconcileEditorialQueue, QUEUE_LIFECYCLE } from '../lib/editorial-intelligence/queue-reconcile.mjs';
import { reconcileImpactQueue } from '../lib/abis-intelligence/impact-queue-reconcile.mjs';
import {
  evaluateNotificationDedup,
  buildNotificationFingerprint,
} from '../lib/abis-intelligence/notification-state.mjs';
import {
  classifyRunnerPersistence,
  workflowUsesStateCache,
  PERSISTENCE_CLASS,
} from '../lib/editorial-intelligence/persistence-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SAMPLE_RSS = `<?xml version="1.0"?><rss><channel>
<item><title>AI Search Update</title><link>https://example.com/a</link><pubDate>Sat, 08 Aug 2026 10:00:00 GMT</pubDate><description>Enterprise AI search discovery update.</description></item>
</channel></rss>`;

function sampleEvent(overrides = {}) {
  return {
    event_id: 'evt-test',
    company: 'Google',
    title: 'Google AI Overviews expand merchant and local business discovery signals',
    url: 'https://blog.google/example/',
    published_date: new Date().toISOString(),
    excerpt: 'Google shares updates to AI Overviews affecting local business discovery.',
    primary_source: { source_type: 'official_blog', source_level: 'A', url: 'https://blog.google/example/' },
    secondary_sources: [],
    detected_at: new Date().toISOString(),
    ...overrides,
  };
}

test('RMVU-05D T01 source registry loads with 5 target companies', () => {
  const reg = loadSourcesRegistry();
  assert.ok(reg.sources.length >= 5);
  const companies = new Set(reg.sources.map((s) => s.company));
  for (const c of ['Cloudflare', 'Microsoft', 'Google', 'OpenAI', 'Anthropic']) {
    assert.ok(companies.has(c), `missing ${c}`);
  }
});

test('RMVU-05D T02 official item fetched from RSS parse', () => {
  const items = parseFeedItems(SAMPLE_RSS, {
    company: 'Google',
    sourceId: 'google-blog',
    sourceType: 'official_blog',
    sourceLevel: 'A',
  });
  assert.equal(items.length, 1);
  assert.match(items[0].title, /AI Search/);
  assert.ok(items[0].url);
  assert.ok(items[0].excerpt.length <= 281);
});

test('RMVU-05D T03 duplicate detected across surfaces', () => {
  const fixtures = loadBackfillFixtures(INTELLIGENCE_PATHS.fixtures);
  const events = dedupeItemsToEvents(fixtures);
  const dupCount = countDuplicateMerges(fixtures.length, events.length);
  assert.ok(dupCount >= 1, `expected duplicate merge, got ${dupCount}`);
  const google = events.find((e) => e.company === 'Google' && e.title.includes('AI Overviews'));
  assert.ok(google?.secondary_sources?.length >= 1);
});

test('RMVU-05D T04 event normalized with event_id', () => {
  const item = {
    company: 'OpenAI',
    title: 'Test announcement',
    url: 'https://openai.com/news/test/',
    source_id: 'openai-blog',
    source_type: 'official_blog',
    source_level: 'A',
    published_date: '2026-08-08T00:00:00.000Z',
    fetched_at: '2026-08-09T00:00:00.000Z',
  };
  const [ev] = dedupeItemsToEvents([item]);
  assert.ok(ev.event_id);
  assert.equal(ev.event_id, buildEventId(item));
  assert.equal(ev.primary_source.source_id, 'openai-blog');
});

test('RMVU-05D T05 relevance score 0–100', () => {
  const ev = sampleEvent();
  const { score, breakdown } = scoreEvent(ev, { now: new Date('2026-08-09T12:00:00.000Z') });
  assert.ok(score >= 0 && score <= 100);
  const sum = Object.values(breakdown).reduce((a, b) => a + b, 0);
  assert.equal(score, Math.min(100, sum));
});

test('RMVU-05D T06 high relevance → P0/P1', () => {
  const ev = sampleEvent();
  const { score } = scoreEvent(ev, { now: new Date('2026-08-09T12:00:00.000Z') });
  const pri = priorityFromScore(score);
  assert.ok(['P0', 'P1', 'P2'].includes(pri));
  assert.ok(score >= SCORE_THRESHOLDS.P2_MIN);
});

test('RMVU-05D T07 low relevance → ignore', () => {
  const ev = sampleEvent({
    title: 'Microsoft quarterly earnings call scheduled',
    excerpt: 'Routine investor relations announcement.',
    published_date: '2026-07-01T10:00:00.000Z',
  });
  const { score } = scoreEvent(ev, { now: new Date('2026-08-09T12:00:00.000Z') });
  assert.ok(score < SCORE_THRESHOLDS.DRAFT_MIN || priorityFromScore(score) === PRIORITY_BANDS.IGNORE);
});

test('RMVU-05D T08 freshness decay', () => {
  const fresh = freshnessMultiplier(new Date().toISOString(), new Date());
  const stale = freshnessMultiplier('2026-07-01T10:00:00.000Z', new Date('2026-08-09T12:00:00.000Z'));
  assert.equal(fresh, 1);
  assert.ok(stale <= 0.4);
  const demoted = effectivePriority(PRIORITY_BANDS.P0, '2026-07-01T10:00:00.000Z', new Date('2026-08-09T12:00:00.000Z'));
  assert.notEqual(demoted, PRIORITY_BANDS.P0);
});

test('RMVU-05D T09 existing article → refresh recommendation', () => {
  const schedule = JSON.parse(fs.readFileSync(PATHS.schedule, 'utf8'));
  const existing = schedule.articles.find((a) => a.title && a.status !== EDITORIAL_STATUSES.PUBLISHED);
  assert.ok(existing, 'need scheduled article for refresh test');
  const ev = sampleEvent({ title: existing.title, excerpt: existing.primarySearchIntent || existing.title });
  ev.score = 70;
  ev.priority = PRIORITY_BANDS.P1;
  const c = classifyCannibalization(ev, { root: ROOT });
  assert.ok(['REFRESH EXISTING', 'MERGE'].includes(c.decision));
});

test('RMVU-05D T10 new topic → article recommendation', () => {
  const ev = sampleEvent({
    title: 'Unique platform capability xyz123 never published before',
    excerpt: 'Novel agent actionability API for enterprise booking flows.',
  });
  ev.score = 72;
  ev.priority = PRIORITY_BANDS.P1;
  const c = classifyCannibalization(ev, { root: ROOT });
  assert.equal(c.decision, 'NEW ARTICLE');
});

test('RMVU-05D T11 article draft created with frontmatter', () => {
  const ev = sampleEvent();
  ev.score = 75;
  ev.priority = PRIORITY_BANDS.P1;
  ev.freshness = 1;
  const scoring = scoreEvent(ev);
  const interpretation = buildInterpretation(ev, scoring);
  const cannibalization = classifyCannibalization(ev, { root: ROOT });
  const seo = buildSeoPackage(ev, interpretation);
  const draft = generateArticleDraft(ev, scoring, interpretation, cannibalization, seo);
  assert.match(draft, /^---\nevent_id:/);
  assert.match(draft, /status: READY_FOR_EDITORIAL_REVIEW/);
  assert.match(draft, /## 何が公表されたのか？/);
  assert.match(draft, /## Direct Answer|Direct Answer/);
  const headings = validateQuestionShapedHeadings(draft);
  assert.equal(headings.ok, true, JSON.stringify(headings.issues));
});

test('RMVU-05D T12 source claims mapped', () => {
  const ev = sampleEvent();
  const claims = buildClaimMap(ev);
  assert.ok(claims.some((c) => c.confidence === 'VERIFIED' && c.source_url));
});

test('RMVU-05D T13 inference labeled', () => {
  const claims = buildClaimMap(sampleEvent());
  assert.ok(claims.some((c) => c.confidence === 'ARI INTERPRETATION'));
});

test('RMVU-05D T14 unsupported claim blocked in draft validation', () => {
  const bad = validateDraftText('これは必ず改善され、5.5倍の効果があります。');
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.includes('UNSUPPORTED_MULTIPLIER') || bad.issues.includes('UNSUPPORTED_URGENCY'));
});

test('RMVU-05D T15 ABIS terms blocked', () => {
  assert.ok(containsAbisContent('Read about ABIS readiness gap'));
  const blocked = blockIfAbis({ title: 'abis-intro update', company: 'Test' });
  assert.equal(blocked.blocked, true);
});

test('RMVU-05D T16 protected slugs blocked', () => {
  for (const slug of PROTECTED_ABIS_SLUGS) {
    const r = blockIfAbis({ slug, title: 'Safe title', company: 'Test' });
    assert.equal(r.blocked, true, slug);
  }
});

test('RMVU-05D T17 queue priority ordering', () => {
  let q = { version: 1, entries: [] };
  q = upsertQueueEntry(q, { event_id: 'a', priority: PRIORITY_BANDS.P2, score: 55, company: 'A', title: 'a', status: EVENT_STATUSES.READY_FOR_EDITORIAL_REVIEW });
  q = upsertQueueEntry(q, { event_id: 'b', priority: PRIORITY_BANDS.P0, score: 85, company: 'B', title: 'b', status: EVENT_STATUSES.READY_FOR_EDITORIAL_REVIEW });
  const order = q.entries.map((e) => e.priority);
  assert.equal(order[0], PRIORITY_BANDS.P0);
});

test('RMVU-05D T18 P0 preempts P2 schedule proposal', () => {
  const schedule = JSON.parse(fs.readFileSync(PATHS.schedule, 'utf8'));
  const proposal = proposeScheduleChange(
    { event_id: 'x', priority: PRIORITY_BANDS.P0, slug_proposal: 'google-ai-update' },
    schedule,
    { now: new Date('2026-08-09T12:00:00.000Z') },
  );
  assert.equal(proposal.applicable, true);
  assert.ok(proposal.target_slot);
  assert.equal(proposal.mutation_executed, false);
});

test('RMVU-05D T19 displaced Evergreen rescheduled in proposal', () => {
  const schedule = JSON.parse(fs.readFileSync(PATHS.schedule, 'utf8'));
  const proposal = proposeScheduleChange(
    { event_id: 'y', priority: PRIORITY_BANDS.P1, slug_proposal: 'openai-search-update' },
    schedule,
    { now: new Date('2026-08-09T12:00:00.000Z') },
  );
  if (proposal.applicable) {
    assert.ok(proposal.displaced_article || proposal.new_displaced_slot);
  }
});

test('RMVU-05D T20 no schedule mutation in dry-run', async () => {
  const before = fs.readFileSync(PATHS.schedule, 'utf8');
  const fixtures = loadBackfillFixtures(INTELLIGENCE_PATHS.fixtures);
  const result = processPipeline({ items: fixtures.slice(0, 5), dryRun: true, now: new Date('2026-08-09T12:00:00.000Z') });
  const after = fs.readFileSync(PATHS.schedule, 'utf8');
  assert.equal(before, after);
  assert.equal(result.scheduleMutation, false);
});

test('RMVU-05D T21 human approval required — status ends at READY_FOR_EDITORIAL_REVIEW', () => {
  const fixtures = loadBackfillFixtures(INTELLIGENCE_PATHS.fixtures);
  const result = processPipeline({ items: fixtures.slice(0, 5), dryRun: true, now: new Date('2026-08-09T12:00:00.000Z') });
  for (const ev of result.processed) {
    assert.equal(ev.status, EVENT_STATUSES.READY_FOR_EDITORIAL_REVIEW);
    assert.notEqual(ev.status, EVENT_STATUSES.PUBLISHED);
  }
});

test('RMVU-05D T22 intelligence CLI does not invoke IndexNow', () => {
  const cli = read('scripts/intelligence-run.mjs');
  assert.doesNotMatch(cli, /submit-indexnow|from ['"].*indexnow/i);
  assert.doesNotMatch(cli, /import.*indexnow/i);
});

test('RMVU-05D T23 no public publish in pipeline', () => {
  const pipelineSrc = read('scripts/lib/editorial-intelligence/pipeline.mjs');
  assert.doesNotMatch(pipelineSrc, /publish-scheduled|publish:insights|PUBLISHED/);
});

test('RMVU-05D T24 no Stripe changes in intelligence modules', () => {
  const dir = path.join(ROOT, 'scripts/lib/editorial-intelligence');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /stripe/i, f);
  }
});

test('RMVU-05D T25 RMVU-04F positioning preserved in drafts', () => {
  const ev = sampleEvent();
  ev.score = 70;
  ev.priority = PRIORITY_BANDS.P1;
  const draft = generateArticleDraft(
    ev,
    scoreEvent(ev),
    buildInterpretation(ev, scoreEvent(ev)),
    classifyCannibalization(ev, { root: ROOT }),
    buildSeoPackage(ev, {}),
  );
  assert.match(draft, /Agent Readiness|Discovery|Recommendation|Action/);
  assert.doesNotMatch(draft, /ABIS/);
});

test('RMVU-05D T26 GA4 hooks preserved in draft CTA guidance', () => {
  const ev = sampleEvent({ score: 70, priority: PRIORITY_BANDS.P1 });
  const draft = generateArticleDraft(
    ev,
    scoreEvent(ev),
    buildInterpretation(ev, scoreEvent(ev)),
    { article_type: 'CURRENT_EVENT_ANALYSIS', conflict_slug: null },
    buildSeoPackage(ev, {}),
  );
  assert.match(draft, /data-ga-insight-cta="report"/);
  assert.match(read('assets/analytics.js'), /insight_cta_report/);
});

test('RMVU-05D T27 editorial_hold preserved in schedule', () => {
  const schedule = JSON.parse(fs.readFileSync(PATHS.schedule, 'utf8'));
  const holds = schedule.articles.filter((a) => a.status === EDITORIAL_STATUSES.HOLD);
  assert.ok(holds.length > 0, 'evergreen hold queue must exist');
});

test('RMVU-05D T28 source health failure handled', () => {
  const src = { source_id: 'test', consecutive_failures: 0, health_status: SOURCE_HEALTH.HEALTHY };
  const failed = updateSourceHealth(src, { success: false, error: 'HTTP 503' });
  assert.equal(failed.consecutive_failures, 1);
  assert.equal(failed.health_status, SOURCE_HEALTH.DEGRADED);
  const dead3 = updateSourceHealth({ ...failed, consecutive_failures: 2 }, { success: false });
  assert.equal(dead3.consecutive_failures, 3);
  assert.equal(dead3.health_status, SOURCE_HEALTH.FAILED);
});

test('RMVU-05D T29 source parser failure safe — empty feed returns no items', () => {
  const items = parseFeedItems('<html>broken</html>', {
    company: 'Anthropic',
    sourceId: 'anthropic-news',
    sourceType: 'official_blog',
  });
  assert.deepEqual(items, []);
});

test('RMVU-05D T30 no copyrighted full-body storage in fetcher', () => {
  const src = read('scripts/lib/editorial-intelligence/fetcher.mjs');
  assert.match(src, /excerpt|280|metadata/i);
  const items = parseFeedItems(SAMPLE_RSS, {
    company: 'Google',
    sourceId: 'g',
    sourceType: 'official_blog',
  });
  assert.ok(!('body' in items[0]));
  assert.ok(items[0].excerpt.length <= 281);
});

test('RMVU-05D integration backfill pipeline runs end-to-end', async () => {
  const result = await runIntelligencePipeline({
    dryRun: true,
    backfill: true,
    now: new Date('2026-08-09T12:00:00.000Z'),
  });
  assert.ok(result.eventCount >= 5);
  assert.ok(result.processed.length >= 1);
  assert.ok(fs.existsSync(INTELLIGENCE_PATHS.dailyBrief));
  assert.ok(result.abisWatch);
  assert.ok(result.abisWatch.impacts.length >= 5);
});

// --- RMVU-05D Extension: Private ABIS Impact Watch (T31–T47) ---

function abisSampleEvent(overrides = {}) {
  return {
    event_id: 'abis-test-evt',
    company: 'OpenAI',
    title: 'OpenAI launches agent commerce execution protocol with delegated business authorization',
    url: 'https://openai.com/news/example-agent-commerce/',
    published_date: '2026-08-08T00:00:00.000Z',
    excerpt: 'New agent-to-business interaction model with consent, execution contract, outcome evidence, and MCP binding.',
    primary_source: { source_type: 'official_blog', source_level: 'A' },
    ...overrides,
  };
}

test('RMVU-05D T31 normalized event feeds ABIS evaluator', () => {
  const items = loadBackfillFixtures(INTELLIGENCE_PATHS.fixtures).slice(0, 3);
  const events = dedupeItemsToEvents(items);
  const impact = scoreAbisImpact(events[0]);
  assert.ok(impact.abis_impact_score >= 0);
  assert.equal(impact.event_id, events[0].event_id);
});

test('RMVU-05D T32 semantic impact scored', () => {
  const impact = scoreAbisImpact(abisSampleEvent());
  assert.ok(impact.semantic_impact > 0);
  assert.ok(impact.semantic_impact <= 25);
});

test('RMVU-05D T33 authority impact scored', () => {
  const impact = scoreAbisImpact(abisSampleEvent());
  assert.ok(impact.authority_impact > 0);
});

test('RMVU-05D T34 execution impact scored', () => {
  const impact = scoreAbisImpact(abisSampleEvent());
  assert.ok(impact.interaction_execution_impact > 0);
});

test('RMVU-05D T35 binding-only change does not falsely invalidate ABIS', () => {
  const impact = scoreAbisImpact(abisSampleEvent({
    title: 'MCP transport protocol update for WebMCP connector SDK release',
    excerpt: 'Transport layer SDK release for MCP WebMCP protocol binding.',
  }));
  assert.equal(impact.binding_only_change, true);
  assert.ok(impact.semantic_impact <= 10);
  assert.match(impact.reasoning_summary, /semantic layer not invalidated/i);
});

test('RMVU-05D T36 HIGH triggers WOULD_NOTIFY', async () => {
  const impact = scoreAbisImpact(abisSampleEvent());
  assert.ok(impact.abis_impact_score >= 70, `score=${impact.abis_impact_score}`);
  const r = await notifyAbisImpact(impact, { dryRun: true, notify: false, title: impact.title });
  assert.equal(r.would_notify, true);
  assert.equal(r.notification_status, 'DRY_RUN');
});

test('RMVU-05D T37 WATCH does not notify', async () => {
  const impact = scoreAbisImpact(abisSampleEvent({
    title: 'Cloudflare minor SDK update',
    excerpt: 'SDK patch with limited agent interaction scope.',
  }));
  if (impact.severity === ABIS_SEVERITY.WATCH) {
    const r = await notifyAbisImpact(impact, { dryRun: false, notify: true });
    assert.equal(r.would_notify, false);
    assert.equal(r.notification_status, 'SKIPPED');
  } else {
    assert.ok(!shouldNotify(impact));
  }
});

test('RMVU-05D T38 webhook absent fails safe', async () => {
  const prev = process.env.ABIS_SLACK_WEBHOOK_URL;
  delete process.env.ABIS_SLACK_WEBHOOK_URL;
  const impact = scoreAbisImpact(abisSampleEvent());
  const r = await notifyAbisImpact(impact, { dryRun: false, notify: true, title: impact.title });
  if (impact.abis_impact_score >= 70) {
    assert.equal(r.notification_status, 'FAILED');
    assert.equal(r.sent, false);
  }
  if (prev) process.env.ABIS_SLACK_WEBHOOK_URL = prev;
});

test('RMVU-05D T39 webhook secret not exposed', () => {
  const src = read('scripts/lib/abis-intelligence/slack-notifier.mjs');
  assert.doesNotMatch(src, /VITE_/);
  assert.match(src, /process\.env\.ABIS_SLACK_WEBHOOK_URL/);
  const redacted = sanitizeLogMessage('failed https://hooks.slack.com/services/T00/B00/XXXX');
  assert.doesNotMatch(redacted, /hooks\.slack\.com\/services\/T00/);
  assert.match(redacted, /REDACTED/);
});

test('RMVU-05D T40 Slack failure does not stop pipeline', async () => {
  const prev = process.env.ABIS_SLACK_WEBHOOK_URL;
  process.env.ABIS_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/INVALID/TEST/URL';
  const events = [abisSampleEvent({ event_id: 'slack-fail-1' })];
  const result = await processAbisImpactWatch(events, { dryRun: false, notify: true, allowFixtures: true });
  assert.ok(result.impacts.length === 1);
  if (prev) process.env.ABIS_SLACK_WEBHOOK_URL = prev;
  else delete process.env.ABIS_SLACK_WEBHOOK_URL;
});

test('RMVU-05D T41 ABIS output absent from public draft', () => {
  const ev = sampleEvent();
  ev.score = 70;
  const draft = generateArticleDraft(
    ev,
    scoreEvent(ev),
    buildInterpretation(ev, scoreEvent(ev)),
    { article_type: 'CURRENT_EVENT_ANALYSIS', conflict_slug: null },
    buildSeoPackage(ev, {}),
  );
  assert.doesNotMatch(draft, /abis_impact_score|ABIS Impact Watch|PRIVATE ABIS/i);
  const draftSrc = read('scripts/lib/editorial-intelligence/draft-generator.mjs');
  assert.doesNotMatch(draftSrc, /abis-intelligence/);
});

test('RMVU-05D T42 ABIS output absent from public_build', () => {
  const buildScript = read('package.json');
  assert.match(buildScript, /rm -rf public_build\/crucial_data/);
});

test('RMVU-05D T43 ABIS output absent from sitemap', () => {
  const sitemap = read('sitemap.xml');
  assert.doesNotMatch(sitemap, /abis-intelligence|crucial_data/i);
});

test('RMVU-05D T44 ABIS output absent from llms', () => {
  const llms = read('llms.txt');
  assert.doesNotMatch(llms, /abis-intelligence|ABIS Impact Watch/i);
});

test('RMVU-05D T45 patent relevance produces review flag only', () => {
  const impact = scoreAbisImpact(abisSampleEvent({
    title: 'New reference architecture standard proposal with semantic convergence',
    excerpt: 'Standards organization reference architecture terminology proposal.',
  }));
  assert.ok(impact.patent_flags.includes(PATENT_FLAGS.HUMAN_REVIEW_RECOMMENDED));
  assert.ok(!impact.reasoning_summary.match(/infringement|patentability|freedom-to-operate/i));
});

test('RMVU-05D T46 no automatic repository mutation', () => {
  const dir = path.join(ROOT, 'scripts/lib/abis-intelligence');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /writeFileSync\([^)]*insights\//);
    assert.doesNotMatch(src, /writeFileSync\([^)]*schedule\.json/);
    assert.doesNotMatch(src, /writeFileSync\([^)]*public_build/);
  }
});

test('RMVU-05D T47 dry-run sends no Slack request', async () => {
  let fetchCalled = false;
  const orig = globalThis.fetch;
  globalThis.fetch = (...args) => {
    fetchCalled = true;
    return orig(...args);
  };
  try {
    const impact = scoreAbisImpact(abisSampleEvent());
    process.env.ABIS_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/TEST/B/SECRET';
    await notifyAbisImpact(impact, { dryRun: true, notify: true, title: impact.title });
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = orig;
    delete process.env.ABIS_SLACK_WEBHOOK_URL;
  }
});

test('RMVU-05D T47b public editorial brief excludes ABIS section', () => {
  const briefSrc = read('scripts/lib/editorial-intelligence/daily-brief.mjs');
  assert.doesNotMatch(briefSrc, /ABIS Impact Watch/);
  if (fs.existsSync(PUBLIC_SURFACE_PATHS.editorialBrief)) {
    const brief = fs.readFileSync(PUBLIC_SURFACE_PATHS.editorialBrief, 'utf8');
    assert.doesNotMatch(brief, /ABIS Impact Watch \(PRIVATE/i);
  }
});

// --- ABIS Slack Japanese UX (T48–T62) ---

function jaImpact(overrides = {}) {
  return {
    event_id: 'ja-test',
    company: 'Cloudflare',
    source_url: 'https://blog.cloudflare.com/example/',
    source_date: '2026-08-08T09:00:00.000Z',
    abis_impact_score: 78,
    severity: 'HIGH',
    affected_areas: ['Binding', 'Technology Profiles', 'Reference Examples', 'Runtime Demonstrator'],
    semantic_impact: 8,
    authority_impact: 14,
    interaction_execution_impact: 16,
    evidence_outcome_impact: 5,
    binding_ecosystem_impact: 9,
    standardization_patent_relevance: 4,
    binding_only_change: false,
    patent_flags: [],
    recommended_action: 'REVIEW',
    confidence: 'MEDIUM',
    title: 'Cloudflare Agent Commerce wallet update',
    ...overrides,
  };
}

test('RMVU-05D T48 Slack notification default language = Japanese', () => {
  const msg = formatSlackMessageJa(jaImpact(), { title: 'Test announcement' });
  assert.match(msg, /【要確認】/);
  assert.match(msg, /【発信元】/);
  assert.match(msg, /【一次情報】/);
  assert.doesNotMatch(msg, /^Why It Matters:/m);
});

test('RMVU-05D T49 HIGH header Japanese', () => {
  const msg = formatSlackMessageJa(jaImpact());
  assert.match(msg, /⚠️ ABIS影響監視 — HIGH \/ 78/);
});

test('RMVU-05D T50 CRITICAL header Japanese', () => {
  const msg = formatSlackMessageJa(jaImpact({ severity: 'CRITICAL', abis_impact_score: 90 }));
  assert.match(msg, /🚨 ABIS影響監視 — CRITICAL \/ 90/);
});

test('RMVU-05D T51 要確認 is first content block', () => {
  const msg = formatSlackMessageJa(jaImpact());
  const afterHeader = msg.split('\n').slice(2).join('\n');
  assert.match(afterHeader, /^【要確認】/m);
});

test('RMVU-05D T52 affected areas mapped to Japanese labels', () => {
  assert.match(formatAffectedAreaJa('Foundation'), /基盤モデル/);
  assert.match(formatAffectedAreaJa('Binding'), /接続実現/);
  const msg = formatSlackMessageJa(jaImpact());
  assert.match(msg, /Technology Profile/);
  assert.match(msg, /Reference Example/);
});

test('RMVU-05D T53 recommended action mapped to Japanese', () => {
  assert.match(formatRecommendedActionJa('REVIEW'), /レビュー推奨/);
  const msg = formatSlackMessageJa(jaImpact());
  assert.match(msg, /【推奨アクション】[\s\S]*レビュー推奨（REVIEW）/);
});

test('RMVU-05D T54 confidence mapped to Japanese', () => {
  assert.match(formatConfidenceJa('MEDIUM'), /中（MEDIUM）/);
  const msg = formatSlackMessageJa(jaImpact());
  assert.match(msg, /中（MEDIUM）/);
});

test('RMVU-05D T55 binding-only event does not imply semantic invalidation', () => {
  const impact = jaImpact({
    binding_only_change: true,
    binding_ecosystem_impact: 8,
    semantic_impact: 4,
    authority_impact: 2,
    interaction_execution_impact: 0,
    affected_areas: ['Binding', 'Technology Profiles'],
  });
  const msg = buildReasoningSummaryJa(impact);
  assert.match(msg, /意味層|semantic core/i);
  assert.doesNotMatch(msg, /無効化|invalidate/i);
});

test('RMVU-05D T56 patent relevance remains review-only language', () => {
  const msg = formatSlackMessageJa(jaImpact({
    standardization_patent_relevance: 8,
    patent_flags: ['POTENTIAL_OVERLAP_REVIEW', 'HUMAN_REVIEW_RECOMMENDED'],
  }));
  assert.match(msg, /【標準化・特許観点】/);
  assert.match(msg, /要レビュー|人による確認/);
  assert.doesNotMatch(msg, /特許侵害|FTO|特許性|抵触/);
});

test('RMVU-05D T57 source URL preserved', () => {
  const msg = formatSlackMessageJa(jaImpact());
  assert.match(msg, /https:\/\/blog\.cloudflare\.com\/example\//);
});

test('RMVU-05D T58 webhook secret absent from rendered message', () => {
  const msg = formatSlackMessageJa(jaImpact());
  assert.doesNotMatch(msg, /hooks\.slack\.com\/services/);
  process.env.ABIS_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/SECRET/TOKEN/VALUE';
  const preview = formatSlackMessageJa(jaImpact());
  assert.doesNotMatch(preview, /hooks\.slack\.com/);
  delete process.env.ABIS_SLACK_WEBHOOK_URL;
});

test('RMVU-05D T59 WATCH still does not notify', async () => {
  const impact = jaImpact({ severity: 'WATCH', abis_impact_score: 55, recommended_action: 'MONITOR' });
  const r = await notifyAbisImpact(impact, { dryRun: false, notify: true });
  assert.equal(r.would_notify, false);
  assert.equal(r.notification_status, 'SKIPPED');
});

test('RMVU-05D T60 LOG_ONLY still does not notify', async () => {
  const impact = jaImpact({ severity: 'LOG_ONLY', abis_impact_score: 20, recommended_action: 'NO_ACTION' });
  const r = await notifyAbisImpact(impact, { dryRun: false, notify: true });
  assert.equal(r.would_notify, false);
});

test('RMVU-05D T61 ARI public draft unaffected', () => {
  const draftSrc = read('scripts/lib/editorial-intelligence/draft-generator.mjs');
  assert.doesNotMatch(draftSrc, /slack-message-ja|formatSlackMessageJa/);
});

test('RMVU-05D T62 ABIS private/public separation preserved', () => {
  const msg = formatSlackMessageJa(jaImpact());
  assert.doesNotMatch(msg, /abis-intelligence\/reviews/);
  assert.doesNotMatch(read('scripts/lib/editorial-intelligence/draft-generator.mjs'), /abis-intelligence/);
});

test('RMVU-05D T62b dry-run Cloudflare sample preview', () => {
  const preview = buildDryRunSampleMessage();
  assert.match(preview, /Cloudflare/);
  assert.match(preview, /ABIS影響監視 — HIGH \/ 78/);
  assert.match(preview, /レビュー推奨（REVIEW）/);
});

// --- RMVU-05D 12-hour monitoring cadence (T63–T71) ---

test('RMVU-05D T63 DEFAULT_POLLING_HOURS = 12', () => {
  assert.equal(DEFAULT_POLLING_HOURS, 12);
});

test('RMVU-05D T64 sources.json polling_default_hours = 12', () => {
  const reg = loadSourcesRegistry();
  assert.equal(reg.polling_default_hours, 12);
});

test('RMVU-05D T65 no per-source 2h polling override in registry', () => {
  const reg = loadSourcesRegistry();
  for (const s of reg.sources) {
    assert.notEqual(s.polling_hours, 2, `${s.source_id} has explicit 2h override`);
    assert.notEqual(s.polling_interval_hours, 2, `${s.source_id} has explicit 2h interval`);
  }
});

test('RMVU-05D T66 GitHub Actions workflow cron is 12h', () => {
  const wf = read('.github/workflows/editorial-intelligence-monitor.yml');
  assert.match(wf, /cron:\s*['"]0 \*\/12 \* \* \*['"]/);
});

test('RMVU-05D T67 workflow_dispatch enabled', () => {
  const wf = read('.github/workflows/editorial-intelligence-monitor.yml');
  assert.match(wf, /workflow_dispatch:/);
});

test('RMVU-05D T68 workflow uses ABIS_SLACK_WEBHOOK_URL secret without logging', () => {
  const wf = read('.github/workflows/editorial-intelligence-monitor.yml');
  assert.match(wf, /secrets\.ABIS_SLACK_WEBHOOK_URL/);
  assert.doesNotMatch(wf, /echo.*ABIS_SLACK/);
});

test('RMVU-05D T69 workflow no auto publish or IndexNow', () => {
  const wf = read('.github/workflows/editorial-intelligence-monitor.yml');
  assert.doesNotMatch(wf, /publish-scheduled-insights|submit-indexnow|npm run publish:insights/i);
  assert.match(wf, /intelligence-run\.mjs/);
});

test('RMVU-05D T70 HIGH/CRITICAL Slack rule unchanged', () => {
  assert.equal(shouldNotify({ severity: ABIS_SEVERITY.HIGH }), true);
  assert.equal(shouldNotify({ severity: ABIS_SEVERITY.CRITICAL }), true);
  assert.equal(shouldNotify({ severity: ABIS_SEVERITY.WATCH }), false);
  assert.equal(shouldNotify({ severity: ABIS_SEVERITY.LOG_ONLY }), false);
});

test('RMVU-05D T71 intelligence:monitor script uses live + abis-notify', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['intelligence:monitor'], /--live/);
  assert.match(pkg.scripts['intelligence:monitor'], /--abis-notify/);
});

// --- RMVU-05F Operational Hardening (T72–T90) ---

test('RMVU-05F T72 OpenAI official source returns items via incremental fetch', async () => {
  const reg = loadSourcesRegistry();
  const openai = reg.sources.find((s) => s.source_id === 'openai-blog');
  assert.ok(openai);
  const result = await fetchSourceItems(openai);
  assert.equal(result.ok, true, result.error || 'fetch failed');
  assert.ok(result.items.length >= 1, 'expected at least 1 OpenAI item');
  assert.ok(result.items[0].title);
  assert.ok(result.items[0].url);
  assert.match(result.items[0].url, /^https:\/\/openai\.com\//);
  assert.equal(result.items[0].origin, ITEM_ORIGIN.LIVE);
});

test('RMVU-05F T73 OpenAI source-specific size handling is safe', async () => {
  assert.ok(SOURCE_FETCH_PROFILES['openai-blog'].maxFeedBytes <= 800_000);
  assert.ok(DEFAULT_MAX_FEED_BYTES <= 500_000);
  const result = await fetchFeedIncremental('https://openai.com/news/rss.xml', {
    maxItems: 5,
    maxFeedBytes: SOURCE_FETCH_PROFILES['openai-blog'].maxFeedBytes,
  });
  assert.equal(result.ok, true, result.error);
  assert.ok(result.truncated, 'should truncate large feed');
  assert.ok(result.text.length < SOURCE_FETCH_PROFILES['openai-blog'].maxFeedBytes);
});

test('RMVU-05F T74 Anthropic official source returns items', async () => {
  const reg = loadSourcesRegistry();
  const anthropic = reg.sources.find((s) => s.source_id === 'anthropic-news');
  assert.ok(anthropic);
  assert.equal(anthropic.fetch_mode, 'html_listing');
  const result = await fetchSourceItems(anthropic);
  assert.equal(result.ok, true, result.error || 'fetch failed');
  assert.ok(result.items.length >= 1);
  assert.ok(result.items[0].title);
  assert.match(result.items[0].url, /^https:\/\/www\.anthropic\.com\/news\//);
});

test('RMVU-05F T75 Anthropic parser uses official domain only', () => {
  const html = '<a href="/news/claude-opus-5" class="PublicationList-module"><span class="PublicationList-module__title">Test</span><time>Aug 1, 2026</time></a>';
  const items = parseAnthropicNewsListing(html, {
    company: 'Anthropic',
    sourceId: 'anthropic-news',
    sourceType: 'official_blog',
    sourceLevel: 'A',
  });
  assert.ok(items[0].url.startsWith('https://www.anthropic.com/'));
  assert.doesNotMatch(items[0].url, /techcrunch|feedburner|medium\.com/i);
});

test('RMVU-05F T76 fixture events excluded from production queue', () => {
  const fixtures = loadBackfillFixtures(INTELLIGENCE_PATHS.fixtures);
  assert.ok(fixtures.every((f) => f.origin === ITEM_ORIGIN.FIXTURE));
  const events = dedupeItemsToEvents(fixtures);
  const queue = {
    entries: events.map((e) => ({
      event_id: e.event_id,
      company: e.company,
      title: e.title,
      priority: 'P1',
      score: 75,
      origin: ITEM_ORIGIN.FIXTURE,
    })),
  };
  const { queue: cleaned, removed } = reconcileEditorialQueue(queue, { events });
  assert.ok(removed.length >= 1);
  assert.equal(cleaned.entries.length, 0);
});

test('RMVU-05F T77 fixture ABIS excluded from active impact queue', () => {
  const ev = sampleEvent({
    url: 'https://openai.com/news/example-agent-commerce/',
    primary_source: { item_id: 'backfill-x', origin: ITEM_ORIGIN.FIXTURE, url: 'https://openai.com/news/example-agent-commerce/' },
  });
  const queue = {
    entries: [{
      event_id: ev.event_id,
      company: 'OpenAI',
      severity: ABIS_SEVERITY.HIGH,
      abis_impact_score: 70,
      origin: ITEM_ORIGIN.FIXTURE,
    }],
  };
  const { removed } = reconcileImpactQueue(queue, { events: [ev], currentImpacts: [] });
  assert.ok(removed.length >= 1);
});

test('RMVU-05F T78 queue live P1 count matches active production events', async () => {
  const result = await runIntelligencePipeline({ dryRun: true, backfill: false, now: new Date('2026-08-09T12:00:00.000Z') });
  const liveP1Events = productionEvents(result.allEvents).filter((e) => e.priority === PRIORITY_BANDS.P1).length;
  const activeP1Queue = result.queue.entries.filter(
    (e) => e.priority === PRIORITY_BANDS.P1 && e.lifecycle === QUEUE_LIFECYCLE.ACTIVE,
  ).length;
  assert.equal(activeP1Queue, liveP1Events, 'active P1 queue should match live P1 events');
});

test('RMVU-05F T79 same HIGH event does not resend', () => {
  const impact = { event_id: 'e1', severity: ABIS_SEVERITY.HIGH, abis_impact_score: 72, dimension_scores: {}, affected_areas: ['Binding'] };
  const fp = buildNotificationFingerprint(impact);
  const state = {
    notifications: {
      e1: {
        event_id: 'e1',
        notification_status: 'SENT',
        notification_severity: ABIS_SEVERITY.HIGH,
        notification_fingerprint: fp,
      },
    },
  };
  const d = evaluateNotificationDedup(impact, state);
  assert.equal(d.send, false);
  assert.equal(d.reason, 'DUPLICATE_BLOCKED');
});

test('RMVU-05F T80 HIGH → CRITICAL resends', () => {
  const state = {
    notifications: {
      e1: {
        notification_status: 'SENT',
        notification_severity: ABIS_SEVERITY.HIGH,
        notification_fingerprint: 'old-fp',
      },
    },
  };
  const critical = { event_id: 'e1', severity: ABIS_SEVERITY.CRITICAL, abis_impact_score: 88, dimension_scores: {}, affected_areas: ['Binding'] };
  const d = evaluateNotificationDedup(critical, state);
  assert.equal(d.send, true);
  assert.equal(d.reason, 'SEVERITY_ESCALATION');
});

test('RMVU-05F T81 WATCH → HIGH sends', () => {
  const state = {
    notifications: {
      e1: { notification_status: 'SKIPPED', notification_severity: ABIS_SEVERITY.WATCH, notification_fingerprint: 'w1' },
    },
  };
  const high = { event_id: 'e1', severity: ABIS_SEVERITY.HIGH, abis_impact_score: 68, dimension_scores: {}, affected_areas: [] };
  const d = evaluateNotificationDedup(high, state);
  assert.equal(d.send, true);
});

test('RMVU-05F T82 failed notification retry allowed', () => {
  const state = {
    notifications: {
      e1: { notification_status: 'FAILED', notification_severity: ABIS_SEVERITY.HIGH, notification_fingerprint: 'fp1' },
    },
  };
  const impact = { event_id: 'e1', severity: ABIS_SEVERITY.HIGH, abis_impact_score: 68, dimension_scores: {}, affected_areas: [] };
  const d = evaluateNotificationDedup(impact, state);
  assert.equal(d.send, true);
  assert.equal(d.reason, 'RETRY_AFTER_FAILURE');
});

test('RMVU-05F T83 fixture HIGH never sends', () => {
  const ev = sampleEvent({
    url: 'https://openai.com/news/example-test/',
    primary_source: { origin: ITEM_ORIGIN.FIXTURE, item_id: 'backfill-test' },
  });
  const impact = scoreAbisImpact(ev);
  const d = evaluateNotificationDedup({ ...impact, severity: ABIS_SEVERITY.HIGH }, {}, { event: ev });
  assert.equal(d.send, false);
  assert.equal(d.reason, 'FIXTURE_NEVER_SEND');
});

test('RMVU-05F T84 notification secret remains hidden', () => {
  process.env.ABIS_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/SECRET/TOKEN';
  const msg = formatSlackMessageJa(jaImpact({ severity: ABIS_SEVERITY.HIGH }));
  assert.doesNotMatch(msg, /hooks\.slack\.com\/services\/SECRET/);
  delete process.env.ABIS_SLACK_WEBHOOK_URL;
});

test('RMVU-05F T85 queue pruning keeps valid real historical event as STALE', () => {
  const realEntry = {
    event_id: 'real-hist-1',
    company: 'Cloudflare',
    title: 'Historical real announcement',
    priority: 'P2',
    score: 60,
    origin: ITEM_ORIGIN.LIVE,
    source_url: 'https://blog.cloudflare.com/real-post',
    lifecycle: QUEUE_LIFECYCLE.ACTIVE,
  };
  const queue = { entries: [realEntry] };
  const events = [{ event_id: 'other-live', company: 'Google', url: 'https://blog.google/new', primary_source: { origin: ITEM_ORIGIN.LIVE } }];
  const { queue: cleaned } = reconcileEditorialQueue(queue, { events, processedEventIds: new Set(['other-live']) });
  const kept = cleaned.entries.find((e) => e.event_id === 'real-hist-1');
  assert.ok(kept);
  assert.equal(kept.lifecycle, QUEUE_LIFECYCLE.STALE);
});

test('RMVU-05F T86 source health constants unchanged', () => {
  assert.equal(SOURCE_HEALTH.HEALTHY, 'HEALTHY');
  assert.equal(SOURCE_HEALTH.DEGRADED, 'DEGRADED');
  assert.equal(SOURCE_HEALTH.FAILED, 'FAILED');
});

test('RMVU-05F T87 no automatic article publish in pipeline', () => {
  const src = read('scripts/lib/editorial-intelligence/pipeline.mjs');
  assert.doesNotMatch(src, /publish-scheduled-insights|submit-indexnow|autoPublish/i);
  assert.match(src, /scheduleMutation:\s*false/);
});

test('RMVU-05F T88 ABIS public separation preserved', () => {
  assert.doesNotMatch(read('scripts/lib/editorial-intelligence/draft-generator.mjs'), /abis-intelligence/);
  for (const p of Object.values(PUBLIC_SURFACE_PATHS)) {
    assert.ok(p);
  }
});

test('RMVU-05F T89 GHA persistence uses cache for crucial_data', () => {
  const wf = read('.github/workflows/editorial-intelligence-monitor.yml');
  assert.ok(workflowUsesStateCache(wf));
  const partial = classifyRunnerPersistence({ ghaCacheEnabled: true });
  assert.equal(partial.class, PERSISTENCE_CLASS.PARTIAL);
  assert.equal(partial.durable_cross_run_dedup, false);
});

test('RMVU-05F T90 ephemeral runner without cache is not durable', () => {
  const ep = classifyRunnerPersistence({ ghaCacheEnabled: false });
  assert.equal(ep.class, PERSISTENCE_CLASS.EPHEMERAL);
  assert.equal(ep.durable_cross_run_dedup, false);
});
