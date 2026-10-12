#!/usr/bin/env node
/**
 * Generate Facebook and X post bodies from LinkedIn posts (git-tracked paths).
 * Usage: node scripts/generate-facebook-x-posts.mjs [--slug ai-search-shift]
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, articleUrl } from './lib/insights-v2-paths.mjs';
import { CONTENT_LIMITS } from './lib/social-channels.mjs';

const LI_DIR = path.join(ROOT, 'insights/_social/linkedin/posts');
const FB_DIR = path.join(ROOT, 'insights/_social/facebook/posts');
const X_DIR = path.join(ROOT, 'insights/_social/x/posts');

const onlySlug = (() => {
  const i = process.argv.indexOf('--slug');
  return i >= 0 ? process.argv[i + 1] : null;
})();

function extractHashtags(text) {
  return text.match(/#\w+/g) || [];
}

function extractUrl(text) {
  const m = text.match(/https:\/\/[^\s]+/);
  return m ? m[0].replace(/\/$/, '') + '/' : null;
}

function stripHashtagsAndUrl(text) {
  return text
    .replace(/#\w+/g, '')
    .replace(/https:\/\/[^\s]+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function soften(text) {
  return text
    .replace(/——/g, '—')
    .replace(/重要です/g, '大切です')
    .replace(/求められる/g, '意識したい')
    .replace(/必要です/g, '役立ちます');
}

function truncateToLen(text, maxLen) {
  if (text.length <= maxLen) return text;
  let t = text.slice(0, maxLen - 1);
  const lastSpace = t.lastIndexOf('。');
  if (lastSpace > maxLen * 0.5) t = t.slice(0, lastSpace + 1);
  else t = t.slice(0, maxLen - 3) + '…';
  return t;
}

function buildFacebook(slug, liText) {
  const url = extractUrl(liText) || articleUrl(slug);
  const tags = extractHashtags(liText);
  const body = soften(stripHashtagsAndUrl(liText));
  const paras = body.split(/\n\n+/).filter(Boolean);
  const core = paras.slice(0, 2).join('\n\n');
  const closing = '詳しくはInsightsで。';
  const fbTags = tags.slice(0, 3);
  if (!fbTags.includes('#AgentReadiness')) fbTags.unshift('#AgentReadiness');

  let text = `${core}\n\n${closing}\n\n${url}\n\n${fbTags.join(' ')}`;
  text = truncateToLen(text, CONTENT_LIMITS.facebook.max);
  if (text.length < CONTENT_LIMITS.facebook.min && paras[2]) {
    text = truncateToLen(
      `${paras.slice(0, 3).join('\n\n')}\n\n${closing}\n\n${url}\n\n${fbTags.join(' ')}`,
      CONTENT_LIMITS.facebook.max
    );
  }
  // Still short: leave it. Validation holds the channel. Do not repeat a sentence.
  return text.trim();
}

function buildX(slug, liText) {
  const url = extractUrl(liText) || articleUrl(slug);
  const tags = extractHashtags(liText);
  const body = stripHashtagsAndUrl(liText);
  const firstLine = body.split('\n').find((l) => l.trim()) || body.slice(0, 80);
  const xTags = tags.filter((t) => t !== '#AgentReadiness').slice(0, 1);
  xTags.unshift('#AgentReadiness');

  let hook = firstLine.replace(/[。！？]$/, '');
  if (hook.length > 100) hook = hook.slice(0, 97) + '…';

  let text = `${hook}\n\n${url}\n${xTags.join(' ')}`;
  if (text.length > CONTENT_LIMITS.x.max) {
    const budget = CONTENT_LIMITS.x.max - url.length - xTags.join(' ').length - 4;
    hook = hook.slice(0, Math.max(40, budget - 3)) + '…';
    text = `${hook}\n\n${url}\n${xTags.join(' ')}`;
  }
  return text.trim();
}

function main() {
  fs.mkdirSync(FB_DIR, { recursive: true });
  fs.mkdirSync(X_DIR, { recursive: true });

  const files = fs.readdirSync(LI_DIR).filter((f) => f.endsWith('.md'));
  let count = 0;

  for (const file of files) {
    const slug = file.replace(/\.md$/, '');
    if (onlySlug && slug !== onlySlug) continue;

    const liText = fs.readFileSync(path.join(LI_DIR, file), 'utf8');
    const fb = buildFacebook(slug, liText);
    const x = buildX(slug, liText);

    fs.writeFileSync(path.join(FB_DIR, file), fb + '\n', 'utf8');
    fs.writeFileSync(path.join(X_DIR, file), x + '\n', 'utf8');
    count++;
    console.log(slug, 'fb:', fb.length, 'x:', x.length);
  }

  console.log('Generated', count, 'facebook + x posts');
}

main();
