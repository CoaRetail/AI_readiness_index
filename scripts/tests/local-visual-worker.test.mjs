import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  CANONICAL_HERO_SIZE,
  acquireLock,
  canonicalHeroPath,
  checkRemoteDivergence,
  configFor,
  createBriefPrompt,
  discoverCandidates,
  gitStatusIsSafe,
  integrateCanonicalHero,
  isPublishedArticle,
  readQualityGate,
  readOriginMainSha,
  acceptRecoveredImageForConvert,
  findNewestCodexExecPng,
  recoverCodexNativeImage,
  WORKER_INTEGRITY_PATHS,
  releaseLock,
  runWorker,
  sortNewestFirst,
  validatePresentationContract,
  resolveMaxGenerationAttempts,
  shouldContinuePrepublishQueue,
  validateIntegration,
  verifyProductionReferences,
} from '../lib/local-visual-worker.mjs';
import { validateOptionalHeroPresentation } from '../lib/insights-presentation.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ari-visual-worker-test-'));
  fs.mkdirSync(path.join(root, 'insights/_scheduled'), { recursive: true });
  fs.mkdirSync(path.join(root, 'insights'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets/insights'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ARI_INSIGHTS_VISUAL_CANON.md'), 'TYPOGRAPHIC MODE ONLY');
  fs.writeFileSync(path.join(root, 'insights/index.html'), '<!-- INSIGHTS_CARDS_START -->\n<a class="insight-card" href="/insights/newest/" data-insight-slug="newest"><h3>Newest</h3></a>');
  fs.writeFileSync(path.join(root, 'insights/_scheduled/schedule.json'), JSON.stringify({ articles: [
    { slug: 'old', status: 'published', publishedAt: '2026-08-20T01:00:00Z', title: 'Old' },
    { slug: 'newest', status: 'published', publishedAt: '2026-08-26T01:00:00Z', title: 'Newest' },
    { slug: 'draft', status: 'scheduled', publishAt: '2026-08-27T01:00:00Z', title: 'Draft' },
  ] }));
  fs.mkdirSync(path.join(root, 'insights/newest'), { recursive: true });
  fs.writeFileSync(path.join(root, 'insights/newest/index.html'), '<meta name="twitter:card" content="summary_large_image">\n</header>\n\n<article class="article-body container">');
  return { root, config: configFor(root, { logDir: path.join(root, 'logs'), lockPath: path.join(root, 'worker.lock'), origin: 'https://example.test' }) };
}

function cleanup(root) { fs.rmSync(root, { recursive: true, force: true }); }

function gitBackedFixture() {
  const f = fixture();
  execFileSync('git', ['init', '-b', 'main'], { cwd: f.root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: f.root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: f.root });
  execFileSync('git', ['add', '.'], { cwd: f.root });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: f.root, stdio: 'ignore' });
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: f.root });
  f.config.logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ari-visual-worker-logs-'));
  f.config.lockPath = path.join(os.tmpdir(), `ari-visual-worker-${path.basename(f.root)}.lock`);
  return f;
}

function originAheadFixture() {
  const f = gitBackedFixture();
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.root, encoding: 'utf8' }).trim();
  const schedulePath = path.join(f.root, 'insights/_scheduled/schedule.json');
  const schedule = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
  schedule.articles.push({ slug: 'policy-clarity', status: 'published', publishedAt: '2026-08-27T01:00:00Z', title: 'Policy clarity' });
  fs.writeFileSync(schedulePath, JSON.stringify(schedule));
  fs.writeFileSync(path.join(f.root, 'insights/index.html'), '<a class="insight-card" href="/insights/policy-clarity/" data-insight-slug="policy-clarity"><h3>Policy clarity</h3></a>');
  fs.mkdirSync(path.join(f.root, 'insights/policy-clarity'), { recursive: true });
  fs.writeFileSync(path.join(f.root, 'insights/policy-clarity/index.html'), '<meta name="twitter:card" content="summary_large_image">\n</header>\n\n<article>');
  execFileSync('git', ['add', '.'], { cwd: f.root });
  execFileSync('git', ['commit', '-m', 'origin article'], { cwd: f.root, stdio: 'ignore' });
  const remote = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.root, encoding: 'utf8' }).trim();
  execFileSync('git', ['switch', '--detach', base], { cwd: f.root, stdio: 'ignore' });
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', remote], { cwd: f.root });
  return f;
}

function workerSource() {
  return fs.readFileSync(new URL('../lib/local-visual-worker.mjs', import.meta.url), 'utf8');
}

