#!/usr/bin/env node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  INDEXNOW_BASE,
  INDEXNOW_ENDPOINT,
  buildIndexNowPayload,
  classifyIndexNowResponse,
  insightPublishUrl,
  maskIndexNowKey,
  normalizeIndexNowUrls,
  publishedUrlsFromSlugs,
  resolveIndexNowKey,
  submitIndexNow,
  validateIndexNowKey,
  validateIndexNowUrl,
} from '../lib/indexnow-client.mjs';
import { loadCommittedIndexNowKey } from '../lib/indexnow-key.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DUMMY_KEY = 'abcd1234-test-key-01';

function mockFetch(status, { calls = [] } = {}) {
  return async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      status,
      async text() {
        return '';
      },
    };
  };
}

test('T01 — No key skips without HTTP request', async () => {
  const calls = [];
  const prev = process.env.INDEXNOW_KEY;
  delete process.env.INDEXNOW_KEY;
  const result = await submitIndexNow([insightPublishUrl('example-slug')], {
    fetchImpl: (...args) => {
      calls.push(args);
      throw new Error('fetch should not run');
    },
  });
  if (prev) process.env.INDEXNOW_KEY = prev;
  assert.equal(result.status, 'skipped');
  assert.equal(calls.length, 0);
});

test('T02 — Dry run previews payload without HTTP or key leak', async () => {
  const calls = [];
  const logs = [];
  const origWarn = console.warn;
  const origLog = console.log;
  console.warn = (...args) => logs.push(args.join(' '));
  console.log = (...args) => logs.push(args.join(' '));

  const result = await submitIndexNow(
    [insightPublishUrl('dry-run-slug'), insightPublishUrl('dry-run-slug')],
    {
      dryRun: true,
      key: DUMMY_KEY,
      fetchImpl: (...args) => {
        calls.push(args);
        throw new Error('fetch should not run');
      },
    }
  );

  console.warn = origWarn;
  console.log = origLog;

  assert.equal(result.status, 'dry_run');
  assert.equal(calls.length, 0);
  assert.equal(result.payload.urlList.length, 1);
  assert.equal(result.payload.key, DUMMY_KEY);
  const joined = logs.join('\n');
  assert.match(joined, /DRY RUN/);
  assert.doesNotMatch(joined, new RegExp(DUMMY_KEY));
  assert.match(joined, /abcd\*\*\*\*y-01/);
});

test('T03 — Valid single URL (mock 200)', async () => {
  const calls = [];
  const result = await submitIndexNow([insightPublishUrl('single-url')], {
    key: DUMMY_KEY,
    fetchImpl: mockFetch(200, { calls }),
  });
  assert.equal(result.status, 'success');
  assert.equal(result.submitted, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, INDEXNOW_ENDPOINT);
  assert.deepEqual(calls[0].body.urlList, [insightPublishUrl('single-url')]);
});

test('T04 — Batch URLs (mock 202)', async () => {
  const calls = [];
  const urls = [insightPublishUrl('a'), insightPublishUrl('b')];
  const result = await submitIndexNow(urls, {
    key: DUMMY_KEY,
    fetchImpl: mockFetch(202, { calls }),
  });
  assert.equal(result.status, 'accepted');
  assert.equal(result.submitted, 2);
  assert.equal(calls[0].body.urlList.length, 2);
});

test('T05 — Duplicate URLs deduplicated', () => {
  const url = insightPublishUrl('dup');
  const { valid, rejected } = normalizeIndexNowUrls([url, url, url]);
  assert.equal(valid.length, 1);
  assert.equal(rejected.length, 0);
});

test('T06 — External domain rejected', () => {
  const check = validateIndexNowUrl('https://example.com/insights/foo/');
  assert.equal(check.ok, false);
});

test('T07 — Scheduled path rejected', () => {
  const check = validateIndexNowUrl(`${INDEXNOW_BASE}/insights/_scheduled/foo/`);
  assert.equal(check.ok, false);
});

