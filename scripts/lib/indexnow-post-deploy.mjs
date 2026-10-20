/**
 * Post-deploy IndexNow — production HTTP 200 gate before submission.
 */
import { classifyIndexNowCandidate, DEFAULT_ROOT } from './indexnow-eligibility.mjs';
import { insightPublishUrl, submitIndexNow } from './indexnow-client.mjs';
import { verifyArticleUrl } from './url-verify.mjs';
import {
  PRODUCTION_DEPLOY_POLL_MS,
  PRODUCTION_DEPLOY_WAIT_MS,
  waitForArticleProduction,
} from './wait-production-url.mjs';

/**
 * Map production verify failure to IndexNow gate reason.
 * @param {{ ok: boolean, reason?: string, status?: number }} check
 */
export function productionGateReason(check) {
  if (check.ok) return null;
  const reason = check.reason || 'unknown';
  if (reason === 'timeout' || reason.includes('AbortError')) return 'timeout';
  if (/^HTTP 5/.test(reason)) return '500';
  if (/^HTTP 404/.test(reason) || reason === 'HTTP 404') return '404';
  if (reason === 'noindex detected') return 'noindex';
  return reason;
}

/**
 * @param {string} slug
 * @param {{ root?: string, now?: Date, verifyFn?: typeof verifyArticleUrl, skipWait?: boolean, deadlineMs?: number, dryRun?: boolean }} opts
 */
export async function verifySlugForPostDeployIndexNow(slug, opts = {}) {
  const {
    root,
    now = new Date(),
    verifyFn = verifyArticleUrl,
    skipWait = false,
    deadlineMs = PRODUCTION_DEPLOY_WAIT_MS,
    dryRun = false,
  } = opts;

  const url = insightPublishUrl(slug);
  const eligibility = classifyIndexNowCandidate(url, { root, now, requireLiveInsightFile: true });
  if (!eligibility.eligible) {
    return { slug, url, eligible: false, stage: 'eligibility', ...eligibility };
  }

  if (dryRun) {
    return { slug, url, eligible: true, stage: 'dry_run', reason: 'public', detail: slug };
  }

  const production = skipWait
    ? await verifyFn(slug)
    : await waitForArticleProduction(slug, { verifyFn, deadlineMs });

  if (!production.ok) {
    const gate = productionGateReason(production);
    return {
      slug,
      url,
      eligible: false,
      stage: 'production',
      reason: gate,
      detail: production.reason || gate,
    };
  }

  return {
    slug,
    url,
    eligible: true,
    stage: 'production',
    reason: 'public',
    detail: slug,
    httpStatus: production.status,
  };
}

/**
 * @param {string[]} slugs
 * @param {{ dryRun?: boolean, skipWait?: boolean, root?: string, now?: Date, key?: string, fetchImpl?: typeof fetch, verifyFn?: typeof verifyArticleUrl, deadlineMs?: number, pollMs?: number }} [opts]
 */
export async function submitPostDeployIndexNow(slugs, opts = {}) {
  const {
    dryRun = false,
    skipWait = false,
    root = DEFAULT_ROOT,
    now = new Date(),
    key,
    fetchImpl,
    verifyFn = verifyArticleUrl,
    deadlineMs = PRODUCTION_DEPLOY_WAIT_MS,
  } = opts;

  const unique = [...new Set(slugs.filter(Boolean))];
  if (!unique.length) {
    return { status: 'skipped', submitted: 0, deferred: [], blocked: [], urls: [] };
  }

  const deferred = [];
  const blocked = [];
  const readyUrls = [];

  for (const slug of unique) {
    const verdict = await verifySlugForPostDeployIndexNow(slug, {
      root,
      now,
      verifyFn,
      skipWait,
      deadlineMs,
      dryRun,
    });

    if (verdict.eligible) {
      readyUrls.push(verdict.url);
      if (verdict.httpStatus) {
        console.log(`IndexNow production gate PASS: ${verdict.url} (HTTP ${verdict.httpStatus})`);
      } else if (dryRun) {
        console.log(`IndexNow production gate DRY RUN: ${verdict.url}`);
      }
      continue;
    }

    const item = { slug, url: verdict.url, reason: verdict.reason, detail: verdict.detail, stage: verdict.stage };
    if (verdict.stage === 'production') {
      deferred.push(item);
      console.warn(`IndexNow: DEFERRED — ${verdict.url} (${verdict.reason}: ${verdict.detail})`);
    } else {
      blocked.push(item);
      console.warn(`IndexNow: BLOCKED — ${verdict.url} (${verdict.reason}: ${verdict.detail})`);
    }
  }

  if (!readyUrls.length) {
    const status = blocked.length ? 'blocked' : 'deferred';
    return { status, submitted: 0, deferred, blocked, urls: [], graceful: true };
  }

  const result = await submitIndexNow(readyUrls, {
    dryRun,
    enforceEligibility: true,
    key,
    fetchImpl,
    root,
    now,
  });

  if (!dryRun && result.status !== 'success' && result.status !== 'accepted' && result.status !== 'dry_run') {
    console.warn('INDEXNOW_FAILED', result.status, result.httpStatus || result.reason || '');
  }

  return {
    ...result,
    deferred,
    blocked,
    urls: readyUrls,
    graceful: true,
  };
}

export { PRODUCTION_DEPLOY_WAIT_MS, PRODUCTION_DEPLOY_POLL_MS };
