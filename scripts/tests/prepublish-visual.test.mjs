import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  VISUAL_MODES,
  configFor,
  discoverPrepublishCandidates,
  discoverRecoveryCandidates,
  integrateScheduledCanonicalHero,
  listPrepublishHeroGaps,
  morningPrepublishShouldGenerate,
  validateScheduledIntegration,
} from '../lib/local-visual-worker.mjs';
import {
  PACKAGE_STATES,
  evaluateMorningPreflight,
  findNextPrepublishCandidate,
  markHeroPending,
  markHeroReady,
  resolvePackageState,
} from '../lib/insights-package-readiness.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ari-prepublish-visual-'));
  const slug = 'marketing-info-design';
  fs.mkdirSync(path.join(root, 'assets/insights', slug), { recursive: true });
  fs.mkdirSync(path.join(root, 'insights/_scheduled', slug), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets/insights'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets/insights/hero.css'), '.insight-hero { max-width: 820px; }');
  fs.writeFileSync(path.join(root, 'insights/_scheduled/schedule.json'), JSON.stringify({
    articles: [{
      slug,
      status: 'scheduled',
      publishAt: '2026-09-04T10:00:00+09:00',
      title: 'マーケが担う情報設計の再定義',
    }],
  }));
  fs.writeFileSync(path.join(root, 'insights/_scheduled', slug, 'index.html'), `<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="../../assets/hub-animations.css">
<header class="article-header container"></header>

  <article class="article-body container" data-article-slug="${slug}"><p>本文</p></article>`);
  fs.writeFileSync(path.join(root, 'insights/index.html'), `<article class="insight-card planned" data-scheduled-slug="${slug}"><h3>planned</h3></article>`);
  return { root, slug };
}

test('A. scheduled future article without hero becomes prepublish candidate', () => {
  const { root } = fixture();
  const config = configFor(root);
  const schedule = JSON.parse(fs.readFileSync(config.schedulePath, 'utf8'));
  const result = discoverPrepublishCandidates(config, {
    schedule,
    now: new Date('2026-09-04T09:00:00+09:00'),
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].visualMode, VISUAL_MODES.PRIMARY_PREPUBLISH);
  fs.rmSync(root, { recursive: true, force: true });
});

