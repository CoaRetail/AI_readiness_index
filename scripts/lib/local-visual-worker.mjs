import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CANONICAL_HERO_CSS_HREF,
  repairCanonicalHeroCssLink,
  validateOptionalHeroPresentation,
} from './insights-presentation.mjs';
import {
  markHeroReady,
  markHeroPending,
  PACKAGE_STATES,
} from './insights-package-readiness.mjs';
import { EDITORIAL_STATUSES } from './editorial-status.mjs';
import { findEarliestScheduledArticle, upsertPlannedCard } from './unlock-next-insight.mjs';
import {
  INSIGHTS_HERO_CONVERT_NODE,
  INSIGHTS_HERO_CONVERT_WEBP,
  INSIGHTS_HERO_TOOLCHAIN_CODE,
  assertInsightsHeroToolchain,
  codexNativeExecArgs,
  insightsHeroToolchainError,
} from './insights-hero-toolchain.mjs';

export const VISUAL_MODES = Object.freeze({
  PRIMARY_PREPUBLISH: 'PRIMARY_PREPUBLISH',
  RECOVERY_POSTPUBLISH: 'RECOVERY_POSTPUBLISH',
  HOLD_STOCK: 'HOLD_STOCK',
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(__dirname, '../..');
export const CANONICAL_HERO_SIZE = Object.freeze({ width: 1672, height: 941 });
export const MAX_CANDIDATES_PER_RUN = 2;
export const PREPUBLISH_HORIZON_DAYS = 3;
export const MAX_GENERATION_ATTEMPTS = 3;
export const CODEX_OUTPUT_TAIL_CHARS = 4000;
const PREPUBLISH_QUEUE_HARD_STOPS = new Set([
  'VISUAL_WORKER_REMOTE_DIVERGED',
  'VISUAL_WORKER_TOOLCHAIN_MISSING',
  'VISUAL_WORKER_NETWORK_BLOCKED',
  'VISUAL_WORKER_CODE_DIRTY',
]);
export const PRODUCTION_ORIGIN = 'https://readiness.coaretail.com';
export const DEFAULT_LOCK_PATH = '/private/tmp/ari-insights-visual-worker.lock';
export const DEFAULT_LOG_DIR = path.join(os.homedir(), 'Library/Logs/ARIInsightsVisualWorker');
export const WORKER_INTEGRITY_PATHS = Object.freeze([
  'scripts/local-visual-worker.sh',
  'scripts/run-insights-visual-worker.mjs',
  'scripts/run-prepublish-hero.mjs',
  'scripts/run-prepublish-hero.sh',
  'scripts/morning-preflight-insights.mjs',
  'scripts/lib/local-visual-worker.mjs',
  'scripts/lib/insights-hero-toolchain.mjs',
  'scripts/lib/insights-presentation.mjs',
  'scripts/lib/insights-package-readiness.mjs',
  'launchd/com.ari.insights.visual-worker.plist',
  'launchd/com.ari.insights.prepublish-hero.plist',
]);

const PROTECTED_SLUGS = new Set(['_scheduled', '_social']);

export function makeRunId(now = new Date()) {
  return `${now.toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${crypto.randomBytes(4).toString('hex')}`;
}

export function configFor(root = DEFAULT_ROOT, overrides = {}) {
  return {
    root,
    schedulePath: path.join(root, 'insights/_scheduled/schedule.json'),
    canonPath: path.join(root, 'ARI_INSIGHTS_VISUAL_CANON.md'),
    indexPath: path.join(root, 'insights/index.html'),
    insightsPath: path.join(root, 'insights'),
    assetsPath: path.join(root, 'assets/insights'),
    origin: PRODUCTION_ORIGIN,
    lockPath: overrides.lockPath || process.env.ARI_VISUAL_WORKER_LOCK_PATH || DEFAULT_LOCK_PATH,
    logDir: overrides.logDir || process.env.ARI_VISUAL_WORKER_LOG_DIR || DEFAULT_LOG_DIR,
    maxCandidates: MAX_CANDIDATES_PER_RUN,
    ...overrides,
  };
}

export function canonicalHeroPath(config, slug) {
  return path.join(config.assetsPath, slug, 'hero.webp');
}

export function canonicalHeroUrl(config, slug) {
  return `${config.origin}/assets/insights/${encodeURIComponent(slug)}/hero.webp`;
}

export function articleUrl(config, slug) {
  return `${config.origin}/insights/${encodeURIComponent(slug)}/`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadSchedule(config) {
  return readJson(config.schedulePath);
}

export function isProtectedSlug(slug) {
  return !slug || slug.startsWith('_') || PROTECTED_SLUGS.has(slug);
}

export function isPublishedArticle(article) {
  return article?.status === EDITORIAL_STATUSES.PUBLISHED && !isProtectedSlug(article.slug);
}

export function isScheduledPrepublishArticle(article, now = new Date()) {
  if (article?.status !== EDITORIAL_STATUSES.SCHEDULED || !article.publishAt || isProtectedSlug(article.slug)) {
    return false;
  }
  const publishMs = new Date(article.publishAt).getTime();
  const nowMs = now.getTime();
  const horizonMs = PREPUBLISH_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  if (publishMs > nowMs && publishMs - nowMs <= horizonMs) return true;
  // Same-day catch-up: unlock/reschedule missed the day-before prepublish window.
  const publishYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date(article.publishAt));
  const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(now);
  return publishYmd === todayYmd && publishMs <= nowMs;
}

export function scheduledArticleHtmlPath(config, slug, root = config.root) {
  return path.join(root, 'insights/_scheduled', slug, 'index.html');
}

export function sortNewestFirst(articles) {
  return [...articles].sort((a, b) =>
    new Date(b.publishedAt || b.publishAt || 0).getTime() -
    new Date(a.publishedAt || a.publishAt || 0).getTime()
  );
}

export async function defaultProductionCheck(url, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    return { ok: response.status === 200, status: response.status, url: response.url };
  } catch (error) {
    return { ok: false, status: null, error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Scheduled articles inside the prepublish horizon that still have no hero.webp.
 * Eligibility is the file on disk. packageReadiness, heroReadyAt, and the index
 * planned card are ignored, including after an article is unreserved and later
 * given a new publishAt.
 */
export function listPrepublishHeroGaps(config, {
  schedule = loadSchedule(config),
  now = new Date(),
} = {}) {
  const reasons = [];
  const gaps = [];
  const ordered = [...(schedule.articles || [])]
    .filter((article) => isScheduledPrepublishArticle(article, now))
    .sort((a, b) => new Date(a.publishAt).getTime() - new Date(b.publishAt).getTime()
      || String(a.slug).localeCompare(String(b.slug)));
  for (const article of ordered) {
    if (fs.existsSync(canonicalHeroPath(config, article.slug))) {
      reasons.push({ slug: article.slug, state: 'skip', reason: 'hero_exists' });
      continue;
    }
    if (!fs.existsSync(scheduledArticleHtmlPath(config, article.slug))) {
      reasons.push({ slug: article.slug, state: 'skip', reason: 'scheduled_html_missing' });
      continue;
    }
    gaps.push(article);
  }
  return { gaps, reasons };
}

export function discoverPrepublishCandidates(config, {
  schedule = loadSchedule(config),
  now = new Date(),
} = {}) {
  const { gaps, reasons } = listPrepublishHeroGaps(config, { schedule, now });
  const limit = Number.isInteger(config.maxCandidates) ? config.maxCandidates : MAX_CANDIDATES_PER_RUN;
  const selected = gaps.slice(0, Math.max(0, limit));
  for (const article of gaps.slice(selected.length)) {
    reasons.push({ slug: article.slug, state: 'defer', reason: 'max_candidates' });
  }
  return {
    candidates: selected.map((article) => ({ ...article, visualMode: VISUAL_MODES.PRIMARY_PREPUBLISH })),
    reasons,
    gaps,
  };
}

/** Morning preflight still generates when any horizon slot is missing hero.webp. */
export function morningPrepublishShouldGenerate({ report, gaps = [] } = {}) {
  if (gaps.length > 0) return true;
  return report?.ok === false;
}

export async function discoverRecoveryCandidates(config, {
  productionCheck = defaultProductionCheck,
  schedule = loadSchedule(config),
} = {}) {
  const candidates = [];
  const reasons = [];
  for (const article of sortNewestFirst(schedule.articles || [])) {
    if (!isPublishedArticle(article)) {
      reasons.push({ slug: article?.slug, state: 'excluded', reason: 'not_published_or_protected' });
      continue;
    }
    if (fs.existsSync(canonicalHeroPath(config, article.slug))) {
      reasons.push({ slug: article.slug, state: 'skip', reason: 'hero_exists' });
      continue;
    }
    const production = await productionCheck(articleUrl(config, article.slug), article);
    if (!production.ok) {
      reasons.push({ slug: article.slug, state: 'skip', reason: 'production_not_200', production });
      continue;
    }
    candidates.push({ ...article, visualMode: VISUAL_MODES.RECOVERY_POSTPUBLISH, production });
    if (candidates.length >= config.maxCandidates) break;
  }
  return { candidates, reasons };
}

export async function discoverCandidates(config, {
  mode = VISUAL_MODES.RECOVERY_POSTPUBLISH,
  productionCheck = defaultProductionCheck,
  schedule = loadSchedule(config),
  now = new Date(),
} = {}) {
  if (mode === VISUAL_MODES.PRIMARY_PREPUBLISH) {
    return discoverPrepublishCandidates(config, { schedule, now });
  }
  return discoverRecoveryCandidates(config, { productionCheck, schedule });
}

export function acquireLock(lockPath, { runId = makeRunId(), now = new Date(), staleMs = 6 * 60 * 60 * 1000 } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  if (fs.existsSync(lockPath)) {
    let existing = null;
    try { existing = readJson(lockPath); } catch { existing = { malformed: true }; }
    const age = existing?.startedAt ? now.getTime() - new Date(existing.startedAt).getTime() : Infinity;
    let alive = false;
    if (Number.isInteger(existing?.pid) && existing.pid > 0) {
      try { process.kill(existing.pid, 0); alive = true; } catch { alive = false; }
    }
    if (alive || (!alive && age <= staleMs)) {
      return { acquired: false, reason: 'active', existing };
    }
    fs.unlinkSync(lockPath);
  }
  const lock = { pid: process.pid, startedAt: now.toISOString(), runId };
  let fd;
  try {
    fd = fs.openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') return { acquired: false, reason: 'active', existing: readJson(lockPath) };
    throw error;
  }
  fs.writeFileSync(fd, JSON.stringify(lock, null, 2) + '\n');
  fs.closeSync(fd);
  return { acquired: true, lock, release: () => releaseLock(lockPath, runId) };
}

export function releaseLock(lockPath, runId) {
  if (!fs.existsSync(lockPath)) return false;
  try {
    const current = readJson(lockPath);
    if (current.runId !== runId) return false;
  } catch { return false; }
  fs.unlinkSync(lockPath);
  return true;
}

export function runCommand(command, args, { cwd, input, env, allowFailure = false, timeout = 0 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    input,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${(result.stderr || result.stdout || '').trim()}`);
  }
  return result;
}

export function gitStatusIsSafe(root, workerPaths = WORKER_INTEGRITY_PATHS) {
  const status = runCommand('git', ['status', '--porcelain'], { cwd: root }).stdout.trimEnd();
  if (!status.trim()) return { safe: true, status: '' };
  const allowed = new Set(workerPaths.map((p) => path.isAbsolute(p) ? path.relative(root, p) : p));
  const dirtyFiles = status.split('\n').map((line) => line.slice(3).replace(/^"|"$/g, ''));
  const workerCodeDirty = dirtyFiles.filter((file) => allowed.has(file));
  return {
    safe: workerCodeDirty.length === 0,
    status,
    dirtyFiles,
    sourceWorktreeDirty: dirtyFiles.filter((file) => !allowed.has(file)),
    workerCodeDirty,
  };
}

function isNetworkFailure(error) {
  return /could not resolve host|unable to access|network is unreachable|failed to connect|connection timed out|temporary failure in name resolution/i.test(String(error?.message || error));
}

export function classifyWorkerFailure(error) {
  const message = String(error?.message || '');
  if (message.startsWith('VISUAL_WORKER_REMOTE_DIVERGED')) return 'VISUAL_WORKER_REMOTE_DIVERGED';
  if (message.startsWith('VISUAL_WORKER_CODE_DIRTY')) return 'VISUAL_WORKER_CODE_DIRTY';
  if (message.startsWith('VISUAL_WORKER_NETWORK_BLOCKED')) return 'VISUAL_WORKER_NETWORK_BLOCKED';
  if (error?.code === INSIGHTS_HERO_TOOLCHAIN_CODE || message.startsWith(`${INSIGHTS_HERO_TOOLCHAIN_CODE}:`)) {
    return 'VISUAL_WORKER_TOOLCHAIN_MISSING';
  }
  return 'VISUAL_WORKER_SKIPPED';
}

export function checkRemoteDivergence(root, { fetch = true } = {}) {
  if (fetch) runCommand('git', ['fetch', '--prune', 'origin'], { cwd: root });
  const head = runCommand('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();
  const remote = runCommand('git', ['rev-parse', 'origin/main'], { cwd: root }).stdout.trim();
  const mergeBase = runCommand('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: root }).stdout.trim();
  const headIsAncestor = runCommand('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main'], { cwd: root, allowFailure: true }).status === 0;
  const remoteIsAncestor = runCommand('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], { cwd: root, allowFailure: true }).status === 0;
  return { diverged: !headIsAncestor && !remoteIsAncestor, remoteAhead: headIsAncestor && head !== remote, head, remote, mergeBase };
}

export function readOriginMainSha(root) {
  return runCommand('git', ['rev-parse', 'origin/main'], { cwd: root }).stdout.trim();
}

export function createBriefPrompt({ articleHtml, canon, slug, attempt, outputDir }) {
  return `You are the ARI Insights Local Visual Worker. This is attempt ${attempt} for slug ${slug}.

Work only inside this isolated workspace: ${outputDir}
Do not access or modify the production repository, Buffer, SNS, Git remote, or any file outside this workspace.
Do not use OPENAI_API_KEY. Do not use the OpenAI Images API. Use ChatGPT-login Native image generation only.

Read the complete article below and the authoritative Visual Canon below. First decide and save a JSON file named visual-brief.json with exactly these fields:
ARTICLE, PRIMARY_TOPIC, KEY_PHRASE, IMAGE_TEXT, LAYOUT, RATIONALE.
Then make exactly one Native image-generation call. MODE is TYPOGRAPHIC ONLY.
Save the temporary PNG as generation-${attempt}.png in this workspace.
The image must be a premium B2B editorial 16:9 hero: white or very light neutral background, navy/blue/subtle cyan accents, strong hierarchy, generous negative space, central safe area, thumbnail-readable.
Do not use explanatory, conceptual, data, abstract, generic AI art, photography, people, robots, brains, AI chips, dashboards, 3D objects, sculptures, or logos.
Use only article-supported short text. Japanese text must be exact and legible.
Keep IMAGE_TEXT deterministic: use at most one Japanese headline of 12 characters
and one optional Japanese subline of 12 characters; do not render body copy,
labels, paragraphs, punctuation-heavy text, or the full article title.
After generation, save quality.json with boolean fields: TEXT_CORRECT, JAPANESE_CORRECT, NO_GARBLED_TEXT, TYPOGRAPHIC_ONLY, ARTICLE_RELEVANT, SAFE_AREA_PASS, THUMBNAIL_READABLE, VISUAL_CANON_PASS, and numeric width and height. Set a field false if it fails.
If the native image tool returns a URL or writes the PNG under another filename, copy those bytes to generation-${attempt}.png before you finish and put that URL or path in the final message.
The Native tool also saves the PNG at $CODEX_HOME/generated_images/<thread-id>/exec-*.png (CODEX_HOME defaults to ~/.codex) and does not place that file in this workspace. Copy the newest exec-*.png from this thread into generation-${attempt}.png and include that absolute path in the final message. If you leave it there, the worker copies the newest exec-*.png for this thread that is newer than this attempt, before the quality gate.
Do not create alternate images or derivatives.

AUTHORITATIVE VISUAL CANON:
${canon}

ARTICLE HTML:
${articleHtml}
`;
}

export function imageDimensions(file, cwd) {
  const result = runCommand('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { cwd, allowFailure: true });
  const stdout = result.stdout || '';
  const width = Number((stdout.match(/pixelWidth:\s*(\d+)/) || [])[1]);
  const height = Number((stdout.match(/pixelHeight:\s*(\d+)/) || [])[1]);
  return { width, height, ok: result.status === 0 && Number.isFinite(width) && Number.isFinite(height) };
}

export function readQualityGate(workspace, attempt) {
  const briefPath = path.join(workspace, 'visual-brief.json');
  const qualityPath = path.join(workspace, 'quality.json');
  const imagePath = path.join(workspace, `generation-${attempt}.png`);
  if (!fs.existsSync(imagePath) || !fs.existsSync(briefPath) || !fs.existsSync(qualityPath)) {
    return { ok: false, reason: 'missing_generation_artifacts', imagePath };
  }
  let quality;
  let brief;
  try { quality = readJson(qualityPath); brief = readJson(briefPath); } catch (error) {
    return { ok: false, reason: 'invalid_quality_json', error: error.message };
  }
  const dimensions = imageDimensions(imagePath, workspace);
  const required = ['TEXT_CORRECT', 'JAPANESE_CORRECT', 'NO_GARBLED_TEXT', 'TYPOGRAPHIC_ONLY', 'ARTICLE_RELEVANT', 'SAFE_AREA_PASS', 'THUMBNAIL_READABLE', 'VISUAL_CANON_PASS'];
  const flags = Object.fromEntries(required.map((key) => [key, quality[key] === true]));
  const ok = dimensions.ok && dimensions.width === CANONICAL_HERO_SIZE.width && dimensions.height === CANONICAL_HERO_SIZE.height && required.every((key) => flags[key]);
  return { ok, imagePath, dimensions, quality: flags, brief, reason: ok ? null : 'quality_gate_failed' };
}

export function optimizeToWebp(input, output, cwd, {
  assertToolchain = assertInsightsHeroToolchain,
  run = runCommand,
} = {}) {
  const toolchain = assertToolchain();
  if (toolchain.converter !== INSIGHTS_HERO_CONVERT_WEBP || toolchain.nodePath !== INSIGHTS_HERO_CONVERT_NODE) {
    throw insightsHeroToolchainError([toolchain.nodePath, toolchain.converter].filter(Boolean));
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  run(toolchain.nodePath, [toolchain.converter, input, output], { cwd });
  if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error('webp_output_missing');
  return output;
}

function metaTag(property, content) {
  return `<meta ${property.startsWith('og:') ? 'property' : 'name'}="${property}" content="${content}">`;
}

export function integrateCanonicalHero(config, slug, { root = config.root } = {}) {
  const heroUrl = canonicalHeroUrl(config, slug);
  const heroPath = `/assets/insights/${slug}/hero.webp`;
  const articlePath = path.join(root, 'insights', slug, 'index.html');
  const indexPath = path.join(root, 'insights/index.html');
  if (!fs.existsSync(articlePath)) throw new Error(`article_missing:${slug}`);
  let article = fs.readFileSync(articlePath, 'utf8');
  if (!article.includes(heroUrl)) {
    const meta = `\n${metaTag('og:image', heroUrl)}\n${metaTag('twitter:image', heroUrl)}\n`;
    const marker = '<meta name="twitter:card" content="summary_large_image">';
    if (!article.includes(marker)) throw new Error(`article_metadata_marker_missing:${slug}`);
    article = article.replace(marker, marker + meta);
    const hero = `\n<figure class="insight-hero"><img src="${heroPath}" alt="${slug} のInsight Hero" width="${CANONICAL_HERO_SIZE.width}" height="${CANONICAL_HERO_SIZE.height}" loading="eager"></figure>\n`;
    const articleMarker = '</header>\n\n<article';
    if (article.includes(articleMarker)) {
      article = article.replace(articleMarker, `</header>${hero}\n<article`);
    } else {
      const articleStart = article.search(new RegExp(`<article\\b[^>]*data-article-slug=["']${slug}["'][^>]*>`));
      if (articleStart < 0) throw new Error(`article_hero_marker_missing:${slug}`);
      article = article.slice(0, articleStart) + hero.trimStart() + '\n' + article.slice(articleStart);
    }
    fs.writeFileSync(articlePath, article, 'utf8');
  }
  let index = fs.readFileSync(indexPath, 'utf8');
  const cardMarker = `data-insight-slug="${slug}"`;
  if (!index.includes(cardMarker)) throw new Error(`index_card_missing:${slug}`);
  const cardStart = index.indexOf(`<a class="insight-card" href="/insights/${slug}/"`);
  if (cardStart < 0) throw new Error(`index_card_start_missing:${slug}`);
  if (!index.includes(heroPath, cardStart)) {
    const insertAt = index.indexOf('>', cardStart) + 1;
    const thumbnail = `\n        <div class="insight-card-thumb">\n          <img src="${heroPath}" alt="" loading="lazy" width="${CANONICAL_HERO_SIZE.width}" height="${CANONICAL_HERO_SIZE.height}">\n        </div>`;
    index = index.slice(0, insertAt) + thumbnail + index.slice(insertAt);
    fs.writeFileSync(indexPath, index, 'utf8');
  }
  return { articlePath, indexPath, heroUrl, heroPath };
}

function plannedCardBounds(index, slug) {
  const marker = `data-scheduled-slug="${slug}"`;
  const markerAt = index.indexOf(marker);
  if (markerAt < 0) return null;
  const start = index.lastIndexOf('<article', markerAt);
  const closeAt = index.indexOf('</article>', markerAt);
  if (start < 0 || closeAt < 0 || start > markerAt) return null;
  return { start, end: closeAt + '</article>'.length, markerAt };
}

/** Thumbnail is required only inside this slug's planned card. A missing card is not a failure. */
export function plannedCardThumbnailSatisfied(index, slug, heroPath) {
  const bounds = plannedCardBounds(index, slug);
  if (!bounds) return { present: false, ok: true };
  const card = index.slice(bounds.start, bounds.end);
  return {
    present: true,
    ok: card.includes(heroPath) && card.includes('insight-card-thumb'),
  };
}

function slugOwnsPlannedSlot(schedule, slug) {
  const earliest = findEarliestScheduledArticle(schedule);
  return !earliest || earliest.slug === slug;
}

function insertPlannedCardThumbnail(index, slug, heroPath) {
  const bounds = plannedCardBounds(index, slug);
  if (!bounds) return index;
  const card = index.slice(bounds.start, bounds.end);
  if (card.includes(heroPath)) return index;
  const openEnd = index.indexOf('>', bounds.markerAt);
  if (openEnd < 0 || openEnd >= bounds.end) return index;
  const thumbnail = `\n        <div class="insight-card-thumb">\n          <img src="${heroPath}" alt="" loading="lazy" width="${CANONICAL_HERO_SIZE.width}" height="${CANONICAL_HERO_SIZE.height}">\n        </div>`;
  return index.slice(0, openEnd + 1) + thumbnail + index.slice(openEnd + 1);
}

export function integrateScheduledCanonicalHero(config, slug, { root = config.root } = {}) {
  const heroUrl = canonicalHeroUrl(config, slug);
  const heroPath = `/assets/insights/${slug}/hero.webp`;
  const articlePath = scheduledArticleHtmlPath(config, slug, root);
  const indexPath = path.join(root, 'insights/index.html');
  if (!fs.existsSync(articlePath)) throw new Error(`scheduled_article_missing:${slug}`);
  let article = fs.readFileSync(articlePath, 'utf8');
  if (!article.includes(heroUrl)) {
    const meta = `\n${metaTag('og:image', heroUrl)}\n${metaTag('twitter:image', heroUrl)}\n`;
    const marker = '<meta name="twitter:card" content="summary_large_image">';
    if (!article.includes(marker)) throw new Error(`article_metadata_marker_missing:${slug}`);
    article = article.replace(marker, marker + meta);
    const repaired = repairCanonicalHeroCssLink(article, { heroCssExists: fs.existsSync(path.join(root, 'assets/insights/hero.css')) });
    if (repaired.changed) article = repaired.html;
    const hero = `\n  <figure class="insight-hero"><img src="${heroPath}" alt="${slug} のInsight Hero" width="${CANONICAL_HERO_SIZE.width}" height="${CANONICAL_HERO_SIZE.height}" loading="eager"></figure>\n`;
    const articleMarker = '  </header>\n\n  <article class="article-body container"';
    if (article.includes(articleMarker)) {
      article = article.replace(articleMarker, `  </header>${hero}\n  <article class="article-body container"`);
    } else {
      const articleStart = article.search(new RegExp(`<article\\b[^>]*data-article-slug=["']${slug}["'][^>]*>`));
      if (articleStart < 0) throw new Error(`scheduled_article_hero_marker_missing:${slug}`);
      article = article.slice(0, articleStart) + hero.trimStart() + '\n' + article.slice(articleStart);
    }
    fs.writeFileSync(articlePath, article, 'utf8');
  }
  let index = fs.readFileSync(indexPath, 'utf8');
  const plannedMarker = `data-scheduled-slug="${slug}"`;
  // The public index shows one planned card: the earliest scheduled article.
  // The 10:00 JST publish job rotates it. A later reservation must not replace that card.
  if (!index.includes(plannedMarker)) {
    const schedulePath = path.join(root, 'insights/_scheduled/schedule.json');
    if (!fs.existsSync(schedulePath)) throw new Error(`planned_card_missing:${slug}`);
    const schedule = readJson(schedulePath);
    const entry = schedule.articles.find((article) => article.slug === slug);
    if (!entry) throw new Error(`planned_card_missing:${slug}`);
    if (slugOwnsPlannedSlot(schedule, slug)) {
      if (!index.includes('<!-- INSIGHTS_CARDS_START -->')) throw new Error(`planned_card_missing:${slug}`);
      index = upsertPlannedCard(index, entry, schedule);
      fs.writeFileSync(indexPath, index, 'utf8');
      if (!index.includes(plannedMarker)) throw new Error(`planned_card_missing:${slug}`);
    }
  }
  if (index.includes(plannedMarker)) {
    const updated = insertPlannedCardThumbnail(index, slug, heroPath);
    if (updated !== index) {
      index = updated;
      fs.writeFileSync(indexPath, index, 'utf8');
    }
  }
  return { articlePath, indexPath, heroUrl, heroPath };
}

/** Hold-stock hero integration — scheduled HTML only, no index planned-card mutation. */
export function integrateHoldStockHero(config, slug, { root = config.root } = {}) {
  const heroUrl = canonicalHeroUrl(config, slug);
  const heroPath = `/assets/insights/${slug}/hero.webp`;
  const articlePath = scheduledArticleHtmlPath(config, slug, root);
  if (!fs.existsSync(articlePath)) throw new Error(`scheduled_article_missing:${slug}`);
  let article = fs.readFileSync(articlePath, 'utf8');
  if (!article.includes(heroUrl)) {
    const meta = `\n${metaTag('og:image', heroUrl)}\n${metaTag('twitter:image', heroUrl)}\n`;
    const marker = '<meta name="twitter:card" content="summary_large_image">';
    if (!article.includes(marker)) throw new Error(`article_metadata_marker_missing:${slug}`);
    article = article.replace(marker, marker + meta);
    const repaired = repairCanonicalHeroCssLink(article, { heroCssExists: fs.existsSync(path.join(root, 'assets/insights/hero.css')) });
    if (repaired.changed) article = repaired.html;
    const hero = `\n  <figure class="insight-hero"><img src="${heroPath}" alt="${slug} のInsight Hero" width="${CANONICAL_HERO_SIZE.width}" height="${CANONICAL_HERO_SIZE.height}" loading="eager"></figure>\n`;
    const articleMarker = '  </header>\n\n  <article class="article-body container"';
    if (article.includes(articleMarker)) {
      article = article.replace(articleMarker, `  </header>${hero}\n  <article class="article-body container"`);
    } else {
      const articleStart = article.search(new RegExp(`<article\\b[^>]*data-article-slug=["']${slug}["'][^>]*>`));
      if (articleStart < 0) throw new Error(`scheduled_article_hero_marker_missing:${slug}`);
      article = article.slice(0, articleStart) + hero.trimStart() + '\n' + article.slice(articleStart);
    }
    fs.writeFileSync(articlePath, article, 'utf8');
  }
  return { articlePath, heroUrl, heroPath };
}

export function validateHoldStockIntegration(config, slug, { root = config.root } = {}) {
  const hero = canonicalHeroPath(config, slug);
  const articlePath = scheduledArticleHtmlPath(config, slug, root);
  const errors = [];
  if (!fs.existsSync(hero)) errors.push('hero_missing');
  if (!fs.existsSync(articlePath)) errors.push('scheduled_article_missing');
  if (!errors.length) {
    const article = fs.readFileSync(articlePath, 'utf8');
    const url = canonicalHeroUrl(config, slug);
    const rel = `/assets/insights/${slug}/hero.webp`;
    for (const [name, ok] of [
      ['scheduled_article_hero', article.includes(rel)],
      ['og_image', article.includes(`<meta property="og:image" content="${url}">`)],
      ['twitter_image', article.includes(`<meta name="twitter:image" content="${url}">`)],
    ]) if (!ok) errors.push(name);
  }
  return { ok: errors.length === 0, errors };
}

export function validateScheduledIntegration(config, slug, { root = config.root } = {}) {
  const hero = canonicalHeroPath(config, slug);
  const articlePath = scheduledArticleHtmlPath(config, slug, root);
  const indexPath = path.join(root, 'insights/index.html');
  const errors = [];
  if (!fs.existsSync(hero)) errors.push('hero_missing');
  if (!fs.existsSync(articlePath)) errors.push('scheduled_article_missing');
  if (!fs.existsSync(indexPath)) errors.push('index_missing');
  if (!errors.length) {
    const article = fs.readFileSync(articlePath, 'utf8');
    const index = fs.readFileSync(indexPath, 'utf8');
    const url = canonicalHeroUrl(config, slug);
    const rel = `/assets/insights/${slug}/hero.webp`;
    const plannedThumb = plannedCardThumbnailSatisfied(index, slug, rel);
    for (const [name, ok] of [
      ['scheduled_article_hero', article.includes(rel)],
      ['planned_card_thumbnail', plannedThumb.ok],
      ['og_image', article.includes(`<meta property="og:image" content="${url}">`)],
      ['twitter_image', article.includes(`<meta name="twitter:image" content="${url}">`)],
    ]) if (!ok) errors.push(name);
  }
  return { ok: errors.length === 0, errors };
}

function updateScheduleHeroReadiness(workspace, slug, state) {
  const schedulePath = path.join(workspace, 'insights/_scheduled/schedule.json');
  if (!fs.existsSync(schedulePath)) return;
  const schedule = readJson(schedulePath);
  const entry = schedule.articles.find((article) => article.slug === slug);
  if (!entry) return;
  if (state === PACKAGE_STATES.PACKAGE_READY) markHeroReady(entry);
  else markHeroPending(entry);
  fs.writeFileSync(schedulePath, JSON.stringify(schedule, null, 2) + '\n', 'utf8');
}

function allowedWorkerPaths(candidate) {
  const slug = candidate.slug;
  if (candidate.visualMode === VISUAL_MODES.PRIMARY_PREPUBLISH) {
    return new Set([
      `assets/insights/${slug}/hero.webp`,
      `insights/_scheduled/${slug}/index.html`,
      'insights/index.html',
      'insights/_scheduled/schedule.json',
    ]);
  }
  return new Set([
    `assets/insights/${slug}/hero.webp`,
    `insights/${slug}/index.html`,
    'insights/index.html',
  ]);
}

function articleBodySnapshot(html) {
  return html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] || '';
}

function publishDateSnapshot(html) {
  return [
    html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] || '',
    html.match(/<time\b[^>]*datetime="([^"]+)"/)?.[1] || '',
  ].join('|');
}

function validateCanonicalHeroCss(css) {
  const hero = css.match(/\.insight-hero\s*\{([^}]*)\}/)?.[1] || '';
  const image = css.match(/\.insight-hero\s+img\s*\{([^}]*)\}/)?.[1] || '';
  const mobile = css.match(/@media\s*\(max-width:\s*768px\)[\s\S]*?\.insight-hero\s*\{([^}]*)\}/)?.[1] || '';
  const checks = {
    maxWidth820: /max-width:\s*820px/.test(hero),
    width100: /width:\s*100%/.test(image),
    heightAuto: /height:\s*auto/.test(image),
    aspectRatio: /aspect-ratio:\s*16\s*\/\s*9/.test(image),
    objectFitContain: /object-fit:\s*contain/.test(image),
    mobileWidth: /width:\s*calc\(100%\s*-\s*32px\)/.test(mobile),
    mobileMaxNone: /max-width:\s*none/.test(mobile),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

export function validatePresentationContract(config, slug, { root = config.root } = {}) {
  const hero = canonicalHeroPath({ ...config, assetsPath: path.join(root, 'assets/insights') }, slug);
  if (!fs.existsSync(hero)) return { ok: true, status: 'HERO_OPTIONAL', errors: [] };
  const articlePath = path.join(root, 'insights', slug, 'index.html');
  const indexPath = path.join(root, 'insights/index.html');
  const cssPath = path.join(root, 'assets/insights/hero.css');
  const errors = [];
  if (!fs.existsSync(articlePath)) errors.push('article_missing');
  if (!fs.existsSync(indexPath)) errors.push('index_missing');
  if (!fs.existsSync(cssPath)) errors.push('hero_css_missing');
  if (errors.length) return { ok: false, status: 'PRESENTATION_BLOCKED', errors };
  const article = fs.readFileSync(articlePath, 'utf8');
  const index = fs.readFileSync(indexPath, 'utf8');
  const heroUrl = canonicalHeroUrl(config, slug);
  const rel = `/assets/insights/${slug}/hero.webp`;
  const articleGate = validateOptionalHeroPresentation(article, { slug, heroExists: true, heroCssExists: true, heroUrl });
  if (!articleGate.ok) errors.push(...articleGate.errors);
  const cardStart = index.indexOf(`data-insight-slug="${slug}"`);
  const cardEnd = cardStart >= 0 ? index.indexOf('</a>', cardStart) : -1;
  const card = cardStart >= 0 ? index.slice(cardStart, cardEnd >= 0 ? cardEnd : cardStart + 2000) : '';
  if (!card.includes(rel)) errors.push('index_thumbnail_reference');
  if (!card.includes('insight-card-thumb')) errors.push('index_thumbnail_contract');
  const cssGate = validateCanonicalHeroCss(fs.readFileSync(cssPath, 'utf8'));
  if (!cssGate.ok) errors.push('hero_css_contract');
  return { ok: errors.length === 0, status: errors.length ? 'PRESENTATION_BLOCKED' : 'PRESENTATION_VALID', errors, css: cssGate.checks };
}

export function repairPresentationContract(config, slug, { root = config.root } = {}) {
  const hero = canonicalHeroPath({ ...config, assetsPath: path.join(root, 'assets/insights') }, slug);
  if (!fs.existsSync(hero)) return { ok: true, status: 'HERO_OPTIONAL', changed: false };
  const cssPath = path.join(root, 'assets/insights/hero.css');
  const articlePath = path.join(root, 'insights', slug, 'index.html');
  if (!fs.existsSync(cssPath) || !fs.existsSync(articlePath)) return { ok: false, status: 'PRESENTATION_BLOCKED', changed: false, reason: 'canonical_asset_or_article_missing' };
  const before = fs.readFileSync(articlePath, 'utf8');
  const repaired = repairCanonicalHeroCssLink(before, { heroCssExists: true });
  if (repaired.status === 'PRESENTATION_BLOCKED') return { ok: false, status: repaired.status, changed: false, reason: repaired.reason };
  if (repaired.changed) fs.writeFileSync(articlePath, repaired.html, 'utf8');
  const after = repaired.html;
  if (articleBodySnapshot(before) !== articleBodySnapshot(after)) return { ok: false, status: 'PRESENTATION_BLOCKED', changed: repaired.changed, reason: 'article_body_changed' };
  if (publishDateSnapshot(before) !== publishDateSnapshot(after)) return { ok: false, status: 'PRESENTATION_BLOCKED', changed: repaired.changed, reason: 'publish_date_changed' };
  const validation = validatePresentationContract(config, slug, { root });
  return { ...validation, status: repaired.changed ? 'PRESENTATION_REPAIRED' : validation.status, changed: repaired.changed };
}

export function validateIntegration(config, slug, { root = config.root } = {}) {
  const hero = canonicalHeroPath(config, slug);
  const articlePath = path.join(root, 'insights', slug, 'index.html');
  const indexPath = path.join(root, 'insights/index.html');
  const errors = [];
  if (!fs.existsSync(hero)) errors.push('hero_missing');
  if (!fs.existsSync(articlePath)) errors.push('article_missing');
  if (!fs.existsSync(indexPath)) errors.push('index_missing');
  if (!errors.length) {
    const article = fs.readFileSync(articlePath, 'utf8');
    const index = fs.readFileSync(indexPath, 'utf8');
    const url = canonicalHeroUrl(config, slug);
    const rel = `/assets/insights/${slug}/hero.webp`;
    for (const [name, ok] of [
      ['article_hero', article.includes(rel)],
      ['index_thumbnail', index.includes(rel)],
      ['og_image', article.includes(`<meta property="og:image" content="${url}">`)],
      ['twitter_image', article.includes(`<meta name="twitter:image" content="${url}">`)],
    ]) if (!ok) errors.push(name);
  }
  return { ok: errors.length === 0, errors };
}

export function createLogger(config, runId) {
  fs.mkdirSync(config.logDir, { recursive: true });
  const file = path.join(config.logDir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  return (entry) => {
    const safe = { runAt: new Date().toISOString(), runId, ...entry };
    delete safe.token;
    delete safe.apiKey;
    fs.appendFileSync(file, JSON.stringify(safe) + '\n', 'utf8');
  };
}

function codexEnvironment() {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_API_KEY_FILE;
  delete env.AZURE_OPENAI_API_KEY;
  return env;
}

export function tailText(value, limit = CODEX_OUTPUT_TAIL_CHARS) {
  const text = String(value ?? '');
  return text.length <= limit ? text : text.slice(text.length - limit);
}

export function readCodexFinalMessage(outputPath, limit = CODEX_OUTPUT_TAIL_CHARS) {
  if (!outputPath || !fs.existsSync(outputPath)) return '';
  try {
    return tailText(fs.readFileSync(outputPath, 'utf8'), limit);
  } catch (error) {
    return tailText(`final_message_unreadable:${error.message}`, limit);
  }
}

const CAPABILITY_FAILURE_PATTERN = /(?:usage limit|token limit|rate limit exceeded|authentication failed|not authenticated|invalid api key|OPENAI_API_KEY)/i;

export function codexExecDiagnostics(result, outputPath) {
  const stdoutTail = tailText(result?.stdout);
  const stderrTail = tailText(result?.stderr);
  const finalMessageTail = readCodexFinalMessage(outputPath);
  const status = result?.status ?? null;
  return {
    status,
    timedOut: result?.error?.code === 'ETIMEDOUT',
    stdoutTail,
    stderrTail,
    finalMessagePath: outputPath || null,
    finalMessageTail,
    errorCode: result?.error?.code || null,
    signal: result?.signal || null,
    capabilityFailure: status !== 0 && status !== null && CAPABILITY_FAILURE_PATTERN.test(`${result?.stderr || ''}\n${result?.stdout || ''}\n${finalMessageTail}`),
  };
}

export function generationFailureReason(diagnostics) {
  if (diagnostics?.timedOut) return 'timeout';
  if (diagnostics?.status === 0) return 'codex_exec_no_image';
  return 'codex_exec_failure';
}

export function resolveMaxGenerationAttempts(env = process.env) {
  const raw = env?.ARI_VISUAL_MAX_GENERATION_ATTEMPTS;
  if (raw == null || String(raw).trim() === '') return MAX_GENERATION_ATTEMPTS;
  const parsed = Number(String(raw).trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 6) return MAX_GENERATION_ATTEMPTS;
  return parsed;
}

/** Prepublish keeps walking the horizon queue after a per-article generation or integration failure. */
export function shouldContinuePrepublishQueue(result) {
  if (!result) return false;
  if (result.finalResult === 'SUCCESS') return true;
  if (result.reason === 'capability_or_auth_failure') return false;
  if (PREPUBLISH_QUEUE_HARD_STOPS.has(result.finalResult)) return false;
  return true;
}

function nonEmptyFile(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

const IMAGE_FILE_RE = /\.(png|jpe?g|webp)$/i;

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

export function isLikelyCodexImageUrl(url) {
  const value = String(url || '');
  return /\.(?:png|jpe?g|webp)(?:$|\?)/i.test(value)
    || /[?&](?:format|fm)=(?:png|webp|jpe?g)/i.test(value)
    || /\/images?\//i.test(value)
    || /oaiusercontent|oaidalle|blob\.core\.windows\.net|filesystem\.site/i.test(value);
}

/** URLs and file paths Codex may emit when it does not write generation-N.png. */
export function extractCodexImageRefs(text) {
  const raw = String(text || '');
  const urls = [];
  const files = [];
  const markdownImageRe = /!\[[^\]]*]\(([^)\s]+)\)/g;
  const bareUrlRe = /https?:\/\/[^\s<>"')]+/gi;
  const mentionedPathRe = /(?:sandbox:|file:\/\/)?(?:\/|\.\/)[^\s<>"')]+\.(?:png|jpe?g|webp)/gi;
  for (const match of raw.matchAll(markdownImageRe)) {
    const target = match[1].trim();
    if (/^https?:\/\//i.test(target)) urls.push(target);
    else files.push(target);
  }
  for (const match of raw.matchAll(bareUrlRe)) {
    const url = match[0].replace(/[),.;\]]+$/, '');
    if (isLikelyCodexImageUrl(url)) urls.push(url);
  }
  for (const match of raw.matchAll(mentionedPathRe)) {
    files.push(match[0].replace(/[),.;\]]+$/, ''));
  }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 1 && /^https?:\/\/\S+$/.test(lines[0])) {
    urls.push(lines[0].replace(/[),.;\]]+$/, ''));
  }
  return { urls: uniqueStrings(urls), files: uniqueStrings(files) };
}