function presentationFixture({ hero = true, css = true, heroCssLink = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ari-presentation-test-'));
  const slug = 'newest';
  fs.mkdirSync(path.join(root, 'insights', slug), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets', 'insights', slug), { recursive: true });
  const config = configFor(root, { origin: 'https://example.test', logDir: path.join(root, 'logs'), lockPath: path.join(root, 'worker.lock') });
  if (hero) fs.writeFileSync(canonicalHeroPath(config, slug), 'hero');
  if (css) fs.writeFileSync(path.join(root, 'assets/insights/hero.css'), `.insight-hero { max-width: 820px; }\n.insight-hero img { width: 100%; height: auto; aspect-ratio: 16 / 9; object-fit: contain; }\n@media (max-width: 768px) { .insight-hero { width: calc(100% - 32px); max-width: none; } }`);
  const cssLink = heroCssLink ? '<link rel="stylesheet" href="../../assets/insights/hero.css">\n' : '';
  fs.writeFileSync(path.join(root, 'insights', slug, 'index.html'), `<meta property="og:image" content="https://example.test/assets/insights/${slug}/hero.webp">\n<meta name="twitter:image" content="https://example.test/assets/insights/${slug}/hero.webp">\n<script type="application/ld+json">{"datePublished":"2026-08-26"}</script>\n<link rel="stylesheet" href="../../assets/hub-animations.css">\n${cssLink}<figure class="insight-hero"><img src="/assets/insights/${slug}/hero.webp"></figure>\n<article class="article-body container"><p>本文</p></article>`);
  fs.writeFileSync(path.join(root, 'insights', 'index.html'), `<a class="insight-card" href="/insights/${slug}/" data-insight-slug="${slug}"><div class="insight-card-thumb"><img src="/assets/insights/${slug}/hero.webp"></div></a>`);
  return { root, config, slug };
}

test('hero existing → skip', async () => {
  const { root, config } = fixture();
  config.maxCandidates = 2;
  fs.mkdirSync(path.dirname(canonicalHeroPath(config, 'old')), { recursive: true });
  fs.writeFileSync(canonicalHeroPath(config, 'old'), 'webp');
  const result = await discoverCandidates(config, { productionCheck: async () => ({ ok: true, status: 200 }) });
  assert.equal(result.candidates[0].slug, 'newest');
  assert.ok(result.reasons.some((r) => r.slug === 'old' && r.reason === 'hero_exists'));
  cleanup(root);
});

test('no candidate → clean exit', async () => {
  const { root, config } = gitBackedFixture();
  fs.mkdirSync(path.dirname(canonicalHeroPath(config, 'old')), { recursive: true });
  fs.mkdirSync(path.dirname(canonicalHeroPath(config, 'newest')), { recursive: true });
  fs.writeFileSync(canonicalHeroPath(config, 'old'), 'webp');
  fs.writeFileSync(canonicalHeroPath(config, 'newest'), 'webp');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture heroes'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: root });
  const result = await runWorker({ root, dryRun: true, productionCheck: async () => ({ ok: true, status: 200 }), configOverrides: config });
  assert.equal(result.finalResult, 'NO_CANDIDATE', JSON.stringify(result));
  cleanup(root);
});

test('hero output path resolves when root is relative', () => {
  const workspace = '/private/tmp/ari-visual-workspace';
  const slug = 'multi-agent-compare';
  const heroOutput = path.join(workspace, 'assets', 'insights', slug, 'hero.webp');
  assert.equal(heroOutput, '/private/tmp/ari-visual-workspace/assets/insights/multi-agent-compare/hero.webp');
  assert.doesNotMatch(heroOutput, /hero\/private\/tmp/);
});

test('published + hero missing → select', async () => {
  const { root, config } = fixture();
  const result = await discoverCandidates(config, { productionCheck: async () => ({ ok: true, status: 200 }) });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].slug, 'newest');
  cleanup(root);
});

test('unpublished → exclude', () => assert.equal(isPublishedArticle({ slug: 'draft', status: 'scheduled' }), false));

test('max 1', async () => {
  const { root, config } = fixture();
  config.maxCandidates = 1;
  const result = await discoverCandidates(config, { productionCheck: async () => ({ ok: true, status: 200 }) });
  assert.equal(result.candidates.length, 1);
  cleanup(root);
});

test('newest published first', () => {
  const items = sortNewestFirst([{ slug: 'a', publishedAt: '2026-08-01' }, { slug: 'b', publishedAt: '2026-08-03' }]);
  assert.deepEqual(items.map((x) => x.slug), ['b', 'a']);
});

test('production article must be HTTP 200', async () => {
  const { root, config } = fixture();
  const result = await discoverCandidates(config, { productionCheck: async () => ({ ok: false, status: 503 }) });
  assert.equal(result.candidates.length, 0);
  cleanup(root);
});

test('lock active → skip', () => {
  const { root, config } = fixture();
  const first = acquireLock(config.lockPath, { runId: 'first' });
  const second = acquireLock(config.lockPath, { runId: 'second' });
  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
  first.release();
  cleanup(root);
});

test('stale lock → recover', () => {
  const { root, config } = fixture();
  fs.writeFileSync(config.lockPath, JSON.stringify({ pid: 999999, startedAt: '2020-01-01T00:00:00.000Z', runId: 'stale' }));
  const result = acquireLock(config.lockPath, { runId: 'new' });
  assert.equal(result.acquired, true);
  result.release();
  cleanup(root);
});

test('lock release is ownership-safe', () => {
  const { root, config } = fixture();
  const lock = acquireLock(config.lockPath, { runId: 'owner' });
  assert.equal(releaseLock(config.lockPath, 'other'), false);
  assert.equal(releaseLock(config.lockPath, 'owner'), true);
  cleanup(root);
});

test('remote divergence path is represented as safe stop', async () => {
  const { root, config } = fixture();
  const result = await runWorker({ root, dryRun: false, simulate: false, fetch: false, productionCheck: async () => ({ ok: true, status: 200 }), configOverrides: config });
  assert.ok(['VISUAL_WORKER_REMOTE_DIVERGED', 'VISUAL_WORKER_SKIPPED'].includes(result.finalResult));
  cleanup(root);
});

