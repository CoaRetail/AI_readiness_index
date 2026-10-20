#!/usr/bin/env node
/**
 * Record a freshness addendum on a published Insight.
 *
 * Updates JSON-LD dateModified only (not the body, not schedule.json) and
 * refreshes that URL's sitemap lastmod. The next Reconcile run submits the
 * URL to IndexNow when FRESHNESS_SLUGS is printed.
 *
 * Usage:
 *   node scripts/apply-insight-freshness-addendum.mjs --slug cloudflare-pay-per-use --date 2026-10-21
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyInsightFreshnessAddendum } from './lib/insights-publication-date.mjs';
import { refreshSitemapFile } from './lib/sitemap-lastmod.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const slug = arg('--slug');
const date = arg('--date');
const dryRun = process.argv.includes('--dry-run');

if (!slug || !date) {
  console.error('Usage: node scripts/apply-insight-freshness-addendum.mjs --slug SLUG --date YYYY-MM-DD [--dry-run]');
  process.exit(1);
}

const articlePath = path.join(ROOT, 'insights', slug, 'index.html');
if (!fs.existsSync(articlePath)) {
  console.error(`missing published article: ${articlePath}`);
  process.exit(1);
}

const applied = applyInsightFreshnessAddendum(fs.readFileSync(articlePath, 'utf8'), date);
if (!applied.changed) {
  console.error(`freshness addendum not applied: ${applied.reason || 'unchanged'}`);
  process.exit(1);
}

if (!dryRun) fs.writeFileSync(articlePath, applied.html, 'utf8');
const refreshed = refreshSitemapFile({ root: ROOT, dryRun });
console.log(`FRESHNESS_SLUGS=${slug}`);
console.log(JSON.stringify({
  slug,
  dateModified: date,
  sitemapChanged: refreshed.changed,
  dryRun,
}, null, 2));