export function resolveMentionedImage(token, workspace) {
  let value = String(token || '').trim().replace(/^["']|["']$/g, '');
  if (!value) return null;
  if (value.startsWith('sandbox:')) value = value.slice('sandbox:'.length);
  if (value.startsWith('file://')) {
    const rawPath = value.slice('file://'.length);
    try { value = decodeURIComponent(rawPath); } catch { value = rawPath; }
  }
  const candidates = path.isAbsolute(value)
    ? [value, path.join(workspace, path.basename(value))]
    : [path.resolve(workspace, value), path.join(workspace, path.basename(value))];
  for (const candidate of candidates) {
    if (!IMAGE_FILE_RE.test(candidate) || !nonEmptyFile(candidate)) continue;
    const relative = path.relative(workspace, candidate).split(path.sep).join('/');
    if (!relative.startsWith('..') && relative.startsWith('assets/insights/') && path.basename(candidate) === 'hero.webp') {
      continue;
    }
    return candidate;
  }
  return null;
}

export async function downloadImageUrl(url, dest, {
  fetchImpl = globalThis.fetch,
  maxBytes = 20 * 1024 * 1024,
} = {}) {
  if (!/^https?:\/\//i.test(url)) throw new Error('unsupported_image_url');
  const response = await fetchImpl(url);
  if (!response?.ok) throw new Error(`image_download_${response?.status || 'error'}`);
  const type = response.headers?.get?.('content-type') || '';
  if (type && !/^image\//i.test(type) && !/octet-stream/i.test(type)) {
    throw new Error(`image_download_type:${type}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxBytes) throw new Error('image_download_size');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bytes);
  return dest;
}

const EXEC_PNG_NAME = /^exec-.*\.png$/i;

export function codexHomeDir(env = process.env) {
  const configured = env?.CODEX_HOME;
  if (configured != null && String(configured).trim()) return path.resolve(String(configured).trim());
  return path.join(os.homedir(), '.codex');
}

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

function safePathSegment(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,}$/.test(id)) return null;
  if (id !== path.basename(id) || id === '.' || id === '..') return null;
  return id;
}

/** Thread id Codex printed, or the directory named in a generated_images/exec-*.png path. */
export function extractCodexThreadId(texts) {
  const raw = stripAnsi((texts || []).filter(Boolean).join('\n'));
  const patterns = [
    /generated_images\/([A-Za-z0-9_-]{8,})\/exec-[A-Za-z0-9_.-]+\.png/gi,
    /(?:session|thread)[ _-]?id\s*[:=]\s*["']?([A-Za-z0-9_-]{8,})/gi,
    /"(?:thread_id|session_id|threadId|sessionId)"\s*:\s*"([A-Za-z0-9_-]{8,})"/gi,
  ];
  let found = null;
  let index = -1;
  for (const pattern of patterns) {
    for (const match of raw.matchAll(pattern)) {
      const id = safePathSegment(match[1]);
      if (!id || match.index < index) continue;
      found = id;
      index = match.index;
    }
  }
  return found;
}

function threadIdFromRolloutFilename(name) {
  const match = String(name).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match ? match[1] : null;
}

function rolloutThreadIdsSince(codexHome, startedAt) {
  const root = path.join(codexHome, 'sessions');
  if (!fs.existsSync(root)) return [];
  const found = new Set();
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const id = threadIdFromRolloutFilename(entry.name);
      if (!id) continue;
      try {
        if (fs.statSync(full).mtimeMs > startedAt) found.add(id);
      } catch { /* unreadable rollout */ }
    }
  }
  return [...found];
}

function execPngsInThread(dir, startedAt) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !EXEC_PNG_NAME.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (!stat.isFile() || stat.size <= 0 || !(stat.mtimeMs > startedAt)) continue;
    files.push({ path: full, mtimeMs: stat.mtimeMs, name: entry.name });
  }
  files.sort((a, b) => (b.mtimeMs - a.mtimeMs) || b.name.localeCompare(a.name));
  return files;
}

/**
 * Newest exec-*.png Codex saved for this run under CODEX_HOME/generated_images.
 * A known thread is the only directory searched. Otherwise only files newer than
 * the attempt start qualify, and the newest of those is the current run.
 */
export function findNewestCodexExecPng({
  codexHome,
  startedAt,
  texts = [],
  threadId = null,
} = {}) {
  const start = Number(startedAt);
  if (!codexHome || !Number.isFinite(start)) return null;
  const root = path.join(codexHome, 'generated_images');
  let threadNames;
  try {
    threadNames = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && safePathSegment(entry.name))
      .map((entry) => entry.name);
  } catch {
    return null;
  }
  const known = new Set(threadNames);
  const explicit = safePathSegment(threadId) || extractCodexThreadId(texts);
  let scoped = null;
  if (explicit) scoped = explicit;
  else {
    const rollouts = rolloutThreadIdsSince(codexHome, start).filter((id) => known.has(id));
    if (rollouts.length === 1) scoped = rollouts[0];
  }
  if (scoped) {
    if (!known.has(scoped)) return null;
    const newest = execPngsInThread(path.join(root, scoped), start)[0];
    return newest ? { ...newest, threadId: scoped } : null;
  }
  const fresh = [];
  for (const name of threadNames) {
    for (const file of execPngsInThread(path.join(root, name), start)) {
      fresh.push({ ...file, threadId: name });
    }
  }
  fresh.sort((a, b) => (b.mtimeMs - a.mtimeMs) || b.name.localeCompare(a.name));
  return fresh[0] || null;
}

/**
 * Codex Native sometimes exits 0 without writing generation-N.png.
 * On the Mac it saves ~/.codex/generated_images/<thread-id>/exec-*.png and does not
 * copy that file into the workspace. Copy the current run's PNG first, then a
 * mentioned path or URL. The quality gate and convert-webp.mjs follow.
 * This does not generate a new image.
 */
export async function recoverCodexNativeImage({
  workspace,
  attempt,
  texts = [],
  download = downloadImageUrl,
  startedAt = null,
  codexHome = null,
  env = process.env,
} = {}) {
  const target = path.join(workspace, `generation-${attempt}.png`);
  if (nonEmptyFile(target)) return { ok: true, imagePath: target, source: 'generation_png' };
  if (startedAt != null) {
    const found = findNewestCodexExecPng({
      codexHome: codexHome || codexHomeDir(env),
      startedAt,
      texts,
    });
    if (found) {
      try {
        fs.copyFileSync(found.path, target);
        if (nonEmptyFile(target)) {
          return {
            ok: true,
            imagePath: target,
            source: 'codex_generated_images',
            from: found.path,
            threadId: found.threadId,
          };
        }
      } catch {
        if (fs.existsSync(target)) fs.rmSync(target, { force: true });
      }
    }
  }
  const refs = texts.filter(Boolean).map((text) => extractCodexImageRefs(text));
  const files = uniqueStrings(refs.flatMap((ref) => ref.files));
  const urls = uniqueStrings(refs.flatMap((ref) => ref.urls));
  for (const file of files) {
    const located = resolveMentionedImage(file, workspace);
    if (!located) continue;
    if (path.resolve(located) !== path.resolve(target)) fs.copyFileSync(located, target);
    return { ok: true, imagePath: target, source: 'located_file', from: located };
  }
  for (const url of urls) {
    try {
      await download(url, target);
      if (nonEmptyFile(target)) return { ok: true, imagePath: target, source: 'downloaded_url', url };
    } catch {
      if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    }
  }
  return { ok: false, reason: 'codex_exec_no_image' };
}

/** A recovered Codex PNG with the canonical size can enter convert-webp.mjs. */
export function acceptRecoveredImageForConvert(quality, workspace, { dimensionsOf = imageDimensions } = {}) {
  if (!quality || quality.ok || quality.reason !== 'missing_generation_artifacts' || !quality.imagePath) return quality;
  const dimensions = dimensionsOf(quality.imagePath, workspace);
  if (!dimensions.ok || dimensions.width !== CANONICAL_HERO_SIZE.width || dimensions.height !== CANONICAL_HERO_SIZE.height) {
    return { ...quality, dimensions, reason: 'quality_gate_failed' };
  }
  return { ...quality, ok: true, dimensions, reason: null, recoveredWithoutQualityJson: true };
}

export function runNativeGeneration(workspace, candidate, canon, attempt, {
  assertToolchain = assertInsightsHeroToolchain,
  run = runCommand,
} = {}) {
  assertToolchain();
  const articlePath = path.join(workspace, 'article.html');
  const prompt = createBriefPrompt({
    articleHtml: fs.readFileSync(articlePath, 'utf8'),
    canon,
    slug: candidate.slug,
    attempt,
    outputDir: workspace,
  });
  const outputPath = path.join(workspace, `codex-${attempt}.final.txt`);
  const result = run('codex', codexNativeExecArgs(workspace, outputPath), {
    cwd: workspace,
    input: prompt,
    env: codexEnvironment(),
    allowFailure: true,
    timeout: 12 * 60 * 1000,
  });
  if (result.error?.code === 'ENOENT') throw insightsHeroToolchainError(['codex']);
  const diagnostics = codexExecDiagnostics(result, outputPath);
  return {
    ok: result.status === 0 && nonEmptyFile(path.join(workspace, `generation-${attempt}.png`)),
    ...diagnostics,
    outputPath,
  };
}

export async function createIsolatedWorktree(root, runId, baseSha) {
  const workspace = fs.mkdtempSync(path.join('/private/tmp', `ari-insights-visual-${runId}-`));
  const result = runCommand('git', ['worktree', 'add', '--detach', workspace, baseSha], { cwd: root, allowFailure: true });
  if (result.status !== 0) {
    fs.rmSync(workspace, { recursive: true, force: true });
    throw new Error(`worktree_create_failed:${(result.stderr || '').trim()}`);
  }
  return workspace;
}

function createReadOnlyOriginSnapshot(root, runId, baseSha) {
  const workspace = fs.mkdtempSync(path.join('/private/tmp', `ari-insights-visual-snapshot-${runId}-`));
  const archive = path.join('/private/tmp', `ari-insights-visual-snapshot-${runId}.tar`);
  try {
    runCommand('git', ['archive', '--format=tar', '--output', archive, baseSha], { cwd: root });
    runCommand('/usr/bin/tar', ['-xf', archive, '-C', workspace], { cwd: root });
    return workspace;
  } catch (error) {
    fs.rmSync(workspace, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(archive, { force: true });
  }
}

async function createExecutionWorkspace(root, runId, baseSha, { readOnly = false } = {}) {
  return readOnly
    ? createReadOnlyOriginSnapshot(root, runId, baseSha)
    : await createIsolatedWorktree(root, runId, baseSha);
}

function removeIsolatedWorktree(root, workspace) {
  runCommand('git', ['worktree', 'remove', '--force', workspace], { cwd: root, allowFailure: true });
  if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
}

async function replaceIsolatedWorktree(root, current, runId, baseSha) {
  const next = await createIsolatedWorktree(root, runId, baseSha);
  removeIsolatedWorktree(root, current);
  return next;
}

export async function verifyProduction(config, slug, { productionCheck = defaultProductionCheck } = {}) {
  const article = await productionCheck(articleUrl(config, slug));
  const hero = await productionCheck(canonicalHeroUrl(config, slug));
  const index = await productionCheck(`${config.origin}/insights/`);
  const errors = [];
  if (!article.ok) errors.push(`article_http_${article.status || 'error'}`);
  if (!hero.ok) errors.push(`hero_http_${hero.status || 'error'}`);
  if (!index.ok) errors.push(`index_http_${index.status || 'error'}`);
  if (hero.ok && hero.contentType && !hero.contentType.toLowerCase().includes('image/webp')) errors.push(`hero_content_type_${hero.contentType}`);
  return { ok: errors.length === 0, article, hero, index, errors };
}

async function productionCheckWithContent(url, options, check = defaultProductionCheck, contentFetch = fetch) {
  const result = await check(url, options);
  if (!result.ok) return result;
  try {
    const response = await contentFetch(url, { redirect: 'follow' });
    return { ...result, contentType: response.headers.get('content-type') || '', body: await response.text() };
  } catch (error) {
    return { ...result, contentType: '', body: '', error: error.message };
  }
}

export async function verifyProductionReferences(config, slug, { productionCheck = defaultProductionCheck, contentFetch = fetch } = {}) {
  const article = await productionCheckWithContent(articleUrl(config, slug), {}, productionCheck, contentFetch);
  const index = await productionCheckWithContent(`${config.origin}/insights/`, {}, productionCheck, contentFetch);
  const hero = await productionCheckWithContent(canonicalHeroUrl(config, slug), {}, productionCheck, contentFetch);
  const heroCss = await productionCheckWithContent(`${config.origin}/assets/insights/hero.css`, {}, productionCheck, contentFetch);
  const heroUrl = canonicalHeroUrl(config, slug);
  const rel = `/assets/insights/${slug}/hero.webp`;
  const errors = [];
  if (!article.ok || !article.body.includes(rel)) errors.push('article_hero_reference');
  if (!article.body.includes('../../assets/insights/hero.css') && !article.body.includes('/assets/insights/hero.css')) errors.push('article_hero_css_reference');
  if (!article.body.includes('class="insight-hero"')) errors.push('article_hero_markup');
  if (!index.ok || !index.body.includes(rel)) errors.push('index_thumbnail_reference');
  if (!article.body.includes(`<meta property="og:image" content="${heroUrl}">`)) errors.push('og_image_reference');
  if (!article.body.includes(`<meta name="twitter:image" content="${heroUrl}">`)) errors.push('twitter_image_reference');
  if (!hero.ok || !hero.contentType.toLowerCase().includes('image/webp')) errors.push('hero_webp');
  if (!heroCss.ok || !heroCss.body) errors.push('hero_css_http');
  else if (!validateCanonicalHeroCss(heroCss.body).ok) errors.push('hero_css_contract');
  return { ok: errors.length === 0, article, index, hero, heroCss, errors };
}

function archiveCodexAttempt(recoveryDir, workspace, attempt, generation, { includeImage = false } = {}) {
  const evidenceDir = path.join(recoveryDir, `attempt-${attempt}`);
  fs.mkdirSync(evidenceDir, { recursive: true });
  if (generation?.finalMessagePath && fs.existsSync(generation.finalMessagePath)) {
    fs.copyFileSync(generation.finalMessagePath, path.join(evidenceDir, path.basename(generation.finalMessagePath)));
  }
  fs.writeFileSync(path.join(evidenceDir, 'codex-exec.json'), `${JSON.stringify({
    status: generation?.status ?? null,
    timedOut: Boolean(generation?.timedOut),
    stdoutTail: generation?.stdoutTail || '',
    stderrTail: generation?.stderrTail || '',
    finalMessagePath: generation?.finalMessagePath || null,
    finalMessageTail: generation?.finalMessageTail || '',
    errorCode: generation?.errorCode || null,
  }, null, 2)}\n`, 'utf8');
  if (!includeImage) return;
  for (const file of [`generation-${attempt}.png`, 'visual-brief.json', 'quality.json']) {
    const source = path.join(workspace, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(evidenceDir, file));
  }
}

function codexFailureRecord(attempt, generation) {
  return {
    attempt,
    status: generation.status ?? null,
    timedOut: Boolean(generation.timedOut),
    reason: generationFailureReason(generation),
    stdoutTail: generation.stdoutTail || '',
    stderrTail: generation.stderrTail || '',
    finalMessagePath: generation.finalMessagePath || generation.outputPath || null,
    finalMessageTail: generation.finalMessageTail || '',
    errorCode: generation.errorCode || null,
  };
}

function saveHeroRecoveryArtifacts(recoveryDir, heroOutput, quality) {
  fs.mkdirSync(recoveryDir, { recursive: true });
  if (heroOutput && fs.existsSync(heroOutput)) {
    fs.copyFileSync(heroOutput, path.join(recoveryDir, 'hero.webp'));
  }
  if (quality?.imagePath && fs.existsSync(quality.imagePath)) {
    fs.copyFileSync(quality.imagePath, path.join(recoveryDir, path.basename(quality.imagePath)));
  }
}

async function processCandidate({ root, config, candidate, runId, log, productionCheck, workspace, baseSha }) {
  const recoveryDir = path.join(config.logDir, 'recovery', candidate.slug, runId);
  fs.mkdirSync(recoveryDir, { recursive: true });
  const prepublish = candidate.visualMode === VISUAL_MODES.PRIMARY_PREPUBLISH;
  try {
    assertInsightsHeroToolchain();
    const sourceArticle = prepublish
      ? scheduledArticleHtmlPath(config, candidate.slug, workspace)
      : path.join(workspace, 'insights', candidate.slug, 'index.html');
    const canon = fs.readFileSync(path.join(workspace, 'ARI_INSIGHTS_VISUAL_CANON.md'), 'utf8');
    fs.copyFileSync(sourceArticle, path.join(workspace, 'article.html'));
    let quality = null;
    const codexFailures = [];
    const maxAttempts = resolveMaxGenerationAttempts();
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptStartedAt = Date.now();
      log({ stage: 'CODEX_EXEC_STARTED', slug: candidate.slug, attempt, maxAttempts, attemptStartedAt });
      let generation = runNativeGeneration(workspace, candidate, canon, attempt);
      if (!generation.ok && generation.status === 0) {
        const finalMessage = generation.finalMessagePath && fs.existsSync(generation.finalMessagePath)
          ? fs.readFileSync(generation.finalMessagePath, 'utf8')
          : generation.finalMessageTail;
        const recovered = await recoverCodexNativeImage({
          workspace,
          attempt,
          texts: [finalMessage, generation.stdoutTail, generation.stderrTail],
          startedAt: attemptStartedAt,
        });
        if (recovered.ok) {
          generation = { ...generation, ok: true, recoveredImage: recovered };
          log({
            stage: 'CODEX_IMAGE_RECOVERED',
            slug: candidate.slug,
            attempt,
            source: recovered.source,
            from: recovered.from || recovered.url || null,
          });
        }
      }
      quality = generation.ok ? readQualityGate(workspace, attempt) : { ok: false, reason: generationFailureReason(generation) };
      if (generation.recoveredImage) {
        quality = acceptRecoveredImageForConvert(quality, workspace);
        if (quality.recoveredWithoutQualityJson) {
          log({ stage: 'RECOVERED_IMAGE_SIZE_OK', slug: candidate.slug, attempt, dimensions: quality.dimensions });
        }
      }
      if (!generation.ok) {
        const failure = codexFailureRecord(attempt, generation);
        codexFailures.push(failure);
        log({ stage: 'CODEX_EXEC_FAILED', slug: candidate.slug, ...failure });
      }
      log({
        stage: 'GENERATION_RESULT',
        slug: candidate.slug,
        attempt,
        generation: {
          ok: generation.ok,
          status: generation.status,
          timedOut: generation.timedOut,
          finalMessagePath: generation.finalMessagePath || null,
          stdoutTail: generation.ok ? undefined : generation.stdoutTail,
          stderrTail: generation.ok ? undefined : generation.stderrTail,
          finalMessageTail: generation.ok ? undefined : generation.finalMessageTail,
        },
        quality: quality.reason || 'pass',
        dimensions: quality.dimensions || null,
        qualityFlags: quality.quality || null,
      });
      log({ stage: 'QUALITY_RESULT', slug: candidate.slug, attempt, ok: quality.ok, reason: quality.reason || null, dimensions: quality.dimensions || null, qualityFlags: quality.quality || null });
      if (!generation.ok || !quality.ok) {
        try {
          archiveCodexAttempt(recoveryDir, workspace, attempt, generation, { includeImage: generation.ok && !quality.ok });
        } catch (archiveError) {
          log({ stage: 'CODEX_EVIDENCE_ARCHIVE_FAILED', slug: candidate.slug, attempt, error: archiveError.message });
        }
      }
      if (!generation.ok && (generation.capabilityFailure || generation.timedOut)) {
        return {
          finalResult: 'VISUAL_WORKER_SKIPPED',
          slug: candidate.slug,
          reason: generation.timedOut ? 'timeout' : 'capability_or_auth_failure',
          codexFailures,
        };
      }
      if (quality.ok) break;
    }
    if (!quality?.ok) {
      return {
        finalResult: 'VISUAL_WORKER_SKIPPED_QUALITY',
        slug: candidate.slug,
        reason: quality?.reason || 'quality_gate_failed',
        codexFailures,
      };
    }
    const heroOutput = path.join(workspace, 'assets', 'insights', candidate.slug, 'hero.webp');
    optimizeToWebp(quality.imagePath, heroOutput, workspace);
    const workspaceConfig = { ...config, root: workspace, assetsPath: path.join(workspace, 'assets/insights') };
    try {
      if (prepublish) {
        integrateScheduledCanonicalHero(workspaceConfig, candidate.slug, { root: workspace });
        updateScheduleHeroReadiness(workspace, candidate.slug, PACKAGE_STATES.PACKAGE_READY);
      } else {
        integrateCanonicalHero(workspaceConfig, candidate.slug, { root: workspace });
      }
    } catch (integrationError) {
      saveHeroRecoveryArtifacts(recoveryDir, heroOutput, quality);
      throw integrationError;
    }
    log({ stage: 'PRESENTATION_CHECK_STARTED', slug: candidate.slug, visualMode: candidate.visualMode });
    const presentation = prepublish
      ? { ok: true, status: 'SCHEDULED_PRESENTATION_VALID' }
      : repairPresentationContract(workspaceConfig, candidate.slug, { root: workspace });
    log({ stage: 'PRESENTATION_RESULT', slug: candidate.slug, presentationState: presentation.status, presentationErrors: presentation.errors || [presentation.reason].filter(Boolean) });
    if (!presentation.ok) return { finalResult: 'VISUAL_WORKER_PRESENTATION_BLOCKED', slug: candidate.slug, presentation };
    const integration = prepublish
      ? validateScheduledIntegration(workspaceConfig, candidate.slug, { root: workspace })
      : validateIntegration(workspaceConfig, candidate.slug, { root: workspace });
    if (!integration.ok) throw new Error(`integration_failed:${integration.errors.join(',')}`);
    const diff = runCommand('git', ['diff', '--name-only'], { cwd: workspace }).stdout.trim().split('\n').filter(Boolean);
    const allowed = allowedWorkerPaths(candidate);
    if (diff.some((file) => !allowed.has(file))) throw new Error(`unexpected_worker_diff:${diff.join(',')}`);
    runCommand('git', ['diff', '--check'], { cwd: workspace });
    runCommand('git', ['add', '--', ...[...allowed]], { cwd: workspace });
    const staged = runCommand('git', ['diff', '--cached', '--name-only'], { cwd: workspace }).stdout.trim().split('\n').filter(Boolean);
    if (staged.some((file) => !allowed.has(file))) throw new Error(`unexpected_staged_file:${staged.join(',')}`);
    const commitMessage = prepublish
      ? `feat(insights): add pre-publish hero for ${candidate.slug}`
      : `feat(insights): add hero for ${candidate.slug}`;
    runCommand('git', ['commit', '-m', commitMessage], { cwd: workspace });
    const commitSha = runCommand('git', ['rev-parse', 'HEAD'], { cwd: workspace }).stdout.trim();
    log({ stage: 'COMMIT_CREATED', slug: candidate.slug, commitSha, baseSha, visualMode: candidate.visualMode });
    runCommand('git', ['fetch', '--prune', 'origin'], { cwd: workspace });
    const base = readOriginMainSha(workspace);
    const parent = runCommand('git', ['rev-parse', 'HEAD^'], { cwd: workspace }).stdout.trim();
    log({ stage: 'PRE_PUSH_REMOTE_CHECK', slug: candidate.slug, baseSha, currentOriginMain: base, commitParent: parent });
    if (base !== baseSha || parent !== baseSha) throw new Error('VISUAL_WORKER_REMOTE_DIVERGED');
    runCommand('git', ['push', 'origin', 'HEAD:main'], { cwd: workspace });
    log({ stage: 'PUSH_RESULT', slug: candidate.slug, ok: true, force: false, visualMode: candidate.visualMode });
    if (prepublish) {
      log({ stage: 'SCHEDULED_PACKAGE_VERIFY_RESULT', slug: candidate.slug, ok: true, integration });
      return { finalResult: 'SUCCESS', slug: candidate.slug, visualMode: candidate.visualMode, integration, commitSha };
    }
    const production = await verifyProductionReferences(config, candidate.slug, { productionCheck });
    log({ stage: 'PRODUCTION_VERIFY_RESULT', slug: candidate.slug, ok: production.ok, errors: production.errors });
    if (!production.ok) {
      fs.cpSync(quality.imagePath, path.join(recoveryDir, path.basename(quality.imagePath)));
      return { finalResult: 'PRODUCTION_VERIFY_FAILED', slug: candidate.slug, production, recoveryDir, commitSha };
    }
    return { finalResult: 'SUCCESS', slug: candidate.slug, production, commitSha };
  } finally { /* workspace cleanup is owned by runWorker */ }
}

export async function runWorker({
  root = DEFAULT_ROOT,
  dryRun = false,
  simulate = false,
  now = new Date(),
  fetch = true,
  productionCheck,
  runId = makeRunId(now),
  configOverrides = {},
  visualMode = VISUAL_MODES.RECOVERY_POSTPUBLISH,
} = {}) {
  const config = configFor(root, configOverrides);
  const log = createLogger(config, runId);
  log({ stage: 'RUN_STARTED', mode: dryRun ? 'dry-run' : simulate ? 'simulate' : 'run', visualMode, maxGenerationAttempts: resolveMaxGenerationAttempts() });
  const lock = acquireLock(config.lockPath, { runId, now });
  if (!lock.acquired) {
    log({ stage: 'LOCK', finalResult: 'VISUAL_WORKER_SKIPPED', candidateState: 'lock_active' });
    return { finalResult: 'VISUAL_WORKER_SKIPPED', reason: 'lock_active', runId };
  }
  log({ stage: 'LOCK', acquired: true });
  let workspace = null;
  try {
    const safety = gitStatusIsSafe(root);
    if (safety.workerCodeDirty?.length) {
      throw new Error(`VISUAL_WORKER_CODE_DIRTY:${safety.workerCodeDirty.join(',')}`);
    }
    let sync;
    try {
      sync = checkRemoteDivergence(root, { fetch: !dryRun && fetch });
    } catch (error) {
      if (isNetworkFailure(error)) throw new Error(`VISUAL_WORKER_NETWORK_BLOCKED:${error.message}`);
      throw error;
    }
    log({ stage: 'FETCH_COMPLETED', fetched: !dryRun && fetch, remoteAhead: sync.remoteAhead, diverged: sync.diverged });
    if (sync.diverged) throw new Error('VISUAL_WORKER_REMOTE_DIVERGED');
    const baseSha = readOriginMainSha(root);
    log({ stage: 'BASE_SHA', baseSha });
    workspace = await createExecutionWorkspace(root, runId, baseSha, { readOnly: dryRun || simulate });
    log({ stage: 'WORKTREE_CREATED', workspace, baseSha, readOnly: dryRun || simulate });
    const workspaceConfig = configFor(workspace, { origin: config.origin, logDir: config.logDir, lockPath: config.lockPath, maxCandidates: config.maxCandidates });
    log({ stage: 'CANDIDATE_DISCOVERY_STARTED', visualMode });
    const discovered = await discoverCandidates(workspaceConfig, { mode: visualMode, productionCheck, now });
    log({
      stage: discovered.candidates.length ? 'CANDIDATE_SELECTED' : 'NO_CANDIDATE',
      visualMode,
      candidates: discovered.candidates.map((a) => a.slug),
      reasons: discovered.reasons.slice(0, 30),
    });
    if (!discovered.candidates.length) {
      const finalResult = visualMode === VISUAL_MODES.RECOVERY_POSTPUBLISH ? 'NO_CANDIDATE' : 'NO_PREPUBLISH_CANDIDATE';
      return { finalResult, runId, reasons: discovered.reasons, visualMode };
    }

    let activeBaseSha = baseSha;
    const candidateResults = [];
    for (let index = 0; index < discovered.candidates.length; index += 1) {
      const candidate = discovered.candidates[index];
      if (dryRun || simulate) {
        return { finalResult: 'DRY_RUN_CANDIDATE', runId, slug: candidate.slug, title: candidate.title };
      }
      let result;
      try {
        result = await processCandidate({ root, config, candidate, runId, log, productionCheck, workspace, baseSha: activeBaseSha });
      } catch (error) {
        const failed = { finalResult: classifyWorkerFailure(error), error: error.message, slug: candidate.slug };
        const continuable = visualMode === VISUAL_MODES.PRIMARY_PREPUBLISH && shouldContinuePrepublishQueue(failed);
        if (!continuable) {
          if (visualMode === VISUAL_MODES.PRIMARY_PREPUBLISH && candidateResults.some((entry) => entry.finalResult === 'SUCCESS')) {
            log({ stage: 'CANDIDATE_FAILED', slug: candidate.slug, finalResult: failed.finalResult, error: error.message });
            candidateResults.push(failed);
            const lastSuccess = candidateResults.findLast((entry) => entry.finalResult === 'SUCCESS');
            return { ...lastSuccess, runId, processed: candidateResults, partial: true };
          }
          throw error;
        }
        log({ stage: 'CANDIDATE_FAILED_CONTINUE', slug: candidate.slug, finalResult: failed.finalResult, error: error.message });
        result = failed;
      }
      log({
        slug: candidate.slug,
        finalResult: result.finalResult,
        reason: result.reason || null,
        error: result.error || null,
        codexFailures: result.codexFailures || null,
      });
      candidateResults.push(result);
      const prepublishContinue = visualMode === VISUAL_MODES.PRIMARY_PREPUBLISH && shouldContinuePrepublishQueue(result);
      const recoverySuccess = visualMode !== VISUAL_MODES.PRIMARY_PREPUBLISH && result.finalResult === 'SUCCESS';
      if (!prepublishContinue && !recoverySuccess) {
        if (visualMode === VISUAL_MODES.PRIMARY_PREPUBLISH && candidateResults.some((entry) => entry.finalResult === 'SUCCESS')) {
          const lastSuccess = candidateResults.findLast((entry) => entry.finalResult === 'SUCCESS');
          return { ...lastSuccess, runId, processed: candidateResults, partial: true };
        }
        return { ...result, runId, processed: candidateResults };
      }
      if (result.finalResult === 'SUCCESS' && result.commitSha) activeBaseSha = result.commitSha;
      if (index === discovered.candidates.length - 1) break;
      workspace = await replaceIsolatedWorktree(root, workspace, `${runId}-c${index + 1}`, activeBaseSha);
      log({ stage: 'WORKTREE_REFRESHED', workspace, baseSha: activeBaseSha, previousSlug: candidate.slug });
    }
    const lastSuccess = candidateResults.findLast((entry) => entry.finalResult === 'SUCCESS');
    const last = lastSuccess || candidateResults[candidateResults.length - 1];
    const partial = Boolean(lastSuccess) && candidateResults.some((entry) => entry.finalResult !== 'SUCCESS');
    return { ...last, runId, processed: candidateResults, ...(partial ? { partial: true } : {}) };
  } catch (error) {
    const finalResult = classifyWorkerFailure(error);
    log({ stage: 'ERROR', finalResult, error: error.message });
    return { finalResult, error: error.message, runId };
  } finally {
    if (workspace) {
      removeIsolatedWorktree(root, workspace);
      log({ stage: 'WORKTREE_CLEANUP', workspace });
    }
    log({ stage: 'FINAL_RESULT', runId });
    lock.release();
  }
}
