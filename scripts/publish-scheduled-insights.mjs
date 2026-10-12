#!/usr/bin/env node
/**
 * Publish due Insights columns from insights/_scheduled/ to insights/{slug}/,
 * and update index.html / sitemap.xml / llms.txt.
 *
 * Usage:
 *   node scripts/publish-scheduled-insights.mjs
 *   node scripts/publish-scheduled-insights.mjs --dry-run
 *   node scripts/publish-scheduled-insights.mjs --force-slug files
 *   node scripts/publish-scheduled-insights.mjs --now 2026-07-13T10:00:00+09:00
 */
import { publishDueArticles } from './lib/publish-scheduled-insights-core.mjs';

const dryRun = process.argv.includes('--dry-run');
const forceSlug = (() => {
  const i = process.argv.indexOf('--force-slug');
  return i >= 0 ? process.argv[i + 1] : null;
})();
const nowArg = (() => {
  const i = process.argv.indexOf('--now');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const now = nowArg ? new Date(nowArg) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error('Invalid --now value');
  process.exit(1);
}

const result = publishDueArticles({ now, forceSlug, dryRun });

if (result.reason === 'weekend') {
  console.log('Weekend — no publish.', { now: now.toISOString() });
  process.exit(0);
}

if (result.held?.length) {
  for (const hold of result.held) {
    console.error(`HERO_PENDING_HOLD: ${hold.slug} remains scheduled at ${hold.publishAt}`);
  }
}

if (!result.published?.length && !result.skipped?.length && !result.updated && !result.held?.length && !result.errors?.length) {
  console.log('No scheduled articles due.', { now: now.toISOString() });
  process.exit(0);
}

if (result.skipped?.length) {
  console.log('Already published (skipped):', result.skipped.join(', '));
}

if (result.errors?.length) {
  for (const e of result.errors) console.error('Error:', e);
  process.exit(1);
}

if (dryRun) {
  console.log('Dry run complete. Would publish:', (result.published || []).join(', '));
  console.log('IndexNow: deferred to post-deploy step');
  process.exit(0);
}

if (result.published?.length) {
  console.log('Published:', result.published.join(', '));
}
console.log('IndexNow: deferred to post-deploy step');
if (result.updated) console.log('UPDATED=1');
else console.log('UPDATED=0');

process.exit(0);
