import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const reportSource = read('report/src/agent-readiness-report.jsx');
const reportCss = read('report/src/report-design.css');

const itemsStart = reportSource.indexOf('const LANDING_EVIDENCE_ITEMS');
const itemsEnd = reportSource.indexOf('function LandingEvidenceBlock', itemsStart);
const evidenceData = reportSource.slice(itemsStart, itemsEnd);
const componentStart = reportSource.indexOf('function LandingEvidenceBlock');
const componentEnd = reportSource.indexOf('function LandingPage', componentStart);
const evidenceComponent = reportSource.slice(componentStart, componentEnd);

test('landing evidence block sits before primary pricing section', () => {
  assert.notEqual(itemsStart, -1);
  const landingStart = reportSource.indexOf('function LandingPage');
  const pricingStart = reportSource.indexOf('id="pricing"', landingStart);
  const evidenceUsage = reportSource.indexOf('<LandingEvidenceBlock />', landingStart);
  assert.notEqual(evidenceUsage, -1);
  assert.ok(evidenceUsage < pricingStart);
  assert.match(reportSource.slice(landingStart, pricingStart), /id="proof"/);
});

test('landing evidence cites verified third-party sources with safe links', () => {
  assert.match(evidenceData, /8%/);
  assert.match(evidenceData, /15%/);
  assert.match(evidenceData, /58%/);
  assert.match(evidenceData, /100万件超/);
  assert.match(evidenceData, /pewresearch\.org\/short-reads\/2025\/07\/22/);
  assert.match(evidenceData, /ahrefs\.com\/blog\/ai-overviews-reduce-clicks-update/);
  assert.match(evidenceData, /theverge\.com\/tech\/1022848\/reddit-ceo-google-ai-mode-traffic/);
  const externalLinks = [...evidenceComponent.matchAll(/target="_blank"\s+rel="noopener noreferrer"/g)];
  assert.ok(externalLinks.length >= 1);
});

test('landing evidence includes Japan-market disclaimer and avoids banned framing', () => {
  const block = evidenceData + evidenceComponent;
  assert.match(block, /数値は米国またはグローバルの調査で、日本市場での同等のデータは確認できていません/);
  assert.match(block, /御社の数字で準備度を測/);
  assert.doesNotMatch(block, /SEOは終わった/);
  assert.doesNotMatch(block, /全員詰み/);
  assert.doesNotMatch(block, /AI経由は必ず質が高い/);
  assert.doesNotMatch(block, /作業時間/);
});

test('landing evidence styles are scoped in report-design.css', () => {
  assert.match(reportCss, /\.lp-evidence/);
  assert.match(reportCss, /\.lp-evidence__note/);
});