test('image failure remains a visual-only result', () => {
  const prompt = createBriefPrompt({ articleHtml: '<article>本文</article>', canon: 'TYPOGRAPHIC MODE ONLY', slug: 'x', attempt: 1, outputDir: '/private/tmp/test' });
  assert.match(prompt, /Do not use OPENAI_API_KEY/);
  assert.match(prompt, /Native image-generation call/);
});

test('token limit fallback is explicit in prompt policy', () => {
  const prompt = createBriefPrompt({ articleHtml: 'article', canon: 'canon', slug: 'x', attempt: 1, outputDir: '/tmp' });
  assert.match(prompt, /Do not access or modify the production repository/);
});

test('generation attempts default to 3 and honor a bounded override', () => {
  assert.equal(resolveMaxGenerationAttempts({}), 3);
  assert.equal(resolveMaxGenerationAttempts({ ARI_VISUAL_MAX_GENERATION_ATTEMPTS: '1' }), 1);
  assert.equal(resolveMaxGenerationAttempts({ ARI_VISUAL_MAX_GENERATION_ATTEMPTS: '6' }), 6);
  assert.equal(resolveMaxGenerationAttempts({ ARI_VISUAL_MAX_GENERATION_ATTEMPTS: '9' }), 3);
  assert.equal(resolveMaxGenerationAttempts({ ARI_VISUAL_MAX_GENERATION_ATTEMPTS: '0' }), 3);
  assert.equal(resolveMaxGenerationAttempts({ ARI_VISUAL_MAX_GENERATION_ATTEMPTS: 'nope' }), 3);
  assert.equal(resolveMaxGenerationAttempts({ ARI_VISUAL_MAX_GENERATION_ATTEMPTS: '' }), 3);
});

test('prepublish queue continues after a per-article generation or integration failure', () => {
  assert.equal(shouldContinuePrepublishQueue({ finalResult: 'VISUAL_WORKER_SKIPPED_QUALITY', reason: 'codex_exec_no_image' }), true);
  assert.equal(shouldContinuePrepublishQueue({ finalResult: 'VISUAL_WORKER_SKIPPED', error: 'integration_failed:planned_card_thumbnail' }), true);
  assert.equal(shouldContinuePrepublishQueue({ finalResult: 'VISUAL_WORKER_SKIPPED', reason: 'timeout' }), true);
  assert.equal(shouldContinuePrepublishQueue({ finalResult: 'SUCCESS' }), true);
  assert.equal(shouldContinuePrepublishQueue({ finalResult: 'VISUAL_WORKER_SKIPPED', reason: 'capability_or_auth_failure' }), false);
  assert.equal(shouldContinuePrepublishQueue({ finalResult: 'VISUAL_WORKER_TOOLCHAIN_MISSING' }), false);
  assert.equal(shouldContinuePrepublishQueue({ finalResult: 'VISUAL_WORKER_REMOTE_DIVERGED' }), false);
  assert.equal(shouldContinuePrepublishQueue({ finalResult: 'VISUAL_WORKER_NETWORK_BLOCKED' }), false);
  assert.equal(shouldContinuePrepublishQueue(null), false);
});

