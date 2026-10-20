/**
 * RMVU-03 — Client-side paid fulfillment (persistence, verification, entitlements).
 */

import {
  PRODUCTS,
  RESEARCH_EDITION,
  resolveCompanyReportPaymentLink,
} from '../../scripts/lib/product-catalog.mjs';
import {
  STORAGE_KEYS,
  createPurchaseState,
  createReportCache,
  sanitizePurchaseForStorage,
  isExpired,
  hasActivePurchase,
  grantBrowserEntitlements,
  buildLegacyPurchaseState,
  mergePurchaseEntitlements,
} from '../../scripts/lib/fulfillment-state.mjs';
import {
  trackReportCheckoutStart,
  trackReportFormComplete,
  trackPurchaseVerified,
  trackReportResultView,
  trackResearchEntitlementOpen,
  trackHandbookUpgradeClick,
  conversionAttribution,
} from './analytics.js';

export {
  STORAGE_KEYS,
  RESEARCH_EDITION,
  PRODUCTS,
  hasActivePurchase,
  isExpired,
};

export function loadPurchaseState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.purchase);
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (isExpired(state)) {
      localStorage.removeItem(STORAGE_KEYS.purchase);
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

export function savePurchaseState(state) {
  if (!state) return;
  try {
    localStorage.setItem(STORAGE_KEYS.purchase, JSON.stringify(sanitizePurchaseForStorage(state)));
  } catch { /* noop */ }
}

export function loadReportCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.reportCache);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    if (isExpired(cache)) {
      localStorage.removeItem(STORAGE_KEYS.reportCache);
      return null;
    }
    return cache;
  } catch {
    return null;
  }
}

export function saveReportCache(report, form) {
  if (!report) return;
  try {
    localStorage.setItem(
      STORAGE_KEYS.reportCache,
      JSON.stringify(createReportCache({ report, form })),
    );
  } catch { /* noop */ }
}

export function clearReportCache() {
  try { localStorage.removeItem(STORAGE_KEYS.reportCache); } catch { /* noop */ }
}

export function resolveCheckoutUrl() {
  const bundlePaymentUrl = String(
    import.meta.env.VITE_COMPANY_REPORT_BUNDLE_PAYMENT_URL || '',
  ).trim();
  return resolveCompanyReportPaymentLink({
    env: { COMPANY_REPORT_BUNDLE_PAYMENT_URL: bundlePaymentUrl },
    allowLegacy: false,
  });
}

export function applyEntitlementsToBrowser(state) {
  if (!state?.entitlements) return [];
  return grantBrowserEntitlements(state.entitlements, state.sessionId, {
    sessionStorage: typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  });
}

export async function verifyPurchaseSession(sessionId, productHint = 'company_report') {
  if (!sessionId) return { ok: false, reason: 'missing_session' };

  try {
    const res = await fetch('/api/verify-purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, productHint, leadId: (() => { try { return localStorage.getItem('ari_lead_id') || ''; } catch { return ''; } })(), attribution: conversionAttribution() }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 503 && data.error === 'verification_unconfigured') {
      return { ok: false, reason: 'verification_unconfigured' };
    }
    if (!res.ok) {
      return { ok: false, reason: data.error || 'verification_failed', detail: data };
    }

    savePurchaseState(data.purchase);
    applyEntitlementsToBrowser(data.purchase);
    trackPurchaseVerified({
      product_id: data.product?.id,
      verified: true,
      verification_method: 'stripe_api',
      purchase_reference: data.purchase?.sessionId,
    });

    return { ok: true, purchase: data.purchase, product: data.product, verified: true };
  } catch (e) {
    return { ok: false, reason: 'network_error', message: e?.message };
  }
}

/** Idempotent purchase grant — merges with existing entitlement within TTL. */
export function grantLegacyCompanyReportPurchase() {
  const incoming = buildLegacyPurchaseState(PRODUCTS.companyReportLegacy.id);
  const existing = loadPurchaseState();
  const merged = mergePurchaseEntitlements(existing, incoming);
  savePurchaseState(merged);
  applyEntitlementsToBrowser(merged);
  trackPurchaseVerified({
    product_id: merged.productId,
    verified: false,
    verification_method: 'legacy_query',
  });
  return merged;
}

export function grantVerifiedPurchase(purchase) {
  const existing = loadPurchaseState();
  const merged = mergePurchaseEntitlements(existing, purchase);
  savePurchaseState(merged);
  applyEntitlementsToBrowser(merged);
  return merged;
}

export function openResearchEdition(purchaseState) {
  const state = purchaseState || loadPurchaseState();
  if (!state?.entitlements?.researchEdition) {
    return { ok: false, reason: 'missing_entitlement' };
  }
  trackResearchEntitlementOpen({
    verified: state?.verified ?? false,
    source: 'company_report_bundle',
  });
  return { ok: true, path: RESEARCH_EDITION.pdfPath };
}

export function openHandbookUpgrade() {
  const upgrade = PRODUCTS.handbookUpgrade;
  trackHandbookUpgradeClick({ product_id: upgrade.id });
  window.location.href = upgrade.paymentLink;
}

export function onReportFormComplete() {
  trackReportFormComplete();
}

export function onReportCheckoutStart(checkout, onComplete) {
  trackReportCheckoutStart({
    checkout_source: checkout?.source || 'unknown',
    bundle_link_required: !!checkout?.bundleLinkRequired,
  }, onComplete);
}

export function onReportResultView(purchaseState) {
  trackReportResultView({
    verified: purchaseState?.verified ?? false,
    has_research: !!purchaseState?.entitlements?.researchEdition,
  });
}

export function tryRestorePaidSession() {
  const purchase = loadPurchaseState();
  const cache = loadReportCache();
  if (!hasActivePurchase(purchase) || !cache?.report) return null;
  return { purchase, cache };
}
