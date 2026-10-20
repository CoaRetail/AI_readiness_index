/**
 * IndexNow client — notification layer only (does not gate publish).
 * @see https://www.indexnow.org/documentation
 */
import { assertIndexNowSubmissionSafe } from './indexnow-eligibility.mjs';
import { loadCommittedIndexNowKey } from './indexnow-key.mjs';

export const INDEXNOW_HOST = 'readiness.coaretail.com';
export const INDEXNOW_BASE = `https://${INDEXNOW_HOST}`;
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

const KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/;

const BLOCKED_PATH_PREFIXES = [
  '/insights/_scheduled/',
  '/insights/_social/',
  '/crucial_data/',
  '/report/dist/',
];

/**
 * @param {string[]} slugs
 */
export function publishedUrlsFromSlugs(slugs) {
  return slugs.map((slug) => insightPublishUrl(slug));
}

/**
 * @param {string} slug
 */
export function insightPublishUrl(slug) {
  return `${INDEXNOW_BASE}/insights/${slug}/`;
}

/**
 * @param {string} key
 */
export function validateIndexNowKey(key) {
  if (!key || typeof key !== 'string') {
    return { ok: false, error: 'INDEXNOW_KEY is empty' };
  }
  if (!KEY_PATTERN.test(key)) {
    return { ok: false, error: 'INDEXNOW_KEY must be 8–128 alphanumeric/hyphen characters' };
  }
  return { ok: true };
}

/**
 * @param {string} key
 */
export function maskIndexNowKey(key) {
  if (!key || key.length < 8) return '(not configured)';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

/**
 * @param {string} urlString
 */
export function validateIndexNowUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return { ok: false, error: 'empty URL' };
  }
  const trimmed = urlString.trim();
  if (!trimmed) return { ok: false, error: 'empty URL' };

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'malformed URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: `unsupported protocol: ${parsed.protocol}` };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'credentials in URL are not allowed' };
  }
  if (parsed.hostname !== INDEXNOW_HOST) {
    return { ok: false, error: `host must be ${INDEXNOW_HOST}` };
  }

  const path = parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
  for (const blocked of BLOCKED_PATH_PREFIXES) {
    if (path.startsWith(blocked) || path.includes(blocked)) {
      return { ok: false, error: `private or build-only path: ${blocked}` };
    }
  }

  const normalized = `${INDEXNOW_BASE}${path}${parsed.search || ''}`;
  return { ok: true, url: normalized };
}

/**
 * @param {string[]} urls
 */
export function normalizeIndexNowUrls(urls) {
  const valid = [];
  const rejected = [];
  const seen = new Set();

  for (const raw of urls) {
    const check = validateIndexNowUrl(raw);
    if (!check.ok) {
      rejected.push({ url: raw, reason: check.error });
      continue;
    }
    if (seen.has(check.url)) continue;
    seen.add(check.url);
    valid.push(check.url);
  }

  return { valid, rejected };
}

/**
 * @param {string[]} urlList
 * @param {string} key
 */
export function buildIndexNowPayload(urlList, key) {
  return {
    host: INDEXNOW_HOST,
    key,
    keyLocation: `${INDEXNOW_BASE}/${key}.txt`,
    urlList,
  };
}

/**
 * @param {number} status
 */
export function classifyIndexNowResponse(status) {
  if (status === 200) return 'success';
  if (status === 202) return 'accepted';
  if (status === 400) return 'bad_request';
  if (status === 403) return 'key_verification_failed';
  if (status === 422) return 'validation_error';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'remote_error';
  return 'unexpected';
}

/**
 * Hosted `{key}.txt` wins over a mismatched INDEXNOW_KEY so the submitted
 * key is the one IndexNow can fetch.
 * @param {{ key?: string, envKey?: string, root?: string }} options
 */
export function resolveIndexNowKey(options = {}) {
  if (options.key) return { key: options.key, source: 'explicit' };
  const envKey = options.envKey !== undefined ? options.envKey : process.env.INDEXNOW_KEY;
  const committed = options.root ? loadCommittedIndexNowKey(options.root) : null;
  if (committed) {
    if (envKey && envKey !== committed) {
      console.warn(`IndexNow: INDEXNOW_KEY ${maskIndexNowKey(envKey)} does not match hosted ${maskIndexNowKey(committed)}. Using the hosted key file.`);
    }
    return { key: committed, source: 'file' };
  }
  return { key: envKey, source: 'env' };
}

/**
 * @param {string[]} urls
 * @param {{ dryRun?: boolean, fetchImpl?: typeof fetch, key?: string, envKey?: string, retryOn5xx?: boolean, enforceEligibility?: boolean, root?: string, now?: Date }} [options]
 */
