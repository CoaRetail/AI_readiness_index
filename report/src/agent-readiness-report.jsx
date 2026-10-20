import React, { useState, useEffect, useRef, useCallback, useContext } from "react";
import VideoCarousel from "./VideoCarousel.jsx";
import { trackReportStartOnce, trackReportViewItemOnce, trackReportProofImpression, trackLocalCtaClick } from "./analytics.js";
import { readPreviewPrefillFromSession } from "./preview-prefill.js";
import {
  scoreInterpretation,
  mapProposalToPriority,
  IMPROVE_URL,
  MTG_SCHEDULE_URL,
  SCORE_BAR_VARIANTS,
} from "./report-tokens.js";
import {
  STORAGE_KEYS,
  resolveCheckoutUrl,
  verifyPurchaseSession,
  grantVerifiedPurchase,
  savePurchaseState,
  saveReportCache,
  loadPurchaseState,
  hasActivePurchase,
  tryRestorePaidSession,
  onReportFormComplete,
  onReportCheckoutStart,
  onReportResultView,
  openResearchEdition,
  openHandbookUpgrade,
  PRODUCTS,
  RESEARCH_EDITION,
} from "./fulfillment.js";

// ─── DUMMY DATA ───────────────────────────────────────────────────────────────
const DUMMY_REPORT = {
  company: "株式会社サンプル商事",
  url: "https://sample-shoji.co.jp",
  industry: "小売・EC",
  analyzedAt: "2026年6月26日",
  overallScore: 82,
  certification: "Gold",
  rank: { national: 847, tokyo: 203, industry: 47 },
  deviation: 68.4,
  level: "Leader",
  executiveSummary: `株式会社サンプル商事は、AIエージェント時代における企業情報の可視性・推薦性において、業界上位15%に位置する「Leader」レベルの評価を獲得しました。

公式サイトの構造化データ実装が進んでおり、ChatGPT・Gemini・Claudeの主要AIプラットフォームにおいて企業情報が認識・引用されやすい状態です。特に予約・問い合わせフローのデジタル化が進んでいる点が高評価の要因です。

一方、FAQ Schemaの未実装と、Google Business Profileの情報更新頻度の低さが課題として検出されました。これらを改善することで、スコアが最大+11ポイント向上し、AI推薦率が現状比で約23%改善すると試算されます。`,
  scoreBreakdown: [
    { category: "AI可視性", score: 88, weight: 20, items: ["情報正確性", "エンティティ認識", "ナレッジグラフ登録", "Wikipedia/公式情報整合性"] },
    { category: "技術的最適化", score: 79, weight: 18, items: ["Schema実装", "robots.txt", "LLMs.txt", "Sitemap"] },
    { category: "予約・導線", score: 91, weight: 17, items: ["予約ページ存在", "フォーム最適化", "Agent操作性", "完了率推定"] },
    { category: "ナレッジカバレッジ", score: 75, weight: 16, items: ["営業情報完全性", "料金情報", "FAQ充実度", "口コミ管理"] },
    { category: "権威・引用元", score: 83, weight: 15, items: ["被引用数", "引用元多様性", "メディア掲載", "PR配信"] },
    { category: "推薦・比較準備度", score: 77, weight: 14, items: ["推薦理由の明確性", "情報鮮度", "比較候補としての情報整備", "応答速度"] },
  ],
  aiRecognition: [
    { ai: "ChatGPT", recognition: 94, recommendation: 88, citation: 71, bookable: true },
    { ai: "Gemini", recognition: 91, recommendation: 82, citation: 68, bookable: true },
    { ai: "Claude", recognition: 88, recommendation: 79, citation: 65, bookable: false },
    { ai: "Perplexity", recognition: 86, recommendation: 76, citation: 82, bookable: false },
  ],
  knowledgeCoverage: [
    { item: "会社名・所在地", coverage: 100 },
    { item: "営業時間", coverage: 95 },
    { item: "電話番号", coverage: 100 },
    { item: "料金・価格", coverage: 72 },
    { item: "FAQ", coverage: 58 },
    { item: "予約フロー", coverage: 91 },
    { item: "口コミ・評判", coverage: 83 },
    { item: "SNSプロフィール", coverage: 76 },
  ],
  authority: [
    { source: "公式サイト", pct: 34 },
    { source: "Google Business", pct: 28 },
    { source: "ポータルサイト", pct: 19 },
    { source: "PR/ニュース", pct: 11 },
    { source: "Instagram", pct: 8 },
  ],
  bookingReadiness: {
    hasPage: true,
    hasForm: true,
    difficulty: "Easy",
    steps: 3,
    mobileOptimized: true,
    agentScore: 87,
  },
  technical: [
    { item: "Schema.org", status: "partial", score: 72 },
    { item: "robots.txt", status: "pass", score: 100 },
    { item: "LLMs.txt", status: "fail", score: 0 },
    { item: "XML Sitemap", status: "pass", score: 95 },
    { item: "JSON-LD", status: "partial", score: 65 },
    { item: "OpenGraph", status: "pass", score: 98 },
    { item: "Canonical URL", status: "pass", score: 100 },
    { item: "FAQ Schema", status: "fail", score: 0 },
  ],
  roadmap: [
    { action: "LLMs.txtの実装", impact: "+4", priority: "High", effort: "低（1時間）", roi: "★★★★★" },
    { action: "FAQ Schemaの追加", impact: "+3", priority: "High", effort: "低（2時間）", roi: "★★★★★" },
    { action: "Google Business更新頻度向上", impact: "+2", priority: "Medium", effort: "中（継続）", roi: "★★★★" },
    { action: "価格ページの構造化", impact: "+1.5", priority: "Medium", effort: "中（1日）", roi: "★★★" },
    { action: "Claude予約API対応", impact: "+1", priority: "Low", effort: "高（1週）", roi: "★★★" },
  ],
  improvementProposals: [
    {
      title: "LLMs.txtの実装",
      description: "AIクローラー向けに企業情報・サービス概要・連絡先を明示するLLMs.txtを公式サイトに設置します。Perplexity・ChatGPT等が情報源として引用しやすくなり、推薦精度の底上げが見込めます。",
    },
    {
      title: "FAQ Schemaの追加",
      description: "よくある質問をSchema.orgのFAQPage形式で構造化します。AIが料金・営業時間・予約方法などの回答を正確に生成・引用できる状態を作ります。",
    },
    {
      title: "主要AIでの認識情報の統一",
      description: "ChatGPT・Gemini・Claude・Perplexity間で企業情報の認識にばらつきが見られます。公式サイト・GBP・主要ポータルの記述を統一し、エンティティ認識の精度を高めます。",
    },
    {
      title: "Google Business Profileの定期更新",
      description: "営業時間・写真・投稿を月次で更新し、AI引用元としての鮮度を維持します。地域検索・業界キーワードでの推薦率改善に直結します。",
    },
    {
      title: "料金・サービス情報の構造化",
      description: "料金表・メニュー・プラン情報をHTMLテーブルとJSON-LDで明示します。AIが「いくらか」「何が含まれるか」を推測せず回答できる状態を整えます。",
    },
  ],
  certificate: {
    level: "Gold",
    number: "ARI-2026-G-008847",
    issuedAt: "2026年6月26日",
    validUntil: "2027年6月26日",
  },
};

const CERT_COLORS = {
  Bronze: { bg: "#CD7F32", text: "#fff", light: "#FDF3E7", border: "#CD7F32" },
  Silver: { bg: "#9EA7AD", text: "#fff", light: "#F2F4F5", border: "#9EA7AD" },
  Gold: { bg: "#C9A84C", text: "#fff", light: "#FDF8EC", border: "#C9A84C" },
  Platinum: { bg: "#7B68EE", text: "#fff", light: "#F0EEFF", border: "#7B68EE" },
};

// ─── HOOKS ───────────────────────────────────────────────────────────────────
function useCountUp(target, duration = 1800, start = false) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) return;
    let startTime = null;
    const step = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration, start]);
  return value;
}

// 印刷（PDF保存）時は、スクロール位置に関係なく全チャートを強制表示する。
const PrintContext = React.createContext(false);

function useIntersection(ref, threshold = 0.2) {
  const forced = useContext(PrintContext);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [ref, threshold]);
  // ブラウザのネイティブ印刷（Cmd+P 等）でも、未スクロールのチャートを表示させる
  useEffect(() => {
    const show = () => setVisible(true);
    window.addEventListener("beforeprint", show);
    const mql = window.matchMedia ? window.matchMedia("print") : null;
    const onMql = (e) => { if (e.matches) setVisible(true); };
    if (mql?.addEventListener) mql.addEventListener("change", onMql);
    return () => {
      window.removeEventListener("beforeprint", show);
      if (mql?.removeEventListener) mql.removeEventListener("change", onMql);
    };
  }, []);
  return visible || forced;
}

function Reveal({ children, delay = 0, className = "", style = {} }) {
  const ref = useRef(null);
  const visible = useIntersection(ref, 0.12);
  return (
    <div
      ref={ref}
      className={`ari-reveal${visible ? " ari-reveal--visible" : ""}${className ? ` ${className}` : ""}`}
      style={{ transitionDelay: delay ? `${delay}s` : undefined, ...style }}
    >
      {children}
    </div>
  );
}

// ─── COMPONENTS ──────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const map = {
    pass: ["report-status-badge--success", "✓ Pass"],
    partial: ["report-status-badge--attention", "△ Partial"],
    fail: ["report-status-badge--danger", "✗ Fail"],
  };
  const [className, label] = map[status] || map.fail;
  return <span className={`report-status-badge ${className}`}>{label}</span>;
}

function ScoreBar({ score, variant = SCORE_BAR_VARIANTS.accent, delay = 0 }) {
  const ref = useRef(null);
  const visible = useIntersection(ref);
  return (
    <div ref={ref} className="report-score-bar">
      <div
        className={`report-score-bar__fill report-score-bar__fill--${variant}`}
        style={{
          width: visible ? `${score}%` : "0%",
          transition: `width 0.8s cubic-bezier(0.16,1,0.3,1) ${delay}s`,
        }}
      />
    </div>
  );
}

