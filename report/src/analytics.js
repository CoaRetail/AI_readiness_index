/**
 * TMVU-04 / RMVU-03 / ARI-P0-03 — ARI Report GA4 events (uses window.gtag from /assets/ga4.js).
 */

import { emitWithCanonicalAlias, purchaseDedupeKey, createDedupeStore } from '../../scripts/lib/measurement/canonical-emit.mjs';

const REPORT_START_KEY = 'ari_report_start_sent';
const REPORT_VIEW_ITEM_KEY = 'ari_report_view_item_sent';
const CONVERSION_KEY = 'ari_conversion_log_v1';
const PROOF_IMPRESSION_KEY = 'ari_report_proof_impression_v1';
const purchaseDedupe = createDedupeStore(typeof localStorage !== 'undefined' ? localStorage : null);

const REPORT_ECOMMERCE_VALUE = 29800;
const REPORT_ECOMMERCE_ITEM = {
  item_id: 'company_report_bundle',
  item_name: 'ARI Company Report',
  price: REPORT_ECOMMERCE_VALUE,
};

export function reportEcommerceParams(overrides = {}) {
  const transactionId = overrides.transaction_id
    || overrides.sessionId
    || overrides.purchase_reference
    || '';
  return {
    currency: overrides.currency || 'JPY',
    value: overrides.value ?? REPORT_ECOMMERCE_VALUE,
    ...(transactionId ? { transaction_id: transactionId } : {}),
    items: overrides.items || [{ ...REPORT_ECOMMERCE_ITEM }],
  };
}

function readAttributionContext() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem('ari_attribution_v1') || '{}'); } catch { stored = {}; }
  const firstTouch = stored.firstTouch || {};
  const lastTouch = stored.lastTouch || {};
  const current = Object.keys(lastTouch).length ? lastTouch : firstTouch;
  return {
    firstTouch,
    lastTouch,
    source: current.source || '',
    medium: current.medium || '',
    campaign: current.campaign || '',
    landingPage: current.landingPage || '',
    referrer: current.referrer || '',
    insightSlug: current.insightSlug || firstTouch.insightSlug || '',
    ctaId: current.ctaId || firstTouch.ctaId || '',
    ctaType: current.ctaType || firstTouch.ctaType || '',
    editorialIntent: current.editorialIntent || firstTouch.editorialIntent || '',
    sourceSurface: current.sourceSurface || firstTouch.sourceSurface || '',
  };
}

function eventAttribution(context = readAttributionContext()) {
  return {
    source: context.source,
    medium: context.medium,
    campaign: context.campaign,
    landing_page: context.landingPage,
    insight_slug: context.insightSlug,
    cta_id: context.ctaId,
    cta_type: context.ctaType,
    editorial_intent: context.editorialIntent,
    source_surface: context.sourceSurface,
  };
}

function conversionAttribution(context = readAttributionContext()) {
  return {
    firstTouch: context.firstTouch,
    lastTouch: context.lastTouch,
    source: context.source,
    medium: context.medium,
    campaign: context.campaign,
    sourcePage: context.landingPage,
    insightSlug: context.insightSlug,
    ctaId: context.ctaId,
    ctaType: context.ctaType,
    editorialIntent: context.editorialIntent,
  };
}

function oncePerSession(key) {
  try {
    if (sessionStorage.getItem(key) === '1') return false;
    sessionStorage.setItem(key, '1');
  } catch { /* session storage is optional */ }
  return true;
}

function recordConversion(conversionType, params = {}) {
  if (!conversionType) return null;
  const reference = params.externalReference || params.leadId || params.sessionId || `${conversionType}:${Date.now()}`;
  const key = `${conversionType}:${reference}`;
  let records = [];
  try { records = JSON.parse(localStorage.getItem(CONVERSION_KEY) || '[]'); } catch { records = []; }
  if (records.some((record) => record.key === key)) return records.find((record) => record.key === key);
  const record = { ...conversionAttribution(), ...params, key, conversionType, value: conversionType === 'REPORT_PURCHASE' ? 29800 : null, currency: 'JPY', occurredAt: new Date().toISOString(), schemaVersion: '1' };
  delete record.email; delete record.company; delete record.domain; delete record.note;
  records = [...records.slice(-99), record];
  try { localStorage.setItem(CONVERSION_KEY, JSON.stringify(records)); } catch { /* optional storage */ }
  trackGaEvent('conversion', { conversion_type: conversionType, segment: record.segment, partner_type: record.partnerType, qualification_band: record.qualificationBand, cta_id: record.ctaId, cta_type: record.ctaType, source_page: record.sourcePage, insight_slug: record.insightSlug, editorial_intent: record.editorialIntent, value: record.value, currency: record.currency });
  return record;
}

function sanitizeGaParams(params = {}) {
  const safe = { ...params };
  delete safe.email;
  delete safe.company;
  delete safe.url;
  delete safe.domain;
  delete safe.host;
  delete safe.firstTouch;
  delete safe.lastTouch;
  delete safe.attribution;
  delete safe.referrer;
  return safe;
}