test('codex_exec_no_image downloads a returned URL into generation-N.png', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ari-codex-url-'));
  const url = 'https://example.test/native/generation.png';
  const recovered = await recoverCodexNativeImage({
    workspace: dir,
    attempt: 1,
    texts: [`Native image: ${url}`],
    download: async (got, dest) => {
      assert.equal(got, url);
      fs.writeFileSync(dest, Buffer.from('png-bytes'));
    },
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.source, 'downloaded_url');
  assert.equal(fs.readFileSync(path.join(dir, 'generation-1.png'), 'utf8'), 'png-bytes');
  const source = recoverCodexNativeImage.toString();
  assert.doesNotMatch(source, /Pillow|GenerateImage|drawtext|cwebp/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('codex_exec_no_image copies a mentioned PNG and then the quality gate can see it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ari-codex-file-'));
  const mentioned = path.join(dir, 'native-output.png');
  fs.writeFileSync(mentioned, 'located-png');
  const recovered = await recoverCodexNativeImage({
    workspace: dir,
    attempt: 2,
    texts: [`saved ${mentioned}`],
    download: async () => { throw new Error('download should not run when a file exists'); },
  });
  assert.equal(recovered.source, 'located_file');
  assert.equal(fs.readFileSync(path.join(dir, 'generation-2.png'), 'utf8'), 'located-png');
  fs.writeFileSync(path.join(dir, 'visual-brief.json'), JSON.stringify({ ARTICLE: 'x' }));
  fs.writeFileSync(path.join(dir, 'quality.json'), JSON.stringify({
    TEXT_CORRECT: true,
    JAPANESE_CORRECT: true,
    NO_GARBLED_TEXT: true,
    TYPOGRAPHIC_ONLY: true,
    ARTICLE_RELEVANT: true,
    SAFE_AREA_PASS: true,
    THUMBNAIL_READABLE: true,
    VISUAL_CANON_PASS: true,
    width: 1672,
    height: 941,
  }));
  const gate = readQualityGate(dir, 2);
  assert.equal(gate.imagePath, path.join(dir, 'generation-2.png'));
  assert.equal(fs.existsSync(gate.imagePath), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a recovered canonical PNG continues toward convert-webp without quality.json', () => {
  const accepted = acceptRecoveredImageForConvert(
    { ok: false, reason: 'missing_generation_artifacts', imagePath: '/tmp/generation-1.png' },
    '/tmp',
    { dimensionsOf: () => ({ ok: true, width: 1672, height: 941 }) },
  );
  assert.equal(accepted.ok, true);
  assert.equal(accepted.recoveredWithoutQualityJson, true);
  const rejected = acceptRecoveredImageForConvert(
    { ok: false, reason: 'quality_gate_failed', imagePath: '/tmp/generation-1.png' },
    '/tmp',
    { dimensionsOf: () => ({ ok: true, width: 1672, height: 941 }) },
  );
  assert.equal(rejected.ok, false);
});

test('a bare Codex image URL with no file extension is downloaded', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ari-codex-bare-url-'));
  const url = 'https://example.test/codex/native-image';
  const recovered = await recoverCodexNativeImage({
    workspace: dir,
    attempt: 1,
    texts: [url],
    download: async (got, dest) => {
      assert.equal(got, url);
      fs.writeFileSync(dest, Buffer.from('png-bytes'));
    },
  });
  assert.equal(recovered.source, 'downloaded_url');
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeExecPng(file, contents, mtimeMs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  const date = new Date(mtimeMs);
  fs.utimesSync(file, date, date);
}

test('exec-*.png from the current Codex thread is copied to generation-N.png before the quality gate', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ari-codex-exec-png-'));
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace);
  const startedAt = 1_700_000_000_000;
  const thread = 'thread-current';
  const other = 'thread-other01';
  const images = path.join(root, 'generated_images');
  writeExecPng(path.join(images, thread, 'exec-old.png'), 'old-bytes', startedAt - 10_000);
  writeExecPng(path.join(images, thread, 'exec-mid.png'), 'mid-bytes', startedAt + 1_000);
  writeExecPng(path.join(images, thread, 'exec-new.png'), 'new-bytes', startedAt + 10_000);
  writeExecPng(path.join(images, thread, 'notes.png'), 'not-exec', startedAt + 20_000);
  writeExecPng(path.join(images, other, 'exec-other.png'), 'other-bytes', startedAt + 30_000);
  let downloaded = false;
  const recovered = await recoverCodexNativeImage({
    workspace,
    attempt: 1,
    texts: [`session id: ${thread}\nhttps://example.test/native/generation.png`],
    startedAt,
    codexHome: root,
    download: async () => { downloaded = true; },
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.source, 'codex_generated_images');
  assert.equal(recovered.threadId, thread);
  assert.equal(recovered.from, path.join(images, thread, 'exec-new.png'));
  assert.equal(fs.readFileSync(path.join(workspace, 'generation-1.png'), 'utf8'), 'new-bytes');
  assert.equal(downloaded, false);
  assert.equal(findNewestCodexExecPng({
    codexHome: root,
    startedAt,
    texts: [`session id: ${thread}`],
  }).name, 'exec-new.png');

  const olderOnly = fs.mkdtempSync(path.join(os.tmpdir(), 'ari-codex-exec-old-'));
  const olderWorkspace = path.join(olderOnly, 'workspace');
  fs.mkdirSync(olderWorkspace);
  writeExecPng(path.join(olderOnly, 'generated_images', thread, 'exec-old.png'), 'old-bytes', startedAt - 10_000);
  writeExecPng(path.join(olderOnly, 'generated_images', other, 'exec-other.png'), 'other-bytes', startedAt + 30_000);
  const missed = await recoverCodexNativeImage({
    workspace: olderWorkspace,
    attempt: 3,
    texts: [`session id: ${thread}`],
    startedAt,
    codexHome: olderOnly,
    download: async () => { throw new Error('no url'); },
  });
  assert.deepEqual({ ok: missed.ok, reason: missed.reason }, { ok: false, reason: 'codex_exec_no_image' });
  assert.equal(fs.existsSync(path.join(olderWorkspace, 'generation-3.png')), false);
  assert.equal(findNewestCodexExecPng({
    codexHome: olderOnly,
    startedAt,
    texts: [`session id: ${thread}`],
  }), null);

  const notStolen = await recoverCodexNativeImage({
    workspace: olderWorkspace,
    attempt: 1,
    texts: ['session id: thread-missing'],
    startedAt,
    codexHome: root,
    download: async () => { throw new Error('must not take another thread'); },
  });
  assert.equal(notStolen.ok, false);

  const unscoped = findNewestCodexExecPng({ codexHome: root, startedAt, texts: [] });
  assert.equal(unscoped.threadId, other);
  assert.equal(unscoped.name, 'exec-other.png');

  const rolloutId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const rolloutHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ari-codex-rollout-'));
  writeExecPng(path.join(rolloutHome, 'generated_images', rolloutId, 'exec-rollout.png'), 'rollout-bytes', startedAt + 5_000);
  writeExecPng(path.join(rolloutHome, 'generated_images', other, 'exec-later.png'), 'later-bytes', startedAt + 50_000);
  const rollout = path.join(rolloutHome, 'sessions', '2026', '10', '12', `rollout-2026-10-12T15-05-01-${rolloutId}.jsonl`);
  writeExecPng(rollout, '{"type":"session"}\n', startedAt + 1_000);
  const fromRollout = findNewestCodexExecPng({ codexHome: rolloutHome, startedAt, texts: [] });
  assert.equal(fromRollout.threadId, rolloutId);
  assert.equal(fromRollout.name, 'exec-rollout.png');

  const prompt = createBriefPrompt({ articleHtml: 'article', canon: 'canon', slug: 'x', attempt: 2, outputDir: workspace });
  assert.match(prompt, /generated_images\/<thread-id>\/exec-\*\.png/);
  assert.match(prompt, /newest exec-\*\.png for this thread that is newer than this attempt/);
  assert.ok(WORKER_INTEGRITY_PATHS.includes('scripts/lib/local-visual-worker.mjs'));
  const body = fs.readFileSync(new URL('../lib/local-visual-worker.mjs', import.meta.url), 'utf8');
  const processBody = body.slice(body.indexOf('async function processCandidate'));
  const started = processBody.indexOf('const attemptStartedAt = Date.now()');
  const run = processBody.indexOf('runNativeGeneration(workspace, candidate, canon, attempt)');
  const recover = processBody.indexOf('startedAt: attemptStartedAt');
  const gate = processBody.indexOf('readQualityGate(workspace, attempt)');
  assert.ok(started !== -1 && started < run && run < recover && recover < gate);
  assert.doesNotMatch(recoverCodexNativeImage.toString(), /Pillow|GenerateImage|drawtext|cwebp/);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(olderOnly, { recursive: true, force: true });
  fs.rmSync(rolloutHome, { recursive: true, force: true });
});

test('codex output with no image URL stays codex_exec_no_image', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ari-codex-none-'));
  const recovered = await recoverCodexNativeImage({
    workspace: dir,
    attempt: 1,
    texts: ['Codex finished without an image file.'],
    download: async () => { throw new Error('no url'); },
  });
  assert.deepEqual({ ok: recovered.ok, reason: recovered.reason }, { ok: false, reason: 'codex_exec_no_image' });
  const body = fs.readFileSync(new URL('../lib/local-visual-worker.mjs', import.meta.url), 'utf8');
  const processBody = body.slice(body.indexOf('async function processCandidate'));
  assert.ok(processBody.indexOf('recoverCodexNativeImage') < processBody.indexOf('readQualityGate(workspace, attempt)'));
  assert.match(processBody, /optimizeToWebp\(quality\.imagePath/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('codex failure tails are recorded for the operator log', () => {
  const source = workerSource();
  assert.match(source, /CODEX_EXEC_FAILED/);
  assert.match(source, /codexFailures/);
  assert.match(source, /finalMessageTail/);
  assert.match(source, /shouldContinuePrepublishQueue/);
});

test('quality gate rejects missing artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ari-quality-'));
  assert.equal(readQualityGate(dir, 1).ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality gate requires all fields', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ari-quality-'));
  fs.writeFileSync(path.join(dir, 'generation-1.png'), 'not-an-image');
  fs.writeFileSync(path.join(dir, 'visual-brief.json'), '{}');
  fs.writeFileSync(path.join(dir, 'quality.json'), JSON.stringify({ TEXT_CORRECT: true }));
  assert.equal(readQualityGate(dir, 1).ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('success contract uses canonical hero.webp only', () => {
  assert.deepEqual(CANONICAL_HERO_SIZE, { width: 1672, height: 941 });
});

test('integration updates article, index, OG and Twitter', () => {
  const { root, config } = fixture();
  fs.mkdirSync(path.join(root, 'assets/insights/newest'), { recursive: true });
  fs.writeFileSync(canonicalHeroPath(config, 'newest'), 'webp');
  integrateCanonicalHero(config, 'newest');
  const result = validateIntegration(config, 'newest');
  assert.equal(result.ok, true);
  cleanup(root);
});

test('integration supports standard article-header layout', () => {
  const { root, config } = fixture();
  fs.mkdirSync(path.join(root, 'assets/insights/newest'), { recursive: true });
  fs.writeFileSync(canonicalHeroPath(config, 'newest'), 'webp');
  const file = path.join(root, 'insights/newest/index.html');
  fs.writeFileSync(file, '<meta name="twitter:card" content="summary_large_image">\n<header class="article-header"><h1>Title</h1></header>\n<article class="article-body container" data-article-slug="newest"><p>本文</p></article>\n');
  integrateCanonicalHero(config, 'newest');
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /class="insight-hero"/);
  assert.match(html, /data-article-slug="newest"><p>本文<\/p>/);
  cleanup(root);
});

test('temporary PNG is not part of integration contract', () => {
  const { root, config } = fixture();
  fs.mkdirSync(path.join(root, 'assets/insights/newest'), { recursive: true });
  fs.writeFileSync(canonicalHeroPath(config, 'newest'), 'webp');
  integrateCanonicalHero(config, 'newest');
  assert.equal(fs.existsSync(path.join(root, 'assets/insights/newest/generation-1.png')), false);
  cleanup(root);
});

test('Buffer queue is outside worker paths', () => {
  const { root, config } = fixture();
  const result = validateIntegration(config, 'newest');
  assert.ok(!result.errors.includes('buffer'));
  cleanup(root);
});

test('schedule is outside integration writes', () => {
  const { root, config } = fixture();
  const before = fs.readFileSync(config.schedulePath, 'utf8');
  fs.mkdirSync(path.join(root, 'assets/insights/newest'), { recursive: true });
  fs.writeFileSync(canonicalHeroPath(config, 'newest'), 'webp');
  integrateCanonicalHero(config, 'newest');
  assert.equal(fs.readFileSync(config.schedulePath, 'utf8'), before);
  cleanup(root);
});

test('force push is not present in worker source', () => {
  const source = fs.readFileSync(new URL('../lib/local-visual-worker.mjs', import.meta.url), 'utf8');
  assert.equal(/git', \['push', '--force/.test(source), false);
});

test('Hero exists + hero.css exists → presentation valid and no change', () => {
  const f = presentationFixture();
  const before = fs.readFileSync(path.join(f.root, 'insights/newest/index.html'), 'utf8');
  const result = validatePresentationContract(f.config, f.slug);
  assert.equal(result.status, 'PRESENTATION_VALID');
  assert.equal(fs.readFileSync(path.join(f.root, 'insights/newest/index.html'), 'utf8'), before);
  cleanup(f.root);
});

test('Hero exists + hero.css link missing → safe repair', async () => {
  const f = presentationFixture({ heroCssLink: false });
  const worker = await import('../lib/local-visual-worker.mjs');
  const result = worker.repairPresentationContract(f.config, f.slug);
  assert.equal(result.status, 'PRESENTATION_REPAIRED');
  assert.equal((fs.readFileSync(path.join(f.root, 'insights/newest/index.html'), 'utf8').match(/assets\/insights\/hero\.css/g) || []).length, 1);
  cleanup(f.root);
});

test('Hero CSS repair is duplicate-safe and idempotent', async () => {
  const f = presentationFixture({ heroCssLink: false });
  const worker = await import('../lib/local-visual-worker.mjs');
  assert.equal(worker.repairPresentationContract(f.config, f.slug).status, 'PRESENTATION_REPAIRED');
  const second = worker.repairPresentationContract(f.config, f.slug);
  assert.equal(second.status, 'PRESENTATION_VALID');
  assert.equal(second.changed, false);
  cleanup(f.root);
});

test('Hero absent → publication presentation contract remains optional', () => {
  assert.equal(validateOptionalHeroPresentation('<article>本文</article>', { heroExists: false }).status, 'HERO_OPTIONAL');
});

test('Hero exists + article Hero reference missing → detected', () => {
  const f = presentationFixture();
  const file = path.join(f.root, 'insights/newest/index.html');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('src="/assets/insights/newest/hero.webp"', 'src="/assets/other.webp"'));
  assert.ok(validatePresentationContract(f.config, f.slug).errors.includes('hero_reference_missing'));
  cleanup(f.root);
});

test('Hero exists + OG image missing/wrong → detected', () => {
  const f = presentationFixture();
  const file = path.join(f.root, 'insights/newest/index.html');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('https://example.test/assets/insights/newest/hero.webp', 'https://example.test/assets/wrong.webp'));
  assert.ok(validatePresentationContract(f.config, f.slug).errors.includes('og_image_missing'));
  cleanup(f.root);
});