function RadarChart({ data }) {
  const ref = useRef(null);
  const visible = useIntersection(ref);
  const size = 220, cx = 110, cy = 110, r = 80;
  const n = data.length;
  const angle = (i) => (i / n) * 2 * Math.PI - Math.PI / 2;
  const pt = (i, radius) => ({
    x: cx + radius * Math.cos(angle(i)),
    y: cy + radius * Math.sin(angle(i)),
  });
  const polygon = (radius) => data.map((_, i) => `${pt(i, radius).x},${pt(i, radius).y}`).join(" ");
  const dataPolygon = data.map((d, i) => `${pt(i, (d.score / 100) * r).x},${pt(i, (d.score / 100) * r).y}`).join(" ");

  return (
    <div ref={ref} style={{ display: "flex", justifyContent: "center" }}>
      <svg width={size} height={size} style={{ overflow: "visible" }}>
        {[0.2, 0.4, 0.6, 0.8, 1].map((f) => (
          <polygon key={f} points={polygon(f * r)} fill="none" stroke="#E5E5E5" strokeWidth={1} />
        ))}
        {data.map((_, i) => (
          <line key={i} x1={cx} y1={cy} x2={pt(i, r).x} y2={pt(i, r).y} stroke="#E5E5E5" strokeWidth={1} />
        ))}
        <polygon
          points={dataPolygon}
          fill="var(--color-accent)"
          fillOpacity={visible ? 0.14 : 0}
          stroke="var(--color-accent)"
          strokeWidth={2}
          strokeOpacity={visible ? 1 : 0}
          style={{ transition: "fill-opacity 1s ease, stroke-opacity 1s ease" }}
        />
        {data.map((d, i) => {
          const labelPt = pt(i, r + 20);
          return (
            <text key={i} x={labelPt.x} y={labelPt.y} textAnchor="middle" dominantBaseline="middle"
              style={{ fontSize: 10, fill: "#6B6B6B", fontFamily: "-apple-system, sans-serif" }}>
              {d.category}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function PieChart({ data }) {
  const size = 160, cx = 80, cy = 80, r = 60, inner = 32;
  let cumulative = 0;
  const colors = ["#0A0A0A", "#4A4A4A", "#8A8A8A", "#ADADAD", "#D0D0D0"];
  const slices = data.map((d, i) => {
    const start = cumulative;
    cumulative += d.pct;
    const startAngle = (start / 100) * 2 * Math.PI - Math.PI / 2;
    const endAngle = (cumulative / 100) * 2 * Math.PI - Math.PI / 2;
    const large = d.pct > 50 ? 1 : 0;
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
    const ix1 = cx + inner * Math.cos(startAngle), iy1 = cy + inner * Math.sin(startAngle);
    const ix2 = cx + inner * Math.cos(endAngle), iy2 = cy + inner * Math.sin(endAngle);
    return { d: `M ${ix1} ${iy1} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${inner} ${inner} 0 ${large} 0 ${ix1} ${iy1} Z`, color: colors[i], label: d.source, pct: d.pct };
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
      <svg width={size} height={size}>
        {slices.map((s, i) => <path key={i} d={s.d} fill={s.color} />)}
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {slices.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: "#3A3A3A" }}>{s.label}</span>
            <span style={{ fontSize: 12, color: "#9A9A9A", marginLeft: "auto" }}>{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// 改善ロードマップ — スコア推移タイムライン（スクロール連動アニメーション）
function RoadmapTimeline({ roadmap, currentScore }) {
  const ref = useRef(null);
  const visible = useIntersection(ref);

  const steps = roadmap.map((item) => ({
    ...item,
    impactNum: parseFloat(String(item.impact).replace("+", "")) || 0,
  }));
  const totalImpact = steps.reduce((s, x) => s + x.impactNum, 0);
  const targetScore = Math.min(100, Math.round(currentScore + totalImpact));

  const W = 800, H = 168, padX = 56;
  const nodeCount = steps.length + 2; // 現状 + steps + 目標
  const nodeXs = Array.from({ length: nodeCount }, (_, i) =>
    padX + ((W - padX * 2) * i) / (nodeCount - 1)
  );

  let cumulative = currentScore;
  const scores = [currentScore, ...steps.map((s) => { cumulative += s.impactNum; return Math.min(100, Math.round(cumulative)); }), targetScore];

  const pathD = `M ${nodeXs[0]} 72 L ${nodeXs[nodeXs.length - 1]} 72`;
  const pathLen = nodeXs[nodeXs.length - 1] - nodeXs[0];

  const nodeColor = (priority) =>
    priority === "High" ? "#0A0A0A" : priority === "Medium" ? "#6B6B6B" : "#B0B0B0";

  return (
    <div ref={ref} style={{
      background: "#F8F8F8", borderRadius: 12, padding: "28px 24px 20px",
      marginBottom: 28, border: "1px solid #F0F0F0", overflow: "hidden",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#9B9B9B", letterSpacing: 1.5, textTransform: "uppercase" }}>
          Implementation Roadmap
        </span>
        <span style={{ fontSize: 12, color: "#6B6B6B" }}>
          優先度順 · 段階的スコア向上
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }}>
        {/* ベースライン */}
        <line x1={nodeXs[0]} y1={72} x2={nodeXs[nodeXs.length - 1]} y2={72}
          stroke="#E5E5E5" strokeWidth={3} strokeLinecap="round" />
        {/* アニメーション進行ライン */}
        <line x1={nodeXs[0]} y1={72} x2={nodeXs[nodeXs.length - 1]} y2={72}
          stroke="#16A34A" strokeWidth={3} strokeLinecap="round"
          strokeDasharray={pathLen}
          strokeDashoffset={visible ? 0 : pathLen}
          style={{ transition: "stroke-dashoffset 1.4s cubic-bezier(0.16,1,0.3,1) 0.2s" }}
        />
        {/* 移動する光点 */}
        <circle r={5} fill="#16A34A" opacity={visible ? 0.9 : 0}>
          <animateMotion dur="2.8s" repeatCount="indefinite" begin={visible ? "0.5s" : "indefinite"}
            path={pathD} />
        </circle>

        {/* 現状ノード */}
        <g style={{
          opacity: visible ? 1 : 0,
          transition: "opacity 0.5s ease 0.15s",
        }}>
          <circle cx={nodeXs[0]} cy={72} r={14} fill="#fff" stroke="#0A0A0A" strokeWidth={3} />
          <text x={nodeXs[0]} y={76} textAnchor="middle" style={{ fontSize: 11, fontWeight: 800, fill: "#0A0A0A", fontFamily: "-apple-system, sans-serif" }}>
            {currentScore}
          </text>
          <text x={nodeXs[0]} y={108} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: "#0A0A0A", fontFamily: "-apple-system, sans-serif" }}>
            現状
          </text>
        </g>

        {/* 施策ノード */}
        {steps.map((step, i) => {
          const x = nodeXs[i + 1];
          const delay = 0.25 + i * 0.12;
          const color = nodeColor(step.priority);
          return (
            <g key={i} style={{
              opacity: visible ? 1 : 0,
              transition: `opacity 0.5s ease ${delay}s`,
            }}>
              <circle cx={x} cy={72} r={12} fill="#fff" stroke={color} strokeWidth={2.5} />
              <text x={x} y={76} textAnchor="middle" style={{ fontSize: 10, fontWeight: 800, fill: color, fontFamily: "-apple-system, sans-serif" }}>
                {i + 1}
              </text>
              <text x={x} y={44} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: "#16A34A", fontFamily: "-apple-system, sans-serif" }}>
                {scores[i + 1]}
              </text>
              <text x={x} y={108} textAnchor="middle" style={{ fontSize: 9, fill: "#6B6B6B", fontFamily: "-apple-system, sans-serif" }}>
                {step.impact}pt
              </text>
            </g>
          );
        })}

        {/* 目標ノード */}
        <g style={{
          opacity: visible ? 1 : 0,
          transition: `opacity 0.5s ease ${0.25 + steps.length * 0.12}s`,
        }}>
          <circle cx={nodeXs[nodeXs.length - 1]} cy={72} r={16} fill="#16A34A" stroke="#16A34A" strokeWidth={3} />
          <text x={nodeXs[nodeXs.length - 1]} y={76} textAnchor="middle" style={{ fontSize: 11, fontWeight: 800, fill: "#fff", fontFamily: "-apple-system, sans-serif" }}>
            {targetScore}
          </text>
          <text x={nodeXs[nodeXs.length - 1]} y={108} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: "#16A34A", fontFamily: "-apple-system, sans-serif" }}>
            目標
          </text>
        </g>
      </svg>

      {/* フェーズラベル（モバイルでも読める要約） */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        {steps.map((step, i) => (
          <div key={i} style={{
            fontSize: 11, padding: "4px 10px", borderRadius: 100,
            background: visible ? (step.priority === "High" ? "#0A0A0A" : "#F0F0F0") : "#F5F5F5",
            color: visible ? (step.priority === "High" ? "#fff" : "#6B6B6B") : "#C0C0C0",
            fontWeight: 600,
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(6px)",
            transition: `all 0.45s ease ${0.4 + i * 0.08}s`,
          }}>
            Phase {i + 1}: {step.action.length > 18 ? step.action.slice(0, 18) + "…" : step.action}
          </div>
        ))}
      </div>
    </div>
  );
}

// 改善ロードマップ — リスト行（スタガーアニメーション）
function RoadmapItem({ item, index, cardStyle }) {
  const ref = useRef(null);
  const visible = useIntersection(ref, 0.15);
  const delay = index * 0.1;

  return (
    <div ref={ref} style={{
      ...cardStyle,
      display: "flex", alignItems: "center", gap: 20,
      border: "1px solid #F0F0F0",
      opacity: visible ? 1 : 0,
      transform: visible ? "translateX(0)" : "translateX(-20px)",
      transition: `opacity 0.55s cubic-bezier(0.16,1,0.3,1) ${delay}s, transform 0.55s cubic-bezier(0.16,1,0.3,1) ${delay}s`,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: "50%",
        background: item.priority === "High" ? "#0A0A0A" : "#F0F0F0",
        color: item.priority === "High" ? "#fff" : "#6B6B6B",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 800, flexShrink: 0,
        boxShadow: visible && item.priority === "High" ? "0 0 0 4px rgba(10,10,10,0.08)" : "none",
        transition: `box-shadow 0.4s ease ${delay + 0.3}s`,
      }}>
        {index + 1}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#0A0A0A", marginBottom: 2 }}>{item.action}</div>
        <div style={{ fontSize: 12, color: "#6B6B6B" }}>工数: {item.effort}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 20, fontWeight: 900, color: "#16A34A", letterSpacing: "-0.5px" }}>{item.impact}pt</div>
        <div style={{ fontSize: 11, color: "#9B9B9B" }}>改善幅</div>
      </div>
      <div style={{ textAlign: "right", minWidth: 60 }}>
        <div style={{ fontSize: 11, color: "#9B9B9B", marginBottom: 2 }}>ROI</div>
        <div style={{ fontSize: 13 }}>{item.roi}</div>
      </div>
      <div style={{ minWidth: 60 }}>
        <span style={{
          fontSize: 11, padding: "3px 10px", borderRadius: 100, fontWeight: 700,
          background: item.priority === "High" ? "#0A0A0A" : "#F5F5F5",
          color: item.priority === "High" ? "#fff" : "#6B6B6B",
        }}>{item.priority}</span>
      </div>
    </div>
  );
}

function RoadmapSummaryBox({ currentScore, roadmap }) {
  const ref = useRef(null);
  const visible = useIntersection(ref, 0.2);
  const totalImpact = roadmap.reduce((s, r) => s + (parseFloat(String(r.impact).replace("+", "")) || 0), 0);
  const targetScore = Math.min(100, Math.round(currentScore + totalImpact));

  return (
    <div ref={ref} style={{
      marginTop: 20, padding: "16px 20px", background: "#F0FDF4", borderRadius: 10,
      border: "1px solid #BBF7D0",
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(12px)",
      transition: "opacity 0.6s ease 0.3s, transform 0.6s cubic-bezier(0.16,1,0.3,1) 0.3s",
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#16A34A" }}>
        全施策を実装した場合、総合スコアは最大 {targetScore}/100 に改善される見込みです
        <span style={{ fontWeight: 500, color: "#4ADE80", marginLeft: 8 }}>
          (+{Math.round(totalImpact)}pt)
        </span>
      </div>
    </div>
  );
}

// ─── MEDIA COVERAGE CAROUSEL（掲載媒体・index.html より移植） ─────────────────
// base（本番:"/report/"）配下で配信されるため、import.meta.env.BASE_URL を前置する。
const MEDIA_BASE = import.meta.env.BASE_URL;
const HERO_IMAGE = `${MEDIA_BASE}assets/hero-search-comparison.png`;
const MEDIA_LOGOS = [
  { src: `${MEDIA_BASE}assets/media-logos/04-toyokeizai.svg`, name: "東洋経済オンライン" },
  { src: `${MEDIA_BASE}assets/media-logos/12-president.svg`, name: "PRESIDENT Online" },
  { src: `${MEDIA_BASE}assets/media-logos/13-jbpress.svg`, name: "JBpress" },
  { src: `${MEDIA_BASE}assets/media-logos/14-jiji.svg`, name: "時事ドットコム" },
  { src: `${MEDIA_BASE}assets/media-logos/15-mainichi.svg`, name: "毎日新聞デジタル" },
  { src: `${MEDIA_BASE}assets/media-logos/05-asahi-and.svg`, name: "朝日新聞デジタルマガジン＆[and]" },
  { src: `${MEDIA_BASE}assets/media-logos/01-tbs-news-dig.svg`, name: "TBS NEWS DIG" },
  { src: `${MEDIA_BASE}assets/media-logos/10-fnn.svg`, name: "FNNプライムオンライン" },
  { src: `${MEDIA_BASE}assets/media-logos/20-tvtokyo.svg`, name: "テレ東プラス" },
];

function MediaCoverage() {
  return (
    <div style={{ marginTop: 36 }} aria-label="メディア掲載">
      <a
        href="https://www.coaretail.com/readiness/citation"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="メディア掲載実績一覧を見る"
        style={{ display: "block", textDecoration: "none", color: "inherit" }}
      >
        <p style={{ textAlign: "center", fontSize: 11, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9B9B9B", marginBottom: 16 }}>
          <span style={{ color: "#C9A84C" }}>Media Coverage</span> ・ メディア掲載実績
        </p>
        <div className="ari-media-mask">
          <div className="ari-media-track">
            {[...MEDIA_LOGOS, ...MEDIA_LOGOS].map((m, i) => {
              const dup = i >= MEDIA_LOGOS.length;
              return (
                <span key={i} className="ari-media-chip" title={m.name} aria-hidden={dup}>
                  <img src={m.src} alt={dup ? "" : m.name} loading="lazy" />
                </span>
              );
            })}
          </div>
        </div>
      </a>
      <style>{`
        .ari-media-mask {
          overflow: hidden;
          -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 6%, #000 94%, transparent 100%);
          mask-image: linear-gradient(90deg, transparent 0%, #000 6%, #000 94%, transparent 100%);
        }
        .ari-media-track {
          display: flex; align-items: center; gap: 38px;
          width: max-content; padding: 4px 0;
          animation: ariMediaScroll 50s linear infinite;
        }
        .ari-media-track:hover { animation-play-state: paused; }
        @keyframes ariMediaScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .ari-media-chip {
          flex-shrink: 0; display: flex; align-items: center; justify-content: center;
          height: 34px; padding: 4px 14px;
          background: #fff; border: 1px solid #ECECEC; border-radius: 4px;
          opacity: 0.78; filter: grayscale(0.2);
          transition: opacity 0.25s ease, filter 0.25s ease;
        }
        .ari-media-chip img { display: block; height: 18px; width: auto; max-width: 150px; object-fit: contain; }
        .ari-media-mask:hover .ari-media-chip { opacity: 1; filter: none; }
        @media (prefers-reduced-motion: reduce) {
          .ari-media-track { animation: none; flex-wrap: wrap; justify-content: center; width: 100%; gap: 16px 28px; }
          .ari-media-mask { -webkit-mask-image: none; mask-image: none; }
        }
      `}</style>
    </div>
  );
}

const SITE_NAV_LINKS = [
  { href: "/framework/", label: "Framework" },
  { href: "/research/", label: "Research" },
  { href: "/whitepaper/", label: "Whitepaper" },
  { href: "/evidence/", label: "Evidence" },
  { href: "/news/", label: "News" },
  { href: "/insights/", label: "Insights" },
  { href: "/methodology.html", label: "Methodology" },
];

const SITE_FOOTER_LINKS = [
  { href: "/", label: "トップ" },
  { href: "/framework/", label: "Framework" },
  { href: "/research/", label: "Research" },
  { href: "/whitepaper/", label: "Whitepaper" },
  { href: "/evidence/", label: "Evidence" },
  { href: "/news/", label: "News" },
  { href: "/insights/", label: "Insights" },
  { href: "/methodology.html", label: "Methodology" },
  { href: "/dental.html", label: "Benchmarks" },
  { href: "/report/", label: "診断レポート" },
  { href: "https://www.coaretail.com", label: "Coa Retail", external: true },
];

function CtaBtn({ onClick, variant = "ink", children }) {
  return (
    <button type="button" className={`lp-cta lp-cta--${variant}`} onClick={onClick}>
      {children}
      <span className="lp-cta__icon" aria-hidden="true">→</span>
    </button>
  );
}

function CtaLink({ href, variant = "ink", external = false, onClick, children }) {
  return (
    <a
      href={href}
      className={`lp-cta lp-cta--${variant}`}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      onClick={onClick}
    >
      {children}
      <span className="lp-cta__icon" aria-hidden="true">→</span>
    </a>
  );
}

function LandingPage({ onStart }) {
  const [legal, setLegal] = useState(null);
  const proofRef = useRef(null);
  const proofTrackedRef = useRef(false);

  useEffect(() => {
    const track = () => {
      if (proofTrackedRef.current) return;
      proofTrackedRef.current = true;
      trackReportProofImpression({ proof_version: "9c" });
    };
    const element = proofRef.current;
    if (!element || typeof IntersectionObserver !== "function") {
      track();
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        track();
        observer.disconnect();
      }
    }, { threshold: 0.2 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const faqs = [
    { q: "広告やSEOは続けています。それでも必要ですか？", a: "必要です。広告とSEOは人が検索したあとに効きます。いま増えているのは、検索せずAIに聞く行動です。レポートは、その経路で御社が比較・推薦・問い合わせまで届くかを確認します。" },
    { q: "何が分かるレポートですか？", a: "ChatGPT・Gemini・Claude・Perplexityが御社をどう認識しているか、比較候補に入るか、推薦理由を作れるか、予約や問い合わせまでつながるかを23項目で評価し、直す順番を示します。" },
    { q: "業種は限定されますか？", a: "限定しません。小売、飲食、美容、不動産、教育、医療、宿泊など、集客導線があるサービス全般が対象です。会社名、公式サイトURL、業種があれば診断できます。" },
    { q: "どのくらいで結果が届きますか？", a: "入力から約3分で診断レポートが生成されます。結果ページからPDFをダウンロードできます。" },
    { q: "¥29,800で何が手元に残りますか？", a: "ARI診断レポート本体、23項目スコア、4大AIの認識分析、改善優先順位、改善ロードマップ、PDF、および同梱のARI Research Report 2026です。" },
    { q: "成果は保証されますか？", a: "スコアや改善提案は解析時点の推計です。特定の検索順位、AI出力、集客件数、売上を保証するものではありません。" },
  ];

  return (
    <div className="lp">
      <div className="lp-fv" style={{ "--lp-hero-bg": `url(${HERO_IMAGE})` }}>
        <nav className="lp-nav" aria-label="サイト">
          <a href="/" className="lp-nav__brand">
            Agent Readiness <span>Index™</span>
          </a>
          <div className="lp-nav__links">
            {SITE_NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href}>{link.label}</a>
            ))}
          </div>
          <CtaBtn onClick={onStart}>レポートを入手する</CtaBtn>
        </nav>

        <section className="lp-hero">
          <div className="lp-hero__visual">
            <img
              src={HERO_IMAGE}
              alt="AI検索結果の比較：ARI対策前は競合のみ表示、対策後は御社が第1推薦になる例"
              width={960}
              height={540}
              loading="eager"
              decoding="async"
            />
          </div>
          <div className="lp-hero__content">
            <p className="lp-hero__kicker">Decision Product — Personalized Decision Report</p>
            <h1 id="start">集客の入口が、検索からAIに移っています</h1>
            <p className="lp-hero__sub">
              広告費を足しても伸びないとき、原因はクリエイティブではなく、AIが御社を候補に上げていないことです。公式サイトURLから、推薦されない理由と直す順をレポートにします。
            </p>
            <div className="lp-hero__cta-row">
              <CtaBtn onClick={onStart}>レポートを入手する</CtaBtn>
              <p className="lp-hero__price">
                <strong>¥29,800</strong><small>税別</small>
                <span className="lp-hero__price-was">通常 ¥49,800</span>
              </p>
            </div>
            <p className="lp-hero__meta">約3分で診断完了 ・ PDFダウンロード ・ 1社1回</p>
          </div>
        </section>
      </div>

      <div className="lp-strip">
        <MediaCoverage />
        <Reveal delay={0.08}>
          <div className="lp-stats" style={{ marginTop: 36 }}>
            <div className="lp-stats__item">
              <div className="lp-stats__n">最大5.5倍</div>
              <div className="lp-stats__l">業種間AI推薦率格差</div>
            </div>
            <div className="lp-stats__rule" />
            <div className="lp-stats__item">
              <div className="lp-stats__n">23項目</div>
              <div className="lp-stats__l">評価チェックポイント</div>
            </div>
            <div className="lp-stats__rule" />
            <div className="lp-stats__item">
              <div className="lp-stats__n">約3分</div>
              <div className="lp-stats__l">レポート生成時間</div>
            </div>
          </div>
        </Reveal>
      </div>

      <section className="lp-section" id="problem">
        <h2>集客が止まっている会社で、いま起きていること</h2>
        <p className="lp-section__lead">
          見込み客は「どこがよいか」を人に聞かなくなっています。AIに聞いて、比較して、そのまま予約や問い合わせに進みます。そこに載っていない会社は、広告を増やしても候補に入りません。
        </p>
        <div className="lp-pains">
          <article>
            <strong>認知</strong>
            <div>
              <h3>検索では見つかる。AIでは名前が出ない</h3>
              <p>Googleで上位でも、ChatGPTやGeminiの回答に御社が入らなければ、比較の土俵に立てません。</p>
            </div>
          </article>
          <article>
            <strong>比較</strong>
            <div>
              <h3>候補に入っても、選ぶ理由が書けない</h3>
              <p>料金、対象、実績、予約方法がAIに読めないと、推薦文は競合のほうに流れます。</p>
            </div>
          </article>
          <article>
            <strong>行動</strong>
            <div>
              <h3>推薦されても、予約まで届かない</h3>
              <p>問い合わせフォームや予約導線が弱いと、AI経由の関心は途中で切れます。</p>
            </div>
          </article>
        </div>
      </section>

      <section className="lp-section" id="features">
        <h2>経営が次に打つ手を決めるための診断です</h2>
        <p className="lp-section__lead">
          <a href="/framework/" style={{ color: "#0d1b3e", fontWeight: 600 }}>Agent Readiness Framework</a>
          に基づき、認識・比較・推薦・行動のどこで落ちているかを数値化します。
        </p>
        <div className="lp-stack">
          <div className="lp-stack__hero">
            <h3>直す順番が分かる</h3>
            <p>23項目のスコアから、影響の大きい改善を上から並べます。全部直す必要はありません。先に効く3つが分かります。</p>
          </div>
          <div className="lp-stack__side">
            <div className="lp-stack__cell">
              <h3>4大AIの認識差</h3>
              <p>同じ会社でも、モデルごとに認識と推薦の強さが違います。その差を並べます。</p>
            </div>
            <div className="lp-stack__cell">
              <h3>予約・問い合わせまで</h3>
              <p>推薦のあと、実際に行動できる導線があるかを Actionability として確認します。</p>
            </div>
          </div>
        </div>
      </section>

      <VideoCarousel />

      <section ref={proofRef} className="lp-proof" id="proof">
        <Reveal>
        <div className="lp-proof__inner">
          <div className="lp-proof__heading">
            <div className="lp-proof__eyebrow">Representative Example</div>
            <h2>¥29,800で分かること</h2>
            <p>スコアを見るためのレポートではありません。AIが何を理解でき、どこで比較・推薦につまずき、何から直すべきかを判断するためのレポートです。</p>
          </div>
          <div className="lp-proof__notice">
            以下はレポート構成を説明するための代表例です。実際の分析結果は対象企業・サイトによって異なります。
          </div>
          <div className="lp-proof__grid">
            <article className="lp-proof-card">
              <div className="lp-proof-card__label">OBSERVATION</div>
              <h3>何が見えているか</h3>
              <p>公式サイトや公開情報から、AIが理解するための手がかりを整理します。</p>
              <div className="lp-proof-card__subhead">WHAT AI CAN SEE</div>
              <ul>
                <li>会社・店舗の基本情報</li>
                <li>サービス・提供内容</li>
                <li>所在地・連絡先の手がかり</li>
              </ul>
            </article>
            <article className="lp-proof-card">
              <div className="lp-proof-card__label">GAP</div>
              <h3>何が不足しているか</h3>
              <p>比較に必要な料金、対象、選ばれる理由など、判断材料の不足箇所を切り分けます。</p>
              <div className="lp-proof-card__subhead">WHY IT MATTERS</div>
              <p>見つけられても比較・推薦の根拠が足りなければ、候補に残りにくくなります。</p>
            </article>
            <article className="lp-proof-card lp-proof-card--priority">
              <div className="lp-proof-card__label">PRIORITY / NEXT ACTION</div>
              <h3>何から直すべきか</h3>
              <p>影響度と着手順を整理し、最初に対応する課題を判断できる形にします。</p>
              <div className="lp-proof-card__actions">
                <span>HIGH</span> 比較情報を明確にする
                <span>MEDIUM</span> サービス範囲を整理する
                <span>LOW</span> 予約・問い合わせ導線を整える
              </div>
            </article>
          </div>
          <div className="lp-proof__decision">
            <strong>レポートを読んだあとに決められること</strong>
            <span>いま直すべき課題は何か。自社で対応するか、専門支援に任せるか。</span>
          </div>
          <div className="lp-proof__footer">
            <p>有料レポートでは、対象サイトに合わせた23項目の分析と改善優先順位を確認できます。</p>
            <CtaLink href="https://localgeo.coaretail.com/?utm_source=ari_report&utm_medium=outbound&utm_campaign=direct_buyer&utm_content=report_proof" variant="outline" external onClick={() => trackLocalCtaClick({ placement: "report_proof" })}>
              店舗・クリニックの集客改善を任せたい（月額60,000円）
            </CtaLink>
          </div>
        </div>
        </Reveal>
      </section>

      <section className="lp-section" id="how">
        <h2>会社名とURLを入れて、レポートを受け取る</h2>
        <p className="lp-section__lead">準備は公式サイトだけです。診断後にPDFをダウンロードできます。</p>
        <div className="lp-steps">
          <article>
            <div className="lp-steps__n">1</div>
            <h3>入力する</h3>
            <p>会社名、公式サイトURL、業種、メールアドレスを入れます。</p>
          </article>
          <article>
            <div className="lp-steps__n">2</div>
            <h3>決済する</h3>
            <p>¥29,800（税別）。Stripeで支払い、同じ流れで診断が始まります。</p>
          </article>
          <article>
            <div className="lp-steps__n">3</div>
            <h3>読む</h3>
            <p>約3分でレポート生成。改善の優先順を確認し、PDFを保存します。</p>
          </article>
        </div>
      </section>

      <section className="lp-section" id="pricing">
        <h2>ARI診断とレポートダウンロード</h2>
        <p className="lp-section__lead">プランは1つです。診断本体とPDF、調査レポート同梱。</p>
        <div className="lp-offer" style={{ maxWidth: 520 }}>
          <div className="lp-offer__inner">
            <div className="lp-offer__kicker">1社1回</div>
            <div className="lp-offer__price">¥29,800<small>税別</small></div>
            <div className="lp-offer__was">通常 ¥49,800</div>
            <ul>
              {["12セクション / 23項目の詳細レポート", "4大AI認識分析", "改善優先順位とロードマップ", "PDFダウンロード", "ARI Research Report 2026 同梱"].map((item) => (
                <li key={item}><span>✓</span>{item}</li>
              ))}
            </ul>
            <CtaBtn onClick={onStart} variant="gold">レポートを入手する</CtaBtn>
          </div>
        </div>
      </section>

      <section className="lp-section" id="faq">
        <h2>よくある質問</h2>
        <div className="lp-faq">
          {faqs.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <div className="lp-strip">
        <div className="lp-final">
          <div className="lp-final__inner">
            <div>
              <h2>AIに尋ねたとき、御社は候補に入っていますか</h2>
              <p>¥29,800（税別）・約3分・PDFダウンロード</p>
            </div>
            <CtaBtn onClick={onStart} variant="gold">レポートを入手する</CtaBtn>
          </div>
        </div>
        <div className="lp-final lp-final--consult">
          <div className="lp-final__inner">
            <div>
              <h2>レポート結果を、どこから着手すべきか迷っていませんか</h2>
              <p>30分のオンライン相談・無料</p>
            </div>
            <CtaLink href={MTG_SCHEDULE_URL} variant="outline" external>
              無料相談を予約する
            </CtaLink>
          </div>
        </div>
      </div>

      <footer className="lp-footer">
        <div className="lp-footer__links">
          {SITE_FOOTER_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noopener noreferrer" : undefined}
            >
              {link.label}
            </a>
          ))}
        </div>
        <div className="lp-footer__links">
          <button type="button" onClick={() => setLegal("terms")}>利用規約</button>
          <button type="button" onClick={() => setLegal("privacy")}>プライバシーポリシー</button>
        </div>
        <div style={{ fontSize: 12, color: "#8a93a6" }}>© 2026 合同会社コア・リテール（Coa Retail G.K.） All rights reserved.</div>
      </footer>
      <LegalModal doc={legal} onClose={() => setLegal(null)} />
    </div>
  );
}

// ─── FORM PAGE ────────────────────────────────────────────────────────────────
// フォーム入力欄。FormPage の外で定義しないと、再レンダリングのたびに
// コンポーネントが再生成され input がアンマウント→フォーカスが外れる。
function Field({ label, name, type = "text", placeholder, options, form, setForm, errors }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#0A0A0A", marginBottom: 8 }}>{label}</label>
      {options ? (
        <select value={form[name]} onChange={e => setForm({ ...form, [name]: e.target.value })}
          style={{ width: "100%", padding: "12px 14px", border: `1px solid ${errors[name] ? "#DC2626" : "#E5E5E5"}`, borderRadius: 8, fontSize: 14, color: form[name] ? "#0A0A0A" : "#9B9B9B", background: "#fff", outline: "none", boxSizing: "border-box" }}>
          <option value="">選択してください</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type={type} value={form[name]} onChange={e => setForm({ ...form, [name]: e.target.value })}
          placeholder={placeholder}
          style={{ width: "100%", padding: "12px 14px", border: `1px solid ${errors[name] ? "#DC2626" : "#E5E5E5"}`, borderRadius: 8, fontSize: 14, color: "#0A0A0A", outline: "none", boxSizing: "border-box" }} />
      )}
      {errors[name] && <p style={{ margin: "6px 0 0", fontSize: 12, color: "#DC2626" }}>{errors[name]}</p>}
    </div>
  );
}

// ─── LEGAL（利用規約・プライバシーポリシー） ─────────────────────────────────
// 既存の公開ポリシー（coaretail.com）と整合させつつ、本サービス（Agent Readiness
// Index 診断）の実態（AI各社への外部送信・Stripe決済・取得項目）に合わせて整備。
const LEGAL_COMPANY = {
  name: "合同会社コア・リテール（Coa Retail G.K.）",
  rep: "佐々木 健之",
  contact: "https://www.coaretail.com/contact",
  site: "https://www.coaretail.com",
};

const LEGAL_DOCS = {
  terms: {
    title: "利用規約",
    updated: "2026年6月26日",
    intro: "本利用規約（以下「本規約」といいます）は、合同会社コア・リテール（以下「当社」といいます）が提供する AI 露出診断サービス「Agent Readiness Index」（以下「本サービス」といいます）の利用条件を定めるものです。利用者（以下「ユーザー」といいます）は、本規約に同意のうえ本サービスを利用するものとします。",
    sections: [
      { h: "第1条（適用）", body: [
        "本規約は、本サービスの提供条件およびユーザーと当社との間の権利義務関係に適用されます。",
        "ユーザーが本サービスの申込みフォームで「同意」を選択し、または本サービスを利用した時点で、本規約に同意したものとみなします。",
      ] },
      { h: "第2条（サービス内容）", body: [
        "本サービスは、ユーザーが入力した企業情報および公式サイトを対象に、主要な生成AI・AI検索（ChatGPT、Gemini、Claude、Perplexity 等）における認識・比較・推薦・行動接続の準備度を評価し、改善優先順位を含む診断レポート（Company Report）を生成・提供するものです。サイトの技術的整備状況は、Actionability評価の一部として確認します。",
        "本サービスが提供するスコア、順位、偏差値その他の数値は、解析時点の情報に基づく推計値であり、特定の検索結果・AI出力・集客・売上その他の成果を保証するものではありません。",
        "本サービスは現在ベータ版として提供されており、機能・仕様・料金は予告なく変更される場合があります。",
      ] },
      { h: "第3条（料金および支払い）", body: [
        "本サービスの利用料金は、申込み時に表示する金額（ベータ版：29,800円（税別））とします。",
        "支払いは、当社が指定する決済代行事業者（Stripe）を通じて行われます。ユーザーは決済代行事業者の定める規約にも従うものとします。",
        "本サービスはデジタル役務であり、レポート生成（役務の提供）が開始された後の返金は、当社に重大な帰責事由がある場合を除き、原則として行いません。",
      ] },
      { h: "第4条（AI解析および外部サービスの利用）", body: [
        "本サービスは解析の過程で、ユーザーが入力した企業名・URL・業種等の情報、および対象サイトの公開情報を、第三者が提供するAI・クラウドサービス（OpenAI、Google、Anthropic、Perplexity 等）へ送信します。",
        "ユーザーは、自己が入力する情報について、第三者の権利を侵害せず、かつ当社が上記の解析を行うために必要な範囲で利用・送信することに同意するものとします。機密情報・個人情報を不必要に入力しないようご注意ください。",
      ] },
      { h: "第5条（禁止事項）", body: [
        "ユーザーは、本サービスの利用にあたり、次の行為を行ってはなりません。",
      ], list: [
        "法令または公序良俗に違反する行為",
        "当社または第三者の権利・利益を侵害する行為",
        "虚偽の情報を入力する行為、他者になりすます行為",
        "本サービスの運営を妨害し、または不正アクセス・リバースエンジニアリング等を試みる行為",
        "本サービスにより得たレポート等を、当社の許諾なく再販・再配布する行為",
      ] },
      { h: "第6条（知的財産権）", body: [
        "本サービスおよび診断レポートに関する著作権その他の知的財産権は、当社または正当な権利者に帰属します。",
        "ユーザーは、提供を受けたレポートを自社の内部利用の範囲で利用できます。第三者への公開・再配布を行う場合は事前に当社の同意を得るものとします。",
      ] },
      { h: "第7条（免責事項）", body: [
        "本サービスは情報提供を目的とするものであり、診断結果の正確性・完全性・有用性、および特定目的への適合性を保証しません。",
        "AIの出力内容は提供各社のモデル・仕様に依存し、時期や条件により変動します。当社はこれらに起因する結果について責任を負いません。",
        "当社の故意または重過失による場合を除き、本サービスに起因してユーザーに生じた損害について、当社は責任を負いません。当社が責任を負う場合でも、その範囲はユーザーが当社に支払った利用料金の額を上限とします。",
      ] },
      { h: "第8条（サービスの変更・中断・終了）", body: [
        "当社は、ユーザーへの事前の通知なく、本サービスの内容を変更し、または提供を中断・終了することができます。これによりユーザーに生じた損害について、当社は責任を負いません。",
      ] },
      { h: "第9条（本規約の変更）", body: [
        "当社は、必要と判断した場合、本規約を変更できます。変更後の本規約は、本サービス上に表示した時点から効力を生じます。",
      ] },
      { h: "第10条（準拠法・管轄）", body: [
        "本規約の解釈および適用は日本法に準拠します。",
        "本サービスに関して紛争が生じた場合、当社の所在地を管轄する裁判所を第一審の専属的合意管轄裁判所とします。",
      ] },
    ],
  },
  privacy: {
    title: "プライバシーポリシー",
    updated: "2026年6月26日",
    intro: "合同会社コア・リテール（以下「当社」といいます）は、AI露出診断サービス「Agent Readiness Index」（以下「本サービス」といいます）における利用者の個人情報を、以下の方針に基づき適切に取り扱います。",
    sections: [
      { h: "1. 事業者情報", body: [
        `事業者：${LEGAL_COMPANY.name}`,
        `代表者：${LEGAL_COMPANY.rep}`,
      ], contact: true },
      { h: "2. 取得する情報", body: [
        "本サービスでは、サービス提供のため次の情報を取得します。",
      ], list: [
        "申込みフォームに入力された情報（会社名、公式サイトURL、業種、メールアドレス）",
        "決済に関する情報（決済代行事業者 Stripe を通じて処理され、カード番号等の決済情報は当社サーバーに保存しません）",
        "アクセスログ・Cookie 等の利用状況に関する情報（Google Analytics 4 を使用）",
      ] },
      { h: "3. 利用目的", body: [
        "取得した情報は、次の目的の範囲で利用します。",
      ], list: [
        "診断レポートの生成・提供および結果のご連絡",
        "本サービスに関するお問い合わせ対応・ご案内",
        "本サービスの品質向上・新機能の開発・統計分析",
      ] },
      { h: "4. 外部サービスへの提供・送信", body: [
        "本サービスは解析のため、入力情報および対象サイトの公開情報を、次の第三者サービスへ送信します。各社の情報の取扱いは各社のポリシーに従います。",
      ], list: [
        "AI解析：OpenAI（ChatGPT）、Google（Gemini）、Anthropic（Claude）、Perplexity",
        "決済処理：Stripe",
        "アクセス解析：Google（Google Analytics 4）",
      ] },
      { h: "5. Cookie・アクセス解析", body: [
        "本サービスは、利用状況の把握とサービス改善のため Cookie および Google Analytics 4 を利用します。ブラウザの設定により Cookie を無効化できますが、その場合一部機能が利用できないことがあります。",
      ] },
      { h: "6. 安全管理措置", body: [
        "当社は、取得した情報の漏えい・滅失・毀損の防止その他安全管理のために、通信の暗号化（SSL/TLS）等の必要かつ適切な措置を講じます。",
      ] },
      { h: "7. 保存期間", body: [
        "取得した情報は、利用目的の達成に必要な期間、または法令で定める期間保存し、不要となった場合は適切に消去します。",
      ] },
      { h: "8. 開示・訂正・削除等の請求", body: [
        "ユーザーは、当社が保有する自己の個人情報について、開示・訂正・利用停止・削除等を請求できます。下記お問い合わせ窓口までご連絡ください。ご本人であることを確認のうえ、法令に従い対応します。",
      ] },
      { h: "9. 本ポリシーの改定", body: [
        "当社は、法令の改正やサービス内容の変更に応じて本ポリシーを改定することがあります。改定後の内容は本サービス上に表示した時点から適用されます。",
      ] },
      { h: "10. お問い合わせ窓口", body: [
        `${LEGAL_COMPANY.name}`,
      ], contact: true },
    ],
  },
};

function LegalModal({ doc, onClose }) {
  if (!doc) return null;
  const data = LEGAL_DOCS[doc];
  if (!data) return null;
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(10,10,10,0.55)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, overflowY: "auto" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ position: "relative", background: "#fff", borderRadius: 16, padding: "40px 40px 48px", maxWidth: 720, width: "100%", margin: "40px 0", boxShadow: "0 12px 64px rgba(0,0,0,0.25)" }}
      >
        <button onClick={onClose} aria-label="閉じる" style={{
          position: "absolute", top: 16, right: 16, width: 36, height: 36,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "#F5F5F5", border: "none", borderRadius: 8,
          fontSize: 18, lineHeight: 1, color: "#6B6B6B", cursor: "pointer",
        }}>✕</button>

        <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0A0A0A", letterSpacing: "-0.6px", marginBottom: 6 }}>{data.title}</h1>
        <div style={{ fontSize: 12, color: "#9B9B9B", marginBottom: 24 }}>最終更新日：{data.updated}</div>

        <p style={{ fontSize: 14, color: "#3A3A3A", lineHeight: 1.9, marginBottom: 28 }}>{data.intro}</p>

        {data.sections.map(sec => (
          <div key={sec.h} style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "#0A0A0A", marginBottom: 10 }}>{sec.h}</h2>
            {sec.body.map((p, i) => (
              <p key={i} style={{ fontSize: 13.5, color: "#3A3A3A", lineHeight: 1.9, marginBottom: 8 }}>{p}</p>
            ))}
            {sec.list && (
              <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                {sec.list.map((li, i) => (
                  <li key={i} style={{ fontSize: 13.5, color: "#3A3A3A", lineHeight: 1.9, marginBottom: 4 }}>{li}</li>
                ))}
              </ul>
            )}
            {sec.contact && (
              <p style={{ fontSize: 13.5, color: "#3A3A3A", lineHeight: 1.9, marginBottom: 8 }}>
                お問い合わせ：
                <a href={LEGAL_COMPANY.contact} target="_blank" rel="noopener noreferrer" style={{ color: "#0A0A0A", textDecoration: "underline" }}>お問い合わせフォーム</a>
              </p>
            )}
          </div>
        ))}

        <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid #E5E5E5", fontSize: 12, color: "#9B9B9B", lineHeight: 1.8 }}>
          {LEGAL_COMPANY.name}<br />
          代表社員：{LEGAL_COMPANY.rep}<br />
          お問い合わせ：
          <a href={LEGAL_COMPANY.contact} target="_blank" rel="noopener noreferrer" style={{ color: "#6B6B6B", textDecoration: "underline" }}>お問い合わせフォーム</a>
          {" ／ "}
          <a href={LEGAL_COMPANY.site} target="_blank" rel="noopener noreferrer" style={{ color: "#6B6B6B", textDecoration: "underline" }}>{LEGAL_COMPANY.site}</a>
        </div>

        <button onClick={onClose} style={{
          marginTop: 28, width: "100%", background: "#0A0A0A", color: "#fff", border: "none",
          padding: "13px", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer",
        }}>閉じる</button>
      </div>
    </div>
  );
}