test('T08 — Malformed URL rejected', () => {
  assert.equal(validateIndexNowUrl('javascript:alert(1)').ok, false);
  assert.equal(validateIndexNowUrl('file:///etc/passwd').ok, false);
  assert.equal(validateIndexNowUrl('not-a-url').ok, false);
});

test('T09 — Key file generation writes public_build/{key}.txt', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'indexnow-keyfile-'));
  const res = spawnSync(
    process.execPath,
    ['scripts/generate-indexnow-key-file.mjs', '--out', tmp],
    {
      cwd: ROOT,
      env: { ...process.env, INDEXNOW_KEY: DUMMY_KEY },
      encoding: 'utf8',
    }
  );
  assert.equal(res.status, 0, res.stderr);
  const filePath = path.join(tmp, `${DUMMY_KEY}.txt`);
  assert.equal(fs.existsSync(filePath), true);
  assert.equal(fs.readFileSync(filePath, 'utf8'), `${DUMMY_KEY}\n`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('T10 — Build without key skips key file (generator only)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'indexnow-nk-'));
  const env = { ...process.env };
  delete env.INDEXNOW_KEY;
  const res = spawnSync(process.execPath, ['scripts/generate-indexnow-key-file.mjs', '--out', tmp, '--env-only'], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout + res.stderr, /SKIPPED/);
  assert.equal(fs.readdirSync(tmp).length, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('T11 — Publish simulation URL candidates', () => {
  const urls = publishedUrlsFromSlugs(['three-pillars-ops', 'ari-vs-geo-seo']);
  assert.deepEqual(urls, [
    insightPublishUrl('three-pillars-ops'),
    insightPublishUrl('ari-vs-geo-seo'),
  ]);
  for (const url of urls) {
    assert.equal(validateIndexNowUrl(url).ok, true);
  }
});

test('validateIndexNowKey enforces length and charset', () => {
  assert.equal(validateIndexNowKey('short').ok, false);
  assert.equal(validateIndexNowKey('valid-key-12345678').ok, true);
  assert.equal(validateIndexNowKey('bad_key!').ok, false);
});

test('maskIndexNowKey hides middle segment', () => {
  assert.equal(maskIndexNowKey(DUMMY_KEY), 'abcd****y-01');
});

test('buildIndexNowPayload uses root keyLocation', () => {
  const payload = buildIndexNowPayload([insightPublishUrl('x')], DUMMY_KEY);
  assert.equal(payload.keyLocation, `${INDEXNOW_BASE}/${DUMMY_KEY}.txt`);
  assert.equal(payload.host, 'readiness.coaretail.com');
});

test('classifyIndexNowResponse maps HTTP codes', () => {
  assert.equal(classifyIndexNowResponse(200), 'success');
  assert.equal(classifyIndexNowResponse(403), 'key_verification_failed');
  assert.equal(classifyIndexNowResponse(429), 'rate_limited');
  assert.equal(classifyIndexNowResponse(503), 'remote_error');
});

test('5xx triggers one retry then graceful failure', async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    return { status: 503, async text() { return ''; } };
  };
  const result = await submitIndexNow([insightPublishUrl('retry-slug')], {
    key: DUMMY_KEY,
    fetchImpl,
  });
  assert.equal(attempts, 2);
  assert.equal(result.status, 'remote_error');
  assert.equal(result.graceful, true);
});

test('403 does not retry', async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    return { status: 403, async text() { return ''; } };
  };
  const result = await submitIndexNow([insightPublishUrl('forbidden')], {
    key: DUMMY_KEY,
    fetchImpl,
  });
  assert.equal(attempts, 1);
  assert.equal(result.status, 'key_verification_failed');
});