/** Direct gtag (dual measurement IDs via ga4.js); optional beacon + event_callback for navigation. */
function trackGaEventDirect(name, params = {}, { transportType, onComplete } = {}) {
  if (typeof window.gtag !== 'function') {
    if (onComplete) onComplete();
    return;
  }
  const payload = sanitizeGaParams(params);
  if (transportType) payload.transport_type = transportType;
  if (onComplete) {
    payload.event_callback = onComplete;
    payload.event_timeout = 2000;
  }
  window.gtag('event', name, payload);
}

export function trackGaEvent(name, params = {}) {
  if (typeof window.gtag !== 'function') return;
  const safe = sanitizeGaParams(params);
  const bridge = typeof window.ariMeasurement?.emitWithAlias === 'function'
    ? (event, payload) => window.ariMeasurement.emitWithAlias(event, payload)
    : (event, payload) => emitWithCanonicalAlias((evt, p) => window.gtag('event', evt, { transport_type: 'beacon', ...p }), event, payload);
  bridge(name, safe);
}

/** Fires once per browser tab session when user starts diagnosis (landing → form). */
/** GA4 recommended e-commerce — once per tab when /report/ SPA loads. */
export function trackReportViewItemOnce() {
  if (!oncePerSession(REPORT_VIEW_ITEM_KEY)) return;
  trackGaEvent('view_item', {
    source: 'ari_report',
    page_path: window.location.pathname || '/report/',
    ...eventAttribution(),
    ...reportEcommerceParams(),
  });
}

export function trackReportStartOnce() {
  try {
    if (sessionStorage.getItem(REPORT_START_KEY) === '1') return;
    sessionStorage.setItem(REPORT_START_KEY, '1');
  } catch {
    /* noop */
  }

  trackGaEvent('report_start', {
    source: 'ari_report',
    page_path: window.location.pathname || '/report/',
  });
}

export function trackReportFormComplete() {
  trackGaEvent('report_form_complete', { source: 'ari_report' });
}

export function trackReportCheckoutStart(params = {}, onComplete) {
  const base = { source: 'ari_report', ...eventAttribution(), ...params };
  trackGaEvent('report_checkout_start', base);
  trackGaEventDirect(
    'begin_checkout',
    { ...base, ...reportEcommerceParams() },
    { transportType: 'beacon', onComplete },
  );
}

export function trackReportProofImpression(params = {}) {
  if (!oncePerSession(PROOF_IMPRESSION_KEY)) return false;
  trackGaEvent('report_proof_impression', { source: 'ari_report', ...eventAttribution(), ...params });
  return true;
}

export function trackLocalCtaClick(params = {}) {
  trackGaEvent('local_cta_click', { source: 'ari_report', ...eventAttribution(), cta_type: 'LOCAL', ...params });
}

export function trackPurchaseVerified(params = {}) {
  const { purchase_reference, ...analyticsParams } = params;
  const reference = purchase_reference || params.sessionId || '';
  if (reference && !purchaseDedupe.once(purchaseDedupeKey(reference))) return;
  const context = readAttributionContext();
  const ecommerce = reportEcommerceParams({
    ...analyticsParams,
    transaction_id: analyticsParams.transaction_id,
    sessionId: reference,
    purchase_reference: reference,
  });
  const enriched = {
    ...analyticsParams,
    currency: analyticsParams.currency || ecommerce.currency,
    value: analyticsParams.value ?? ecommerce.value,
    transaction_id: analyticsParams.transaction_id || ecommerce.transaction_id,
    items: analyticsParams.items || ecommerce.items,
  };
  trackGaEvent('purchase_verified', {
    source: 'ari_report',
    verified: true,
    ...eventAttribution(context),
    ...enriched,
    purchase_reference: reference,
  });
  if (params.verified === true && ['company_report_bundle', 'company_report_legacy', 'company_report'].includes(params.product_id)) {
    recordConversion('REPORT_PURCHASE', { ...conversionAttribution(context), externalReference: reference || params.product_id, segment: params.segment, partnerType: params.partnerType });
  }
}

export function trackReportResultView(params = {}) {
  trackGaEvent('report_result_view', { source: 'ari_report', ...eventAttribution(), ...params });
}

export { recordConversion, readAttributionContext, conversionAttribution };

export function trackResearchEntitlementOpen(params = {}) {
  trackGaEvent('research_entitlement_open', { source: 'ari_report', ...params });
}

export function trackHandbookUpgradeClick(params = {}) {
  trackGaEvent('handbook_upgrade_click', { source: 'ari_report', ...params });
}

/** Preview funnel — opaque token landing (/report/p/{token}) */
export async function hashPreviewToken(token) {
  if (!token || typeof token !== 'string') return 'none';
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 8);
  }
  return 'unavailable';
}

export function trackPreviewVisit(params = {}) {
  trackGaEvent('preview_visit', {
    source: 'ari_report',
    page_path: window.location.pathname || '/report/p/',
    ...params,
  });
}

export function trackPreviewEngaged(params = {}) {
  trackGaEvent('preview_engaged', { source: 'ari_report', ...params });
}

export function trackPreviewVideoImpression(params = {}) {
  trackGaEvent('preview_video_impression', { source: 'ari_report', ...params });
}

export function trackPreviewVideoPlay(params = {}) {
  trackGaEvent('preview_video_play', { source: 'ari_report', ...params });
}

export function trackPreviewVideoComplete(params = {}) {
  trackGaEvent('preview_video_complete', { source: 'ari_report', ...params });
}