function ResearchEditionModal({ onClose, onDownload }) {
  const features = [
    "5業種・231件の観測データ",
    "ChatGPT / Gemini / Claude / Perplexity の4AIクロス検証",
    "業種別考察と Evidence パッケージ",
    "Company Report の個社分析を市場データと比較する Benchmark 資料",
    "PDF 即時ダウンロード（Company Report 同梱 entitlement）",
  ];
  const metaRows = [
    {
      label: "位置づけ",
      value: "Company Report 同梱の ARI Research Report 2026（Benchmark Evidence）",
    },
    {
      label: "内容",
      value: "231件の観測データ・4AIクロス検証・業種別考察",
    },
    {
      label: "対象者",
      value: <>調査根拠と自社スコアを<strong>セットで把握したい</strong>経営・マーケ担当者</>,
    },
    {
      label: "使い方",
      value: "Company Report の改善判断を、市場全体の Benchmark と照合する資料",
    },
  ];

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(10,10,10,0.55)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, overflowY: "auto" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: "relative", background: "#fff", borderRadius: 16, padding: "40px 40px 48px", maxWidth: 680, width: "100%", margin: "40px 0", boxShadow: "0 12px 64px rgba(0,0,0,0.25)" }}
      >
        <button onClick={onClose} aria-label="閉じる" style={{
          position: "absolute", top: 16, right: 16, width: 36, height: 36,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "#F5F5F5", border: "none", borderRadius: 8,
          fontSize: 18, lineHeight: 1, color: "#6B6B6B", cursor: "pointer",
        }}>✕</button>

        <div style={{ fontSize: 11, fontWeight: 700, color: "#9B9B9B", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 }}>
          Included with Company Report
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0A0A0A", letterSpacing: "-0.6px", marginBottom: 8 }}>
          ARI Research Report 2026
        </h1>
        <p style={{ fontSize: 13, fontWeight: 700, color: "#6B6B6B", marginBottom: 16 }}>
          Market Research / Benchmark / Evidence
        </p>
        <p style={{ fontSize: 14, color: "#3A3A3A", lineHeight: 1.9, marginBottom: 24 }}>
          調査データ・Benchmark・業種観察の Evidence パッケージです。
          Agent Readiness Company Report に同梱されており、個社レポートの判断を市場全体の観測データと接続できます。
        </p>

        <div style={{ borderTop: "1px solid #F0F0F0", borderBottom: "1px solid #F0F0F0", padding: "20px 0", marginBottom: 24 }}>
          {metaRows.map((row, index) => (
            <div
              key={row.label}
              style={{
                display: "grid",
                gridTemplateColumns: "96px 1fr",
                gap: 16,
                alignItems: "start",
                marginBottom: index === metaRows.length - 1 ? 0 : 14,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "#9B9B9B" }}>{row.label}</div>
              <div style={{ fontSize: 13.5, color: "#3A3A3A", lineHeight: 1.8 }}>{row.value}</div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: "#9B9B9B", letterSpacing: 1, marginBottom: 12 }}>
          収録内容
        </div>
        <ul style={{ margin: "0 0 24px", paddingLeft: 20 }}>
          {features.map((item) => (
            <li key={item} style={{ fontSize: 13.5, color: "#3A3A3A", lineHeight: 1.9, marginBottom: 6 }}>{item}</li>
          ))}
        </ul>

        <div style={{ background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 10, padding: "12px 16px", marginBottom: 24, fontSize: 13, color: "#065F46", lineHeight: 1.7 }}>
          Company Report 購入 entitlement により追加決済なしでダウンロードできます（このブラウザ・72時間）。
        </div>

        <a
          href={RESEARCH_EDITION.pdfPath}
          download={RESEARCH_EDITION.pdfDownloadName}
          onClick={onDownload}
          style={{
            display: "block", width: "100%", background: "#0A0A0A", color: "#fff", border: "none",
            padding: "14px", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer",
            textAlign: "center", textDecoration: "none", boxSizing: "border-box",
          }}
        >
          ARI Research Report 2026（PDF）をダウンロード
        </a>

        <a
          href={RESEARCH_EDITION.readPath}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "block", marginTop: 12, textAlign: "center", fontSize: 13, color: "#6B6B6B", textDecoration: "underline",
          }}
        >
          オンライン版を読む
        </a>

        <button
          type="button"
          onClick={onClose}
          style={{
            marginTop: 20, width: "100%", background: "transparent", color: "#6B6B6B", border: "1px solid #E5E5E5",
            padding: "12px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}
        >
          閉じる
        </button>
      </div>
    </div>
  );
}

