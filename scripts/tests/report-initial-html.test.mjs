import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPORT_CANONICAL_URL,
  REPORT_STATIC_MARKERS,
  REPORT_STATIC_META,
} from '../lib/report-static-landing.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function extractStaticLanding(html) {
  const start = html.indexOf('id="report-static-landing"');
  assert.notEqual(start, -1, 'missing #report-static-landing');
  const end = html.indexOf('</main>', start);
  assert.notEqual(end, -1, 'missing </main> for static landing');
  return html.slice(start, end);
}

test('P0-01 report/index.html exposes crawler-visible sales copy in initial HTML', () => {
  const html = read('report/index.html');
  const landing = extractStaticLanding(html);
  for (const marker of REPORT_STATIC_MARKERS) {
    assert.match(landing, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('P0-01 report/index.html has canonical, robots, and OG url aligned to /report/', () => {
  const html = read('report/index.html');
  assert.match(html, new RegExp(`rel="canonical" href="${REPORT_CANONICAL_URL}"`));
  assert.match(html, new RegExp(`name="robots" content="${REPORT_STATIC_META.robots}"`));
  assert.match(html, new RegExp(`property="og:url" content="${REPORT_CANONICAL_URL}"`));
  assert.match(html, /application\/ld\+json/);
});

test('P0-01 built report dist preserves static landing after Vite build', () => {
  const distPath = path.join(ROOT, 'report/dist/index.html');
  if (!fs.existsSync(distPath)) {
    return;
  }
  const html = fs.readFileSync(distPath, 'utf8');
  const landing = extractStaticLanding(html);
  assert.match(landing, /¥29,800/);
  assert.match(landing, /Decision Product/);
});

test('report static landing FAQ matches FAQPage JSON-LD and keeps Product', () => {
  const html = read('report/index.html');
  assert.match(html, /"@type": "Product"/);
  assert.match(html, /"@type": "Offer"/);
  assert.match(html, /"price": "29800"/);
  assert.match(html, /"@type": "Organization"/);
  assert.match(html, /合同会社コア・リテール/);
  assert.match(html, /"dateModified": "2026-10-20"/);
  const faq = html.match(/"@type": "FAQPage"[\s\S]*?<\/script>/);
  assert.ok(faq, 'FAQPage JSON-LD missing');
  const landing = extractStaticLanding(html);
  const names = [...faq[0].matchAll(/"name": "([^"]+)"/g)].map((match) => match[1]);
  const answers = [...faq[0].matchAll(/"text": "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(names.length >= 4);
  for (const name of names) assert.ok(landing.includes(name), name);
  for (const answer of answers) assert.ok(landing.includes(answer), answer);
});

test('P0-01 sitemap lists canonical /report/ URL', () => {
  const sitemap = read('sitemap.xml');
  assert.match(sitemap, new RegExp(`<loc>${REPORT_CANONICAL_URL}</loc>`));
});

test('P0-01 robots.txt allows /report/ (no disallow)', () => {
  const robots = read('robots.txt');
  assert.match(robots, /Allow: \//);
  assert.doesNotMatch(robots, /Disallow:.*\/report/);
});