test('eligibility gate blocks a future scheduled article', async () => {
  const result = await submitIndexNow([insightPublishUrl('court-record-on-clicks')], {
    key: DUMMY_KEY,
    enforceEligibility: true,
    now: new Date('2026-10-20T12:00:00+09:00'),
    fetchImpl: () => {
      throw new Error('fetch should not run');
    },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.submitted, 0);
});

test('eligibility gate blocks protected ABIS slugs', async () => {
  const result = await submitIndexNow([insightPublishUrl('abis-intro')], {
    key: DUMMY_KEY,
    enforceEligibility: true,
    fetchImpl: () => {
      throw new Error('fetch should not run');
    },
  });
  assert.equal(result.status, 'blocked');
});

test('eligibility gate blocks editorial_hold slugs', async () => {
  const result = await submitIndexNow([insightPublishUrl('consent-data-design')], {
    key: DUMMY_KEY,
    enforceEligibility: true,
    fetchImpl: () => {
      throw new Error('fetch should not run');
    },
  });
  assert.equal(result.status, 'blocked');
});

test('eligibility allows published insight with live HTML', async () => {
  const calls = [];
  const result = await submitIndexNow([insightPublishUrl('blind')], {
    key: DUMMY_KEY,
    enforceEligibility: true,
    fetchImpl: mockFetch(200, { calls }),
  });
  assert.equal(result.status, 'success');
  assert.equal(result.submitted, 1);
});

test('full-site inventory excludes future and protected slugs', async () => {
  const { collectIndexNowEligibleUrls, classifyIndexNowCandidate } = await import(
    '../lib/indexnow-eligibility.mjs'
  );
  const inventory = collectIndexNowEligibleUrls({ root: ROOT, now: new Date('2026-10-20T12:00:00+09:00') });
  const future = classifyIndexNowCandidate(insightPublishUrl('court-record-on-clicks'), {
    root: ROOT,
    now: new Date('2026-10-20T12:00:00+09:00'),
  });
  assert.equal(future.eligible, false);
  assert.equal(future.reason, 'future_publishAt');
  assert.ok(!inventory.eligible.some((u) => u.includes('court-record-on-clicks')));
  assert.ok(!inventory.eligible.some((u) => u.includes('abis-intro')));
  assert.ok(!inventory.eligible.some((u) => u.includes('consent-data-design')));
  assert.ok(inventory.eligible.some((u) => u.includes('/insights/blind/')));
});

test('scheduled publisher defers IndexNow to post-deploy step', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/publish-scheduled-insights.mjs'), 'utf8');
  assert.doesNotMatch(src, /submitIndexNow/);
  assert.doesNotMatch(src, /notifyIndexNow/);
  assert.match(src, /deferred to post-deploy step/);
});

test('post-deploy IndexNow blocks production 404', async () => {
  const { submitPostDeployIndexNow } = await import('../lib/indexnow-post-deploy.mjs');
  const calls = [];
  const result = await submitPostDeployIndexNow(['blind'], {
    skipWait: true,
    key: DUMMY_KEY,
    verifyFn: async () => ({ ok: false, url: insightPublishUrl('blind'), reason: 'HTTP 404' }),
    fetchImpl: (...args) => {
      calls.push(args);
      throw new Error('IndexNow fetch should not run');
    },
  });
  assert.equal(result.status, 'deferred');
  assert.equal(result.submitted, 0);
  assert.equal(calls.length, 0);
  assert.equal(result.deferred[0].reason, '404');
});

test('post-deploy IndexNow blocks production 500', async () => {
  const { submitPostDeployIndexNow } = await import('../lib/indexnow-post-deploy.mjs');
  const result = await submitPostDeployIndexNow(['blind'], {
    skipWait: true,
    key: DUMMY_KEY,
    verifyFn: async () => ({ ok: false, url: insightPublishUrl('blind'), reason: 'HTTP 500' }),
    fetchImpl: () => {
      throw new Error('IndexNow fetch should not run');
    },
  });
  assert.equal(result.status, 'deferred');
  assert.equal(result.deferred[0].reason, '500');
});