function HandbookUpgradeModal({ onClose, onCheckout }) {
  const upgrade = PRODUCTS.handbookUpgrade;
  const features = [
    "DRAモデル・3軸×4要素の評価基準",
    "3フェーズ改善ロードマップ（Playbook）",
    "Readiness Level 基準（Beginner〜Leader）",
    "ARI Research Report 2026 全文収録",
    "決済完了後、PDFを即時ダウンロード",
  ];
  const metaRows = [
    {
      label: "対象者",
      value: <>施策に<strong>そのまま落とし込みたい</strong>実務・代理店担当者</>,
    },
    {
      label: "得られるもの",
      value: "DRA評価基準・実行Playbook・Readiness Level基準",
    },
    {
      label: "役割",
      value: "How — 実行手順・実装方法",
    },
    {
      label: "使い方",
      value: "明日から現場で使う実装マニュアル",
    },
  ];

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(10,10,10,0.55)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, overflowY: "auto" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: "relative", background: "#fff", borderRadius: 16, padding: "40px 40px 48px", maxWidth: 680, width: "100%", margin: "40px 0", boxShadow: "0 12px 64px rgba(0,0,0,0.25)" }}
      >
        <button onClick={onClose} aria-label="閉じる" style={{
          position: "absolute", top: 16, right: 16, width: 36, height: 36,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "#F5F5F5", border: "none", borderRadius: 8,
          fontSize: 18, lineHeight: 1, color: "#6B6B6B", cursor: "pointer",
        }}>✕</button>

        <div style={{ fontSize: 11, fontWeight: 700, color: "#9B9B9B", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 }}>
          Methodology Handbook Upgrade
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0A0A0A", letterSpacing: "-0.6px", marginBottom: 8 }}>
          Agent Readiness Methodology Handbook 2026
        </h1>
        <p style={{ fontSize: 13, fontWeight: 700, color: "#6B6B6B", marginBottom: 16 }}>
          Implementation Method — How
        </p>
        <p style={{ fontSize: 14, color: "#3A3A3A", lineHeight: 1.9, marginBottom: 24 }}>
          Company Report が &quot;What / Priority&quot; なら、Handbook は &quot;How / Implementation Method&quot;。
          DRA評価基準・現場で使える Playbook・Readiness Level 基準を1冊に収録した実装マニュアルです。
          Company Report で把握した改善優先順位を、どう測り・どう直すかの標準に接続できます。
        </p>

        <div style={{ borderTop: "1px solid #F0F0F0", borderBottom: "1px solid #F0F0F0", padding: "20px 0", marginBottom: 24 }}>
          {metaRows.map((row) => (
            <div
              key={row.label}
              style={{
                display: "grid",
                gridTemplateColumns: "96px 1fr",
                gap: 16,
                alignItems: "start",
                marginBottom: row.label === "使い方" ? 0 : 14,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "#9B9B9B" }}>{row.label}</div>
              <div style={{ fontSize: 13.5, color: "#3A3A3A", lineHeight: 1.8 }}>{row.value}</div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: "#9B9B9B", letterSpacing: 1, marginBottom: 12 }}>
          収録内容
        </div>
        <ul style={{ margin: "0 0 24px", paddingLeft: 20 }}>
          {features.map((item) => (
            <li key={item} style={{ fontSize: 13.5, color: "#3A3A3A", lineHeight: 1.9, marginBottom: 6 }}>{item}</li>
          ))}
        </ul>

        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#92400E", lineHeight: 1.7 }}>
          Company Report 購入者は差額 ¥69,000（税別）で追加できます。
        </div>

        <div style={{ background: "#F8F8F8", borderRadius: 12, padding: "20px 24px", marginBottom: 24, border: "1px solid #F0F0F0" }}>
          <div style={{ fontSize: 12, color: "#9B9B9B", marginBottom: 6 }}>既購入者向けアップグレード価格</div>
          <div style={{ fontSize: 32, fontWeight: 900, color: "#0A0A0A", letterSpacing: "-1px" }}>
            ¥{upgrade.priceExTax.toLocaleString("ja-JP")}
            <span style={{ fontSize: 14, fontWeight: 700, color: "#6B6B6B", marginLeft: 8 }}>（税別）</span>
          </div>
          <div style={{ fontSize: 13, color: "#6B6B6B", marginTop: 4 }}>
            税込 ¥{upgrade.priceTaxIncl.toLocaleString("ja-JP")}
          </div>
        </div>

        <button
          type="button"
          onClick={onCheckout}
          style={{
            width: "100%", background: "#0A0A0A", color: "#fff", border: "none",
            padding: "14px", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer",
          }}
        >
          Stripeで決済する
        </button>
        <p style={{ textAlign: "center", fontSize: 12, color: "#9B9B9B", marginTop: 12, marginBottom: 0 }}>
          🔒 Stripe決済・SSL暗号化済み
        </p>

        <button
          type="button"
          onClick={onClose}
          style={{
            marginTop: 20, width: "100%", background: "transparent", color: "#6B6B6B", border: "1px solid #E5E5E5",
            padding: "12px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}
        >
          閉じる
        </button>
      </div>
    </div>
  );
}

function FormPage({ onSubmit, onClose, initialForm = null }) {
  const industries = ["小売・EC", "飲食・フード", "美容・ヘルスケア", "不動産", "教育・スクール", "医療・歯科", "宿泊・ホテル", "フィットネス", "その他"];
  const [form, setForm] = useState(() => ({
    company: initialForm?.company || "",
    url: initialForm?.url || "",
    industry: initialForm?.industry || "",
    email: initialForm?.email || "",
    agree: false,
  }));
  const [errors, setErrors] = useState({});
  const [legal, setLegal] = useState(null);

  const validate = () => {
    const e = {};
    if (!form.company) e.company = "会社名を入力してください";
    if (!form.url) e.url = "URLを入力してください";
    if (!form.industry) e.industry = "業種を選択してください";
    if (!form.email || !form.email.includes("@")) e.email = "正しいメールアドレスを入力してください";
    if (!form.agree) e.agree = "利用規約に同意してください";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => { if (validate()) onSubmit(form); };

  return (
    <div style={{ minHeight: "100vh", background: "#F8F8F8", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ position: "relative", background: "#fff", borderRadius: 16, padding: "56px 48px", maxWidth: 480, width: "100%", boxShadow: "0 4px 32px rgba(0,0,0,0.08)" }}>
        {onClose && (
          <button onClick={onClose} aria-label="閉じる" style={{
            position: "absolute", top: 16, right: 16, width: 36, height: 36,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#F5F5F5", border: "none", borderRadius: 8,
            fontSize: 18, lineHeight: 1, color: "#6B6B6B", cursor: "pointer",
            transition: "background 0.15s ease, color 0.15s ease",
          }}
            onMouseEnter={e => { e.currentTarget.style.background = "#ECECEC"; e.currentTarget.style.color = "#0A0A0A"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "#F5F5F5"; e.currentTarget.style.color = "#6B6B6B"; }}>
            ✕
          </button>
        )}
        <div style={{ marginBottom: 40 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#9B9B9B", letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>診断フォーム</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#0A0A0A", letterSpacing: "-0.8px", margin: 0 }}>ARI診断レポートを入手する</h1>
          <p style={{ fontSize: 13, color: "#9B9B9B", marginTop: 8 }}>会社名と公式サイトURLを入力。約3分でレポートを生成し、PDFをダウンロードできます。</p>
        </div>
        <Field label="会社名" name="company" placeholder="株式会社サンプル" form={form} setForm={setForm} errors={errors} />
        <Field label="公式サイトURL" name="url" placeholder="https://example.com" form={form} setForm={setForm} errors={errors} />
        <Field label="業種" name="industry" options={industries} form={form} setForm={setForm} errors={errors} />
        <Field label="メールアドレス" name="email" type="email" placeholder="you@company.com" form={form} setForm={setForm} errors={errors} />
        <div style={{ marginBottom: 32 }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={form.agree} onChange={e => setForm({ ...form, agree: e.target.checked })} style={{ marginTop: 2 }} />
            <span style={{ fontSize: 13, color: "#6B6B6B", lineHeight: 1.6 }}>
              <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); setLegal("terms"); }} style={{ background: "none", border: "none", padding: 0, color: "#0A0A0A", textDecoration: "underline", cursor: "pointer", font: "inherit" }}>利用規約</button>
              および
              <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); setLegal("privacy"); }} style={{ background: "none", border: "none", padding: 0, color: "#0A0A0A", textDecoration: "underline", cursor: "pointer", font: "inherit" }}>プライバシーポリシー</button>
              に同意します
            </span>
          </label>
          {errors.agree && <p style={{ margin: "6px 0 0 22px", fontSize: 12, color: "#DC2626" }}>{errors.agree}</p>}
        </div>
        <button onClick={handleSubmit} style={{
          width: "100%", background: "#0A0A0A", color: "#fff", border: "none",
          padding: "14px", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer",
          marginBottom: 12,
        }}>
          レポートを入手する（¥29,800 税別）
        </button>
        <p style={{ textAlign: "center", fontSize: 12, color: "#9B9B9B" }}>🔒 Stripe決済・SSL暗号化済み</p>
      </div>
      <LegalModal doc={legal} onClose={() => setLegal(null)} />
    </div>
  );
}