export async function submitIndexNow(urls, options = {}) {
  const {
    dryRun = false,
    fetchImpl = globalThis.fetch,
    retryOn5xx = true,
    enforceEligibility = false,
    root,
    now = new Date(),
  } = options;
  const key = resolveIndexNowKey(options).key;

  const { valid, rejected } = normalizeIndexNowUrls(urls);

  if (rejected.length) {
    return {
      status: 'rejected',
      submitted: 0,
      valid,
      rejected,
      message: `${rejected.length} URL(s) rejected`,
    };
  }

  if (!valid.length) {
    return { status: 'skipped', reason: 'no valid URLs', submitted: 0, valid, rejected };
  }

  if (enforceEligibility) {
    const safety = assertIndexNowSubmissionSafe(valid, { root, now });
    if (!safety.ok) {
      console.warn(`IndexNow: BLOCKED — ${safety.message}`);
      for (const item of safety.excluded) {
        console.warn(`  - ${item.url} (${item.reason}: ${item.detail})`);
      }
      return {
        status: 'blocked',
        reason: safety.message,
        submitted: 0,
        valid: safety.eligible,
        rejected: safety.excluded.map((e) => ({ url: e.url, reason: `${e.reason}: ${e.detail}` })),
        excluded: safety.excluded,
      };
    }
  }

  const keyCheck = validateIndexNowKey(key);
  if (!keyCheck.ok) {
    console.warn(`IndexNow: SKIPPED — ${keyCheck.error}`);
    return {
      status: 'skipped',
      reason: keyCheck.error,
      submitted: 0,
      valid,
      rejected,
    };
  }

  const payload = buildIndexNowPayload(valid, key);

  if (dryRun) {
    console.log('IndexNow: DRY RUN');
    console.log(`Endpoint: ${INDEXNOW_ENDPOINT}`);
    console.log(`INDEXNOW_KEY: ${maskIndexNowKey(key)}`);
    console.log(`Payload URLs (${payload.urlList.length}):`);
    for (const u of payload.urlList) console.log(`  - ${u}`);
    return {
      status: 'dry_run',
      submitted: 0,
      valid,
      rejected,
      payload,
    };
  }

  if (typeof fetchImpl !== 'function') {
    return {
      status: 'error',
      reason: 'fetch unavailable',
      submitted: 0,
      valid,
      rejected,
      graceful: true,
    };
  }

  let attempt = 0;
  let lastResult = null;

  while (attempt < (retryOn5xx ? 2 : 1)) {
    attempt += 1;
    try {
      const res = await fetchImpl(INDEXNOW_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
      });

      const classification = classifyIndexNowResponse(res.status);
      lastResult = {
        httpStatus: res.status,
        classification,
        attempt,
      };

      if (classification === 'success' || classification === 'accepted') {
        console.log(`IndexNow: ${classification.toUpperCase()} (${res.status}) — ${valid.length} URL(s)`);
        return {
          status: classification,
          submitted: valid.length,
          valid,
          rejected,
          httpStatus: res.status,
          graceful: true,
        };
      }

      if (classification === 'rate_limited') {
        console.warn(`IndexNow: RATE LIMITED (429) — not retrying`);
        return {
          status: 'rate_limited',
          submitted: 0,
          valid,
          rejected,
          httpStatus: res.status,
          graceful: true,
        };
      }

      if (['bad_request', 'key_verification_failed', 'validation_error'].includes(classification)) {
        console.warn(`IndexNow: ${classification.toUpperCase()} (${res.status}) — publish unaffected`);
        return {
          status: classification,
          submitted: 0,
          valid,
          rejected,
          httpStatus: res.status,
          graceful: true,
        };
      }

      if (classification === 'remote_error' && attempt < 2) {
        console.warn(`IndexNow: REMOTE ERROR (${res.status}) — retrying once`);
        continue;
      }

      console.warn(`IndexNow: ${classification.toUpperCase()} (${res.status}) — publish unaffected`);
      return {
        status: classification,
        submitted: 0,
        valid,
        rejected,
        httpStatus: res.status,
        graceful: true,
      };
    } catch (err) {
      lastResult = { error: String(err.message || err), attempt };
      if (attempt < 2) {
        console.warn(`IndexNow: network error — retrying once (${lastResult.error})`);
        continue;
      }
      console.warn(`IndexNow: network error — publish unaffected (${lastResult.error})`);
      return {
        status: 'network_error',
        submitted: 0,
        valid,
        rejected,
        graceful: true,
        error: lastResult.error,
      };
    }
  }

  return {
    status: 'error',
    submitted: 0,
    valid,
    rejected,
    graceful: true,
    lastResult,
  };
}
