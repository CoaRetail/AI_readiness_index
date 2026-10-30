/**
 * TMVU-01B — Canonical SEO metadata for scheduled Insight slugs (incl. current-event drafts).
 * Single source of truth for title, meta, OG, Twitter, H1, lead, breadcrumb, JSON-LD.
 */

export const SITE_SUFFIX = ' | Agent Readiness Insights';
export const OG_SITE_NAME = 'Agent Readiness Research Hub';

const BASE_URL = 'https://readiness.coaretail.com';

/** @type {Record<string, { intent: 'A'|'B'|'C', primarySearchIntent: string, h1: string, meta: string, lead: string, breadcrumb: string }>} */
export const SCHEDULED_SEO_PACKAGES = {
  'three-pillars-ops': {
    intent: 'B',
    primarySearchIntent: '三柱フレームワークの運用設計',
    h1: 'Visibility・Authority・Actionabilityを運用に落とす方法',
    meta: 'Visibility・Authority・Actionabilityを部門横断で運用する方法。定義の理解から情報オーナーシップ・更新ルールまで、Agent Readinessを現場に落とす設計を解説します。',
    lead: '三柱は概念理解だけでは機能しない。Visibility・Authority・Actionabilityそれぞれにオーナーと更新ルールを定義し、部門横断で運用に落とすことがAgent Readiness改善の起点になる。',
    breadcrumb: '三柱の運用',
  },
  'ari-vs-geo-seo': {
    intent: 'A',
    primarySearchIntent: 'SEO GEO Agent Readiness 違い 比較',
    h1: 'SEO・GEO・Agent Readinessの違いとは？AI検索対策を比較',
    meta: 'SEO・GEO・Agent Readinessは段階が異なる。検索流入・AI回答での引用・予約や購入の実行完了まで、3手法の役割分担とAI検索対策の設計優先順位をAgent Readinessの視点で比較解説します。',
    lead: 'SEOは検索流入、GEOはAI回答での引用、Agent Readinessは実行まで——段階が異なるため、同じ施策でもKPIと担当を分けて設計する必要がある。3手法の役割分担を整理し、予算と優先順位の付け方を考える。',
    breadcrumb: 'SEO・GEO・ARI比較',
  },
  'readiness-baseline': {
    intent: 'B',
    primarySearchIntent: 'Agent Readiness 最低ライン 判断基準',
    h1: 'Agent Readinessの最低ラインとは？準備度の判断基準',
    meta: '「準備できている」の判断基準——発見・理解・信頼・実行の各段階に最低条件がある。チェックリストの項目数ではなく、Agent Readinessの最低ラインを判断する基準と、段階ごとの止まりどころを解説します。',
    lead: 'Agent Readinessの最低ラインは、発見・理解・信頼・実行の各段階に必要条件がある。項目数ではなく、段階ごとに「これが欠けると止まる」条件で判断する——準備度の最低ラインと判断基準を本記事で整理する。',
    breadcrumb: '最低ライン',
  },
  'entity-consistency': {
    intent: 'B',
    primarySearchIntent: '企業情報 一貫性 AI エンティティ',
    h1: '企業情報の一貫性がAI理解を左右する理由',
    meta: '名称・所在地・提供内容が場所ごとに異なるとAIのエンティティ解決が失敗する。VisibilityとAuthorityを同時に損なう一貫性設計をAgent Readinessの視点で解説します。',
    lead: '企業情報の一貫性は、AIが自社を一つの存在として理解できるかを決める。矛盾はVisibilityとAuthorityの両方を同時に損なう——名称・所在地・提供内容のエンティティ設計が先決になる。本記事で理由を整理する。',
    breadcrumb: 'エンティティ一貫性',
  },
  'faq-for-agents': {
    intent: 'A',
    primarySearchIntent: 'FAQ AI検索対策 設計',
    h1: 'FAQはAI検索対策に効果がある？AIに理解されるFAQ設計',
    meta: '人間向けFAQとAIが参照できるFAQは要件が異なる。質問の構造化・回答の明確さ・更新ルールなど、AI検索対策として効くFAQ設計の基本と、Agent ReadinessのAuthority・Visibilityへの効き方を解説します。',
    lead: 'FAQはAI検索対策に有効だが、人間向けのQ&Aをそのまま並べただけでは不十分。AIが参照・比較できるFAQは、質問構造と回答粒度の設計が異なる——AI向けFAQ設計の基本と実務上の要点を本記事で整理する。',
    breadcrumb: 'AI向けFAQ',
  },
  'org-schema-basics': {
    intent: 'A',
    primarySearchIntent: 'Organization Schema 企業情報 構造化',
    h1: 'Organization Schemaとは？AI検索で企業情報を正しく伝える方法',
    meta: 'Organizationスキーマは企業エンティティの公式定義として機能する。Schema.orgのOrganization型の実務的役割と、AI検索で企業情報を正しく伝える設計を解説します。',
    lead: 'Organization Schemaは、企業エンティティの公式定義としてAIに名称・所在地・連絡先を伝える。llms.txtやページ本文と併せて、エンティティ解決の起点になる——Organization型の実務的役割を整理する。',
    breadcrumb: 'Organization Schema',
  },
  'semantic-web-ai': {
    intent: 'A',
    primarySearchIntent: 'セマンティックWeb AI 意味構造',
    h1: 'セマンティックWebとは？生成AI・AI検索との関係を解説',
    meta: 'セマンティックWebの意味構造——見出し・ラベル・構造化データ——がAIの読み取りの骨格になる。生成AI・AI検索との関係と、Agent Readinessの情報設計への示唆を解説します。',
    lead: 'セマンティックWebは、Web上の意味構造を機械が理解するための設計思想。見出し・ラベル・構造化データがAI検索での比較・判断の骨格になる——生成AI・AI検索との関係と、Agent Readinessへの示唆を本記事で解説する。',
    breadcrumb: 'セマンティックWeb',
  },
  'hiring-readiness': {
    intent: 'A',
    primarySearchIntent: '求人情報 AI 比較 構造化',
    h1: '求人情報をAIが比較できる状態にするには？',
    meta: '職種・条件・勤務地・選考フローが構造化されていないとAIは求人を比較できない。採用ドメインにおけるAgent Readiness——Actionabilityの設計と、求人比較の前提条件を解説します。',
    lead: '求人情報をAIが比較するには、職種・条件・勤務地・選考フローが構造化されている必要がある。予約や決済とは異なるが、採用もActionabilityの領域——求人を比較可能にする設計を本記事で整理する。',
    breadcrumb: '求人Readiness',
  },
  'availability-signals': {
    intent: 'A',
    primarySearchIntent: '空き状況 営業時間 機械可読 シグナル',
    h1: '空き状況・営業時間をAIに伝えるシグナル設計',
    meta: '静的な営業時間表記だけではAIは空きを判断できない。更新可能な空き・営業時間シグナルの設計と、予約Actionabilityを高める方法を、Agent Readinessの実行レイヤーの視点から解説します。',
    lead: '空き状況と営業時間は、静的表記だけではAIに伝わらない。更新可能なシグナル設計がなければ、紹介の直前で予約可否の判断が止まる——空き・営業時間を機械に伝えるシグナル設計の考え方と要点を本記事で整理する。',
    breadcrumb: '空きシグナル',
  },
  'purchase-path-design': {
    intent: 'A',
    primarySearchIntent: '購買導線 AI 決済 設計',
    h1: '購買導線をAIが辿れる設計——決済までの連続性',
    meta: '商品理解・在庫・価格・決済の各段階が途切れるとAIは購買を完結できない。決済単体ではなく、購買導線全体の連続性とAgent Readiness設計の観点から、AIが辿れる購買導線を解説します。',
    lead: '購買導線は商品理解・在庫・価格・決済が連続している必要がある。どこか一つが途切れると、AIは紹介できても購入を完結できない——決済までの連続性を保つ購買導線設計の考え方と、現場での要点を本記事で整理する。',
    breadcrumb: '購買導線',
  },
  'policy-clarity': {
    intent: 'B',
    primarySearchIntent: '返金 キャンセル 規約 AI 実行',
    h1: '返金・キャンセル規約の明確さがAI実行に与える影響',
    meta: '返金・キャンセル条件の曖昧さはAIの実行判断を止める。規約の機械可読性とActionabilityへの影響を、Agent Readinessの視点から解説し、返金・キャンセル規約の明確さが実行に与える影響を整理します。',
    lead: '返金・キャンセル規約が曖昧だと、AIは実行判断を止める。信頼の問題以前に、条件が機械可読でなければActionabilityの最後の関門で失敗する——規約の明確さが実行に与える影響を本記事で整理する。',
    breadcrumb: '規約の明確さ',
  },
  'agent-handoff': {
    intent: 'B',
    primarySearchIntent: 'AI 人間 引き継ぎ ハンドオフ',
    h1: 'AIエージェントから人間への引き継ぎ設計',
    meta: 'AIエージェントから人間への引き継ぎ——条件・エスカレーション・記録——が設計要素。予約実行の話ではなく、ハンドオフ設計のAgent Readiness視点と、エージェント体験を途切れさせない引き継ぎの考え方を解説します。',
    lead: 'すべてをAIが完結させる必要はない。引き継ぎ条件・エスカレーション・記録が設計されていなければ、エージェント体験は途中で破綻する——AIから人間へのハンドオフ設計の基本と、現場での要点を本記事で整理する。',
    breadcrumb: 'ハンドオフ設計',
  },
  'mcp-business-api': {
    intent: 'A',
    primarySearchIntent: 'MCP AIエージェント ビジネスAPI',
    h1: 'MCPとは？AIエージェントと企業システムをつなぐ仕組み',
    meta: 'MCP（Model Context Protocol）はAIエージェントが業務APIを安全に呼ぶ接続層。決済プロトコルではなく、企業システムとエージェントをつなぐ仕組みを解説します。',
    lead: 'MCPはAIエージェントが企業の業務APIを安全に呼び出すための接続層。公開情報だけでは実行できない——システム接続がActionabilityの次のレイヤーになる。MCPとビジネスAPIの接点を整理する。',
    breadcrumb: 'MCP',
  },
  'multi-agent-compare': {
    intent: 'A',
    primarySearchIntent: 'ChatGPT Gemini Google AI 企業評価 比較',
    h1: 'ChatGPT・Gemini・Google AIで企業評価は違う？AI推薦を比較',
    meta: 'ChatGPT・Gemini・Google AIは参照情報源・実行能力・ポリシーが異なる。単一AIの推薦論ではなく、マルチエージェント環境での企業評価の違いを比較し、Agent Readiness設計への示唆を整理します。',
    lead: 'ChatGPT・Gemini・Google AIは、参照する情報源と実行能力が異なる。一つのAIで最適化しても、エージェントごとに推薦結果は変わる——マルチエージェント環境を前提に、企業評価の違いを整理する。',
    breadcrumb: 'マルチエージェント比較',
  },
  'agent-experience': {
    intent: 'B',
    primarySearchIntent: 'Agent Experience AX 体験設計',
    h1: 'Agent Experience（AX）とは？エージェント体験設計の基本',
    meta: 'Agent Experience（AX）とは、AIエージェントが目的達成する体験設計。Actionabilityの定義ではなく、エージェント視点での情報設計とAgent Readinessの関係を解説します。',
    lead: 'Agent Experience（AX）とは、AIエージェントがユーザーの目的を達成する体験設計を指す。人間向けUXとは異なる——エージェントが辿る情報と実行の連続性が問われる。AXの基本と設計の視点を整理する。',
    breadcrumb: 'Agent Experience',
  },
  'marketing-info-design': {
    intent: 'B',
    primarySearchIntent: 'マーケティング 情報設計 AI時代',
    h1: 'マーケティングが担うAI時代の情報設計',
    meta: 'AI時代のマーケティングは、比較可能な情報設計が中核になる。キャンペーン運用の話ではなく、Agent Readinessを支える情報設計としてのマーケ機能の再定義と、現場での役割分担を解説します。',
    lead: 'AI時代のマーケティングの中核は、比較可能な情報設計になる。露出や訴求だけでなく、AIが理解・比較・実行するための情報構造を設計する役割が増える——マーケが担うAI時代の情報設計の要点を本記事で整理する。',
    breadcrumb: 'マーケ情報設計',
  },
  'exec-readiness-kpi': {
    intent: 'B',
    primarySearchIntent: 'Agent Readiness KPI 経営指標',
    h1: '経営が見るべきAgent Readiness KPI',
    meta: '検索順位ではなく段階別到達率と実行成功率——経営が見るべきAgent Readiness KPIの設計。基準論ではなく、経営ダッシュボードの指標選定と、Visibility・Authority・Actionabilityの測り方を解説します。',
    lead: '経営が見るべきKPIは検索順位ではない。発見・理解・信頼・実行の段階別到達率と実行成功率——Agent Readinessを測る経営指標の設計が必要になる。経営ダッシュボードの指標選定を本記事で整理する。',
    breadcrumb: '経営KPI',
  },
  'ai-search-52-percent': {
    intent: 'B',
    primarySearchIntent: '生成AI 検索 利用率 企業対策',
    h1: '生成AI検索52.3%。「第二の検索プラットフォーム」で企業が測るべきもの',
    meta: 'サイバーエージェントGEOラボ調査で生成AI検索利用率が52.3%に。検索エンジンに次ぐ第二プラットフォームとして、企業がVisibility・Authority・Actionabilityで測るべき変化をARI視点で整理します。',
    lead: '生成AIの検索利用率が52.3%に達した——検索エンジンに次ぐ「第二の検索プラットフォーム」が現実になった。重要なのは利用率そのものではなく、比較・検討・推薦のプロセスがAI側へ移り始めていること。企業が測るべき観測軸を整理する。',
    breadcrumb: '生成AI検索52.3%',
  },
  'vendor-selection': {
    intent: 'B',
    primarySearchIntent: '予約SaaS 選定 Agent Readiness',
    h1: '予約SaaS選定のReadiness視点——機能比較の先',
    meta: '予約SaaS選定は機能表ではなく、AIが接続・実行できるかで判断する。Agent Readinessの視点から、SaaS選定基準と実行可能性——空き確認から予約完了まで——を解説します。',
    lead: '予約SaaS選定は機能比較表だけでは不十分。AIエージェントが接続し、空き確認から予約完了まで実行できるか——Readiness視点で選ぶ必要がある。機能比較の先にある選定基準の要点を本記事で整理する。',
    breadcrumb: 'SaaS選定',
  },
  'content-ops-ai': {
    intent: 'B',
    primarySearchIntent: 'コンテンツ運用 AI 更新 一貫性',
    h1: 'コンテンツ運用のAI前提化——更新と一貫性',
    meta: 'AI前提のコンテンツ運用では、更新頻度・一貫性・構造化がSEO以上に重要。運用プロセスをAgent Readinessの改善サイクルとして再設計する方法と、更新と一貫性の管理を解説します。',
    lead: 'コンテンツ運用はAI前提化が必要になる。更新頻度・一貫性・構造化——SEOのキーワード最適化より、AIが参照する情報の鮮度と整合性が優先される——更新と一貫性の運用プロセスの考え方と要点を本記事で整理する。',
    breadcrumb: 'コンテンツ運用',
  },
  'interaction-contract': {
    intent: 'C',
    primarySearchIntent: 'ビジネス 約束 機械可読 設計',
    h1: 'ビジネスとの約束を機械可読にする設計',
    meta: 'ビジネスとの約束——提供条件・SLA・制約——を明文化し構造化する設計。規約の明確さを超えた、Business Interactionの起点となる約束設計と、Agent Readinessの実行レイヤーへの効き方を解説します。',
    lead: 'ビジネスとの約束を機械可読にすることが、エージェントが安全に実行する前提になる。暗黙の了解ではなく、条件・制約・SLAを構造化して公開する設計が必要——約束の機械可読化の考え方と要点を本記事で整理する。',
    breadcrumb: '約束の設計',
  },
  'consent-data-design': {
    intent: 'C',
    primarySearchIntent: '同意 データ提供 AI 実行 設計',
    h1: '同意とデータ提供の設計——AI実行の前提',
    meta: 'AI実行には最小必要データと同意フローの設計が前提。信頼の一般論ではなく、データ同意と提供範囲をAgent Readinessの実行レイヤーとして解説し、同意とデータ提供の設計を整理します。',
    lead: 'AIが予約や購入を実行するには、必要最小限のデータと同意フローが設計されている必要がある。データ提供の範囲と同意——実行の前提条件として、同意とデータ提供の設計の考え方と、現場での要点を本記事で整理する。',
    breadcrumb: '同意・データ設計',
  },
  'execution-readiness': {
    intent: 'A',
    primarySearchIntent: 'AI 予約 購入 サイト 条件',
    h1: 'AIエージェントが予約・購入できるサイトの条件とは？',
    meta: 'AIエージェントが予約・購入を完結できるサイトの条件——実行前チェックリストと障害ログ。Actionabilityの定義ではなく、Execution Readinessの実務改善サイクルを解説します。',
    lead: 'AIエージェントが予約・購入できるサイトには共通条件がある。実行前チェックリストと障害ログの設計——Execution Readinessの改善サイクルがActionabilityを実務に落とす。サイトが満たすべき条件を整理する。',
    breadcrumb: 'Execution Readiness',
  },
  'abis-intro': {
    intent: 'C',
    primarySearchIntent: 'ABIS Business Interaction とは',
    h1: 'ABISとは？AIエージェントと企業のBusiness Interaction標準',
    meta: 'ABISはエージェントとビジネスの相互作用を記述・検証する新興フレームワーク。正式標準ではなく、Business Interactionの目的と位置づけをAgent Readiness文脈で解説します。',
    lead: 'ABISは、AIエージェントとビジネスの相互作用を記述・検証する新興フレームワーク。ARIと同義ではなく、Business Interactionの構造を言語化する方向性を示す——ABISの目的と位置づけを整理する。',
    breadcrumb: 'ABIS入門',
  },
  'abis-ari-bridge': {
    intent: 'C',
    primarySearchIntent: 'ABIS ARI 関係 違い',
    h1: 'ABISとAgent Readiness（ARI）の関係とは？',
    meta: 'ARIは評価軸、ABISは相互作用の記述・検証——両者は同義ではない。Agent ReadinessとABISの接続マップと、設計・評価での使い分け、評価と記述のレイヤーの違いを解説します。',
    lead: 'ARIは企業の準備度を測る評価軸、ABISは相互作用を記述・検証する枠組み——同じ概念ではない。評価と記述のレイヤーが異なる接続関係を整理する——ABISとAgent Readinessの関係を解説する。',
    breadcrumb: 'ABISとARI',
  },
  'standards-landscape': {
    intent: 'C',
    primarySearchIntent: 'Schema.org MCP ABIS 標準 比較',
    h1: 'Schema.org・MCP・ABIS——標準化の動きをどう読むか',
    meta: 'Schema.org・MCP・ABISは競合ではなく層が異なる。個別技術比較ではなく、標準化の動きを用途別に読み解き、Agent Readiness設計への示唆と、組み合わせ方の考え方を整理します。',
    lead: 'Schema.org・MCP・ABISは競合する標準ではなく、層が異なる。意味の構造化・API接続・相互作用の記述——用途で選び、組み合わせて読む必要がある——標準化の動きの読み方を本記事で整理する。',
    breadcrumb: '標準ランドscape',
  },
  'abis-readiness-gap': {
    intent: 'C',
    primarySearchIntent: 'ABIS Readiness ギャップ 診断',
    h1: 'ABIS視点で見る企業のReadinessギャップ',
    meta: '相互作用の記述不足が実行失敗の温床。ABIS視点から企業のReadinessギャップを診断する実務視点——新興フレームワークとしての位置づけを踏まえ、Agent Readinessとの接点も解説します。',
    lead: 'ABIS視点で見ると、相互作用の記述不足が実行失敗の温床になる。Agent Readinessの評価に加え、約束と実行の構造が言語化されているか——Readinessギャップ診断の実務視点を本記事で整理する。',
    breadcrumb: 'ABISギャップ',
  },
  'cloudflare-aeo': {
    intent: 'B',
    primarySearchIntent: 'Cloudflare AEO AI検索',
    h1: 'Cloudflareが「順位」から「AI推薦」へ：企業サイトは何を変えるべきか',
    meta: 'Cloudflareが提唱するAEOと「ranking→recommended」とは何か。検索順位中心の発想からAIに推薦されるための企業情報設計へ、Agent Readinessの視点で解説します。',
    lead: 'Cloudflareの提言は、検索順位だけでなくAIが企業を理解・比較・推薦できる状態を整える重要性を示しています。robots.txtや構造化データ等の技術対応だけでは完結しません。企業情報の一貫性、比較可能性、推薦根拠、行動導線まで含めて見る必要があります。',
    breadcrumb: 'Cloudflare AEO',
  },
  'search-departure-ai': {
    intent: 'B',
    primarySearchIntent: '検索離れ 生成AI 20代 調査',
    h1: '20代48%が検索を使わない？調べもののAI移行と企業のVisibility',
    meta: 'ナイル調査で20代の48%が調べもので検索エンジンを使わないと回答。調べものの入口がAIに移るとVisibility・Authority・Actionabilityの前提が変わる——Agent Readinessの視点で読み解きます。',
    lead: '調べものの入口が検索結果一覧から生成AIの回答へ移ると、企業が「見つけてもらう」ための前提が変わる。20代の約5割が検索エンジンを使わないという調査結果を、Visibility・Authority・Actionabilityの三柱で読み解く。',
    breadcrumb: '検索離れ',
  },
  'iab-ai-visibility': {
    intent: 'B',
    primarySearchIntent: 'IAB AI Visibility 計測 指標',
    h1: 'IAB「Measuring Visibility in the AI Era」をどう読むか——AI可視性を事業判断につなぐ',
    meta: 'IABのAI可視性計測フレームワークを解説。Presence・Prominence・Portrayal・Persuasionの4Pと、Directional／Decision-Gradeの違いをAgent Readinessの視点で整理します。',
    lead: 'IAB「Measuring Visibility in the AI Era」は、AI回答でブランドが「出たか」だけでなく、目立ち方・文脈・行動への影響までを分けて測る出発点です。ただし単発のスコアを事業成果とみなさず、測定条件と限界を開示し、改善判断へ接続する必要があります。',
    breadcrumb: 'IAB AI Visibility計測',
  },
  'openai-product-discovery-agentic-commerce': {
    intent: 'B',
    primarySearchIntent: 'ChatGPT 商品探索 Agentic Commerce 事業者',
    h1: 'ChatGPTの商品探索が変える、AIに比較される情報の整え方',
    meta: 'OpenAIが2026年3月24日に発表したChatGPTの商品探索を起点に、何が変わったか、事業者が今確認できる情報は何かを整理します。比較・購入導線と公式情報の整備観点を解説します。',
    lead: 'AI検索や対話画面が、答えを返すだけでなく商品を探し、比較する入口になっています。ここではOpenAIの公式発表を一つの変化として読み、事業者が確認できる情報と、まだ分からないことを分けて整理します。',
    breadcrumb: 'ChatGPT商品探索',
  },
  'competitors-visible-company-missing': {
    intent: 'A',
    primarySearchIntent: 'AI検索 競合 自社 出てこない',
    h1: 'AI検索では競合が出るのに、自社が出てこない理由',
    meta: '競合は推薦されるのに自社が見つからないとき、まず確認したい情報の一貫性・比較材料・行動導線を整理します。推薦の成否を断定せず、公式情報の連続性を点検する実務観点を丁寧に解説します。',
    lead: 'AI検索で競合の店やサービスは出てくるのに、自社は候補に入らない。この差を見つけたとき、すぐに「順位」や「AI対策ツール」の話へ進む前に、AIが比較に使える情報へ到達できているかを確認する必要があります。',
    breadcrumb: '競合は出る自社は出ない',
  },
  'html-observation-check-limits': {
    intent: 'B',
    primarySearchIntent: 'サイト HTML AI 読み取り 確認',
    h1: 'サイトのHTMLだけでAI対応状況をどこまで確認できるか',
    meta: '公開HTMLから確認できる基本情報・比較材料・行動導線の観測範囲と、AIの推薦結果までは断定できない限界を整理します。軽量観測と有料分析の違い、事業判断への接続方法も丁寧に解説します。',
    lead: 'AIに推薦されるかを、サイトのHTMLだけで証明することはできません。一方で、AIが理解するための基本情報や、比較・行動に必要な信号が公開ページに現れているかは、軽量な観測で確認できます。本記事ではその範囲を整理します。',
    breadcrumb: 'HTML観測の限界',
  },
  'seo-meo-ai-recommendation-gap': {
    intent: 'A',
    primarySearchIntent: 'SEO MEO AI検索 推薦されない',
    h1: 'SEOやMEOをしているのに、AI検索で推薦されない理由',
    meta: 'SEOやMEOの成果を否定せず、AIが理解・比較・行動につなげるために追加で確認したい項目を整理します。検索面とAI面の観測を分け、最初に直す優先順位と確認手順を丁寧に解説します。',
    lead: '検索順位や地図上の表示を改善してきたのに、AI検索では店やサービスが候補に出ない。これはSEOやMEOが無意味という話ではなく、AIが理解・比較・行動へ進むための情報が別の形で不足している可能性があります。',
    breadcrumb: 'SEO MEO AI推薦ギャップ',
  },
  'cloudflare-ai-traffic-search-agent-training': {
    intent: 'B',
    primarySearchIntent: 'Cloudflare AIトラフィック Search Agent Training 制御',
    h1: 'CloudflareのAIトラフィック分類が変える、検索と学習の境界線',
    meta: 'CloudflareはAIトラフィックをSearch・Agent・Trainingに分類し独立制御を可能にしました。2026年9月15日の既定変更前後で何が確定し何が未観測かを整理し、Visibility設計への示唆を解説します。',
    lead: 'AIクローラーは用途が違う。Cloudflareの三分類は検索インデックス・リアルタイム取得・学習利用の境界を運用で切り分ける発表だ。9月15日の既定変更は発表済みだが効果は未観測——許可方針と公式情報の整合を点検する視点を整理する。',
    breadcrumb: 'Cloudflare AI分類',
  },
  'niq-similarweb-agentic-shelf-measurement': {
    intent: 'B',
    primarySearchIntent: 'Agentic Shelf 測定 NIQ Similarweb',
    h1: 'NIQ×Similarwebが測る「Agentic Shelf」——AI推薦棚の見え方',
    meta: 'NIQとSimilarwebはAgentic Commerce Measurementを発表し、AI上の商品棚・インテント・AI経由トラフィックを売上と接続して測る方針を示しました。Q4限定提供前に事業者が確認すべき点を整理します。',
    lead: 'AIの「棚」は見えないままでは改善できない。NIQ×SimilarwebはAgentic Shelf Visibilityなど五領域の測定をQ4から始める——ツール前に商品情報の一貫性と構造化を自社で監査する視点を本記事で整理する。',
    breadcrumb: 'Agentic Shelf測定',
  },
  'weighted-ai-visibility-stack': {
    intent: 'B',
    primarySearchIntent: 'AI Visibility 測定 重み付け 三層',
    h1: 'AI Visibilityを重み付けで読む——検索・回答・引用の三層スタック',
    meta: 'AI Visibilityを単一スコアで読むと検索・回答・引用の差が消える。Search Reach・Answer Presence・Citation Authorityの三層で重み付け観測する運用スタックと、GSC生成AIレポートとの併読方法を解説します。',
    lead: '露出は一つではない。検索到達・回答内掲載・引用根拠の三層に分けて重み付け観測しないと改善判断がズレる。GSC生成AIレポートと併読し、層ごとの担当と限界を運用スタックとして本記事で丁寧に整理する視点です。',
    breadcrumb: 'AI Visibility三層',
  },
  'shopify-ai-vs-organic-structured-catalog': {
    intent: 'A',
    primarySearchIntent: 'Shopify Catalog AI 構造化 オーガニック',
    h1: 'ShopifyのAI機能と構造化カタログ——オーガニック発見を残す設計',
    meta: 'Shopify CatalogはAI向け構造化配信の近道になる一方、公式サイトやSEOによるオーガニック発見もAuthorityの土台です。二重入口を矛盾なく保つ設計と、価格・在庫の整合監査を解説します。',
    lead: 'Shopify Catalogに載ることと、オーガニックに見つかることは別の入口だ。AI向け構造化配信とWeb発見を両立するには、価格・在庫・条件の差分監査が先——二重入口の整合設計を本記事で整理する。',
    breadcrumb: 'Shopify Catalog設計',
  },
  'google-ai-coexistence-measurement': {
    intent: 'A',
    primarySearchIntent: 'Google検索 AI機能 共存 測定 クリック インプレッション',
    h1: 'Google検索とAI機能の共存——クリックとインプレッションの読み分け',
    meta: 'Google検索は一覧と生成AI機能が共存します。Search Consoleでクリックと生成AIインプレッションを同じURLで突き合わせ、露出・正確性・導線を分けて読む測定手順をAgent Readinessの視点で解説します。',
    lead: '一覧のクリックだけを追うと、AI回答内の露出変化を見逃す。Search Consoleで生成AIインプレッションと全体パフォーマンスを併読し、露出・要約の正確性・行動導線を分ける——共存時代の測定読み分けを本記事で整理する。',
    breadcrumb: 'Google AI共存測定',
  },
  'gemini-3-8-ai-mode-visibility': {
    intent: 'B',
    primarySearchIntent: 'Gemini 3.8 AI Mode Visibility 確認',
    h1: 'Gemini 3.8とAI Mode——複数AI面でのVisibility確認',
    meta: 'Gemini 3.8 FlashはAI Modeで選択可能になりましたが、AI Overviewsとは別面です。AI Overviews・AI Mode・Geminiアプリで引用挙動が一致しない前提で、面ごとの定点観測設計を解説します。',
    lead: '同じGoogleでもAI面は一つではない。Gemini 3.8はAI Modeに登場したがOverviews既定は別——面ごとに定点観測を分け、モデル世代と日時をログに残すVisibility確認の実務を本記事で整理する。',
    breadcrumb: 'Gemini 3.8 AI Mode',
  },
  'geo-social-citation-authority': {
    intent: 'B',
    primarySearchIntent: 'GEO ソーシャル引用 Authority 観測',
    h1: 'GEOとソーシャル引用——Authorityの新しい観測点',
    meta: 'GEOの露出議論だけではAuthorityの観測が不足します。ソーシャル言及・引用を観測カテゴリに加え、文脈と公式情報の一致を記録する運用を、第三者研究の限界も踏まえて解説します。',
    lead: 'いいね数はAuthorityの代理指標にならない。ソーシャル引用は観測点の拡張であり、公式情報と一致する事実の積み上げが前提——GEOとソーシャル引用をAuthority設計に接続する視点を本記事で整理する。',
    breadcrumb: 'ソーシャル引用Authority',
  },
  'gsc-ai-impressions-how-to-read': {
    intent: 'A',
    primarySearchIntent: 'GSC AIインプレッション 読み方 生成AI',
    h1: 'GSCのAIインプレッションをどう読むか——クリックがない指標の使い方',
    meta: 'Search Consoleの生成AIインプレッションはクリックを伴わない露出も記録します。全体パフォーマンスとの併読、HTML観測との役割分担、経営KPIへの接続方法と限界を解説します。',
    lead: 'AIインプレッションは流入ではない。GSCの生成AIレポートはクリックなし露出のログであり、全体パフォーマンスと併読して要約の正確性と導線を別管理する——読み方と限界をAgent Readinessの視点で本記事で整理する。',
    breadcrumb: 'GSC AIインプレッション',
  },
  'schema-not-ai-citation-cheat-code': {
    intent: 'A',
    primarySearchIntent: 'Schema AI引用 構造化データ 限界',
    h1: 'SchemaはAI引用のチートコードではない——構造化の役割と限界',
    meta: '構造化データは意味の機械可読化に効くが、AI引用を保証するチートコードではありません。Schema.orgとGoogle公式の位置づけを踏まえ、本文との一致と更新プロセスを優先する実務を解説します。',
    lead: 'Schemaは理解補助であり引用の保証ではない。本文と矛盾するマークアップは信頼を損ねる——構造化の役割と限界を分け、事実整備・正確な型・更新プロセスの順で設計する実務視点を本記事で丁寧に整理する視点です。',
    breadcrumb: 'Schemaの限界',
  },
  'chatgpt-retrieval-citation-practice': {
    intent: 'B',
    primarySearchIntent: 'ChatGPT 引用 取得 第三者分析',
    h1: 'ChatGPTの引用と取得——第三者分析から読み取れる実務示唆',
    meta: 'ChatGPTの取得・引用の詳細はOpenAIが十分公開していません。Peec.ai等の第三者分析を整理し、OpenAI未確認の領域を明示したうえで、定点観測とページ設計の実務示唆を解説します。',
    lead: 'Labrador等の内部名称はOpenAI未確認だ。Peec.ai等の第三者分析は参考資料——取得パイプラインの切替と冒頭可視テキストの設計を、断定ではなく検証可能なチェックに落とす視点を本記事で整理する。',
    breadcrumb: 'ChatGPT引用分析',
  },
};