// ─── PAYMENT PAGE ─────────────────────────────────────────────────────────────
function PaymentPage({ form, onPay, onBack, onClose }) {
  return (
    <div style={{ minHeight: "100vh", background: "#F8F8F8", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ position: "relative", background: "#fff", borderRadius: 16, padding: "56px 48px", maxWidth: 480, width: "100%", boxShadow: "0 4px 32px rgba(0,0,0,0.08)" }}>
        {onClose && (
          <button onClick={onClose} aria-label="閉じる" style={{
            position: "absolute", top: 16, right: 16, width: 36, height: 36,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#F5F5F5", border: "none", borderRadius: 8,
            fontSize: 18, lineHeight: 1, color: "#6B6B6B", cursor: "pointer",
            transition: "background 0.15s ease, color 0.15s ease",
          }}
            onMouseEnter={e => { e.currentTarget.style.background = "#ECECEC"; e.currentTarget.style.color = "#0A0A0A"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "#F5F5F5"; e.currentTarget.style.color = "#6B6B6B"; }}>
            ✕
          </button>
        )}
        <div style={{ marginBottom: 32 }}>
          {onBack && (
            <button onClick={onBack} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "none", border: "none", padding: 0, marginBottom: 16,
              fontSize: 13, fontWeight: 600, color: "#6B6B6B", cursor: "pointer",
            }}
              onMouseEnter={e => { e.currentTarget.style.color = "#0A0A0A"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "#6B6B6B"; }}>
              ← 戻る
            </button>
          )}
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0A0A0A", letterSpacing: "-0.6px" }}>お支払い確認</h1>
        </div>
        <div style={{ background: "#F8F8F8", borderRadius: 10, padding: "20px 24px", marginBottom: 32 }}>
          <div style={{ fontSize: 13, color: "#6B6B6B", marginBottom: 4 }}>診断対象</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0A0A0A" }}>{form.company}</div>
          <div style={{ fontSize: 13, color: "#9B9B9B" }}>{form.url}</div>
        </div>
        <div style={{ borderTop: "1px solid #E5E5E5", borderBottom: "1px solid #E5E5E5", padding: "20px 0", marginBottom: 32 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 14, color: "#6B6B6B" }}>Agent Readiness Company Report</span>
            <span style={{ fontSize: 14, color: "#0A0A0A" }}>¥29,800</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 14, color: "#6B6B6B" }}>同梱: ARI Research Report 2026（Benchmark Evidence）</span>
            <span style={{ fontSize: 14, color: "#16A34A" }}>Included</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 14, color: "#6B6B6B" }}>消費税（10%）</span>
            <span style={{ fontSize: 14, color: "#0A0A0A" }}>¥2,980</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, paddingTop: 16, borderTop: "1px solid #E5E5E5" }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#0A0A0A" }}>合計（税込）</span>
            <span style={{ fontSize: 20, fontWeight: 800, color: "#0A0A0A" }}>¥32,780</span>
          </div>
        </div>
        <button onClick={onPay} style={{
          width: "100%", background: "#0A0A0A", color: "#fff", border: "none",
          padding: "14px", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer",
        }}>
          ¥32,780（税込）の決済に進む
        </button>
        <p style={{ textAlign: "center", fontSize: 12, color: "#9B9B9B", marginTop: 12 }}>
          次の画面（Stripe）でカード情報を入力します ・ 🔒 Powered by Stripe
        </p>
      </div>
    </div>
  );
}