test('rescheduled article without hero.webp is a gap regardless of planned card or package state', () => {
  const { root, slug } = fixture();
  const later = 'unreserved-then-rescheduled';
  const schedulePath = path.join(root, 'insights/_scheduled/schedule.json');
  const schedule = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
  schedule.articles.push({
    slug: later,
    status: 'scheduled',
    publishAt: '2026-09-05T10:00:00+09:00',
    title: '予約を外したあと再設定',
    packageReadiness: 'PACKAGE_READY',
    heroReadyAt: '2026-08-01T00:00:00.000Z',
    previousPublishAt: '2026-08-20T10:00:00+09:00',
  });
  fs.writeFileSync(schedulePath, JSON.stringify(schedule));
  fs.mkdirSync(path.join(root, 'insights/_scheduled', later), { recursive: true });
  fs.writeFileSync(path.join(root, 'insights/_scheduled', later, 'index.html'), '<article></article>');
  fs.writeFileSync(path.join(root, 'insights/index.html'), `</p> hidden>公開中の記事はまだありません。
<article class="insight-card planned" data-scheduled-slug="${slug}"><h3>other</h3></article>`);
  const config = configFor(root, { maxCandidates: 1 });
  const now = new Date('2026-09-04T09:00:00+09:00');
  const gaps = listPrepublishHeroGaps(config, { schedule, now });
  assert.deepEqual(gaps.gaps.map((article) => article.slug), [slug, later]);
  const result = discoverPrepublishCandidates(config, { schedule, now });
  assert.deepEqual(result.candidates.map((article) => article.slug), [slug]);
  assert.ok(result.reasons.some((reason) => reason.slug === later && reason.reason === 'max_candidates'));
  assert.equal(morningPrepublishShouldGenerate({
    report: { ok: true, status: 'NO_TODAY_PUBLICATION' },
    gaps: gaps.gaps,
  }), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('hero.webp on disk skips a HERO_PENDING article inside the horizon', () => {
  const { root, slug } = fixture();
  fs.writeFileSync(path.join(root, 'assets/insights', slug, 'hero.webp'), 'hero');
  const schedule = JSON.parse(fs.readFileSync(path.join(root, 'insights/_scheduled/schedule.json'), 'utf8'));
  schedule.articles[0].packageReadiness = 'HERO_PENDING';
  const gaps = listPrepublishHeroGaps(configFor(root), {
    schedule,
    now: new Date('2026-09-04T09:00:00+09:00'),
  });
  assert.deepEqual(gaps.gaps, []);
  assert.equal(gaps.reasons[0].reason, 'hero_exists');
  fs.rmSync(root, { recursive: true, force: true });
});

test('morning preflight does not generate when today and the horizon already have heroes', () => {
  assert.equal(morningPrepublishShouldGenerate({ report: { ok: true }, gaps: [] }), false);
  assert.equal(morningPrepublishShouldGenerate({ report: { ok: false }, gaps: [] }), true);
});

test('B. hero exists → prepublish candidate skipped', () => {
  const { root, slug } = fixture();
  const config = configFor(root);
  fs.writeFileSync(path.join(root, 'assets/insights', slug, 'hero.webp'), 'hero');
  const schedule = JSON.parse(fs.readFileSync(config.schedulePath, 'utf8'));
  const result = discoverPrepublishCandidates(config, {
    schedule,
    now: new Date('2026-09-04T09:00:00+09:00'),
  });
  assert.equal(result.candidates.length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('D/E. morning preflight detects missing hero and package state', () => {
  const { root, slug } = fixture();
  const schedule = JSON.parse(fs.readFileSync(path.join(root, 'insights/_scheduled/schedule.json'), 'utf8'));
  const report = evaluateMorningPreflight({
    now: new Date('2026-09-04T09:00:00+09:00'),
    root,
    schedule,
  });
  assert.equal(report.ok, false);
  assert.equal(report.status, 'PREPUBLISH_HERO_MISSING');
  assert.equal(report.slug, slug);
  fs.rmSync(root, { recursive: true, force: true });
});

test('scheduled integration updates planned card and scheduled article refs', () => {
  const { root, slug } = fixture();
  fs.writeFileSync(path.join(root, 'assets/insights', slug, 'hero.webp'), 'hero');
  const config = { root, origin: 'https://readiness.coaretail.com', assetsPath: path.join(root, 'assets/insights') };
  integrateScheduledCanonicalHero(config, slug, { root });
  const validation = validateScheduledIntegration(config, slug, { root });
  assert.equal(validation.ok, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('later reservation keeps the current planned card and still validates', () => {
  const { root, slug } = fixture();
  const later = 'ai-mode-information-monitoring';
  const schedulePath = path.join(root, 'insights/_scheduled/schedule.json');
  const schedule = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
  schedule.articles.push({
    slug: later,
    status: 'scheduled',
    publishAt: '2026-09-10T10:00:00+09:00',
    title: '後続の予約',
  });
  fs.writeFileSync(schedulePath, JSON.stringify(schedule));
  fs.mkdirSync(path.join(root, 'insights/_scheduled', later), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets/insights', later), { recursive: true });
  fs.writeFileSync(path.join(root, 'insights/_scheduled', later, 'index.html'), `<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="../../assets/hub-animations.css">
<header class="article-header container"></header>

  <article class="article-body container" data-article-slug="${later}"><p>本文</p></article>`);
  fs.writeFileSync(path.join(root, 'assets/insights', later, 'hero.webp'), 'hero');
  const indexPath = path.join(root, 'insights/index.html');
  const before = fs.readFileSync(indexPath, 'utf8');
  const config = { root, origin: 'https://readiness.coaretail.com', assetsPath: path.join(root, 'assets/insights') };
  integrateScheduledCanonicalHero(config, later, { root });
  const index = fs.readFileSync(indexPath, 'utf8');
  assert.equal(index, before);
  assert.match(index, new RegExp(`data-scheduled-slug="${slug}"`));
  assert.doesNotMatch(index, new RegExp(`data-scheduled-slug="${later}"`));
  const validation = validateScheduledIntegration(config, later, { root });
  assert.equal(validation.ok, true, validation.errors.join(','));
  const article = fs.readFileSync(path.join(root, 'insights/_scheduled', later, 'index.html'), 'utf8');
  assert.match(article, new RegExp(`/assets/insights/${later}/hero.webp`));
  fs.rmSync(root, { recursive: true, force: true });
});

test('an existing planned card must contain its own thumbnail', () => {
  const { root, slug } = fixture();
  const later = 'branded-queries-ai-overviews';
  const schedulePath = path.join(root, 'insights/_scheduled/schedule.json');
  const schedule = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
  schedule.articles.push({
    slug: later,
    status: 'scheduled',
    publishAt: '2026-09-10T10:00:00+09:00',
    title: '後続の予約',
  });
  fs.writeFileSync(schedulePath, JSON.stringify(schedule));
  fs.mkdirSync(path.join(root, 'insights/_scheduled', later), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets/insights', later), { recursive: true });
  fs.writeFileSync(path.join(root, 'insights/_scheduled', later, 'index.html'), `<meta name="twitter:card" content="summary_large_image">
<header class="article-header container"></header>

  <article class="article-body container" data-article-slug="${later}"><p>本文</p></article>`);
  fs.writeFileSync(path.join(root, 'assets/insights', later, 'hero.webp'), 'hero');
  const rel = `/assets/insights/${later}/hero.webp`;
  fs.writeFileSync(path.join(root, 'insights/index.html'), `<article class="insight-card planned" data-scheduled-slug="${slug}"><h3>next</h3></article>
<article class="insight-card planned" data-scheduled-slug="${later}"><h3>later</h3></article>
<img src="${rel}">`);
  const config = { root, origin: 'https://readiness.coaretail.com', assetsPath: path.join(root, 'assets/insights') };
  const beforeIntegrate = validateScheduledIntegration(config, later, { root });
  assert.equal(beforeIntegrate.ok, false);
  assert.ok(beforeIntegrate.errors.includes('planned_card_thumbnail'));
  integrateScheduledCanonicalHero(config, later, { root });
  const index = fs.readFileSync(path.join(root, 'insights/index.html'), 'utf8');
  const laterAt = index.indexOf(`data-scheduled-slug="${later}"`);
  const laterCard = index.slice(index.lastIndexOf('<article', laterAt), index.indexOf('</article>', laterAt));
  const earlierAt = index.indexOf(`data-scheduled-slug="${slug}"`);
  const earlierCard = index.slice(index.lastIndexOf('<article', earlierAt), index.indexOf('</article>', earlierAt));
  assert.match(laterCard, /insight-card-thumb/);
  assert.match(laterCard, new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(earlierCard, new RegExp(later));
  const validation = validateScheduledIntegration(config, later, { root });
  assert.equal(validation.ok, true, validation.errors.join(','));
  fs.rmSync(root, { recursive: true, force: true });
});

test('a hero path outside the planned card does not satisfy the thumbnail check', () => {
  const { root, slug } = fixture();
  fs.writeFileSync(path.join(root, 'assets/insights', slug, 'hero.webp'), 'hero');
  const config = { root, origin: 'https://readiness.coaretail.com', assetsPath: path.join(root, 'assets/insights') };
  integrateScheduledCanonicalHero(config, slug, { root });
  const indexPath = path.join(root, 'insights/index.html');
  let index = fs.readFileSync(indexPath, 'utf8');
  index = index.replace(/<div class="insight-card-thumb">[\s\S]*?<\/div>/, '');
  const rel = `/assets/insights/${slug}/hero.webp`;
  fs.writeFileSync(indexPath, `<img src="${rel}">\n${index}`, 'utf8');
  const validation = validateScheduledIntegration(config, slug, { root });
  assert.deepEqual(validation.errors, ['planned_card_thumbnail']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('scheduled integration self-heals missing planned card from schedule', () => {
  const { root, slug } = fixture();
  fs.writeFileSync(path.join(root, 'assets/insights', slug, 'hero.webp'), 'hero');
  fs.writeFileSync(path.join(root, 'insights/index.html'), '<!-- INSIGHTS_CARDS_START -->\n<a class="insight-card">published only</a>');
  const config = { root, origin: 'https://readiness.coaretail.com', assetsPath: path.join(root, 'assets/insights') };
  integrateScheduledCanonicalHero(config, slug, { root });
  const index = fs.readFileSync(path.join(root, 'insights/index.html'), 'utf8');
  assert.match(index, new RegExp(`data-scheduled-slug="${slug}"`));
  const validation = validateScheduledIntegration(config, slug, { root });
  assert.equal(validation.ok, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('readiness state transitions', () => {
  const entry = { slug: 'x', status: 'scheduled', publishAt: '2026-09-05T10:00:00+09:00' };
  markHeroPending(entry, { now: new Date('2026-09-04T06:00:00Z') });
  assert.equal(entry.packageReadiness, PACKAGE_STATES.HERO_PENDING);
  markHeroReady(entry, { now: new Date('2026-09-04T06:30:00Z') });
  assert.equal(entry.packageReadiness, PACKAGE_STATES.PACKAGE_READY);
  assert.ok(entry.heroReadyAt);
});

test('recovery mode remains published-only', async () => {
  const { root } = fixture();
  const config = configFor(root);
  const schedule = JSON.parse(fs.readFileSync(config.schedulePath, 'utf8'));
  const result = await discoverRecoveryCandidates(config, {
    schedule,
    productionCheck: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(result.candidates.length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('findNextPrepublishCandidate returns earliest future scheduled article', () => {
  const { root } = fixture();
  const schedule = JSON.parse(fs.readFileSync(path.join(root, 'insights/_scheduled/schedule.json'), 'utf8'));
  schedule.articles.push({
    slug: 'later-article',
    status: 'scheduled',
    publishAt: '2026-09-10T10:00:00+09:00',
    title: 'Later',
  });
  fs.mkdirSync(path.join(root, 'insights/_scheduled/later-article'), { recursive: true });
  fs.writeFileSync(path.join(root, 'insights/_scheduled/later-article/index.html'), '<article></article>');
  const candidate = findNextPrepublishCandidate(schedule, {
    now: new Date('2026-09-04T09:00:00+09:00'),
    root,
  });
  assert.equal(candidate.slug, 'marketing-info-design');
  fs.rmSync(root, { recursive: true, force: true });
});

test('package state resolves to PACKAGE_READY when hero exists before publish day', () => {
  const { root, slug } = fixture();
  fs.writeFileSync(path.join(root, 'assets/insights', slug, 'hero.webp'), 'hero');
  const entry = { slug, status: 'scheduled', publishAt: '2026-09-04T10:00:00+09:00' };
  assert.equal(
    resolvePackageState(entry, { now: new Date('2026-09-04T09:00:00+09:00'), root }),
    PACKAGE_STATES.PACKAGE_READY,
  );
  fs.rmSync(root, { recursive: true, force: true });
});