/**
 * @param {string} slug
 * @returns {{ intent: 'A'|'B'|'C', primarySearchIntent: string, h1: string, meta: string, lead: string, breadcrumb: string } | null}
 */
export function getScheduledSeoPackage(slug) {
  return SCHEDULED_SEO_PACKAGES[slug] ?? null;
}

export function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function insightCanonicalUrl(slug) {
  return `${BASE_URL}/insights/${slug}/`;
}

/**
 * @param {string} slug
 * @param {string} titleSuffix H1 / og:title (without SITE_SUFFIX)
 * @param {string} metaDescription
 */
export function buildSocialMetaTags(slug, titleSuffix, metaDescription) {
  const url = insightCanonicalUrl(slug);
  return `<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(titleSuffix)}">
<meta property="og:description" content="${escapeHtml(metaDescription)}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="${OG_SITE_NAME}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(titleSuffix)}">
<meta name="twitter:description" content="${escapeHtml(metaDescription)}">`;
}

/**
 * @param {{ slug: string, h1: string, metaDescription: string, datePublished: string }} opts
 */
export function buildArticleHeadHtml({ slug, h1, metaDescription, datePublished }) {
  const canonical = insightCanonicalUrl(slug);
  const pageTitle = `${h1}${SITE_SUFFIX}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: h1,
    description: metaDescription,
    datePublished,
    dateModified: datePublished,
    author: { '@type': 'Organization', name: '合同会社コア・リテール', url: 'https://www.coaretail.com' },
    publisher: { '@type': 'Organization', name: '合同会社コア・リテール', url: 'https://www.coaretail.com' },
    mainEntityOfPage: canonical,
    inLanguage: 'ja',
  };
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Agent Readiness', item: 'https://readiness.coaretail.com/' },
      { '@type': 'ListItem', position: 2, name: 'Insights', item: 'https://readiness.coaretail.com/insights/' },
      { '@type': 'ListItem', position: 3, name: h1, item: canonical },
    ],
  };

  return `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(pageTitle)}</title>
