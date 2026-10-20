/**
 * P0-01 — Initial HTML markers for /report/ landing (crawler-visible, no JS required).
 * Keep in sync with report/index.html #report-static-landing and LandingPage copy.
 */

export const REPORT_CANONICAL_URL = 'https://readiness.coaretail.com/report/';

export const REPORT_STATIC_MARKERS = Object.freeze([
  'Decision Product',
  'Personalized Decision Report',
  '集客の入口が、検索からAIに移っています',
  '¥29,800',
  '税別',
  '23項目',
  '約3分',
  'PDFダウンロード',
  '4大AI認識分析',
  'ARI Research Report 2026',
  '月額60,000円',
  'localgeo.coaretail.com',
  '無料相談を予約する',
  'レポートを入手する',
  '改善優先順位',
  'よくある質問',
  'ARI診断レポートは何を診断しますか？',
  '料金はいくらですか？',
  '更新日 2026-10-20',
]);

export const REPORT_STATIC_META = Object.freeze({
  canonical: REPORT_CANONICAL_URL,
  robots: 'index, follow',
  title: 'ARI診断レポート｜AIに推薦されない理由を可視化（¥29,800）',
});
