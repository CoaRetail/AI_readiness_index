import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  assertCanonicalInsightPresentation,
  validateCanonicalInsightPresentation,
} from '../lib/insights-presentation.mjs';

test('published IAB article uses the canonical Insight presentation', () => {
  const html = fs.readFileSync('insights/iab-ai-visibility/index.html', 'utf8');
  assert.deepEqual(validateCanonicalInsightPresentation(html), []);
});

test('an existing scheduled fixture uses the canonical presentation without publishing', () => {
  const root = 'insights/_scheduled';
  const slug = fs.readdirSync(root)
    .find((name) => fs.existsSync(`${root}/${name}/index.html`));

  assert.ok(slug, 'expected at least one scheduled Insight fixture');

  const html = fs.readFileSync(`${root}/${slug}/index.html`, 'utf8');
  assert.doesNotThrow(() => assertCanonicalInsightPresentation(html, { slug }));
});

test('standalone article markup is rejected before publication', () => {
  const html = '<nav class="nav"></nav><article class="article-body"></article><footer></footer>';
  const missing = validateCanonicalInsightPresentation(html);
  assert.ok(missing.includes('header'));
  assert.ok(missing.includes('article_width'));
  assert.ok(missing.includes('footer'));
});

import {
  syncInsightPublicationDate,
  syncInsightPublicationDateToYmd,
} from '../lib/insights-publication-date.mjs';

test('publication date sync replaces stale generated date with actual publishAt', () => {
  const html = `
  <script type="application/ld+json">
  {
    "datePublished": "2026-08-17",
    "dateModified": "2026-08-17"
  }
  </script>
  <p class="article-meta">
    <time datetime="2026-08-17">2026.08.17</time>
  </p>
  <p class="footer-meta">Version 1.0 · Last Updated 2026-08-17</p>
  `;

  const result = syncInsightPublicationDate(
    html,
    '2026-08-20T10:00:00+09:00'
  );

  assert.equal(result.changed, true);
  assert.match(result.html, /"datePublished": "2026-08-20"/);
  assert.match(result.html, /"dateModified": "2026-08-20"/);
  assert.match(result.html, /datetime="2026-08-20">2026\.08\.20<\/time>/);
  assert.match(result.html, /Last Updated 2026-08-20/);
});

test('publication date sync repairs corrupted article-meta time tags', () => {
  const html = `
  <script type="application/ld+json">
  {"datePublished":"2026-08-20","dateModified":"2026-08-20"}
  </script>
  <p class="article-meta">
    <time datetime="2026-08-20">2026.08.17</time>
  </p>
  `;

  const result = syncInsightPublicationDateToYmd(html, '2026-08-20');
  assert.equal(result.changed, true);
  assert.match(result.html, /<time datetime="2026-08-20">2026\.08\.20<\/time>/);
});

test('publication date sync keeps a later freshness dateModified', () => {
  const html = `
  <script type="application/ld+json">
  {"datePublished":"2026-08-20","dateModified":"2026-10-02"}
  </script>
  `;
  const result = syncInsightPublicationDateToYmd(html, '2026-08-20');
  assert.match(result.html, /"datePublished": "2026-08-20"/);
  assert.match(result.html, /"dateModified": "2026-10-02"/);
});