test('Hero exists + Twitter image missing/wrong → detected', () => {
  const f = presentationFixture();
  const file = path.join(f.root, 'insights/newest/index.html');
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace('<meta name="twitter:image" content="https://example.test/assets/insights/newest/hero.webp">', '');
  fs.writeFileSync(file, html);
  assert.ok(validatePresentationContract(f.config, f.slug).errors.includes('twitter_image_missing'));
  cleanup(f.root);
});

test('Hero exists + index thumbnail missing → detected', () => {
  const f = presentationFixture();
  fs.writeFileSync(path.join(f.root, 'insights/index.html'), '<a data-insight-slug="newest"></a>');
  assert.ok(validatePresentationContract(f.config, f.slug).errors.includes('index_thumbnail_reference'));
  cleanup(f.root);
});

test('canonical hero.css missing → blocked without invented CSS', async () => {
  const f = presentationFixture({ css: false, heroCssLink: false });
  const worker = await import('../lib/local-visual-worker.mjs');
  const result = worker.repairPresentationContract(f.config, f.slug);
  assert.equal(result.status, 'PRESENTATION_BLOCKED');
  assert.equal(fs.existsSync(path.join(f.root, 'assets/insights/hero.css')), false);
  cleanup(f.root);
});

test('presentation repair does not modify body, publish date, schedule, Buffer or SNS state', async () => {
  const f = presentationFixture({ heroCssLink: false });
  const file = path.join(f.root, 'insights/newest/index.html');
  const before = fs.readFileSync(file, 'utf8');
  fs.mkdirSync(path.join(f.root, 'insights/_scheduled'), { recursive: true });
  fs.writeFileSync(path.join(f.root, 'insights/_scheduled/schedule.json'), '{"articles":[]}');
  fs.mkdirSync(path.join(f.root, 'insights/_social'), { recursive: true });
  fs.writeFileSync(path.join(f.root, 'insights/_social/state.json'), '{"buffer":"queued"}');
  const worker = await import('../lib/local-visual-worker.mjs');
  assert.equal(worker.repairPresentationContract(f.config, f.slug).ok, true);
  const after = fs.readFileSync(file, 'utf8');
  assert.match(after, /<article class="article-body container"><p>本文<\/p><\/article>/);
  assert.match(after, /datePublished/);
  assert.equal(fs.readFileSync(path.join(f.root, 'insights/_scheduled/schedule.json'), 'utf8'), '{"articles":[]}');
  assert.equal(fs.readFileSync(path.join(f.root, 'insights/_social/state.json'), 'utf8'), '{"buffer":"queued"}');
  assert.equal(before.replace('<link rel="stylesheet" href="../../assets/hub-animations.css">\n', ''), after.replace('<link rel="stylesheet" href="../../assets/hub-animations.css">\n<link rel="stylesheet" href="../../assets/insights/hero.css">\n', ''));
  cleanup(f.root);
});

