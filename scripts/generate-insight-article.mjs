#!/usr/bin/env node
/**
 * Convert a column markdown file into insights article HTML.
 * Usage: node scripts/generate-insight-article.mjs --md <path> --slug <slug> --date YYYY-MM-DD --out <dir> [--lead "..."] [--desc "..."] [--crumb "..."] [--cta-extra href|label] [--editorial-intent INTENT]
 *
 * Does not create assets/insights/<slug>/hero.webp. Heroes use Codex Native and
 * convert-webp.mjs (docs/insights-hero-generation.md). If that toolchain is
 * missing, leave packageReadiness HERO_PENDING and skip image generation.
 *
 * H2s in the markdown must be real user questions, and the first block under
 * each H2 must be the answer paragraph (lists come after). Pass
 * --strict-question-headings to refuse a draft that breaks that. Structural
 * headings added by this template (関連Insights / 関連リソース) are exempt.
 * Already published articles are not rewritten to match.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  getScheduledSeoPackage,
  buildArticleHeadHtml,
  escapeHtml,
  SITE_SUFFIX,
} from './lib/insights-seo-package.mjs';
import {
  applyInternalLinksToHtml,
  isProtectedInternalLinkSlug,
  loadSchedule,
  RELATED_INSIGHTS_CSS,
} from './lib/insights-related-links.mjs';
import { renderInsightCtaHtml } from './lib/funnel/sitewide-cta.mjs';
import { validateQuestionShapedHeadings } from './lib/question-headings.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const mdPath = arg('--md');
const slug = arg('--slug');
const date = arg('--date');
const outDir = arg('--out');
const lead = arg('--lead', '');
const desc = arg('--desc', '');
const crumb = arg('--crumb', '');
const titleOverride = arg('--title', '');
const ctaExtra = arg('--cta-extra', ''); // href|label
const editorialIntent = arg('--editorial-intent', '');
const strictQuestionHeadings = process.argv.includes('--strict-question-headings');

if (!mdPath || !slug || !date || !outDir) {
  console.error('Required: --md --slug --date --out');
  process.exit(1);
}

const md = fs.readFileSync(mdPath, 'utf8');
const headingCheck = validateQuestionShapedHeadings(md, { format: 'markdown' });
if (!headingCheck.ok) {
  for (const issue of headingCheck.issues) {
    console.warn(`question-heading: ${issue.code} ${issue.title}`);
  }
  if (strictQuestionHeadings) {
    console.error('H2s must be user questions with an answer-first opening paragraph.');
    process.exit(1);
  }
}
const lines = md.split(/\r?\n/);

function escapeHtmlLocal(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineFormat(text) {
  const links = [];
  let raw = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const id = links.length;
    links.push({ label, href });
    return `\x00L${id}\x00`;
  });
  let t = escapeHtmlLocal(raw);
  t = t.replace(/\x00L(\d+)\x00/g, (_, id) => {
    const { label, href } = links[Number(id)];
    return `<a href="${escapeHtmlLocal(href)}">${escapeHtmlLocal(label)}</a>`;
  });
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return t;
}

const blocks = [];
let i = 0;
let titleFromH2 = '';

while (i < lines.length) {
  const line = lines[i];
  if (!line.trim() || line.trim() === '---') {
    i++;
    continue;
  }
  if (line.startsWith('## ')) {
    const h = line.slice(3).trim();
    if (!titleFromH2) titleFromH2 = h;
    blocks.push({ type: 'h2', text: h });
    i++;
    continue;
  }
  if (line.startsWith('### ')) {
    blocks.push({ type: 'h3', text: line.slice(4).trim() });
    i++;
    continue;
  }
  if (line.trim().startsWith('>')) {
    const quoteLines = [];
    while (i < lines.length && lines[i].trim().startsWith('>')) {
      quoteLines.push(lines[i].replace(/^\s*>\s?/, '').trim());
      i++;
    }
    blocks.push({ type: 'blockquote', text: quoteLines.join(' ') });
    continue;
  }
  if (line.trim().startsWith('- ')) {
    const items = [];
    while (i < lines.length && (lines[i].trim().startsWith('- ') || !lines[i].trim())) {
      if (lines[i].trim().startsWith('- ')) {
        items.push(lines[i].replace(/^\s*-\s+/, '').trim());
      }
      i++;
    }
    blocks.push({ type: 'ul', items });
    continue;
  }
  // paragraph: collect consecutive non-empty non-special lines
  const para = [];
  while (
    i < lines.length &&
    lines[i].trim() &&
    lines[i].trim() !== '---' &&
    !lines[i].startsWith('## ') &&
    !lines[i].startsWith('### ') &&
    !lines[i].trim().startsWith('- ') &&
    !lines[i].trim().startsWith('>')
  ) {
    para.push(lines[i].trim());
    i++;
  }
  if (para.length) {
    blocks.push({ type: 'p', text: para.join('') });
  }
}

const seoPkg = getScheduledSeoPackage(slug);
const displayTitle = seoPkg?.h1 ?? (titleOverride || path.basename(mdPath, '.md'));
const crumbText = seoPkg?.breadcrumb ?? (crumb || displayTitle.slice(0, 24));
const description = seoPkg?.meta ?? (desc || lead || displayTitle);
const leadText = seoPkg?.lead ?? lead;
const dateDot = date.replace(/-/g, '.');
const pageTitle = seoPkg ? `${seoPkg.h1}${SITE_SUFFIX}` : `${displayTitle.replace(/──/g, '｜').replace(/—/g, '｜')}｜${
  displayTitle.includes('──') || displayTitle.includes('—')
    ? displayTitle.split(/──|—/).slice(1).join('—').trim() || 'Agent Readiness Insights'
    : 'Agent Readiness Insights'
}`.replace(/｜Agent Readiness Insights｜Agent Readiness Insights$/, '｜Agent Readiness Insights');

const headMetadata = seoPkg
  ? buildArticleHeadHtml({
      slug,
      h1: seoPkg.h1,
      metaDescription: seoPkg.meta,
      datePublished: date,
    })
  : `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtmlLocal(pageTitle)}</title>
<meta name="description" content="${escapeHtmlLocal(description)}">
<link rel="canonical" href="https://readiness.coaretail.com/insights/${slug}/">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": ${JSON.stringify(displayTitle)},
  "description": ${JSON.stringify(description)},
  "datePublished": "${date}",
  "dateModified": "${date}",
  "author": { "@type": "Organization", "name": "合同会社コア・リテール", "url": "https://www.coaretail.com" },
  "publisher": { "@type": "Organization", "name": "合同会社コア・リテール", "url": "https://www.coaretail.com" },
  "mainEntityOfPage": "https://readiness.coaretail.com/insights/${slug}/",
  "inLanguage": "ja"
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Agent Readiness", "item": "https://readiness.coaretail.com/" },
    { "@type": "ListItem", "position": 2, "name": "Insights", "item": "https://readiness.coaretail.com/insights/" },
    { "@type": "ListItem", "position": 3, "name": ${JSON.stringify(displayTitle)}, "item": "https://readiness.coaretail.com/insights/${slug}/" }
  ]
}
</script>`;

let bodyHtml = '';
let firstH2Skipped = false;
// Use first H2 as article section start; keep all H2s including first as body sections
// Lead is provided separately; first content H2 stays in body.

for (let bi = 0; bi < blocks.length; bi++) {
  const b = blocks[bi];
  if (b.type === 'h2') {
    bodyHtml += `      <h2>${inlineFormat(b.text)}</h2>\n`;
  } else if (b.type === 'h3') {
    bodyHtml += `      <h3>${inlineFormat(b.text)}</h3>\n`;
  } else if (b.type === 'p') {
    bodyHtml += `      <p>${inlineFormat(b.text)}</p>\n`;
  } else if (b.type === 'ul') {
    bodyHtml += '      <ul>\n';
    for (const item of b.items) {
      bodyHtml += `        <li>${inlineFormat(item)}</li>\n`;
    }
    bodyHtml += '      </ul>\n';
  } else if (b.type === 'blockquote') {
    bodyHtml += `      <blockquote>\n        ${inlineFormat(b.text)}\n      </blockquote>\n`;
  }
}

let ctaExtraBtn = '';
if (ctaExtra) {
  const [href, label] = ctaExtra.split('|');
  ctaExtraBtn = `        <a href="${href}" class="btn btn-secondary">${escapeHtmlLocal(label)}</a>\n`;
}

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="/assets/ga4.js" async></script>
  <script src="/assets/analytics.js" defer></script>
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
${seoPkg ? headMetadata.replace(/<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n/, '') : headMetadata}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../../assets/hub-animations.css">
<style>
:root {
  --bg: #FFFFFF; --bg-elevated: #FAFAFA; --bg-card: #F4F4F5;
  --border: rgba(0,0,0,0.08);
  --text: #09090B; --text-secondary: #52525B; --text-muted: #71717A;
  --cta: #09090B; --cta-text: #FFFFFF;
  --radius: 12px; --max: 720px; --max-wide: 1120px; --nav-h: 64px;
  --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', sans-serif;
}
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 17px; line-height: 1.8; -webkit-font-smoothing: antialiased; }
.container { max-width: var(--max-wide); margin: 0 auto; padding: 0 24px; }
.article-container { max-width: var(--max); margin: 0 auto; }
.nav { position: fixed; top: 0; left: 0; right: 0; z-index: 100; height: var(--nav-h); background: rgba(255,255,255,0.9); backdrop-filter: blur(16px); border-bottom: 1px solid var(--border); }
.nav-inner { max-width: var(--max-wide); margin: 0 auto; padding: 0 24px; height: 100%; display: flex; align-items: center; justify-content: space-between; }
.nav-logo { font-size: 15px; font-weight: 600; color: var(--text); text-decoration: none; }
.nav-logo span { color: var(--text-muted); font-weight: 400; }
.nav-links { display: flex; align-items: center; gap: 20px; list-style: none; }
.nav-links a { font-size: 14px; color: var(--text-secondary); text-decoration: none; }
.nav-links a:hover, .nav-links a.active { color: var(--text); }
.nav-cta { background: var(--cta); color: var(--cta-text) !important; padding: 8px 14px; border-radius: 8px; font-size: 13px !important; font-weight: 500 !important; }
.nav-toggle { display: none; background: none; border: none; cursor: pointer; }
.article-header { padding: calc(var(--nav-h) + 56px) 0 40px; }
.breadcrumb { font-size: 13px; color: var(--text-muted); margin-bottom: 20px; display: flex; gap: 8px; flex-wrap: wrap; }
.breadcrumb a { color: var(--text-muted); text-decoration: none; }
.article-meta { font-size: 14px; color: var(--text-muted); margin-bottom: 16px; }
.article-meta time { font-weight: 600; }
.article-tag { display: inline-block; font-size: 11px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; background: var(--bg-card); padding: 2px 8px; border-radius: 4px; margin-left: 10px; }
h1 { font-size: clamp(1.75rem, 4vw, 2.25rem); font-weight: 600; letter-spacing: -0.025em; line-height: 1.25; margin-bottom: 20px; }
.lead { font-size: 1.125rem; color: var(--text-secondary); line-height: 1.75; margin-bottom: 40px; }
.article-body h2 { font-size: 1.375rem; font-weight: 600; margin: 48px 0 16px; letter-spacing: -0.02em; color: var(--text); }
.article-body h3 { font-size: 1.125rem; font-weight: 600; margin: 32px 0 12px; color: var(--text); }
.article-body p { margin-bottom: 1.25em; color: var(--text-secondary); }
.article-body ul { margin: 0 0 1.25em 1.25em; color: var(--text-secondary); }
.article-body li { margin-bottom: 0.5em; }
.article-body strong { color: var(--text); font-weight: 600; }
.article-body a { color: var(--text); }
.article-body blockquote { border-left: 3px solid var(--text); padding: 12px 20px; margin: 24px 0; background: var(--bg-elevated); font-size: 16px; color: var(--text-secondary); line-height: 1.75; }
.article-body blockquote strong { color: var(--text); }
.article-body .closing-lines { margin-top: 1.5em; line-height: 2; }
.article-cta { margin: 48px 0; padding: 28px; background: var(--bg-elevated); border-radius: var(--radius); border: 1px solid var(--border); }
.article-cta h2 { font-size: 1.125rem; margin-bottom: 8px; color: var(--text); }
.article-cta p { font-size: 15px; color: var(--text-secondary); margin-bottom: 16px; }
.btn { display: inline-flex; padding: 12px 20px; border-radius: 10px; font-size: 14px; font-weight: 500; text-decoration: none; background: var(--cta); color: var(--cta-text); margin-right: 8px; margin-bottom: 8px; }
.btn-navy { background: #0D1B3E; color: #FFFFFF; }
.btn-navy:hover { background: #162040; color: #FFFFFF; }
.article-cta .btn-navy,
.article-cta .btn-navy:hover { color: #FFFFFF; }
.article-body a.btn-navy,
.article-body a.btn-navy:hover { color: #FFFFFF; }
.sitewide-cta { margin: 48px 0 24px; padding: 24px 28px; background: #F4F4F5; border-radius: var(--radius); border: 1px solid var(--border); }
.sitewide-cta h2 { font-size: 1.125rem; margin-bottom: 8px; color: var(--text); }
.sitewide-cta p { font-size: 15px; color: var(--text-secondary); margin-bottom: 16px; }
.btn-secondary { background: transparent; color: var(--text); border: 1px solid var(--border); }
.back-link { display: inline-block; margin: 40px 0 80px; font-size: 14px; color: var(--text-muted); text-decoration: none; }
.back-link:hover { color: var(--text); }
${RELATED_INSIGHTS_CSS}
.research-footer { background: var(--bg-elevated); border-top: 1px solid var(--border); padding: 48px 0 32px; }
.footer-brand { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
.footer-org { font-size: 14px; color: var(--text-secondary); margin-bottom: 4px; }
.footer-meta { font-size: 12px; color: var(--text-muted); margin-bottom: 24px; }
.footer-layers { display: flex; flex-wrap: wrap; gap: 16px 24px; margin-bottom: 24px; }
.footer-layers a { font-size: 13px; color: var(--text-secondary); text-decoration: none; }
.footer-links { display: flex; flex-wrap: wrap; gap: 16px 24px; margin-bottom: 20px; }
.footer-links a { font-size: 13px; color: var(--text-secondary); text-decoration: none; }
.footer-links a:hover { color: var(--text); }
.footer-copy { font-size: 13px; color: var(--text-muted); padding-top: 20px; border-top: 1px solid var(--border); }
.footer-copy a { color: var(--text-muted); text-decoration: none; }
@media (max-width: 1100px) {
  .nav-links { display: none; }
  .nav-links.open {
    display: flex; flex-direction: column; position: absolute;
    top: var(--nav-h); left: 0; right: 0; background: var(--bg);
    border-bottom: 1px solid var(--border); padding: 20px 24px; gap: 16px; align-items: flex-start;
  }
  .nav-toggle { display: block; }
  .nav { position: relative; }
}
</style>
<link rel="stylesheet" href="/assets/sitewide-cta.css">
</head>
<body>

<header class="nav">
  <div class="nav-inner">
    <a href="/" class="nav-logo">Agent Readiness <span>Research Hub</span></a>
    <button class="nav-toggle" aria-label="メニュー" onclick="document.querySelector('.nav-links').classList.toggle('open')">
      <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>
    <ul class="nav-links">
      <li><a href="/framework/">Framework</a></li>
      <li><a href="/research/">Research</a></li>
      <li><a href="/whitepaper/">Whitepaper</a></li>
      <li><a href="/evidence/">Evidence</a></li>
      <li><a href="/news/">News</a></li>
      <li><a href="/insights/" class="active">Insights</a></li>
      <li><a href="/methodology.html">Methodology</a></li>
      <li><a href="/report/" class="nav-cta">診断レポート</a></li>
    </ul>
  </div>
</header>

<main>
  <header class="article-header container">
    <div class="article-container">
      <nav class="breadcrumb" aria-label="パンくず">
        <a href="/">Agent Readiness</a><span aria-hidden="true">/</span>
        <a href="/insights/">Insights</a><span aria-hidden="true">/</span>
        <span>${escapeHtmlLocal(crumbText)}</span>
      </nav>
      <p class="article-meta">
        <time datetime="${date}">${dateDot}</time>
        <span class="article-tag">Column</span>
      </p>
      <h1>${escapeHtmlLocal(displayTitle)}</h1>
      <p class="lead">${escapeHtmlLocal(leadText)}</p>
    </div>
  </header>

  <article class="article-body container" data-article-slug="${slug}" data-article-title="${escapeHtmlLocal(displayTitle)}"${editorialIntent ? ` data-editorial-intent="${escapeHtmlLocal(editorialIntent)}"` : ''}>
    <div class="article-container">
${bodyHtml}
${renderInsightCtaHtml(slug, 'end', { editorialIntent, title: displayTitle, primarySearchIntent: seoPkg?.primarySearchIntent })}
      <div class="article-cta">
        <h2>関連リソース</h2>
        <p>Agent Readiness Framework は、AIが企業を理解・比較・推薦・実行するまでの状態を評価する基準です。個別技術を点ではなく仕組みとしてつなぐ視点を Research Hub で公開しています。</p>
        <a href="/framework/" class="btn btn-navy" data-ga-insight-cta="framework">Framework</a>
        <a href="/research/" class="btn btn-secondary" data-ga-insight-cta="research">Research Hub</a>
${ctaExtraBtn}        <a href="/report/" class="btn btn-secondary" data-ga-insight-cta="report">ARI診断</a>
      </div>

      <a href="/insights/" class="back-link">← Insights 一覧に戻る</a>
    </div>
  </article>
</main>

<footer class="research-footer">
  <div class="container">
    <p class="footer-brand">Agent Readiness Research Hub</p>
    <p class="footer-org">Insights · Coa Retail</p>
    <p class="footer-meta">Version 1.0 · Last Updated ${date}</p>
    <nav class="footer-links" aria-label="Site">
      <a href="/">トップ</a>
      <a href="/framework/">Framework</a>
      <a href="/research/">Research</a>
      <a href="/whitepaper/">Whitepaper</a>
      <a href="/evidence/">Evidence</a>
      <a href="/news/">News</a>
      <a href="/insights/">Insights</a>
      <a href="/methodology.html">Methodology</a>
      <a href="/dental.html">Benchmarks</a>
      <a href="/report/">診断レポート</a>
      <a href="https://www.coaretail.com" target="_blank" rel="noopener">Coa Retail</a>
    </nav>
    <nav class="footer-layers" aria-label="Research">
      <a href="/research/#principles">Principles</a>
      <a href="/research/#updates">Updates</a>
      <a href="/research/#citation">Citation Policy</a>
      <a href="/research/#faq">FAQ</a>
    </nav>
    <p class="footer-copy">© 2026 <a href="https://www.coaretail.com/" target="_blank" rel="noopener">合同会社コア・リテール</a></p>
  </div>
</footer>
<script src="/assets/sitewide-cta-tracking.js" defer></script>
</body>
</html>
`;

fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'index.html');

let finalHtml = html;
if (!isProtectedInternalLinkSlug(slug)) {
  const schedule = loadSchedule();
  const entry = schedule.articles.find((a) => a.slug === slug);
  const linkResult = applyInternalLinksToHtml(finalHtml, slug, {
    mode: 'scheduled',
    publishAt: entry?.publishAt || `${date}T10:00:00+09:00`,
    schedule,
  });
  finalHtml = linkResult.html;
}

fs.writeFileSync(outPath, finalHtml, 'utf8');
console.log('Wrote', outPath);
