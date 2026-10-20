import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyStaticSitemapLastmods,
  insightLastmodYmd,
  parseSitemapLastmods,
  refreshSitemapFile,
  replaceSitemapLastmod,
} from '../lib/sitemap-lastmod.mjs';
import { applyInsightFreshnessAddendum } from '../lib/insights-publication-date.mjs';

test('insight lastmod stays on the publish date until a later addendum', () => {
  assert.equal(insightLastmodYmd({ publishYmd: '2026-10-07', modifiedYmd: '2026-10-07' }), '2026-10-07');
  assert.equal(insightLastmodYmd({ publishYmd: '2026-10-07', modifiedYmd: '2026-10-21' }), '2026-10-21');
});

test('freshness addendum moves dateModified and not the body', () => {
  const html = '<p>本文は動かさない。</p><script>{"datePublished":"2026-10-07","dateModified":"2026-10-07"}</script>';
  const applied = applyInsightFreshnessAddendum(html, '2026-10-21');
  assert.equal(applied.changed, true);
  assert.match(applied.html, /本文は動かさない/);
  assert.match(applied.html, /"datePublished":"2026-10-07"/);
  assert.match(applied.html, /"dateModified":"2026-10-21"/);
  assert.equal(applyInsightFreshnessAddendum(html, '2026-10-01').reason, 'before_publish');
});

test('static lastmod replace does not add URLs', () => {
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://readiness.coaretail.com/</loc>
    <lastmod>2026-07-08</lastmod>
  </url>
  <url>
    <loc>https://readiness.coaretail.com/insights/abis-intro/</loc>
    <lastmod>2026-09-09</lastmod>
  </url>
</urlset>
`;
  const next = replaceSitemapLastmod(sitemap, 'https://readiness.coaretail.com/', '2026-10-06');
  assert.match(next, /<lastmod>2026-10-06<\/lastmod>/);
  assert.match(next, /abis-intro/);
  assert.equal(parseSitemapLastmods(next).size, 2);
});

test('refresh keeps editorial_hold slugs out and updates home lastmod from the source file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sitemap-lastmod-'));
  fs.mkdirSync(path.join(root, 'insights', 'abis-intro'), { recursive: true });
  fs.writeFileSync(path.join(root, 'insights', 'abis-intro', 'index.html'), '{"datePublished":"2026-09-09","dateModified":"2026-09-09"}');
  fs.writeFileSync(path.join(root, 'index.html'), '<title>home</title>');
  fs.writeFileSync(path.join(root, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset>
  <url>
    <loc>https://readiness.coaretail.com/</loc>
    <lastmod>2026-07-08</lastmod>
  </url>
  <url>
    <loc>https://readiness.coaretail.com/insights/files/</loc>
    <lastmod>2026-07-13</lastmod>
  </url>
</urlset>
`);
  fs.mkdirSync(path.join(root, 'insights', 'files'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'insights', 'files', 'index.html'),
    '{"datePublished":"2026-07-13","dateModified":"2026-10-21"}',
  );
  const result = refreshSitemapFile({ root, dryRun: true });
  assert.equal(result.freshnessSlugs.includes('abis-intro'), false);
  assert.deepEqual(result.freshnessSlugs, ['files']);
  assert.equal(parseSitemapLastmods(result.sitemap).get('https://readiness.coaretail.com/insights/files/'), '2026-10-21');
  assert.equal(fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8').includes('2026-07-08'), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('live sitemap home lastmod is not the July placeholder', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  const applied = applyStaticSitemapLastmods(sitemap, root);
  const home = parseSitemapLastmods(applied.sitemap).get('https://readiness.coaretail.com/');
  assert.notEqual(home, '2026-07-08');
  const report = parseSitemapLastmods(applied.sitemap).get('https://readiness.coaretail.com/report/');
  assert.equal(report, '2026-10-20');
});
