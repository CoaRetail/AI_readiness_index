#!/usr/bin/env node
/**
 * Operational reconciliation worker: publish → verify → buffer.
 *
 * Usage:
 *   node scripts/reconcile-publishing-pipeline.mjs
 *   node scripts/reconcile-publishing-pipeline.mjs --dry-run
 *   node scripts/reconcile-publishing-pipeline.mjs --force-slug readiness-baseline
 *   node scripts/reconcile-publishing-pipeline.mjs --now 2026-08-13T10:30:00+09:00
 *   node scripts/reconcile-publishing-pipeline.mjs --skip-publish --skip-verify
 */
import { isWeekday } from './lib/business-days.mjs';
import { reconcilePublishingPipeline } from './lib/publishing-reconcile.mjs';
import { loadCanonicalBufferEnv } from './lib/buffer-env.mjs';
import { findCanonicalBufferPost, getBufferConfig, getChannelId, validateBufferConfiguration } from './lib/buffer-client.mjs';

const dryRun = process.argv.includes('--dry-run');
const forceSlug = (() => {
  const i = process.argv.indexOf('--force-slug');
  return i >= 0 ? process.argv[i + 1] : null;
})();
const nowArg = (() => {
  const i = process.argv.indexOf('--now');
  return i >= 0 ? process.argv[i + 1] : null;
})();
const skipPublish = process.argv.includes('--skip-publish');
const skipVerify = process.argv.includes('--skip-verify');
const skipBuffer = process.argv.includes('--skip-buffer');
const fastVerify = process.argv.includes('--fast-verify');

const now = nowArg ? new Date(nowArg) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error('Invalid --now');
  process.exit(1);
}

async function main() {
  loadCanonicalBufferEnv();
  const bufferConfig = getBufferConfig();
  const configStatus = validateBufferConfiguration(bufferConfig);
  console.log(`BUFFER_ACCESS_TOKEN=${configStatus.accessToken}`);
  console.log(`BUFFER_ORGANIZATION_ID=${configStatus.organizationId}`);
  for (const channel of ['linkedin', 'facebook', 'x']) {
    console.log(`BUFFER_CHANNEL_${channel.toUpperCase()}=${configStatus.channels[channel]}`);
  }
  if (!isWeekday(now) && !forceSlug) {
    console.log('Weekend — no reconciliation.', { now: now.toISOString() });
    process.exit(0);
  }

  const summary = await reconcilePublishingPipeline({
    now,
    dryRun,
    forceSlug,
    skipPublish,
    skipVerify,
    skipBuffer,
    fastVerify,
    findExistingBufferPost: async ({ channel, text, articleUrl, publishAt }) => findCanonicalBufferPost({
      accessToken: bufferConfig.accessToken,
      organizationId: bufferConfig.organizationId,
      channelId: getChannelId(channel, bufferConfig),
      text,
      articleUrl,
      publishAt,
    }),
  });

  console.log(JSON.stringify(summary, null, 2));

  if (summary.activeSlug) console.log(`ACTIVE_SLUG=${summary.activeSlug}`);

  if (summary.publish?.published?.length) {
    console.log('Published:', summary.publish.published.join(', '));
    console.log(`PUBLISHED_SLUGS=${summary.publish.published.join(',')}`);
  }
  if (summary.freshnessSlugs?.length) {
    console.log(`FRESHNESS_SLUGS=${summary.freshnessSlugs.join(',')}`);
  }
  if (summary.updated) console.log('UPDATED=1');
  else console.log('UPDATED=0');

  if (summary.buffer && !summary.buffer.deliveryComplete && !dryRun) {
    console.error('BUFFER_DELIVERY_COMPLETE=FALSE');
    process.exit(1);
  }
  if (summary.buffer?.deliveryComplete) console.log('BUFFER_DELIVERY_COMPLETE=TRUE');
  else if (summary.buffer) console.log('BUFFER_DELIVERY_COMPLETE=FALSE');

  // Publish errors and incomplete Buffer delivery are fatal after state persistence;
  // successful sibling channels remain recorded for the next reconciliation.
  const publishFailed = summary.publish?.errors?.length;
  process.exit(publishFailed && !dryRun ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