// ─── ANALYSIS BACKEND ─────────────────────────────────────────────────────────
// AI呼び出し・サイト解析・スコアリング(buildReport)はサーバー側 /api/analyze に移行。
// APIキーはサーバー専用環境変数で保持し、クライアントには一切含めない。

// ─── ANALYZING PAGE ───────────────────────────────────────────────────────────
const ANALYSIS_STEPS = [
  { id: "site",       label: "サイトを解析中…",            fn: null },
  { id: "files",      label: "robots.txt / LLMs.txtを確認中…", fn: null },
  { id: "chatgpt",    label: "ChatGPTにクエリ中…",          fn: null },
  { id: "gemini",     label: "Geminiにクエリ中…",           fn: null },
  { id: "claude",     label: "Claudeにクエリ中…",           fn: null },
  { id: "perplexity", label: "Perplexityにクエリ中…",       fn: null },
  { id: "score",      label: "スコアを計算中…",             fn: null },
  { id: "report",     label: "レポートを生成中…",           fn: null },
];

function AnalyzingPage({ onComplete, form, purchaseState = null, isPaidFlow = false, retryKey = 0, onRetry }) {
  const [currentStep, setCurrentStep]   = useState(0);
  const [completedSteps, setCompleted]  = useState([]);
  const [progress, setProgress]         = useState(0);
  const [error, setError]               = useState(null);
  const [apiMode, setApiMode]           = useState("checking");
  const ranRef = useRef(false);

  useEffect(() => {
    ranRef.current = false;
    setError(null);
    setCurrentStep(0);
    setCompleted([]);
    setProgress(0);
    setApiMode("checking");
  }, [retryKey]);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    // ステップ表示はクライアント側でアニメーション。実処理はサーバー(/api/analyze)。
    let stepTimer;
    const advance = (i) => {
      setCurrentStep(i);
      setProgress(Math.round((i / ANALYSIS_STEPS.length) * 100));
      setCompleted((prev) => (i > 0 ? Array.from(new Set([...prev, i - 1])) : prev));
    };
    let stepIdx = 0;
    advance(0);
    // 最後の2ステップ(score / report)はAPI応答後に確定させる
    stepTimer = setInterval(() => {
      stepIdx = Math.min(stepIdx + 1, ANALYSIS_STEPS.length - 3);
      advance(stepIdx);
    }, 650);

    const run = async () => {
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company:  form?.company  || "",
            url:      form?.url      || "",
            industry: form?.industry || "",
            email:    form?.email    || "",
            paid:     isPaidFlow,
            purchaseSessionId: isPaidFlow ? (purchaseState?.sessionId || "") : "",
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = data?.message || data?.error || `サーバーエラー (${res.status})`;
          throw new Error(msg);
        }
        if (!data?.report) throw new Error("レポートデータを取得できませんでした");
        if (isPaidFlow && data.mode !== "live") {
          throw new Error("有料診断にはライブ解析結果が必要です。しばらくして再試行してください。");
        }

        clearInterval(stepTimer);
        setApiMode(data.mode === "live" ? "live" : "demo");
        setCompleted(ANALYSIS_STEPS.map((_, i) => i));
        setCurrentStep(ANALYSIS_STEPS.length - 1);
        setProgress(100);

        setTimeout(() => onComplete(data.report), 700);
      } catch (e) {
        clearInterval(stepTimer);
        setError(`解析中にエラーが発生しました: ${e.message}`);
      }
    };

    run();
    return () => clearInterval(stepTimer);
  }, [retryKey, isPaidFlow, form, onComplete]);

  return (
    <div style={{ minHeight: "100vh", background: "#0A0A0A", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: "#1A1A1A", border: "1px solid #2A2A2A", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 40px" }}>
          <div style={{ width: 32, height: 32, border: "3px solid #C9A84C", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: "#fff", letterSpacing: "-0.6px", marginBottom: 8 }}>AIが御社を分析中</h2>
        <p style={{ fontSize: 14, color: "#6B6B6B", marginBottom: 8 }}>主要AIプラットフォームにクエリを実行しています</p>

        {/* API モードバッジ */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 100, background: apiMode === "live" ? "#0F2E1A" : "#1A1A00", border: `1px solid ${apiMode === "live" ? "#16A34A" : "#CA8A04"}`, marginBottom: 40 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: apiMode === "live" ? "#16A34A" : "#CA8A04" }} />
          <span style={{ fontSize: 11, color: apiMode === "live" ? "#4ADE80" : "#FCD34D", fontWeight: 600 }}>
            {apiMode === "live" ? "LIVE — 実際のAI APIに接続中" : "DEMO — APIキー未設定（デモデータ使用）"}
          </span>
        </div>

        {error && (
          <div style={{ background: "#2A0A0A", border: "1px solid #DC2626", borderRadius: 10, padding: "16px 20px", marginBottom: 24, textAlign: "left" }}>
            <div style={{ fontSize: 13, color: "#FCA5A5", marginBottom: isPaidFlow ? 12 : 0 }}>{error}</div>
            {isPaidFlow && (
              <p style={{ fontSize: 12, color: "#FECACA", margin: "0 0 12px", lineHeight: 1.6 }}>
                お支払いは記録されています。解析のみ再試行できます（追加決済は不要です）。
              </p>
            )}
            {isPaidFlow && (
              <button
                type="button"
                onClick={() => onRetry?.()}
                style={{
                  background: "#C9A84C", color: "#0A0A0A", border: "none",
                  padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}
              >
                解析を再試行
              </button>
            )}
          </div>
        )}

        <div style={{ background: "#1A1A1A", borderRadius: 12, overflow: "hidden", marginBottom: 32 }}>
          <div style={{ height: 3, background: "#2A2A2A" }}>
            <div style={{ height: "100%", background: "#C9A84C", width: `${progress}%`, transition: "width 0.4s ease" }} />
          </div>
          <div style={{ padding: "20px 24px" }}>
            {ANALYSIS_STEPS.map((s, i) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0", opacity: i <= currentStep ? 1 : 0.25, transition: "opacity 0.3s ease" }}>
                <div style={{
                  width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                  background: completedSteps.includes(i) ? "#C9A84C" : i === currentStep ? "#C9A84C" : "#2A2A2A",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, color: "#0A0A0A", fontWeight: 800,
                }}>
                  {completedSteps.includes(i) ? "✓" : i === currentStep ? "•" : ""}
                </div>
                <span style={{ fontSize: 13, color: i <= currentStep ? "#fff" : "#3A3A3A", textAlign: "left" }}>{s.label}</span>
                {i === currentStep && !completedSteps.includes(i) && (
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#C9A84C" }}>実行中</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 環境変数設定ガイド（デモモード時のみ表示・運用者向け） */}
        {apiMode === "demo" && (
          <div style={{ background: "#111100", border: "1px solid #3A3A00", borderRadius: 10, padding: "16px 20px", textAlign: "left" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#FCD34D", marginBottom: 10, letterSpacing: 1 }}>
              🔑 サーバーにAPIキーを設定してLIVEモードへ
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                ["OPENAI_API_KEY",     "sk-..."],
                ["GEMINI_API_KEY",     "AIza..."],
                ["ANTHROPIC_API_KEY",  "sk-ant-..."],
                ["PERPLEXITY_API_KEY", "pplx-..."],
              ].map(([key, placeholder]) => (
                <div key={key} style={{ fontFamily: "monospace", fontSize: 11, color: "#9A9A5A" }}>
                  <span style={{ color: "#FCD34D" }}>{key}</span>=<span style={{ color: "#6B6B6B" }}>{placeholder}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10, color: "#5A5A3A", marginTop: 10 }}>
              Vercelの環境変数（またはローカルの .env）に設定 → 再デプロイで有効になります
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── NAV SEEK BAR ─────────────────────────────────────────────────────────────
// ヘッダー(ナビ)の横スクロール位置を示すシークバー。ドラッグでスライドも可能。
function NavSeekBar({ targetRef }) {
  const [m, setM] = useState({ ratio: 0, thumb: 1, scrollable: false });
  const draggingRef = useRef(false);

  const update = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const maxScroll = scrollWidth - clientWidth;
    setM({
      scrollable: maxScroll > 1,
      thumb: scrollWidth > 0 ? Math.min(1, clientWidth / scrollWidth) : 1,
      ratio: maxScroll > 0 ? scrollLeft / maxScroll : 0,
    });
  }, [targetRef]);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const t = setTimeout(update, 300); // フォント読込後の幅確定に備える
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      clearTimeout(t);
    };
  }, [targetRef, update]);

  const seekTo = (clientX, trackEl) => {
    const el = targetRef.current;
    if (!el || !trackEl) return;
    const rect = trackEl.getBoundingClientRect();
    const thumbW = m.thumb * rect.width;
    const usable = rect.width - thumbW;
    let x = clientX - rect.left - thumbW / 2;
    x = Math.max(0, Math.min(x, usable));
    const ratio = usable > 0 ? x / usable : 0;
    el.scrollLeft = ratio * (el.scrollWidth - el.clientWidth);
  };

  const onPointerDown = (e) => {
    const trackEl = e.currentTarget;
    draggingRef.current = true;
    trackEl.setPointerCapture?.(e.pointerId);
    seekTo(e.clientX, trackEl);
    const onMove = (ev) => { if (draggingRef.current) seekTo(ev.clientX, trackEl); };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (!m.scrollable) return null;
  const thumbPct = m.thumb * 100;
  const leftPct = m.ratio * (100 - thumbPct);

  return (
    <div className="no-print" style={{ maxWidth: "var(--container-max)", margin: "0 auto", padding: "0 var(--container-gutter) 6px" }}>
      <div onPointerDown={onPointerDown} style={{ position: "relative", height: 8, display: "flex", alignItems: "center", cursor: "pointer", touchAction: "none" }}>
        <div style={{ position: "absolute", left: 0, right: 0, height: 3, background: "#EDEDED", borderRadius: 2 }} />
        <div style={{ position: "absolute", height: 3, borderRadius: 2, background: "var(--color-accent)", width: `${thumbPct}%`, left: `${leftPct}%`, transition: draggingRef.current ? "none" : "left 0.1s linear" }} />
      </div>
    </div>
  );
}

// ─── REPORT PAGE ──────────────────────────────────────────────────────────────
function ReportPage({ report, form, reportMode = "demo", purchaseState = null }) {
  const [printing, setPrinting] = useState(false);
  const [showHandbookModal, setShowHandbookModal] = useState(false);
  const [showResearchModal, setShowResearchModal] = useState(false);
  const scoreRef = useRef(null);
  const navScrollRef = useRef(null);

  useEffect(() => {
    if (!printing) return;
    const id = requestAnimationFrame(() => {
      window.print();
      setPrinting(false);
    });
    return () => cancelAnimationFrame(id);
  }, [printing]);

  const scoreVisible = useIntersection(scoreRef);
  const animScore = useCountUp(report.overallScore, 2000, scoreVisible);
  const isPaidReport = reportMode === "paid";
  const isSampleReport = reportMode === "sample";
  const showFulfillment = isPaidReport && purchaseState?.entitlements?.companyReport;
  const showRankMetrics = !!(report.rank && report.deviation != null);
  const showKnowledge = Array.isArray(report.knowledgeCoverage) && report.knowledgeCoverage.length > 0;
  const showAuthority = Array.isArray(report.authority) && report.authority.length > 0;
  const companyName = form?.company || report.company;
  const reportUrl = form?.url || report.url;

  const sections = [
    { id: "overview", label: "総合スコア" },
    { id: "ai", label: "AI認識" },
    { id: "summary", label: "解釈" },
    { id: "breakdown", label: "カテゴリ" },
    ...(showKnowledge ? [{ id: "knowledge", label: "情報カバレッジ" }] : []),
    ...(showAuthority ? [{ id: "authority", label: "権威性" }] : []),
    { id: "booking", label: "予約導線" },
    { id: "technical", label: "技術" },
    { id: "priority", label: "優先TOP3" },
    { id: "proposals", label: "改善提案" },
    { id: "roadmap", label: "ロードマップ" },
    { id: "decision", label: "Decision" },
  ];

  const improvementProposals = (report.improvementProposals?.length >= 5)
    ? report.improvementProposals.slice(0, 5)
    : (report.improvementProposals?.length
      ? report.improvementProposals
      : (report.roadmap || []).slice(0, 5).map((item) => ({
          title: item.action,
          description: `${companyName}において「${item.action}」は改善幅${item.impact}・ROI ${item.roi}と試算されています。優先度${item.priority}の施策として、AI推薦率の向上に寄与します。`,
        })));

  const priorityTop3 = improvementProposals.slice(0, 3).map((item, i) =>
    mapProposalToPriority(item, i, report.roadmap),
  );
  const remainingProposals = improvementProposals.slice(3);
  const scoreNote = scoreInterpretation(report, isSampleReport);
  const firstPriority = priorityTop3[0];

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const cardStyle = { background: "var(--color-surface-subtle)", borderRadius: "var(--radius-md)", padding: "var(--space-5)" };

  return (
    <PrintContext.Provider value={printing}>
    <div className="report-shell">
      {isSampleReport && (
        <div className="report-sample-banner">
          <span>SAMPLE / DEMO — ILLUSTRATIVE DATA（サンプル表示。実購入レポートとはデータソースが異なります）</span>
        </div>
      )}

      <div className="report-sticky-nav no-print">
        <div className="report-sticky-nav__inner">
          <div ref={navScrollRef} className="report-nav-scroll">
            <span className="report-nav-company">{companyName}</span>
            {sections.map((s) => (
              <button key={s.id} type="button" onClick={() => scrollTo(s.id)} className="report-nav-btn">
                {s.label}
              </button>
            ))}
          </div>
          <div className="report-header-actions">
            <a href={IMPROVE_URL} className="report-btn-primary">
              改善支援を見る
            </a>
          </div>
        </div>
        <NavSeekBar targetRef={navScrollRef} />
      </div>

      {showFulfillment && (
        <div className="report-fulfillment no-print">
          <div className="report-fulfillment__inner">
            <div className="report-fulfillment__label">
              {purchaseState?.verified ? "Purchase verified" : "Purchase recorded"}
            </div>
            <p className="report-fulfillment__copy">
              Personalized Company Report と ARI Research Report 2026（Benchmark Evidence）へのアクセスが有効です（このブラウザ・72時間）。
            </p>
            <div className="report-fulfillment__actions">
              <button type="button" onClick={() => setPrinting(true)} className="report-btn-primary">
                表示結果をPDFとして保存
              </button>
              {purchaseState?.entitlements?.researchEdition && (
                <button type="button" onClick={() => setShowResearchModal(true)} className="report-btn-secondary">
                  ARI Research Report 2026をダウンロード
                </button>
              )}
              {!purchaseState?.entitlements?.methodologyHandbook && (
                <button type="button" onClick={() => setShowHandbookModal(true)} className="report-btn-secondary report-btn-upgrade">
                  Methodology Handbookへアップグレード（既購入者向け ¥69,000）
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Evidence anchor — Overall Score */}
      <section id="overview" className="report-section report-section--emphasis" ref={scoreRef}>
        <div className="report-eyebrow">Agent Readiness Company Report</div>
        <div className="report-header-meta">
          <div><strong>Company:</strong> {companyName}</div>
          {reportUrl && <div><strong>URL:</strong> {reportUrl}</div>}
          {report.analyzedAt && <div><strong>Generated:</strong> {report.analyzedAt}</div>}
          <div><strong>Readiness Level:</strong> {report.level}</div>
        </div>

        <div className="report-score-grid">
          <div>
            <div className="report-score-value">{animScore}</div>
            <div className="report-score-denom">/ 100</div>
            <span className="report-level-chip">Readiness Level — {report.level}</span>
            <p className="report-score-interpretation">{scoreNote}</p>
            {showRankMetrics && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)", marginTop: "var(--space-5)" }}>
                {[
                  ["全国順位", `${report.rank.national.toLocaleString()}位`],
                  ["東京都順位", `${report.rank.tokyo}位`],
                  ["業界順位", `${report.rank.industry}位`],
                  ["偏差値", report.deviation],
                ].map(([l, v]) => (
                  <div key={l} className="report-panel report-panel--plain">
                    <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>{l}</div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{v}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <RadarChart data={report.scoreBreakdown} />
            <div className="report-provenance">
              <span>{isSampleReport ? "Illustrative data" : "Live AI observation"}</span>
              <span>Site-derived</span>
              <span>ARI score</span>
              {isPaidReport && <span>Research benchmark included</span>}
            </div>
          </div>
        </div>
      </section>

      {/* Evidence — AI Recognition */}
      <section id="ai" className="report-section">
        <div className="report-eyebrow">Evidence</div>
        <h2 className="report-h2">AIから現在どう認識されているか</h2>
        <p className="report-lead">
          複数AI環境で、企業・サービス・提供価値がどのように認識されているかを確認します。
          {isSampleReport ? " 本セクションはサンプルデータです。" : " 有料レポートはライブ観測結果です。"}
        </p>
        <div className="report-ai-grid">
          {report.aiRecognition.map((ai, i) => (
            <div key={ai.ai} className="report-panel report-panel--plain">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{ai.ai}</h3>
                <span className={`report-status-tag ${ai.bookable ? "report-status-tag--positive" : "report-status-tag--attention"}`}>
                  {ai.bookable ? "予約可能" : "要対応"}
                </span>
              </div>
              {[
                ["認識率", ai.recognition, SCORE_BAR_VARIANTS.accent],
                ["推薦率", ai.recommendation, SCORE_BAR_VARIANTS.accentMid],
                ["引用率", ai.citation, SCORE_BAR_VARIANTS.accentMuted],
              ].map(([label, val, barVariant], j) => (
                <div key={label} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>{val}%</span>
                  </div>
                  <ScoreBar score={val} variant={barVariant} delay={i * 0.1 + j * 0.05} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* Interpretation — Executive Summary */}
      <section id="summary" className="report-section">
        <div className="report-eyebrow">Interpretation</div>
        <h2 className="report-h2">Executive Summary</h2>
        <div className="report-reading">
          <p style={{ fontSize: "var(--text-small)", color: "var(--color-text-secondary)", lineHeight: "var(--leading-relaxed)", whiteSpace: "pre-line", margin: 0 }}>
            {report.executiveSummary}
          </p>
        </div>
      </section>

      {/* Category scores */}
      <section id="breakdown" className="report-section">
        <div className="report-eyebrow">Interpretation</div>
        <h2 className="report-h2">カテゴリ別スコア</h2>
        <p className="report-lead">どこが強く、どこに改善余地があるかを確認します。</p>
        <div className="report-metric-grid report-metric-grid--2x3">
          {report.scoreBreakdown.map((cat, idx) => (
            <div key={cat.category} className="report-metric-card">
              <div className="report-metric-card__name">{cat.category}</div>
              <div className="report-metric-card__score">{cat.score}</div>
              <div className="report-metric-card__meta">重み {cat.weight}%</div>
              <ScoreBar score={cat.score} delay={idx * 0.08} />
            </div>
          ))}
        </div>
      </section>

      {showKnowledge && (
      <section id="knowledge" className="report-section">
        <div className="report-eyebrow">Interpretation</div>
        <h2 className="report-h2">AIの情報カバレッジ</h2>
        <div className="report-metric-grid">
          {report.knowledgeCoverage.map((item, i) => (
            <div key={item.item} className="report-metric-card">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span className="report-metric-card__name">{item.item}</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{item.coverage}%</span>
              </div>
              <ScoreBar score={item.coverage} delay={i * 0.05} />
            </div>
          ))}
        </div>
      </section>
      )}

      {showAuthority && (
      <section id="authority" className="report-section">
        <div className="report-eyebrow">Interpretation</div>
        <h2 className="report-h2">AI引用元の権威分布</h2>
        <div className="report-panel">
          <PieChart data={report.authority} />
        </div>
      </section>
      )}

      <section id="booking" className="report-section">
        <div className="report-eyebrow">Interpretation</div>
        <h2 className="report-h2">予約・行動導線の準備度</h2>
        <div className="report-metric-grid" style={{ marginBottom: "var(--space-5)" }}>
          {[
            ["予約ページ", report.bookingReadiness.hasPage ? "あり" : "なし", report.bookingReadiness.hasPage],
            ["予約フォーム", report.bookingReadiness.hasForm ? "あり" : "なし", report.bookingReadiness.hasForm],
            ["モバイル対応", report.bookingReadiness.mobileOptimized ? "対応済" : "未対応", report.bookingReadiness.mobileOptimized],
          ].map(([label, val, ok]) => (
            <div key={label} className="report-metric-card">
              <div className="report-metric-card__meta">{label}</div>
              <div className="report-metric-card__score" style={{ fontSize: 18, color: ok ? "var(--color-success)" : "var(--color-danger)" }}>{val}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
          <div className="report-panel report-panel--plain">
            <div className="report-metric-card__meta">Agent Difficulty</div>
            <div className="report-metric-card__score">{report.bookingReadiness.difficulty}</div>
            <div className="report-metric-card__meta">予約ステップ数: {report.bookingReadiness.steps}ステップ</div>
          </div>
          <div className="report-panel report-panel--plain">
            <div className="report-metric-card__meta">Agent操作スコア</div>
            <div className="report-metric-card__score">{report.bookingReadiness.agentScore}/100</div>
            <ScoreBar score={report.bookingReadiness.agentScore} />
          </div>
        </div>
      </section>

      <section id="technical" className="report-section">
        <div className="report-eyebrow">Actionability</div>
        <h2 className="report-h2">実行につながる技術シグナル</h2>
        <p className="report-lead">robots.txt・LLMs.txt・Schema等は、AIが発見・理解・行動接続できる状態を支えるシグナルです。ARI全体をTechnical Scannerと定義するものではありません。</p>
        <div className="report-metric-grid">
          {report.technical.map((item, i) => (
            <div key={item.item} className="report-metric-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span className="report-metric-card__name" style={{ fontFamily: "monospace" }}>{item.item}</span>
                <StatusBadge status={item.status} />
              </div>
              {item.score > 0 && <ScoreBar score={item.score} delay={i * 0.05} />}
            </div>
          ))}
        </div>
      </section>

      {/* Decision — Priority TOP3 */}
      <section id="priority" className="report-section report-section--emphasis">
        <div className="report-eyebrow">Decision</div>
        <h2 className="report-h2">まず取り組むべき3項目</h2>
        <p className="report-lead">改善優先度の高い施策から着手することで、AI認識と推薦準備度を段階的に高められます。</p>
        <div className="report-priority-grid">
          {priorityTop3.map((item) => (
            <article key={item.rank} className="report-priority-card">
              <div className="report-priority-card__rank">PRIORITY {item.rank}</div>
              <h3>{item.title}</h3>
              <p><strong>Why:</strong> {item.why}</p>
              {item.impact && <p><strong>Impact:</strong> {item.impact}</p>}
              <p><strong>Action:</strong> {item.action}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="proposals" className="report-section">
        <div className="report-eyebrow">Decision</div>
        <h2 className="report-h2">その他の改善提案</h2>
        {remainingProposals.length > 0 ? (
          <div className="report-proposal-list">
            {remainingProposals.map((item, i) => (
              <div key={i} className="report-proposal-item">
                <div style={{ fontSize: "var(--text-small)", fontWeight: 700, marginBottom: 8 }}>{item.title}</div>
                <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", lineHeight: "var(--leading-normal)", margin: 0 }}>
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="report-lead">上位3項目以外の追加提案はありません。ロードマップで実施順序を確認してください。</p>
        )}
      </section>

      <section id="roadmap" className="report-section">
        <div className="report-eyebrow">Action</div>
        <h2 className="report-h2">改善ロードマップ</h2>
        <p className="report-lead">全部同時に進める必要はありません。NOW → NEXT → LATER の順で段階的に実施できます。</p>
        <RoadmapTimeline roadmap={report.roadmap} currentScore={report.overallScore} />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginTop: "var(--space-5)" }}>
          {report.roadmap.map((item, i) => (
            <RoadmapItem key={i} item={item} index={i} cardStyle={cardStyle} />
          ))}
        </div>
        <RoadmapSummaryBox currentScore={report.overallScore} roadmap={report.roadmap} />
      </section>

      <section id="decision" className="report-section">
        <div className="report-eyebrow">Decision Summary</div>
        <h2 className="report-h2">レポートを閉じたあとも残る判断</h2>
        <dl className="report-decision-summary">
          <div className="report-decision-row">
            <dt>Current State</dt>
            <dd>Overall {report.overallScore}/100 — Readiness Level {report.level}</dd>
          </div>
          <div className="report-decision-row">
            <dt>Priority</dt>
            <dd>{firstPriority?.title || improvementProposals[0]?.title || "改善ロードマップの最優先項目"}</dd>
          </div>
          <div className="report-decision-row">
            <dt>Next Action</dt>
            <dd>{firstPriority?.action || report.roadmap?.[0]?.effort || "上位3項目のうち1つから着手"}</dd>
          </div>
        </dl>

        <div className="report-ladder-mini no-print">
          <div className="report-ladder-mini__step report-ladder-mini__step--here">
            <span>Agent Readiness Company Report</span>
            <span>You are here</span>
          </div>
          <div className="report-ladder-mini__step">
            <span>Methodology Handbook</span>
            <span>How to implement</span>
          </div>
          <div className="report-ladder-mini__step">
            <span>Agent Readiness Advisory</span>
            <span>Continuous support</span>
          </div>
        </div>

        <div className="report-advisory-cta no-print">
          <div className="report-eyebrow">NEXT STEP</div>
          <h3>改善優先順位を、実行に移す必要がある場合</h3>
          <p>
            Company Reportで明らかになった優先課題をもとに、
            実装・計測・再評価まで継続的に支援します。
          </p>
          <p className="report-advisory-product">Agent Readiness Advisory</p>
          <p className="report-advisory-price">
            月額 ¥198,000〜（税別）<br />
            12ヶ月契約
          </p>
          <a href={IMPROVE_URL} className="report-btn-primary report-btn-advisory">
            年間改善支援の内容・料金を見る
          </a>
        </div>
      </section>

      <section className="report-section">
        <div className="report-eyebrow">Appendix</div>
        <h2 className="report-h2">評価方法・用語集</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-7)" }}>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: "var(--space-4)" }}>採点方法</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                "AI可視性（20%）：ChatGPT / Gemini / Claude / Perplexityへの実際のクエリ送信結果",
                "技術実装（18%）：Schema.org・robots.txt・LLMs.txt等の実装状況",
                "予約導線（17%）：予約ページの存在・AIエージェント操作性・完了率推定",
                "ナレッジ（16%）：AIが取得できる情報の網羅度・正確性",
                "権威性（15%）：AI引用元の多様性・信頼性・更新頻度",
                "推薦・比較準備度（14%）：AIが比較候補として扱える情報整備度",
              ].map((item, i) => (
                <div key={i} style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "8px 12px", background: "var(--color-surface-subtle)", borderRadius: "var(--radius-sm)", lineHeight: 1.6 }}>{item}</div>
              ))}
            </div>
          </div>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: "var(--space-4)" }}>用語集</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                ["ARI", "Agent Readiness Index。AIエージェント時代の企業信用指数"],
                ["LLMs.txt", "AIクローラー向けの情報開示ファイル（robots.txtのAI版）"],
                ["Schema.org", "検索エンジン・AIが構造化データを読むための共通規格"],
                ["JSON-LD", "HTMLに埋め込む構造化データの記述形式"],
                ["Agent Difficulty", "AIエージェントが予約完了するまでの難易度指標"],
                ["Knowledge Coverage", "AIが企業情報を正確に把握できている割合"],
              ].map(([term, def]) => (
                <div key={term} style={{ padding: "8px 12px", background: "var(--color-surface-subtle)", borderRadius: "var(--radius-sm)" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>{term}</span>
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>：{def}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginTop: "var(--space-8)", paddingTop: "var(--space-6)", borderTop: "1px solid var(--color-border)", textAlign: "center" }}>
          <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap", marginBottom: 20 }}>
            {SITE_FOOTER_LINKS.map(link => (
              <a
                key={link.href}
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noopener noreferrer" : undefined}
                style={{ fontSize: 12, color: "var(--color-text-muted)", textDecoration: "none" }}
              >
                {link.label}
              </a>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.8 }}>
            本レポートは合同会社コア・リテール（Coa Retail G.K.）が提供するAgent Readiness診断サービスにより生成されました。<br />
            レポート内のスコアは診断実施時点（{report.analyzedAt}）のデータに基づきます。<br />
            お問い合わせ：
            <a href="https://www.coaretail.com/contact" target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-text-muted)", textDecoration: "underline" }}>お問い合わせフォーム</a>
            {" ／ "}
            <a href="https://www.coaretail.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-text-muted)", textDecoration: "underline" }}>https://www.coaretail.com</a>
          </div>
        </div>
      </section>

      {showResearchModal && (
        <ResearchEditionModal
          onClose={() => setShowResearchModal(false)}
          onDownload={() => {
            openResearchEdition(purchaseState);
            setShowResearchModal(false);
          }}
        />
      )}

      {showHandbookModal && (
        <HandbookUpgradeModal
          onClose={() => setShowHandbookModal(false)}
          onCheckout={() => openHandbookUpgrade()}
        />
      )}

      <style>{`
        @media print {
          * {
            transition: none !important;
            animation: none !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
    </div>
    </PrintContext.Provider>
  );
}

function calcTargetScore(overallScore, roadmap) {
  if (!roadmap?.length) return Math.min(100, Math.round(overallScore + 15));
  const totalImpact = roadmap.reduce(
    (s, r) => s + (parseFloat(String(r.impact).replace("+", "")) || 0),
    0,
  );
  return Math.min(100, Math.round(overallScore + totalImpact));
}

function saveReportSummary(report) {
  if (!report?.overallScore) return;
  try {
    localStorage.setItem(
      "ari_report_summary",
      JSON.stringify({
        overallScore: report.overallScore,
        targetScore: calcTargetScore(report.overallScore, report.roadmap),
        company: report.company,
        analyzedAt: report.analyzedAt,
      }),
    );
  } catch { /* noop */ }
}

// ─── STRIPE / FULFILLMENT ─────────────────────────────────────────────────────
const PENDING_FORM_KEY = STORAGE_KEYS.pendingForm;

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  // stage: "landing" | "form" | "payment" | "analyzing" | "report"
  const [stage, setStage]         = useState("landing");
  const [formData, setFormData]   = useState(null);
  const [reportData, setReport]   = useState(null);
  const [isPaidFlow, setIsPaidFlow] = useState(false);
  const [reportMode, setReportMode] = useState("demo"); // demo | paid | sample
  const [purchaseState, setPurchaseState] = useState(() => loadPurchaseState());
  const [analysisRetryKey, setAnalysisRetryKey] = useState(0);
  const [formPrefill, setFormPrefill] = useState(null);
  const returnHandledRef = useRef(false);

  useEffect(() => {
    trackReportViewItemOnce();
  }, []);

  // Preview funnel → form prefill（sessionStorage、query param は使わない）
  useEffect(() => {
    const prefill = readPreviewPrefillFromSession(
      typeof sessionStorage !== "undefined" ? sessionStorage : null,
    );
    if (prefill) {
      setFormPrefill(prefill);
      setStage("form");
      trackReportStartOnce();
    }
  }, []);

  // リザルト表示時に improve.html へ渡すスコアを localStorage に保存
  useEffect(() => {
    if (reportData) saveReportSummary(reportData);
  }, [reportData]);

  // 同一ブラウザ内 — 購入済みレポートの復元（URL return より後順位）
  useEffect(() => {
    if (returnHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("report") === "demo") return;
    if (params.get("paid") || params.get("session_id") || params.get("canceled")) return;

    const restored = tryRestorePaidSession();
    if (restored) {
      setPurchaseState(restored.purchase);
      setFormData(restored.cache.form);
      setReport(restored.cache.report);
      setIsPaidFlow(true);
      setReportMode("paid");
      setStage("report");
    }
  }, []);

  // Stripe決済からの戻り（success_url / cancel_url）を処理する。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get("report") === "demo") {
      returnHandledRef.current = true;
      window.history.replaceState({}, "", window.location.pathname);
      setFormData({
        company: DUMMY_REPORT.company,
        url: DUMMY_REPORT.url,
        industry: DUMMY_REPORT.industry,
        email: "demo@example.com",
      });
      setReport(DUMMY_REPORT);
      setReportMode("sample");
      setIsPaidFlow(false);
      saveReportSummary(DUMMY_REPORT);
      setStage("report");
      return;
    }

    const sessionId = params.get("session_id");
    const paid = params.get("paid") === "1" || !!sessionId;
    const canceled = params.get("canceled") === "1";
    if (!paid && !canceled) return;

    returnHandledRef.current = true;

    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(PENDING_FORM_KEY) || "null"); } catch { saved = null; }

    window.history.replaceState({}, "", window.location.pathname);

    if (canceled) {
      if (saved) setFormData(saved);
      setStage("payment");
      return;
    }

    (async () => {
      let purchase = null;
      if (sessionId) {
        const verified = await verifyPurchaseSession(sessionId, "company_report");
        if (verified.ok) {
          purchase = grantVerifiedPurchase(verified.purchase);
        } else {
          setPurchaseState(null);
          setIsPaidFlow(false);
          setReportMode("demo");
          setStage("form");
          return;
        }
      } else {
        setPurchaseState(null);
        setIsPaidFlow(false);
        setReportMode("demo");
        setStage("form");
        return;
      }

      setPurchaseState(purchase);
      setIsPaidFlow(true);
      setReportMode("paid");

      if (saved) {
        setFormData(saved);
        setStage("analyzing");
      } else {
        setStage("form");
      }
    })();
  }, []);

  const handleStart       = () => {
    trackReportStartOnce();
    setStage("form");
  };
  const handleFormSubmit  = (data) => {
    onReportFormComplete();
    setFormData(data);
    setStage("payment");
  };

  const handlePay = () => {
    try { localStorage.setItem(PENDING_FORM_KEY, JSON.stringify(formData)); } catch { /* noop */ }
    const checkout = resolveCheckoutUrl();
    if (!checkout.url) {
      onReportCheckoutStart(checkout);
      alert("決済リンクが未設定です。Bundle Payment Link の設定が必要です（NEW_PAYMENT_LINK_REQUIRED）。");
      return;
    }
    onReportCheckoutStart(checkout, () => {
      window.location.href = checkout.url;
    });
  };

  const handleAnalysisComplete = (report) => {
    try { localStorage.removeItem(PENDING_FORM_KEY); } catch { /* noop */ }
    saveReportSummary(report);
    saveReportCache(report, formData);
    setReport(report);
    if (isPaidFlow) {
      setReportMode("paid");
      onReportResultView(purchaseState || loadPurchaseState());
    }
    setStage("report");
  };

  if (stage === "landing")   return <LandingPage onStart={handleStart} />;
  if (stage === "form")      return <FormPage onSubmit={handleFormSubmit} onClose={() => setStage("landing")} initialForm={formPrefill} />;
  if (stage === "payment")   return <PaymentPage form={formData} onPay={handlePay} onBack={() => setStage("form")} onClose={() => setStage("landing")} />;
  if (stage === "analyzing") return (
    <AnalyzingPage
      onComplete={handleAnalysisComplete}
      form={formData}
      purchaseState={purchaseState}
      isPaidFlow={isPaidFlow}
      retryKey={analysisRetryKey}
      onRetry={() => setAnalysisRetryKey((k) => k + 1)}
    />
  );
  if (stage === "report") return (
    <ReportPage
      report={reportData || DUMMY_REPORT}
      form={formData}
      reportMode={reportMode}
      purchaseState={purchaseState}
    />
  );
  return null;
}