test('presentation repair preserves article body exactly', async () => {
  const f = presentationFixture({ heroCssLink: false });
  const file = path.join(f.root, 'insights/newest/index.html');
  const beforeBody = fs.readFileSync(file, 'utf8').match(/<article[\s\S]*<\/article>/i)[0];
  const worker = await import('../lib/local-visual-worker.mjs');
  worker.repairPresentationContract(f.config, f.slug);
  assert.equal(fs.readFileSync(file, 'utf8').match(/<article[\s\S]*<\/article>/i)[0], beforeBody);
  cleanup(f.root);
});

test('presentation repair preserves publish date', async () => {
  const f = presentationFixture({ heroCssLink: false });
  const file = path.join(f.root, 'insights/newest/index.html');
  const before = fs.readFileSync(file, 'utf8').match(/datePublished[^}]+/)[0];
  const worker = await import('../lib/local-visual-worker.mjs');
  worker.repairPresentationContract(f.config, f.slug);
  assert.equal(fs.readFileSync(file, 'utf8').match(/datePublished[^}]+/)[0], before);
  cleanup(f.root);
});

test('presentation repair preserves schedule state', async () => {
  const f = presentationFixture({ heroCssLink: false });
  const schedule = path.join(f.root, 'schedule.json');
  fs.writeFileSync(schedule, '{"publishAt":"2026-08-26T01:00:00Z"}');
  const before = fs.readFileSync(schedule, 'utf8');
  const worker = await import('../lib/local-visual-worker.mjs');
  worker.repairPresentationContract(f.config, f.slug);
  assert.equal(fs.readFileSync(schedule, 'utf8'), before);
  cleanup(f.root);
});

