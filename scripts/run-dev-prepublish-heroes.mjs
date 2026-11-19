#!/usr/bin/env node
/**
 * Dev-only: Codex Native prepublish heroes in the current worktree (no git commit/push).
 * Same pipeline as local-visual-worker processCandidate (PRIMARY_PREPUBLISH).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VISUAL_MODES,
  acceptRecoveredImageForConvert,
  canonicalHeroPath,
  configFor,
  generationFailureReason,
  integrateScheduledCanonicalHero,
  optimizeToWebp,
  readQualityGate,
  recoverCodexNativeImage,
  resolveMaxGenerationAttempts,
  runNativeGeneration,
  scheduledArticleHtmlPath,
  validateScheduledIntegration,
} from './lib/local-visual-worker.mjs';
import {
  assertInsightsHeroToolchain,
  INSIGHTS_HERO_TOOLCHAIN_CODE,
} from './lib/insights-hero-toolchain.mjs';
import {
  markHeroPending,
  markHeroReady,
  PACKAGE_STATES,
  loadSchedule,
  saveSchedule,
} from './lib/insights-package-readiness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '..');

const DEFAULT_SLUGS = [
  'answers-without-opening-sources',
  'within-domain-citation-features',
  'deepseek-authority-tiers',
  'ai-referral-volume-and-conversion',
  'how-many-runs-before-ai-visibility',
  'shopping-agents-fail-before-payment',
  'cloudflare-openai-chatgpt-index',
  'ai-mode-global-ads-product-links',
  'merchant-ucp-agentic-performance-api',
  'industry-ai-citation-source-mix',
  'usage-ai-training-robots-token',
  'mckinsey-shopping-ai-chat-vs-retailer',
  'geo-location-changes-cited-sources',
  'perplexity-computer-chrome-extension',
  'predicting-answer-engine-cite-share',
];

function parseArgs() {
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg >= 0 ? path.resolve(process.argv[rootArg + 1]) : DEFAULT_ROOT;
  const skipExisting = !process.argv.includes('--force');
  const slugs = (() => {
    const i = process.argv.indexOf('--slug');
    if (i >= 0) return [process.argv[i + 1]];
    const rest = process.argv.slice(2).filter((a, idx, arr) => {
      if (a.startsWith('--')) return false;
      const prev = arr[idx - 1];
      if (prev === '--root') return false;
      return true;
    });
    return rest.length ? rest : DEFAULT_SLUGS;
  })();
  return { root, slugs, skipExisting };
}

const schedulePathFor = (root) => path.join(root, 'insights/_scheduled/schedule.json');

function updateScheduleHeroReadiness(root, slug, state) {
  const schedulePath = schedulePathFor(root);
  const schedule = loadSchedule(schedulePath);
  const entry = schedule.articles.find((a) => a.slug === slug);
  if (!entry) return;
  if (state === PACKAGE_STATES.PACKAGE_READY) markHeroReady(entry);
  else markHeroPending(entry);
  saveSchedule(schedule, schedulePath);
}

async function generateOne(root, slug, { skipExisting }) {
  const config = configFor(root);
  if (skipExisting && fs.existsSync(canonicalHeroPath(config, slug))) {
    try {
      integrateScheduledCanonicalHero(config, slug, { root });
      updateScheduleHeroReadiness(root, slug, PACKAGE_STATES.PACKAGE_READY);
    } catch {
      /* integrate only if needed */
    }
    const integration = validateScheduledIntegration(config, slug, { root });
    return {
      slug,
      status: integration.ok ? 'ok' : 'HERO_PENDING',
      reason: integration.ok ? 'hero_exists' : integration.errors.join(','),
      attempts: 0,
    };
  }

  const articlePath = scheduledArticleHtmlPath(config, slug, root);
  if (!fs.existsSync(articlePath)) {
    return { slug, status: 'HERO_PENDING', reason: 'missing_html', attempts: 0 };
  }

  try {
    assertInsightsHeroToolchain();
  } catch (error) {
    if (error.code === INSIGHTS_HERO_TOOLCHAIN_CODE) {
      return { slug, status: 'HERO_PENDING', reason: error.message, attempts: 0 };
    }
    throw error;
  }

  const workspace = fs.mkdtempSync(path.join('/private/tmp', `ari-dev-prepublish-${slug}-`));
  const canonPath = path.join(root, 'ARI_INSIGHTS_VISUAL_CANON.md');
  const canon = fs.readFileSync(canonPath, 'utf8');
  fs.copyFileSync(articlePath, path.join(workspace, 'article.html'));

  const schedule = loadSchedule(schedulePathFor(root));
  const entry = schedule.articles.find((a) => a.slug === slug) || { slug, title: slug };
  const candidate = { ...entry, visualMode: VISUAL_MODES.PRIMARY_PREPUBLISH };

  let quality = null;
  const codexFailures = [];
  const maxAttempts = resolveMaxGenerationAttempts();

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptStartedAt = Date.now();
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
        }
      }
      quality = generation.ok ? readQualityGate(workspace, attempt) : { ok: false, reason: generationFailureReason(generation) };
      if (generation.recoveredImage) {
        quality = acceptRecoveredImageForConvert(quality, workspace);
      }
      if (!generation.ok) {
        codexFailures.push({
          attempt,
          reason: generationFailureReason(generation),
          stderrTail: generation.stderrTail || '',
          stdoutTail: generation.stdoutTail || '',
        });
      }
      if (!generation.ok && (generation.capabilityFailure || generation.timedOut)) {
        updateScheduleHeroReadiness(root, slug, PACKAGE_STATES.HERO_PENDING);
        return {
          slug,
          status: 'HERO_PENDING',
          reason: generation.timedOut ? 'timeout' : 'capability_failure',
          attempts: attempt,
          codexFailures,
        };
      }
      if (generation.ok && quality.ok) break;
    }

    if (!quality?.ok) {
      updateScheduleHeroReadiness(root, slug, PACKAGE_STATES.HERO_PENDING);
      return {
        slug,
        status: 'HERO_PENDING',
        reason: quality?.reason || 'quality_gate_failed',
        attempts: maxAttempts,
        codexFailures,
      };
    }

    const heroOutput = canonicalHeroPath(config, slug);
    fs.mkdirSync(path.dirname(heroOutput), { recursive: true });
    optimizeToWebp(quality.imagePath, heroOutput, workspace);
    integrateScheduledCanonicalHero(config, slug, { root });
    updateScheduleHeroReadiness(root, slug, PACKAGE_STATES.PACKAGE_READY);
    const integration = validateScheduledIntegration(config, slug, { root });
    if (!integration.ok) {
      return {
        slug,
        status: 'HERO_PENDING',
        reason: integration.errors.join(','),
        attempts: maxAttempts,
        codexFailures,
      };
    }
    return { slug, status: 'ok', attempts: maxAttempts, codexFailures: codexFailures.length ? codexFailures : undefined };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

const { root, slugs, skipExisting } = parseArgs();
const reportPath = path.join(root, 'reports/dev-prepublish-heroes-report.json');
const results = [];

for (const slug of slugs) {
  console.log(`\n=== ${slug} ===`);
  const result = await generateOne(root, slug, { skipExisting });
  results.push(result);
  console.log(JSON.stringify(result, null, 2));
}

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`, 'utf8');
console.log(`\nReport: ${reportPath}`);
const failed = results.filter((r) => r.status !== 'ok');
process.exit(failed.length ? 1 : 0);