<meta name="description" content="${escapeHtml(metaDescription)}">
<link rel="canonical" href="${canonical}">
${buildSocialMetaTags(slug, h1, metaDescription)}
<script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
</script>
<script type="application/ld+json">
${JSON.stringify(breadcrumbLd, null, 2)}
</script>`;
}

function stripSocialMetaTags(html) {
  return html
    .replace(/<meta property="og:type" content="[^"]*">\n?/g, '')
    .replace(/<meta property="og:title" content="[^"]*">\n?/g, '')
    .replace(/<meta property="og:description" content="[^"]*">\n?/g, '')
    .replace(/<meta property="og:url" content="[^"]*">\n?/g, '')
    .replace(/<meta property="og:site_name" content="[^"]*">\n?/g, '')
    .replace(/<meta name="twitter:card" content="[^"]*">\n?/g, '')
    .replace(/<meta name="twitter:title" content="[^"]*">\n?/g, '')
    .replace(/<meta name="twitter:description" content="[^"]*">\n?/g, '');
}

function moveCharsetToHeadStart(html) {
  const charsetRe = /<meta charset="UTF-8">\s*\n?/i;
  const match = html.match(charsetRe);
  if (!match) return html;

  let out = html.replace(charsetRe, '');
  return out.replace(/<head>\s*/i, (headOpen) => `${headOpen}${match[0]}`);
}

/**
 * @param {string} html
 * @param {string} slug
 * @param {{ h1: string, meta: string, lead: string, breadcrumb: string }} pkg
 */
export function applySeoPackageToHtml(html, slug, pkg) {
  const pageTitle = `${pkg.h1}${SITE_SUFFIX}`;
  let out = html;

  out = out.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(pageTitle)}</title>`);
  out = out.replace(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${escapeHtml(pkg.meta)}">`,
  );
  out = out.replace(
    /<link rel="canonical" href="[^"]+">/,
    `<link rel="canonical" href="${insightCanonicalUrl(slug)}">`,
  );

  out = stripSocialMetaTags(out);
  out = out.replace(
    /(<link rel="canonical" href="[^"]+">)/,
    `$1\n${buildSocialMetaTags(slug, pkg.h1, pkg.meta)}`,
  );

  out = out.replace(/"headline": "[^"]*"/, `"headline": ${JSON.stringify(pkg.h1)}`);
  out = out.replace(/"description": "[^"]*"/, `"description": ${JSON.stringify(pkg.meta)}`);
  out = out.replace(
    /"mainEntityOfPage": "[^"]*"/,
    `"mainEntityOfPage": ${JSON.stringify(insightCanonicalUrl(slug))}`,
  );

  out = out.replace(/<h1>[^<]*<\/h1>/, `<h1>${escapeHtml(pkg.h1)}</h1>`);
  out = out.replace(/<p class="lead">[\s\S]*?<\/p>/, `<p class="lead">${escapeHtml(pkg.lead)}</p>`);
  out = out.replace(
    /(<nav class="breadcrumb"[\s\S]*?<span>)[^<]+(<\/span>\s*<\/nav>)/,
    `$1${escapeHtml(pkg.breadcrumb)}$2`,
  );

  return moveCharsetToHeadStart(out);
}

function decodeHtmlEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
}

function count(html, re) {
  return (html.match(re) || []).length;
}

/**
 * @param {string} html
 * @param {string} slug
 * @param {{ scheduled?: boolean }} [opts]
 * @returns {string[]}
 */
export function validateInsightSeo(html, slug, { scheduled = false } = {}) {
  const errors = [];
  const expectedCanon = insightCanonicalUrl(slug);
  const pkg = scheduled ? getScheduledSeoPackage(slug) : null;

  if (scheduled && !pkg) {
    errors.push(`${slug}: no scheduled SEO package`);
    return errors;
  }

  const expectedH1 = pkg?.h1 ?? html.match(/<h1>([^<]+)<\/h1>/)?.[1];
  const expectedMeta = pkg?.meta ?? html.match(/name="description" content="([^"]+)"/)?.[1];
  const expectedTitle = expectedH1 ? `${expectedH1}${SITE_SUFFIX}` : null;

  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  if (!title) {
    errors.push(`${slug}: missing title`);
  } else if (expectedTitle && title !== expectedTitle) {
    errors.push(`${slug}: title mismatch (expected suffix ${SITE_SUFFIX.trim()})`);
  } else if (!title.endsWith(SITE_SUFFIX)) {
    errors.push(`${slug}: title missing suffix "${SITE_SUFFIX.trim()}"`);
  }

  const meta = html.match(/name="description" content="([^"]+)"/)?.[1];
  if (count(html, /name="description"/g) !== 1) errors.push(`${slug}: meta description count`);
  if (!meta) {
    errors.push(`${slug}: missing meta description`);
  } else if (expectedMeta && meta !== expectedMeta) {
    errors.push(`${slug}: meta description mismatch`);
  } else if ([...meta].length < 90 || [...meta].length > 160) {
    errors.push(`${slug}: meta description length ${[...meta].length} (want 90–160)`);
  }

  const canon = html.match(/rel="canonical" href="([^"]+)"/)?.[1];
  if (count(html, /rel="canonical"/g) !== 1) errors.push(`${slug}: canonical count`);
  if (canon !== expectedCanon) errors.push(`${slug}: canonical URL (${canon})`);

  const ogTitle = html.match(/property="og:title" content="([^"]+)"/)?.[1];
  if (count(html, /property="og:title"/g) !== 1) errors.push(`${slug}: og:title count`);
  if (expectedH1 && ogTitle !== expectedH1) errors.push(`${slug}: og:title≠h1`);

  if (count(html, /property="og:description"/g) !== 1) errors.push(`${slug}: og:description count`);
  const ogDesc = html.match(/property="og:description" content="([^"]+)"/)?.[1];
  if (expectedMeta && ogDesc !== expectedMeta) errors.push(`${slug}: og:description≠meta`);

  if (count(html, /property="og:type"/g) !== 1) errors.push(`${slug}: og:type count`);
  if (!html.includes(`property="og:url" content="${expectedCanon}"`)) errors.push(`${slug}: og:url`);
  if (!html.includes(`property="og:site_name" content="${OG_SITE_NAME}"`)) errors.push(`${slug}: og:site_name`);

  if (count(html, /name="twitter:title"/g) !== 1) errors.push(`${slug}: twitter:title count`);
  if (count(html, /name="twitter:description"/g) !== 1) errors.push(`${slug}: twitter:description count`);
  if (count(html, /name="twitter:card"/g) !== 1) errors.push(`${slug}: twitter:card count`);

  if (count(html, /<h1>/g) !== 1) errors.push(`${slug}: h1 count`);

  const h1 = decodeHtmlEntities(html.match(/<h1>([^<]+)<\/h1>/)?.[1] ?? '');
  if (expectedH1 && h1 !== expectedH1) errors.push(`${slug}: h1 mismatch`);

  const jsonBlocks = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (!jsonBlocks.length) {
    errors.push(`${slug}: missing JSON-LD`);
  } else {
    let blogPosting = null;
    let breadcrumbList = null;
    for (const raw of jsonBlocks) {
      try {
        const ld = JSON.parse(raw);
        if (ld['@type'] === 'BlogPosting') blogPosting = ld;
        if (ld['@type'] === 'BreadcrumbList') breadcrumbList = ld;
      } catch (e) {
        errors.push(`${slug}: invalid JSON-LD — ${e.message}`);
      }
    }
    if (!blogPosting) {
      errors.push(`${slug}: JSON-LD not BlogPosting`);
    } else {
      if (expectedH1 && blogPosting.headline !== expectedH1) errors.push(`${slug}: headline≠h1`);
      if (expectedMeta && blogPosting.description !== expectedMeta) {
        errors.push(`${slug}: json description≠meta`);
      }
      if (blogPosting.mainEntityOfPage !== expectedCanon) errors.push(`${slug}: mainEntityOfPage mismatch`);
      if (blogPosting.author?.url !== 'https://www.coaretail.com') {
        errors.push(`${slug}: author.url missing or wrong`);
      }
    }
    if (!breadcrumbList) errors.push(`${slug}: missing BreadcrumbList JSON-LD`);
  }

  if (!html.includes('/framework/')) errors.push(`${slug}: framework link`);
  if (!html.includes('/research/')) errors.push(`${slug}: research link`);
  if (!html.includes('/report/')) errors.push(`${slug}: report link`);

  if (scheduled && pkg) {
    const lead = decodeHtmlEntities(html.match(/<p class="lead">([^<]+)/)?.[1] ?? '');
    const leadLen = [...lead].length;
    if (leadLen < 100 || leadLen > 200) {
      errors.push(`${slug}: lead length ${leadLen} (want 100–200)`);
    }
    if (lead !== pkg.lead) errors.push(`${slug}: lead mismatch`);
  }

  return errors;
}
