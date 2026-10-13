#!/usr/bin/env node
/**
 * Unit tests for multi-channel Buffer dispatcher.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isChannelQueued,
  isChannelEligible,
  pickTodayArticle,
  validateChannelContent,
  processArticleChannels,
  parseChannelsArg,
} from '../lib/buffer-dispatcher.mjs';
import {
  CHANNEL_STATUSES,
  EXISTING_BUFFER_SENTINEL,
  isBufferDuplicateScheduleError,
} from '../lib/social-channels.mjs';
import { resolvePublishAt, toBufferDueAt, jstMinutesFromMidnight } from '../lib/social-schedule.mjs';
import {
  getChannelId,
  getBufferConfig,
  buildCreatePostInput,
} from '../lib/buffer-client.mjs';
import { duplicateBufferLedgerKeys, duplicateBufferChannelKeys, assertBufferLedgerSemanticInvariants, bufferLedgerKey } from '../lib/buffer-ledger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const BUFFER_QUEUE = path.join(ROOT, 'insights/_social/buffer/queue.json');
const VENDOR_PAD = '施策を増やしてもAIに選ばれない理由は、情報の連続性の欠如にあることがあります。';

function mockArticle(overrides = {}) {
  const url = 'https://readiness.coaretail.com/insights/ai-search-shift/';
  return {
    slug: 'ai-search-shift',
    articleUrl: url,
    status: 'scheduled',
    bufferTransferAt: '2026-08-05T10:30:00+09:00',
    channels: {
      linkedin: {
        channelIdEnv: 'BUFFER_CHANNEL_ID_LINKEDIN',
        contentFile: 'insights/_social/linkedin/posts/ai-search-shift.md',
        publishAt: '2026-08-05T11:30:00+09:00',
        status: CHANNEL_STATUSES.QUEUED,
        bufferUpdateId: EXISTING_BUFFER_SENTINEL,
      },
      facebook: {
        channelIdEnv: 'BUFFER_CHANNEL_ID_FACEBOOK',
        contentFile: 'insights/_social/facebook/posts/ai-search-shift.md',
        publishAt: '2026-08-05T11:45:00+09:00',
        status: CHANNEL_STATUSES.SCHEDULED,
        bufferUpdateId: null,
      },
      x: {
        channelIdEnv: 'BUFFER_CHANNEL_ID_TWITTER',
        contentFile: 'insights/_social/x/posts/ai-search-shift.md',
        publishAt: '2026-08-05T12:00:00+09:00',
        status: CHANNEL_STATUSES.SCHEDULED,
        bufferUpdateId: null,
      },
    },
    ...overrides,
  };
}

test('parseChannelsArg maps twitter to x', () => {
  assert.deepEqual(parseChannelsArg('facebook,twitter'), ['facebook', 'x']);
});

test('isChannelQueued respects sentinel and bufferUpdateId', () => {
  assert.equal(isChannelQueued({ bufferUpdateId: EXISTING_BUFFER_SENTINEL }), true);
  assert.equal(isChannelQueued({ bufferUpdateId: 'abc123' }), true);
  assert.equal(isChannelQueued({ status: CHANNEL_STATUSES.QUEUED, bufferUpdateId: null }), true);
  assert.equal(isChannelQueued({ status: CHANNEL_STATUSES.SCHEDULED, bufferUpdateId: null }), false);
});

test('resolvePublishAt bumps past times by 30min minimum', () => {
  const now = new Date('2026-08-04T11:45:00+09:00');
  const bumped = resolvePublishAt('2026-08-04T11:45:00+09:00', now, 30);
  assert.ok(new Date(bumped).getTime() >= now.getTime() + 30 * 60_000);
});

test('resolvePublishAt uses JST on UTC runner (GHA 12:14 JST scenario)', () => {
  // GitHub Actions runner: system TZ=UTC, now=03:14Z = 12:14 JST
  const now = new Date('2026-08-04T03:14:00.000Z');
  const fb = resolvePublishAt('2026-08-04T12:30:00+09:00', now, 30);
  assert.equal(fb, '2026-08-04T12:45:00+09:00');
  assert.equal(toBufferDueAt(fb), '2026-08-04T03:45:00.000Z');

  const x = resolvePublishAt('2026-08-04T12:45:00+09:00', now, 30);
  assert.equal(x, '2026-08-04T12:45:00+09:00');
  assert.equal(toBufferDueAt(x), '2026-08-04T03:45:00.000Z');
});

test('toBufferDueAt converts JST schedule to UTC ISO for Buffer API', () => {
  assert.equal(toBufferDueAt('2026-08-04T12:30:00+09:00'), '2026-08-04T03:30:00.000Z');
  assert.equal(toBufferDueAt('2026-08-04T12:45:00+09:00'), '2026-08-04T03:45:00.000Z');
});

test('buildCreatePostInput sets Facebook type post and UTC dueAt', () => {
  const input = buildCreatePostInput({
    channelKey: 'facebook',
    channelId: 'fb-ch',
    text: 'hello',
    dueAtUtc: '2026-08-04T03:30:00.000Z',
  });
  assert.equal(input.dueAt, '2026-08-04T03:30:00.000Z');
  assert.deepEqual(input.metadata, { facebook: { type: 'post' } });
});

test('buildCreatePostInput omits Facebook metadata for X', () => {
  const input = buildCreatePostInput({
    channelKey: 'x',
    channelId: 'x-ch',
    text: 'hello',
    dueAtUtc: '2026-08-04T04:00:00.000Z',
  });
  assert.equal(input.metadata, undefined);
});

test('jstMinutesFromMidnight is TZ-independent', () => {
  const utcRunnerNow = new Date('2026-08-04T03:14:00.000Z');
  assert.equal(jstMinutesFromMidnight(utcRunnerNow), 12 * 60 + 14);
});

test('pickTodayArticle rejects editorial_hold with force-slug', () => {
  const queue = {
    posts: [{ slug: 'hold-slug', status: 'editorial_hold', bufferTransferAt: '2026-08-05T10:30:00+09:00' }],
  };
  const r = pickTodayArticle(queue, '2026-08-05', { forceSlug: 'hold-slug' });
  assert.equal(r.error?.includes('editorial_hold'), true);
});

test('pickTodayArticle returns scheduled article for transfer day', () => {
  const article = mockArticle({
    slug: 'transfer-day-test',
    bufferTransferAt: '2026-08-07T10:30:00+09:00',
    status: 'scheduled',
  });
  article.channels.linkedin.status = CHANNEL_STATUSES.SCHEDULED;
  article.channels.linkedin.bufferUpdateId = null;
  const queue = { posts: [article] };
  const r = pickTodayArticle(queue, '2026-08-07');
  assert.equal(r.article?.slug, 'transfer-day-test');
});

test('duplicated vendor-selection sentence holds the channel and is not posted', async () => {
  const sentence = '施策を増やしてもAIに選ばれない理由は、情報の連続性の欠如にあることがあります。';
  const url = 'https://readiness.coaretail.com/insights/vendor-selection/';
  const text = [
    '予約SaaS選定のReadiness視点——経営・マーケティングの論点として、現場で問われているテーマです。',
    '',
    'SaaS選定は機能比較にReadiness要件を加える。',
    '',
    sentence,
    '',
    sentence,
    '',
    sentence,
    '',
    sentence,
    '',
    '詳細はInsightsで解説しています。',
    '',
    url,
    '',
    '#AgentReadiness #AISearch #SaaS',
  ].join('\n');
  const contentFile = path.join(os.tmpdir(), `vendor-selection-linkedin-${process.pid}.md`);
  fs.writeFileSync(contentFile, text);
  const article = {
    slug: 'vendor-selection',
    articleUrl: url,
    status: 'scheduled',
    channels: {
      linkedin: {
        channelIdEnv: 'BUFFER_CHANNEL_ID_LINKEDIN',
        contentFile,
        publishAt: '2026-10-12T11:30:00+09:00',
        status: CHANNEL_STATUSES.SCHEDULED,
        bufferUpdateId: null,
      },
    },
  };
  const created = [];
  const paths = {
    queue: path.join(os.tmpdir(), `ari-dup-queue-${process.pid}.json`),
    publishedLog: path.join(os.tmpdir(), `ari-dup-published-${process.pid}.json`),
    failedLog: path.join(os.tmpdir(), `ari-dup-failed-${process.pid}.json`),
  };
  const first = await processArticleChannels({
    article,
    queue: { posts: [article] },
    now: new Date('2026-10-12T12:00:00+09:00'),
    dryRun: false,
    requestedChannels: ['linkedin'],
    verifyArticleUrl: async () => ({ ok: true, mediaUrl: null }),
    createBufferPost: async () => {
      created.push('linkedin');
      return { postId: 'should-not-post', error: null, rejected: false };
    },
    getConfig: () => ({
      accessToken: 'tok',
      channelIds: { linkedin: 'li', facebook: 'fb', x: 'x' },
    }),
    paths,
  });
  assert.equal(created.length, 0);
  assert.equal(first.results[0].action, 'held');
  assert.match(first.results[0].error, /duplicated sentence \(4\)/);
  assert.equal(article.channels.linkedin.status, CHANNEL_STATUSES.FAILED);
  assert.equal(first.exitCode, 1);

  const second = await processArticleChannels({
    article,
    queue: { posts: [article] },
    now: new Date('2026-10-12T12:10:00+09:00'),
    dryRun: false,
    requestedChannels: ['linkedin'],
    verifyArticleUrl: async () => ({ ok: true, mediaUrl: null }),
    createBufferPost: async () => {
      created.push('retry');
      return { postId: 'should-not-post', error: null, rejected: false };
    },
    getConfig: () => ({
      accessToken: 'tok',
      channelIds: { linkedin: 'li', facebook: 'fb', x: 'x' },
    }),
    paths,
  });
  assert.equal(created.length, 0);
  assert.equal(second.results[0].action, 'held');
  assert.equal(article.channels.linkedin.bufferUpdateId ?? null, null);
  fs.rmSync(contentFile, { force: true });
});

test('short LinkedIn copy is held instead of being padded', async () => {
  const url = 'https://readiness.coaretail.com/insights/short-copy/';
  const contentFile = path.join(os.tmpdir(), `short-copy-linkedin-${process.pid}.md`);
  fs.writeFileSync(contentFile, `短すぎる原稿です。\n\n${url}\n#AgentReadiness #AI`);
  const article = {
    slug: 'short-copy',
    articleUrl: url,
    status: 'scheduled',
    channels: {
      linkedin: {
        channelIdEnv: 'BUFFER_CHANNEL_ID_LINKEDIN',
        contentFile,
        publishAt: '2026-10-13T11:30:00+09:00',
        status: CHANNEL_STATUSES.SCHEDULED,
        bufferUpdateId: null,
      },
    },
  };
  const created = [];
  const result = await processArticleChannels({
    article,
    queue: { posts: [article] },
    now: new Date('2026-10-13T02:00:00+09:00'),
    dryRun: false,
    requestedChannels: ['linkedin'],
    verifyArticleUrl: async () => ({ ok: true }),
    createBufferPost: async () => {
      created.push('linkedin');
      return { postId: 'should-not-post', error: null, rejected: false };
    },
    getConfig: () => ({
      accessToken: 'tok',
      channelIds: { linkedin: 'li' },
    }),
    paths: {
      queue: path.join(os.tmpdir(), `ari-short-queue-${process.pid}.json`),
      publishedLog: path.join(os.tmpdir(), `ari-short-published-${process.pid}.json`),
      failedLog: path.join(os.tmpdir(), `ari-short-failed-${process.pid}.json`),
    },
  });
  assert.equal(created.length, 0);
  assert.equal(result.results[0].action, 'held');
  assert.match(result.results[0].error, /length \d+ outside 450-900/);
  assert.equal(article.channels.linkedin.status, CHANNEL_STATUSES.FAILED);
  assert.equal(fs.readFileSync(contentFile, 'utf8').includes(VENDOR_PAD), false);
  fs.rmSync(contentFile, { force: true });
});

test('validateChannelContent enforces X length', () => {
  const url = 'https://readiness.coaretail.com/insights/test/';
  const okText = `AI検索では比較の主語が移る。候補形成と実行可能性を整える視点が必要です。\n\n${url}\n#AgentReadiness #GEO`;
  const ok = validateChannelContent('x', okText, url);
  assert.equal(ok.ok, true);
  const long = 'x'.repeat(300) + `\n\n${url}\n#AgentReadiness`;
  const bad = validateChannelContent('x', long, url);
  assert.equal(bad.ok, false);
});

test('processArticleChannels skips linkedin when already queued', async () => {
  const article = mockArticle();
  const queue = { posts: [article] };
  const verify = async () => ({ ok: true });
  const create = async () => ({ postId: 'new-id', error: null, rejected: false });

  const { results, updated } = await processArticleChannels({
    article,
    queue,
    now: new Date('2026-08-05T10:35:00+09:00'),
    dryRun: true,
    requestedChannels: ['linkedin', 'facebook', 'x'],
    verifyArticleUrl: verify,
    createBufferPost: create,
    getConfig: () => ({
      accessToken: 'tok',
      channelIds: { linkedin: 'li', facebook: 'fb', x: 'x' },
    }),
    paths: { queue: '/tmp/q.json', publishedLog: '/tmp/p.json', failedLog: '/tmp/f.json' },
  });

  const li = results.find((r) => r.channel === 'linkedin');
  assert.equal(li.action, 'skip');
  assert.equal(li.reason, 'already_queued');
  assert.equal(updated, false);
});

test('processArticleChannels retries only failed channel on re-run', async () => {
  const article = mockArticle();
  article.channels.facebook.status = CHANNEL_STATUSES.FAILED;
  article.channels.facebook.bufferUpdateId = null;
  article.channels.x.status = CHANNEL_STATUSES.QUEUED;
  article.channels.x.bufferUpdateId = 'x-done';

  const queue = { posts: [article] };
  const verify = async () => ({ ok: true });
  const created = [];
  const create = async ({ channelId }) => {
    created.push(channelId);
    return { postId: 'fb-new', error: null, rejected: false };
  };

  const origEnv = {
    BUFFER_ACCESS_TOKEN: process.env.BUFFER_ACCESS_TOKEN,
    BUFFER_CHANNEL_ID_FACEBOOK: process.env.BUFFER_CHANNEL_ID_FACEBOOK,
    BUFFER_CHANNEL_ID_LINKEDIN: process.env.BUFFER_CHANNEL_ID_LINKEDIN,
    BUFFER_CHANNEL_ID_TWITTER: process.env.BUFFER_CHANNEL_ID_TWITTER,
  };
  process.env.BUFFER_ACCESS_TOKEN = 'tok';
  process.env.BUFFER_CHANNEL_ID_FACEBOOK = 'fb';
  process.env.BUFFER_CHANNEL_ID_LINKEDIN = 'li';
  process.env.BUFFER_CHANNEL_ID_TWITTER = 'x-ch';

  try {
    await processArticleChannels({
      article,
      queue,
      now: new Date('2026-08-05T10:35:00+09:00'),
      dryRun: true,
      requestedChannels: ['linkedin', 'facebook', 'x'],
      verifyArticleUrl: verify,
      createBufferPost: create,
      getConfig: getBufferConfig,
      paths: { queue: '/tmp/q.json', publishedLog: '/tmp/p.json', failedLog: '/tmp/f.json' },
    });
    assert.deepEqual(created, ['fb']);
  } finally {
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('processArticleChannels blocks all channels on URL 404', async () => {
  const article = mockArticle();
  article.channels.linkedin.bufferUpdateId = null;
  article.channels.linkedin.status = CHANNEL_STATUSES.SCHEDULED;
  const queue = { posts: [article] };
  const verify = async () => ({ ok: false, reason: 'HTTP 404' });
  const create = async () => {
    throw new Error('should not call Buffer');
  };

  const { exitCode, reason } = await processArticleChannels({
    article,
    queue,
    now: new Date('2026-08-05T10:35:00+09:00'),
    dryRun: true,
    requestedChannels: ['facebook', 'x'],
    verifyArticleUrl: verify,
    createBufferPost: create,
    getConfig: getBufferConfig,
    paths: { queue: '/tmp/q.json', publishedLog: '/tmp/p.json', failedLog: '/tmp/f.json' },
  });

  assert.equal(reason, 'url_unavailable');
  assert.equal(exitCode, 0);
});

test('isBufferDuplicateScheduleError detects Buffer duplicate slot message', () => {
  assert.equal(
    isBufferDuplicateScheduleError(
      "Invalid post: Whoops, it looks like you've already got this one scheduled"
    ),
    true
  );
  assert.equal(isBufferDuplicateScheduleError('HTTP 500'), false);
});

test('processArticleChannels treats Buffer duplicate schedule as success', async () => {
  const article = mockArticle();
  article.channels.linkedin.status = CHANNEL_STATUSES.SCHEDULED;
  article.channels.linkedin.bufferUpdateId = null;
  const queue = { posts: [article] };
  const dupMsg =
    "Invalid post: Whoops, it looks like you've already got this one scheduled or posted around the same time.";

  const origEnv = {
    BUFFER_ACCESS_TOKEN: process.env.BUFFER_ACCESS_TOKEN,
    BUFFER_CHANNEL_ID_LINKEDIN: process.env.BUFFER_CHANNEL_ID_LINKEDIN,
  };
  process.env.BUFFER_ACCESS_TOKEN = 'tok';
  process.env.BUFFER_CHANNEL_ID_LINKEDIN = 'li';

  try {
    const { updated, results, exitCode } = await processArticleChannels({
      article,
      queue,
      now: new Date('2026-08-06T10:35:00+09:00'),
      dryRun: false,
      requestedChannels: ['linkedin'],
      verifyArticleUrl: async () => ({ ok: true, url: article.articleUrl }),
      createBufferPost: async () => ({ postId: null, error: dupMsg, rejected: true }),
      getConfig: getBufferConfig,
      paths: { queue: '/tmp/q.json', publishedLog: '/tmp/p.json', failedLog: '/tmp/f.json' },
    });

    assert.equal(updated, true);
    assert.equal(exitCode, 0);
    assert.equal(results[0].action, 'duplicate_ok');
    assert.equal(article.channels.linkedin.bufferUpdateId, EXISTING_BUFFER_SENTINEL);
    assert.equal(article.channels.linkedin.status, CHANNEL_STATUSES.QUEUED);
  } finally {
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('getChannelId prefers per-channel env names', () => {
  const orig = { ...process.env };
  process.env.BUFFER_CHANNEL_ID_LINKEDIN = 'li-specific';
  process.env.BUFFER_CHANNEL_ID = 'legacy';
  assert.equal(getChannelId('linkedin'), 'li-specific');
  process.env = orig;
});

test('missing Buffer credentials retain retryable channel state', async () => {
  const article = mockArticle({
    channels: Object.fromEntries(['linkedin', 'facebook', 'x'].map((ch) => [ch, {
      channelIdEnv: `BUFFER_CHANNEL_ID_${ch === 'x' ? 'TWITTER' : ch.toUpperCase()}`,
      contentFile: `/private/tmp/unused-${ch}.md`,
      publishAt: '2026-09-02T11:30:00+09:00',
      status: CHANNEL_STATUSES.SCHEDULED,
      bufferUpdateId: null,
    }])),
  });
  const result = await processArticleChannels({
    article,
    queue: { posts: [article] },
    now: new Date('2026-09-02T01:00:00Z'),
    dryRun: false,
    requestedChannels: ['linkedin', 'facebook', 'x'],
    verifyArticleUrl: async () => ({ ok: true }),
    verifyProduction: async () => ({ ok: true, mediaUrl: null }),
    createBufferPost: async () => { throw new Error('must not create'); },
    getConfig: () => ({ accessToken: '', channelIds: {} }),
    paths: { queue: '/private/tmp/ari-credential-q.json', publishedLog: '/private/tmp/ari-credential-p.json', failedLog: '/private/tmp/ari-credential-f.json' },
  });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(Object.values(article.channels).map((c) => c.status), [CHANNEL_STATUSES.SCHEDULED, CHANNEL_STATUSES.SCHEDULED, CHANNEL_STATUSES.SCHEDULED]);
  assert.equal(Object.values(article.channels).every((c) => c.bufferUpdateId === null), true);
});

test('buffer queue has unique semantic ledger identities', () => {
  const q = JSON.parse(fs.readFileSync(BUFFER_QUEUE, 'utf8'));
  const invariants = assertBufferLedgerSemanticInvariants(q.posts);
  assert.equal(invariants.ok, true, JSON.stringify(invariants));
  assert.ok(q.posts.length >= 1, 'ledger must contain at least one entry');
  assert.equal(q.policy.postsPerTransfer, 1);
});

test('buffer ledger tolerates N and N+1 legitimate unique entries', () => {
  const q = JSON.parse(fs.readFileSync(BUFFER_QUEUE, 'utf8'));
  const base = q.posts;
  assert.deepEqual(duplicateBufferLedgerKeys(base), []);
  assert.deepEqual(duplicateBufferChannelKeys(base), []);

  const extra = {
    slug: 'ledger-growth-fixture',
    publicationDate: '2099-12-31',
    status: 'scheduled',
    articlePublishAt: '2099-12-31T10:00:00+09:00',
    channels: {
      linkedin: { status: CHANNEL_STATUSES.SCHEDULED, bufferUpdateId: null },
      facebook: { status: CHANNEL_STATUSES.SCHEDULED, bufferUpdateId: null },
      x: { status: CHANNEL_STATUSES.SCHEDULED, bufferUpdateId: null },
    },
  };
  const grown = [...base, extra];
  assert.equal(assertBufferLedgerSemanticInvariants(grown).ok, true);
  assert.equal(bufferLedgerKey(extra), 'ledger-growth-fixture::2099-12-31');
});

test('buffer ledger rejects duplicate canonical publication identity', () => {
  const q = JSON.parse(fs.readFileSync(BUFFER_QUEUE, 'utf8'));
  const duplicate = { ...q.posts[0], channels: { ...q.posts[0].channels } };
  const withDuplicate = [...q.posts, duplicate];
  const invariants = assertBufferLedgerSemanticInvariants(withDuplicate);
  assert.equal(invariants.ok, false);
  assert.ok(invariants.publicationDuplicates.length >= 1);
});

test('buffer queue allows multiple future scheduled posts with unique ledger identities', () => {
  const q = JSON.parse(fs.readFileSync(BUFFER_QUEUE, 'utf8'));
  const scheduled = q.posts.filter((p) => p.status === 'scheduled');
  assert.ok(scheduled.length >= 1, 'expected at least one scheduled post');
  assert.equal(new Set(scheduled.map((p) => bufferLedgerKey(p))).size, scheduled.length);
});

test('facebook and x content files exist for all scheduled slugs', () => {
  const q = JSON.parse(fs.readFileSync(BUFFER_QUEUE, 'utf8'));
  for (const p of q.posts) {
    for (const ch of ['facebook', 'x']) {
      const rel = p.channels[ch].contentFile;
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `${p.slug} ${ch}`);
    }
  }
});
