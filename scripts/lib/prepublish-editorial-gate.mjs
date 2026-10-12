/**
 * TMVU-05 — Pre-publish Editorial & Search Intent Gate.
 * Deterministic checks only (no LLM / external APIs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ROOT } from './insights-v2-paths.mjs';
import { getScheduledSeoPackage, validateInsightSeo } from './insights-seo-package.mjs';
import {
  isProtectedInternalLinkSlug,
  PROTECTED_INTERNAL_LINK_SLUGS,
  loadSchedule,
  validateInternalLinks,
  getPublishedSlugsFromFilesystem,
} from './insights-related-links.mjs';
import { validateInsightGa4Tracking } from './insights-ga4-tracking.mjs';
import { socialCopyBlockersForEntry } from './validate-social-content.mjs';

export { PROTECTED_INTERNAL_LINK_SLUGS as PROTECTED_ABIS_SLUGS };

export const STALE_THRESHOLD_DAYS = 30;
export const SITE_BASE = 'https://readiness.coaretail.com';

const TRACKED_PROPER_NOUNS = [
  { re: /ChatGPT/i, label: 'ChatGPT' },
  { re: /OpenAI/i, label: 'OpenAI' },
  { re: /Gemini/i, label: 'Gemini' },
  { re: /\bGoogle AI\b/i, label: 'Google AI' },
  { re: /Claude/i, label: 'Claude' },
  { re: /Anthropic/i, label: 'Anthropic' },
  { re: /Microsoft/i, label: 'Microsoft' },
  { re: /Copilot/i, label: 'Copilot' },
  { re: /Cloudflare/i, label: 'Cloudflare' },
  { re: /\bMCP\b/, label: 'MCP' },
  { re: /Schema\.org/i, label: 'Schema.org' },
  { re: /\bx402\b/i, label: 'x402' },
  { re: /Perplexity/i, label: 'Perplexity' },
];

const OVERCLAIM_PATTERNS = [
  { re: /必ず/, label: '必ず' },
  { re: /絶対/, label: '絶対' },
  { re: /完全(?!攻略|版)/, label: '完全' },
  { re: /100%/, label: '100%' },
  { re: /最強/, label: '最強' },
  { re: /No\.?\s*1\b/i, label: 'No.1' },
  { re: /唯一/, label: '唯一' },
  { re: /これだけで/, label: 'これだけで' },
  { re: /確実に/, label: '確実に' },
  { re: /完全攻略/, label: '完全攻略' },
  { re: /決定版/, label: '決定版' },
];

const RANKING_CLAIM_RE = /(?:おすすめ|ランキング|最も優れ|ベスト|Top\s*10|No\.?\s*1)/i;

const COMMERCIAL_TITLE_RE = /(?:おすすめ|ランキング|ベスト|Top\s*10|No\.?\s*1)/i;

const PRIVATE_MARKER_RE = /(?:TODO\s*PRIVATE|INTERNAL\s*ONLY|\bCONFIDENTIAL\b|DRAFT\s*ONLY|\bPATENT\b|特許出願前|社外秘)/i;

const ABIS_LEAK_RE = [
  /Agent Business Interaction Standard/i,
  /\bABIS\b(?:とは|の|が|を|視点|標準|フレームワーク)/,
  /Business Interaction semantics/i,
];

const TIME_SENSITIVE_HINTS = [
  /発表/, /新機能/, /ニュース/, /倒産/, /政策/, /規制/, /シェア/, /最新ランキング/,
  /2026年最新/, /2026年版/, /市場シェア/, /新プロトコル/,
];

const EVERGREEN_HINTS = [
  /llms\.txt/i, /Schema\.org/i, /\bFAQ\b/i, /Visibility/i, /Authority/i,
  /Actionability/i, /\bMCP\b/, /Agent Readiness/i, /SEO/i, /GEO/i,
];

const YEAR_CTR_RE = /20\d{2}(?:年版|最新)/;

function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'");
}

export function stripHtml(html) {
  return decodeHtml(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

export function extractArticleFields(html) {
  const h1 = decodeHtml(html.match(/<h1>([^<]+)<\/h1>/)?.[1] || '');
  const lead = decodeHtml(html.match(/<p class="lead">([\s\S]*?)<\/p>/)?.[1] || '');
  const titleRaw = decodeHtml(html.match(/<title>([^<]+)<\/title>/)?.[1] || '');
  const seoTitle = titleRaw.replace(/\s*\|\s*Agent Readiness Insights\s*$/, '').trim();
  const meta = decodeHtml(html.match(/<meta name="description" content="([^"]+)"/)?.[1] || '');
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] || '';
  const bodyText = stripHtml(html.match(/<article[\s\S]*<\/article>/)?.[0] || html);
  return { h1, lead, seoTitle, meta, canonical, bodyText };
}

export function classifyFreshness(slug, entry, fields) {
  if (entry?.freshnessClass === 'evergreen' || entry?.freshnessClass === 'time_sensitive') {
    return entry.freshnessClass;
  }
  const probe = `${entry?.seoTitle || ''} ${entry?.title || ''} ${fields.seoTitle} ${fields.h1} ${fields.lead}`;
  if (TIME_SENSITIVE_HINTS.some((re) => re.test(probe))) return 'time_sensitive';
  if (EVERGREEN_HINTS.some((re) => re.test(probe)) || EVERGREEN_HINTS.some((re) => re.test(slug))) {
    return 'evergreen';
  }
  return 'evergreen';
}

function daysSince(iso, now) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (now.getTime() - t) / (1000 * 60 * 60 * 24);
}

function resolveReviewDate(entry) {
  return entry?.editorialReviewedAt || entry?.freshnessReviewedAt || entry?.unlockedAt || null;
}

function addBlocker(blockers, code, message) {
  blockers.push({ code, message });
}

function addObservation(observations, code, message) {
  observations.push({ code, message });
}

function finalizeResult(slug, blockers, observations, extra = {}) {
  let status = 'PASS';
  if (blockers.length) status = 'BLOCKED';
  else if (observations.length) status = 'PASS_WITH_OBSERVATIONS';
  return { slug, status, blockers, observations, ...extra };
}

export function checkProtectedAbis(slug) {
  if (isProtectedInternalLinkSlug(slug)) {
    return {
      blocked: true,
      blockers: [{ code: 'PROTECTED_ABIS_PREPUBLICATION', message: 'Protected ABIS slug must not be published' }],
    };
  }
  return { blocked: false, blockers: [] };
}

export function checkAbisLeak(slug, surfaces, bodyText) {
  if (isProtectedInternalLinkSlug(slug)) return [];
  const combined = `${surfaces.seoTitle} ${surfaces.h1} ${surfaces.meta} ${surfaces.lead}`;
  const blockers = [];
  if (/\bABIS\b/.test(combined) || ABIS_LEAK_RE.some((re) => re.test(combined) || re.test(bodyText))) {
    blockers.push({
      code: 'ABIS_PREPUBLICATION_LEAK',
      message: 'Non-ABIS article references protected ABIS content',
    });
  }
  return blockers;
}

export function checkUnsupportedProperNouns(surfaces, bodyText) {
  const blockers = [];
  const combined = `${surfaces.seoTitle} ${surfaces.h1} ${surfaces.meta} ${surfaces.lead}`;
  for (const { re, label } of TRACKED_PROPER_NOUNS) {
    if (re.test(combined) && !re.test(bodyText) && !re.test(surfaces.h1)) {
      blockers.push({
        code: 'UNSUPPORTED_PROPER_NOUN',
        message: `"${label}" appears in SEO surfaces but not in article body`,
      });
    }
  }
  return blockers;
}

export function checkSearchIntent(entry, fields) {
  const blockers = [];
  const observations = [];
  const { bodyText, h1, lead, meta, seoTitle } = fields;

  if (entry?.primarySearchIntent) {
    const terms = entry.primarySearchIntent.split(/\s+/).filter((t) => t.length >= 2);
    const missing = terms.filter(
      (t) => !bodyText.includes(t) && !h1.includes(t) && !lead.includes(t) && !meta.includes(t),
    );
    if (terms.length && missing.length > Math.ceil(terms.length * 0.4)) {
      addBlocker(
        blockers,
        'SEARCH_INTENT_MISMATCH',
        `Primary search intent terms missing in body: ${missing.join(', ')}`,
      );
    }
  }

  const titleProbe = entry?.seoTitle || seoTitle || h1;

  const toWaMatch = titleProbe.match(/(.+?)とは/);
  if (toWaMatch) {
    const topic = toWaMatch[1].split(/[・·]/).pop().trim();
    if (/^(MCP|Schema\.org|FAQ|ABIS|AX|ARI)$/i.test(topic) && !bodyText.match(new RegExp(topic.replace('.', '\\.'), 'i'))) {
      addBlocker(blockers, 'SEO_TITLE_BODY_MISMATCH', `SEO title topic "${topic}" not substantiated in body`);
    }
  }

  const compareMatch = titleProbe.match(/(ChatGPT[^？?]*)/i);
  if (compareMatch && /比較|違う/.test(titleProbe)) {
    for (const noun of ['ChatGPT', 'Gemini']) {
      if (titleProbe.includes(noun) && !bodyText.includes(noun) && !h1.includes(noun)) {
        addBlocker(blockers, 'SEO_TITLE_BODY_MISMATCH', `SEO title comparison requires "${noun}" in body`);
      }
    }
  }

  if (entry?.searchIntentClass === 'C' && COMMERCIAL_TITLE_RE.test(titleProbe)) {
    addObservation(
      observations,
      'INTENT_CLASS_COMMERCIAL_DRIFT',
      'Class C article uses commercial-style title phrasing',
    );
  }

  if (RANKING_CLAIM_RE.test(`${titleProbe} ${lead}`)) {
    const hasComparisonBasis = /(?:比較|評価|調査|データ|違い|分析)/.test(bodyText);
    const isExplanatory = /(?:とは|意味|解説|説明|という)/.test(`${titleProbe} ${lead}`);
    if (!hasComparisonBasis && !isExplanatory) {
      addBlocker(blockers, 'UNSUPPORTED_RANKING_CLAIM', 'Ranking/recommendation claim without body support');
    }
  }

  return { blockers, observations };
}

export function checkDirectAnswer(fields) {
  const observations = [];
  const blockers = [];
  const { h1, lead, bodyText } = fields;
  if (!lead) {
    addBlocker(blockers, 'MISSING_DIRECT_ANSWER', 'Direct Answer (p.lead) missing');
    return { blockers, observations };
  }
  const len = lead.length;
  if (len < 80 || len > 240) {
    addObservation(observations, 'DIRECT_ANSWER_LENGTH', `Direct Answer length ${len} outside 100-200 preferred range`);
  }
  const h1Stem = h1.replace(/[？?].*$/, '').slice(0, 12);
  if (h1Stem.length >= 6 && !lead.includes(h1Stem.slice(0, 6)) && !bodyText.includes(h1Stem.slice(0, 6))) {
    addObservation(observations, 'DIRECT_ANSWER_H1_DRIFT', 'Direct Answer may not address H1 question');
  }
  return { blockers, observations };
}

export function checkOverclaims(fields) {
  const observations = [];
  const probe = `${fields.seoTitle} ${fields.h1} ${fields.lead}`;
  for (const { re, label } of OVERCLAIM_PATTERNS) {
    if (re.test(probe)) {
      const hasNumericContext = /\d+\s*(?:項目|社|件|点|%)/.test(fields.bodyText);
      if (label === '100%' && hasNumericContext) continue;
      addObservation(observations, 'OVERCLAIM_LANGUAGE', `Overclaim pattern detected: ${label}`);
    }
  }
  return observations;
}

export function checkFreshness(slug, entry, fields, now = new Date()) {
  const blockers = [];
  const observations = [];
  const freshnessClass = classifyFreshness(slug, entry, fields);
  if (freshnessClass === 'time_sensitive') {
    const reviewed = resolveReviewDate(entry);
    const age = daysSince(reviewed, now);
    if (age > STALE_THRESHOLD_DAYS) {
      addBlocker(
        blockers,
        'STALE_CONTENT_REVIEW_REQUIRED',
        `Time-sensitive article last reviewed ${Math.floor(age)} days ago (>${STALE_THRESHOLD_DAYS})`,
      );
    } else if (!reviewed) {
      addObservation(observations, 'TIME_SENSITIVE_REVIEW_MISSING', 'Time-sensitive article has no review timestamp');
    }
  }
  return { freshnessClass, blockers, observations };
}

export function checkYearGuardrail(fields) {
  const blockers = [];
  const { seoTitle, bodyText, h1 } = fields;
  const yearMatch = seoTitle.match(YEAR_CTR_RE);
  if (yearMatch) {
    const year = yearMatch[0].slice(0, 4);
    if (!bodyText.includes(year) && !h1.includes(year)) {
      addBlocker(blockers, 'YEAR_GUARDRAIL', `SEO title year ${year} not reflected in body`);
    }
  }
  return blockers;
}

export function checkNumericIntegrity(fields) {
  const blockers = [];
  const observations = [];
  const nums = (s) => [...String(s).matchAll(/(\d+)\s*(社|件|項目|点|%)/g)].map((m) => `${m[1]}${m[2] || ''}`);
  const metaNums = [...nums(fields.meta)];
  const leadNums = new Set(nums(fields.lead));
  for (const n of metaNums) {
    if (leadNums.size && !leadNums.has(n) && !fields.bodyText.includes(n.replace(/[^\d]/g, ''))) {
      addObservation(observations, 'NUMERIC_SURFACE_DRIFT', `Numeric claim ${n} in meta differs from lead`);
    }
  }
  for (const n of metaNums) {
    const digit = n.replace(/[^\d]/g, '');
    const bodyMatches = [...fields.bodyText.matchAll(new RegExp(`${digit}\\s*(?:社|件|項目|点|%)`, 'g'))];
    const metaDigit = fields.meta.match(new RegExp(`${digit}\\s*(?:社|件|項目|点|%)`))?.[0];
    if (metaDigit && bodyMatches.length) {
      const bodyForms = bodyMatches.map((m) => m[0]);
      if (!bodyForms.some((b) => b === metaDigit) && bodyForms.length) {
        addBlocker(blockers, 'NUMERIC_MISMATCH', `Numeric claim "${metaDigit}" conflicts with body`);
      }
    }
  }
  return { blockers, observations };
}

export function checkIndexability(slug, html, fields) {
  const blockers = [];
  if (/noindex/i.test(html)) {
    addBlocker(blockers, 'NOINDEX', 'Article has noindex directive');
  }
  const expected = `${SITE_BASE}/insights/${slug}/`;
  if (fields.canonical && fields.canonical !== expected) {
    addBlocker(blockers, 'CANONICAL_MISMATCH', `Canonical must be ${expected}`);
  }
  if (html.includes('/insights/_scheduled/')) {
    addBlocker(blockers, 'PRIVATE_PATH', 'Scheduled private path referenced in HTML');
  }
  return blockers;
}

export function checkPrivateMarkers(fields, bodyText) {
  const blockers = [];
  const probe = `${fields.seoTitle} ${fields.lead} ${bodyText.slice(0, 2000)}`;
  if (PRIVATE_MARKER_RE.test(probe)) {
    addBlocker(blockers, 'PROTECTED_INFORMATION_MARKER', 'Private/confidential marker detected');
  }
  return blockers;
}

export function checkDuplicateTitles(slug, entry, allEntries, publishedSlugs, root) {
  const blockers = [];
  const observations = [];
  const title = entry?.seoTitle;
  if (!title) return { blockers, observations };

  const peers = allEntries.filter((a) => a.slug !== slug && a.seoTitle === title);
  if (peers.length) {
    addBlocker(blockers, 'DUPLICATE_SEO_TITLE', `Duplicate seoTitle with ${peers.map((p) => p.slug).join(', ')}`);
  }

  for (const pub of publishedSlugs) {
    if (pub === slug) continue;
    const pubHtml = path.join(root, 'insights', pub, 'index.html');
    if (!fs.existsSync(pubHtml)) continue;
    const pubFields = extractArticleFields(fs.readFileSync(pubHtml, 'utf8'));
    if (pubFields.seoTitle === title) {
      addBlocker(blockers, 'DUPLICATE_SEO_TITLE', `Duplicate seoTitle with published ${pub}`);
    } else if (title.length > 10 && pubFields.seoTitle.includes(title.slice(0, 20))) {
      addObservation(observations, 'SIMILAR_SEO_TITLE', `Similar seoTitle to published ${pub}`);
    }
  }
  return { blockers, observations };
}

export function checkIntentSimilarity(slug, entry, allEntries) {
  const observations = [];
  if (!entry?.primarySearchIntent) return observations;
  const dupes = allEntries.filter(
    (a) =>
      a.slug !== slug &&
      !isProtectedInternalLinkSlug(a.slug) &&
      a.primarySearchIntent === entry.primarySearchIntent,
  );
  if (dupes.length) {
    addObservation(
      observations,
      'DUPLICATE_SEARCH_INTENT',
      `Same primarySearchIntent as: ${dupes.map((d) => d.slug).join(', ')}`,
    );
  }
  return observations;
}

export function buildCannibalizationReport(allEntries, root) {
  const rows = [];
  const items = allEntries.filter((a) => !isProtectedInternalLinkSlug(a.slug) && a.primarySearchIntent);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const intentA = a.primarySearchIntent || '';
      const intentB = b.primarySearchIntent || '';
      const titleA = a.seoTitle || '';
      const titleB = b.seoTitle || '';
      const intentOverlap = intentA === intentB ? 1 : 0;
      const titleSim = titleA && titleB && (titleA === titleB || titleA.includes(titleB.slice(0, 15))) ? 0.8 : 0;
      const similarity = Math.max(intentOverlap, titleSim);
      if (similarity < 0.5) continue;
      let decision = 'OK';
      if (similarity >= 1 && titleA === titleB) decision = 'BLOCK';
      else if (similarity >= 0.8) decision = 'REVIEW';
      rows.push({ articleA: a.slug, articleB: b.slug, similarity, decision });
    }
  }
  return rows;
}

export function runPrepublishEditorialGate(slug, options = {}) {
  const {
    html: htmlIn = null,
    scheduleEntry = null,
    schedule = null,
    htmlPath = null,
    now = new Date(),
    forceSlug = null,
    skipReuseGates = false,
    socialRoot = ROOT,
  } = options;

  const blockers = [];
  const observations = [];

  const protectedCheck = checkProtectedAbis(slug);
  if (protectedCheck.blocked) {
    return finalizeResult(slug, protectedCheck.blockers, observations, {
      protected: true,
      forceSlug,
    });
  }

  const filePath = htmlPath || path.join(PATHS.scheduledDir, slug, 'index.html');
  const html = htmlIn || (fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '');
  if (!html) {
    addBlocker(blockers, 'MISSING_HTML', 'Scheduled HTML not found');
    return finalizeResult(slug, blockers, observations);
  }

  const sched = schedule || loadSchedule();
  const entry = scheduleEntry || sched.articles.find((a) => a.slug === slug) || {};
  const fields = extractArticleFields(html);
  const allEntries = sched.articles;
  const publishedSlugs = getPublishedSlugsFromFilesystem();

  blockers.push(...checkAbisLeak(slug, fields, fields.bodyText));
  blockers.push(...checkUnsupportedProperNouns(fields, fields.bodyText));

  const intent = checkSearchIntent(entry, fields);
  blockers.push(...intent.blockers);
  observations.push(...intent.observations);

  const direct = checkDirectAnswer(fields);
  blockers.push(...direct.blockers);
  observations.push(...direct.observations);

  observations.push(...checkOverclaims(fields));

  const freshness = checkFreshness(slug, entry, fields, now);
  blockers.push(...freshness.blockers);
  observations.push(...freshness.observations);

  blockers.push(...checkYearGuardrail(fields));
  const numeric = checkNumericIntegrity(fields);
  blockers.push(...numeric.blockers);
  observations.push(...numeric.observations);
  blockers.push(...checkIndexability(slug, html, fields));
  blockers.push(...checkPrivateMarkers(fields, fields.bodyText));

  const dupes = checkDuplicateTitles(slug, entry, allEntries, publishedSlugs, ROOT);
  blockers.push(...dupes.blockers);
  observations.push(...dupes.observations);

  observations.push(...checkIntentSimilarity(slug, entry, allEntries));

  if (!skipReuseGates) {
    const seoPkg = getScheduledSeoPackage(slug);
    if (seoPkg) {
      const seoErrors = validateInsightSeo(html, slug, { scheduled: true });
      for (const err of seoErrors) {
        addBlocker(blockers, 'SEO_INTEGRITY', err);
      }
    }

    const linkErrors = validateInternalLinks(html, slug, {
      mode: 'scheduled',
      publishAt: entry.publishAt || null,
      schedule: sched,
    });
    for (const err of linkErrors) {
      addBlocker(blockers, 'INTERNAL_LINK_INTEGRITY', err);
    }

    const ga4Errors = validateInsightGa4Tracking(html, slug);
    for (const err of ga4Errors) {
      addBlocker(blockers, 'GA4_INTEGRITY', err);
    }
  }

  blockers.push(...socialCopyBlockersForEntry(slug, entry, { root: socialRoot }));

  return finalizeResult(slug, blockers, observations, {
    protected: false,
    freshnessClass: freshness.freshnessClass,
    forceSlug,
    checks: {
      seo: !blockers.some((b) => b.code.startsWith('SEO_')),
      links: !blockers.some((b) => b.code === 'INTERNAL_LINK_INTEGRITY'),
      ga4: !blockers.some((b) => b.code === 'GA4_INTEGRITY'),
      social: !blockers.some((b) => b.code === 'SOCIAL_COPY_LENGTH' || b.code === 'SOCIAL_COPY_DUPLICATE'),
      intent: !blockers.some((b) => b.code.includes('INTENT') || b.code.includes('PROPER_NOUN')),
    },
  });
}

export function runGateOnAllScheduled(options = {}) {
  const sched = loadSchedule();
  const results = [];
  for (const ent of fs.readdirSync(PATHS.scheduledDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const slug = ent.name;
    if (!fs.existsSync(path.join(PATHS.scheduledDir, slug, 'index.html'))) continue;
    const entry = sched.articles.find((a) => a.slug === slug);
    results.push(
      runPrepublishEditorialGate(slug, {
        scheduleEntry: entry,
        schedule: sched,
        ...options,
      }),
    );
  }
  return results;
}

export function simulatePublishGate(slug, options = {}) {
  return runPrepublishEditorialGate(slug, options);
}
