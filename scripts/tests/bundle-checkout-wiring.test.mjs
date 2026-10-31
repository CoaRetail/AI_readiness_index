#!/usr/bin/env node
/**
 * RMVU-04E — Company Report Bundle checkout wiring tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  PRODUCTS,
  RESEARCH_EDITION,
  resolveCompanyReportPaymentLink,
  resolveBundlePaymentLink,
  STRIPE_AMOUNT_TAX_INCL,
} from '../lib/product-catalog.mjs';
import { PROTECTED_ABIS_SLUGS } from '../lib/product-integrity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUNDLE_TEST_URL = 'https://buy.stripe.com/test_bundle_rmvu04e';
const LEGACY_URL = 'https://buy.stripe.com/9B600kecb8iBdMTb5hcMM0g';

function buildReportBundle(bundleUrl = BUNDLE_TEST_URL) {
  const reportDir = path.join(ROOT, 'report');
  execSync('npm ci && npm run build', {
    cwd: reportDir,
    env: {
      ...process.env,
      VITE_COMPANY_REPORT_BUNDLE_PAYMENT_URL: bundleUrl,
    },
    stdio: 'pipe',
  });
  const distDir = path.join(reportDir, 'dist/assets');
  const jsFiles = fs.readdirSync(distDir).filter((f) => f.endsWith('.js'));
  assert.ok(jsFiles.length >= 1);
  return jsFiles.map((f) => fs.readFileSync(path.join(distDir, f), 'utf8')).join('\n');
}

const fulfillmentSrc = () => fs.readFileSync(path.join(ROOT, 'report/src/fulfillment.js'), 'utf8');
const reportSrc = () => fs.readFileSync(path.join(ROOT, 'report/src/agent-readiness-report.jsx'), 'utf8');
const catalogSrc = () => fs.readFileSync(path.join(ROOT, 'scripts/lib/product-catalog.mjs'), 'utf8');
const envExampleSrc = () => fs.readFileSync(path.join(ROOT, 'report/.env.example'), 'utf8');

test('RMVU-04E T01 bundle env present → NEW Bundle URL returned', () => {
  const checkout = resolveCompanyReportPaymentLink({
    env: { COMPANY_REPORT_BUNDLE_PAYMENT_URL: BUNDLE_TEST_URL },
    allowLegacy: false,
  });
  assert.equal(checkout.url, BUNDLE_TEST_URL);
  assert.equal(checkout.source, 'bundle');
  assert.equal(checkout.productId, PRODUCTS.companyReportBundle.id);
});

test('RMVU-04E T02 bundle env absent → null / fail-safe', () => {
  const checkout = resolveCompanyReportPaymentLink({ env: {}, allowLegacy: false });
  assert.equal(checkout.url, null);
  assert.equal(checkout.source, 'none');
  assert.equal(checkout.bundleLinkRequired, true);
});

test('RMVU-04E T03 Production resolver does NOT fallback to legacy', () => {
  const src = fulfillmentSrc();
  assert.match(src, /VITE_COMPANY_REPORT_BUNDLE_PAYMENT_URL/);
  assert.match(src, /allowLegacy:\s*false/);
  assert.doesNotMatch(src, /resolveCompanyReportPaymentLink\(\{\s*allowLegacy:\s*true/);
  const absent = resolveCompanyReportPaymentLink({
    env: { COMPANY_REPORT_BUNDLE_PAYMENT_URL: '' },
    allowLegacy: false,
  });
  assert.equal(absent.url, null);
  assert.notEqual(absent.url, LEGACY_URL);
});

test('RMVU-04E T04 legacy resolver can still return legacy when explicitly requested', () => {
  const legacy = resolveCompanyReportPaymentLink({ env: {}, allowLegacy: true });
  assert.equal(legacy.url, LEGACY_URL);
  assert.equal(legacy.source, 'legacy');
  assert.match(catalogSrc(), /9B600kecb8iBdMTb5hcMM0g/);
});

test('RMVU-04E T05 STRIPE_SECRET_KEY never appears in client bundle', () => {
  const bundle = buildReportBundle();
  assert.doesNotMatch(bundle, /STRIPE_SECRET_KEY/);
  assert.doesNotMatch(bundle, /sk_live_/);
  assert.doesNotMatch(bundle, /sk_test_/);
});

test('RMVU-04E T06 VITE bundle URL is present in production build when configured', () => {
  const bundle = buildReportBundle(BUNDLE_TEST_URL);
  assert.match(bundle, new RegExp(BUNDLE_TEST_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(bundle, /allowLegacy:!1/);
});

test('RMVU-04E T07 Company Report price unchanged', () => {
  assert.equal(PRODUCTS.companyReportBundle.priceExTax, 29_800);
  assert.equal(PRODUCTS.companyReportLegacy.priceExTax, 29_800);
  assert.equal(STRIPE_AMOUNT_TAX_INCL.companyReport, 32_780);
  assert.match(reportSrc(), /¥29,800/);
  assert.match(reportSrc(), /¥32,780/);
});

test('RMVU-04E T08 Research entitlement preserved', () => {
  assert.ok(PRODUCTS.companyReportBundle.entitlements.researchEdition);
  assert.equal(RESEARCH_EDITION.bundleDownloadPath, '/whitepaper/2026/research/download.html');
  assert.match(fulfillmentSrc(), /openResearchEdition/);
  assert.match(fulfillmentSrc(), /pdfPath/);
});

test('RMVU-04E T09 success URL / session_id flow preserved', () => {
  const src = reportSrc();
  assert.match(src, /session_id/);
  assert.match(src, /verifyPurchaseSession/);
  assert.match(src, /grantVerifiedPurchase/);
  assert.match(src, /NEW_PAYMENT_LINK_REQUIRED/);
});

test('RMVU-04E T10 RMVU-02/03/03B preserved', () => {
  assert.match(fulfillmentSrc(), /verifyPurchaseSession/);
  assert.match(fulfillmentSrc(), /saveReportCache/);
  assert.match(fulfillmentSrc(), /grantVerifiedPurchase/);
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/lib/product-integrity.mjs')));
  assert.ok(fs.existsSync(path.join(ROOT, 'assets/research-entitlement.js')));
});

test('RMVU-04E T11 No ABIS exposure', () => {
  for (const slug of PROTECTED_ABIS_SLUGS) {
    assert.doesNotMatch(fulfillmentSrc(), new RegExp(slug));
    assert.doesNotMatch(reportSrc(), new RegExp(slug));
  }
});

test('RMVU-04E T12 Stripe legacy products not deleted', () => {
  assert.equal(PRODUCTS.companyReportLegacy.paymentLink, LEGACY_URL);
  assert.ok(PRODUCTS.companyReportLegacy.legacy);
  assert.match(fs.readFileSync(path.join(ROOT, 'assets/product-catalog.js'), 'utf8'), /9B600kecb8iBdMTb5hcMM0g/);
});

test('RMVU-04E env example documents VITE bundle URL', () => {
  assert.match(envExampleSrc(), /VITE_COMPANY_REPORT_BUNDLE_PAYMENT_URL/);
  assert.match(envExampleSrc(), /Do NOT put STRIPE_SECRET_KEY under VITE_/);
});

test('RMVU-04E resolveBundlePaymentLink accepts VITE_ alias', () => {
  assert.equal(
    resolveBundlePaymentLink({ VITE_COMPANY_REPORT_BUNDLE_PAYMENT_URL: BUNDLE_TEST_URL }),
    BUNDLE_TEST_URL,
  );
});

test('RMVU-04E T13 checkout redirect works without gtag (timeout fallback)', () => {
  const analyticsSrc = fs.readFileSync(path.join(ROOT, 'report/src/analytics.js'), 'utf8');
  const jsxSrc = reportSrc();
  assert.match(analyticsSrc, /export function scheduleNavigationOnce/);
  assert.match(analyticsSrc, /REPORT_CHECKOUT_NAV_FALLBACK_MS\s*=\s*900/);
  assert.match(analyticsSrc, /setTimeout\(run,\s*fallbackMs\)/);
  assert.match(analyticsSrc, /if \(typeof window\.gtag !== 'function'\)[\s\S]*if \(onComplete\) onComplete\(\)/);
  assert.match(jsxSrc, /scheduleNavigationOnce\(\(\)\s*=>\s*\{[\s\S]*window\.location\.href\s*=\s*checkout\.url/);
});