test('post-deploy IndexNow allows production 200 for published slug', async () => {
  const { submitPostDeployIndexNow } = await import('../lib/indexnow-post-deploy.mjs');
  const calls = [];
  const result = await submitPostDeployIndexNow(['blind'], {
    skipWait: true,
    key: DUMMY_KEY,
    verifyFn: async () => ({
      ok: true,
      url: insightPublishUrl('blind'),
      status: 200,
      checks: { ok: true },
    }),
    fetchImpl: mockFetch(200, { calls }),
  });
  assert.equal(result.status, 'success');
  assert.equal(result.submitted, 1);
  assert.equal(calls.length, 1);
});

test('post-deploy deploy timeout defers without rollback signal', async () => {
  const { submitPostDeployIndexNow } = await import('../lib/indexnow-post-deploy.mjs');
  const { PRODUCTION_DEPLOY_POLL_MS } = await import('../lib/wait-production-url.mjs');
  const result = await submitPostDeployIndexNow(['blind'], {
    skipWait: false,
    deadlineMs: PRODUCTION_DEPLOY_POLL_MS,
    pollMs: 1,
    key: DUMMY_KEY,
    verifyFn: async () => ({ ok: false, url: insightPublishUrl('blind'), reason: 'HTTP 404' }),
    fetchImpl: () => {
      throw new Error('IndexNow fetch should not run');
    },
  });
  assert.equal(result.status, 'deferred');
  assert.equal(result.graceful, true);
  assert.equal(result.submitted, 0);
});

test('post-deploy IndexNow API failure leaves graceful publication path', async () => {
  const { submitPostDeployIndexNow } = await import('../lib/indexnow-post-deploy.mjs');
  const result = await submitPostDeployIndexNow(['blind'], {
    skipWait: true,
    key: DUMMY_KEY,
    verifyFn: async () => ({
      ok: true,
      url: insightPublishUrl('blind'),
      status: 200,
      checks: { ok: true },
    }),
    fetchImpl: async () => ({ status: 503, async text() { return ''; } }),
  });
  assert.equal(result.status, 'remote_error');
  assert.equal(result.graceful, true);
  assert.equal(result.submitted, 0);
});

test('post-deploy blocks a future article before publication', async () => {
  const { submitPostDeployIndexNow } = await import('../lib/indexnow-post-deploy.mjs');
  const result = await submitPostDeployIndexNow(['court-record-on-clicks'], {
    skipWait: true,
    key: DUMMY_KEY,
    now: new Date('2026-10-20T12:00:00+09:00'),
    verifyFn: async () => ({
      ok: true,
      url: insightPublishUrl('court-record-on-clicks'),
      status: 200,
    }),
    fetchImpl: () => {
      throw new Error('IndexNow fetch should not run');
    },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.blocked[0].reason, 'future_publishAt');
});

test('post-deploy blocks protected ABIS slugs', async () => {
  const { submitPostDeployIndexNow } = await import('../lib/indexnow-post-deploy.mjs');
  const result = await submitPostDeployIndexNow(['abis-intro'], {
    skipWait: true,
    key: DUMMY_KEY,
    verifyFn: async () => ({
      ok: true,
      url: insightPublishUrl('abis-intro'),
      status: 200,
    }),
    fetchImpl: () => {
      throw new Error('IndexNow fetch should not run');
    },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.blocked[0].reason, 'protected');
});

test('hosted key file is copied without INDEXNOW_KEY', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'indexnow-hosted-'));
  const env = { ...process.env };
  delete env.INDEXNOW_KEY;
  const res = spawnSync(process.execPath, ['scripts/generate-indexnow-key-file.mjs', '--out', tmp], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  const key = loadCommittedIndexNowKey(ROOT);
  assert.ok(key);
  assert.equal(fs.readFileSync(path.join(tmp, `${key}.txt`), 'utf8').trim(), key);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('hosted key overrides a mismatched INDEXNOW_KEY', () => {
  const hosted = loadCommittedIndexNowKey(ROOT);
  assert.ok(hosted);
  const resolved = resolveIndexNowKey({
    root: ROOT,
    envKey: 'zzzzzzzz-not-hosted',
  });
  assert.equal(resolved.source, 'file');
  assert.equal(resolved.key, hosted);
});