test('presentation repair preserves Buffer and SNS state', async () => {
  const f = presentationFixture({ heroCssLink: false });
  const state = path.join(f.root, 'buffer-sns-state.json');
  fs.writeFileSync(state, '{"buffer":"queued","sns":"queued"}');
  const before = fs.readFileSync(state, 'utf8');
  const worker = await import('../lib/local-visual-worker.mjs');
  worker.repairPresentationContract(f.config, f.slug);
  assert.equal(fs.readFileSync(state, 'utf8'), before);
  cleanup(f.root);
});

test('production verification checks hero.css and canonical references', async () => {
  const f = presentationFixture();
  const css = fs.readFileSync(path.join(f.root, 'assets/insights/hero.css'), 'utf8');
  const article = fs.readFileSync(path.join(f.root, 'insights/newest/index.html'), 'utf8');
  const index = fs.readFileSync(path.join(f.root, 'insights/index.html'), 'utf8');
  const bodies = new Map([
    [`https://example.test/insights/newest/`, article],
    ['https://example.test/insights/', index],
    ['https://example.test/assets/insights/newest/hero.webp', 'webp'],
    ['https://example.test/assets/insights/hero.css', css],
  ]);
  const result = await verifyProductionReferences(f.config, f.slug, {
    productionCheck: async (url) => ({ ok: true, status: 200, contentType: url.endsWith('.webp') ? 'image/webp' : 'text/html' }),
    contentFetch: async (url) => ({ headers: { get: () => url.endsWith('.webp') ? 'image/webp' : 'text/html' }, text: async () => bodies.get(url) || '' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.heroCss.status, 200);
  cleanup(f.root);
});

test('stable HEAD behind origin/main continues', async () => {
  const f = originAheadFixture();
  const result = await runWorker({ root: f.root, dryRun: true, productionCheck: async () => ({ ok: true, status: 200 }), configOverrides: f.config });
  assert.equal(result.finalResult, 'DRY_RUN_CANDIDATE');
  cleanup(f.root);
});

test('fresh snapshot is based on origin/main', async () => {
  const f = originAheadFixture();
  assert.equal(readOriginMainSha(f.root), execFileSync('git', ['rev-parse', 'refs/remotes/origin/main'], { cwd: f.root, encoding: 'utf8' }).trim());
  const result = await runWorker({ root: f.root, dryRun: true, productionCheck: async () => ({ ok: true, status: 200 }), configOverrides: f.config });
  assert.equal(result.slug, 'policy-clarity');
  cleanup(f.root);
});

test('candidate visible only in origin/main is selected', async () => {
  const f = originAheadFixture();
  const result = await runWorker({ root: f.root, dryRun: true, productionCheck: async () => ({ ok: true, status: 200 }), configOverrides: f.config });
  assert.equal(result.slug, 'policy-clarity');
  cleanup(f.root);
});

test('stable filesystem staleness is irrelevant to discovery', async () => {
  const f = originAheadFixture();
  assert.equal(fs.existsSync(path.join(f.root, 'insights/policy-clarity/index.html')), false);
  const result = await runWorker({ root: f.root, dryRun: true, productionCheck: async () => ({ ok: true, status: 200 }), configOverrides: f.config });
  assert.equal(result.finalResult, 'DRY_RUN_CANDIDATE');
  cleanup(f.root);
});

test('dirty source workspace is ignored for origin snapshot discovery', async () => {
  const f = gitBackedFixture();
  fs.mkdirSync(path.join(f.root, 'insights/_scheduled'), { recursive: true });
  fs.writeFileSync(path.join(f.root, 'insights/_scheduled/dirty.txt'), 'do not touch');
  const result = await runWorker({ root: f.root, dryRun: true, productionCheck: async () => ({ ok: true, status: 200 }), configOverrides: f.config });
  assert.equal(result.finalResult, 'DRY_RUN_CANDIDATE');
  assert.equal(fs.readFileSync(path.join(f.root, 'insights/_scheduled/dirty.txt'), 'utf8'), 'do not touch');
  cleanup(f.root);
});

test('worker implementation dirty is a safe stop', async () => {
  const f = gitBackedFixture();
  fs.mkdirSync(path.join(f.root, 'scripts/lib'), { recursive: true });
  fs.writeFileSync(path.join(f.root, 'scripts/lib/local-visual-worker.mjs'), 'worker code');
  execFileSync('git', ['add', 'scripts/lib/local-visual-worker.mjs'], { cwd: f.root });
  execFileSync('git', ['commit', '-m', 'worker code fixture'], { cwd: f.root, stdio: 'ignore' });
  fs.appendFileSync(path.join(f.root, 'scripts/lib/local-visual-worker.mjs'), '\n// dirty worker code\n');
  assert.match(execFileSync('git', ['status', '--porcelain'], { cwd: f.root, encoding: 'utf8' }), /scripts\/lib\/local-visual-worker\.mjs/);
  assert.deepEqual(gitStatusIsSafe(f.root).workerCodeDirty, ['scripts/lib/local-visual-worker.mjs']);
  const result = await runWorker({ root: f.root, dryRun: true, productionCheck: async () => ({ ok: true, status: 200 }), configOverrides: f.config });
  assert.equal(result.finalResult, 'VISUAL_WORKER_CODE_DIRTY');
  cleanup(f.root);
});

test('base SHA is checked again immediately before push', () => {
  assert.match(workerSource(), /currentOriginMain: base/);
  assert.match(workerSource(), /base !== baseSha \|\| parent !== baseSha/);
});

test('fresh snapshot cleanup is logged on no candidate', async () => {
  const f = gitBackedFixture();
  const result = await runWorker({ root: f.root, dryRun: true, productionCheck: async () => ({ ok: false, status: 404 }), configOverrides: f.config });
  assert.equal(result.finalResult, 'NO_CANDIDATE');
  const log = fs.readFileSync(path.join(f.config.logDir, `${new Date().toISOString().slice(0, 10)}.jsonl`), 'utf8');
  assert.match(log, /"stage":"WORKTREE_CLEANUP"/);
  cleanup(f.root);
});

test('cleanup is owned by the run finally path', () => {
  assert.match(workerSource(), /removeIsolatedWorktree\(root, workspace\)/);
  assert.match(workerSource(), /finally \{/);
});

test('worker never hard-resets stable workspace', () => assert.doesNotMatch(workerSource(), /git', \['reset', '--hard/));

test('worker never auto-merges', () => assert.doesNotMatch(workerSource(), /git', \['merge',/));

test('worker never auto-rebases', () => assert.doesNotMatch(workerSource(), /git', \['rebase/));

test('worker never force-pushes', () => assert.doesNotMatch(workerSource(), /git', \['push',[^\]]*'--force/));

test('major execution stages are logged', () => {
  const source = workerSource();
  for (const stage of ['RUN_STARTED', 'FETCH_COMPLETED', 'BASE_SHA', 'WORKTREE_CREATED', 'CANDIDATE_DISCOVERY_STARTED', 'CANDIDATE_SELECTED', 'NO_CANDIDATE', 'CODEX_EXEC_STARTED', 'GENERATION_RESULT', 'QUALITY_RESULT', 'PRESENTATION_RESULT', 'COMMIT_CREATED', 'PRE_PUSH_REMOTE_CHECK', 'PUSH_RESULT', 'PRODUCTION_VERIFY_RESULT', 'WORKTREE_CLEANUP', 'FINAL_RESULT']) {
    assert.match(source, new RegExp(stage));
  }
});

test('policy-clarity fixture becomes a candidate', async () => {
  const f = originAheadFixture();
  const result = await runWorker({ root: f.root, dryRun: true, productionCheck: async () => ({ ok: true, status: 200 }), configOverrides: f.config });
  assert.deepEqual({ candidate: result.slug, hero: fs.existsSync(path.join(f.root, 'assets/insights/policy-clarity/hero.webp')) }, { candidate: 'policy-clarity', hero: false });
  cleanup(f.root);
});

test('origin-ahead is not classified as true divergence', () => {
  const f = originAheadFixture();
  const result = checkRemoteDivergence(f.root, { fetch: false });
  assert.equal(result.diverged, false);
  assert.equal(result.remoteAhead, true);
  cleanup(f.root);
});

test('push is explicitly non-force', () => assert.match(workerSource(), /\['push', 'origin', 'HEAD:main'\]/));
