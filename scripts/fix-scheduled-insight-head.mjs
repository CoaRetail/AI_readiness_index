#!/usr/bin/env node
/**
 * Fix scheduled insight HTML <head>: dedupe charset/viewport, title from JSON-LD, OGP block.
 * Idempotent when twitter:card and og:type are already present (still fixes dupes + title).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SITE_SUFFIX,
  buildSocialMetaTags,
  escapeHtml,
} from './lib/insights-seo-package.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DEFAULT_SLUGS = [
  'answers-without-opening-sources',
  'within-domain-citation-features',
  'deepseek-authority-tiers',
  'ai-referral-volume-and-conversion',
  'how-many-runs-before-ai-visibility',
  'shopping-agents-fail-before-payment',
  'cloudflare-openai-chatgpt-index',
  'ai-mode-global-ads-product-links',
  'merchant-ucp-agentic-performance-api',
  'industry-ai-citation-source-mix',
  'usage-ai-training-robots-token',
  'mckinsey-shopping-ai-chat-vs-retailer',
  'geo-location-changes-cited-sources',
  'perplexity-computer-chrome-extension',
  'predicting-answer-engine-cite-share',
];

function parseHeadline(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/g)];
  for (const [, raw] of blocks) {
    try {
      const ld = JSON.parse(raw);
      if (ld['@type'] === 'BlogPosting' && ld.headline) {
        return {
          headline: ld.headline,
          description: ld.description || null,
        };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function decodeMetaDescription(content) {
  return content.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function removeDuplicateCharsetViewport(html) {
  let seenCharset = false;
  let seenViewport = false;
  return html
    .split('\n')
    .filter((line) => {
      if (/^\s*<meta charset="UTF-8">\s*$/i.test(line)) {
        if (seenCharset) return false;
        seenCharset = true;
        return true;
      }
      if (/^\s*<meta name="viewport" content="width=device-width, initial-scale=1\.0">\s*$/i.test(line)) {
        if (seenViewport) return false;
        seenViewport = true;
        return true;
      }
      return true;
    })
    .join('\n');
}

function hasCompleteSocialBlock(html) {
  return html.includes('<meta name="twitter:card" content="summary_large_image">')
    && html.includes('<meta property="og:type" content="article">');
}

function fixHead(html, slug) {
  const parsed = parseHeadline(html);
  if (!parsed?.headline) {
    return { html, changed: false, error: 'missing_blogposting_headline' };
  }

  let out = removeDuplicateCharsetViewport(html);
  let changed = out !== html;
  html = out;

  const pageTitle = `${parsed.headline}${SITE_SUFFIX}`;
  const titleRe = /<title>[^<]*<\/title>/;
  if (titleRe.test(html)) {
    const next = html.replace(titleRe, `<title>${escapeHtml(pageTitle)}</title>`);
    if (next !== html) {
      html = next;
      changed = true;
    }
  }

  const metaMatch = html.match(/<meta name="description" content="([^"]*)">/);
  const metaDescription = metaMatch
    ? decodeMetaDescription(metaMatch[1])
    : (parsed.description || '');

  if (!hasCompleteSocialBlock(html)) {
    const canonMatch = html.match(/<link rel="canonical" href="[^"]+">/);
    if (!canonMatch) {
      return { html, changed, error: 'missing_canonical' };
    }
    const social = buildSocialMetaTags(slug, parsed.headline, metaDescription);
    const insertion = `${canonMatch[0]}\n${social}`;
    html = html.replace(canonMatch[0], insertion);
    changed = true;
  }

  return { html, changed, error: null };
}

const slugs = (() => {
  const i = process.argv.indexOf('--slug');
  if (i >= 0) return [process.argv[i + 1]];
  const rest = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  return rest.length ? rest : DEFAULT_SLUGS;
})();

let updated = 0;
let skipped = 0;
const errors = [];

for (const slug of slugs) {
  const filePath = path.join(ROOT, 'insights/_scheduled', slug, 'index.html');
  if (!fs.existsSync(filePath)) {
    errors.push({ slug, error: 'missing_html' });
    continue;
  }
  const before = fs.readFileSync(filePath, 'utf8');
  const result = fixHead(before, slug);
  if (result.error) {
    errors.push({ slug, error: result.error });
    continue;
  }
  if (result.changed) {
    fs.writeFileSync(filePath, result.html, 'utf8');
    updated += 1;
    console.log(`OK ${slug}`);
  } else {
    skipped += 1;
    console.log(`SKIP ${slug} (already ok)`);
  }
}

console.log(`\nUpdated ${updated}, skipped ${skipped}, errors ${errors.length}`);
if (errors.length) {
  console.error(JSON.stringify(errors, null, 2));
  process.exit(1);
}