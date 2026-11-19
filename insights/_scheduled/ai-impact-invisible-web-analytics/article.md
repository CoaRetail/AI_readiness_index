## Google検索経由のクリックは、Refererでどう識別するか？

Google Search Central「Identify traffic from Google Search」（2026-11-12付の新規ドキュメント、更新履歴経由）は、Google検索からサイトへ遷移するときのHTTP Refererがドメインのみを送る（検索クエリ文字列は含まない）と説明しています。DiscoverとGoogle画像検索も同じ値になる、ともあります。プライバシー設定・リダイレクト・計測方式の違いにより、解析ツールとSearch Consoleのクリック数は1対1で一致しない、と明記しています。**AIモードやAI OverviewsからのクリックをRefererだけで切り分ける記述は、このドキュメントにはありません。**

## Scrunchの調査は、AI経由をどう見えなくするか？

Sitecore傘下Scrunchのプレスリリース（2026-11-12）は、自社パネル調査でAIアシスタントセッションの40.8%が事前の検索も事後のクリックもない「完結型」とし、従来検索では21.5%だとしています。AIがブランドを勧めたあとサイト訪問が増えたケースの約91%は、AIの参照元ヘッダーなしで到着した、とも書いています。調査レポート本体は未取得で、数字はプレスのみです。2か国オプトイン・主に2026年7〜9月と記載があります。

## 個人の190日ログは、どのエンジンだけ痕跡が残るか？

Masters of Searchの報道（2026-11-11、Landwehrの190日ログ）では、Search Consoleに見えるのは主にGoogleのAI Overviews／AIモード、Bing Webmaster Toolsに見えるのはCopilotだけで、Gemini・Perplexity・Grokは両方に痕跡がない、とされています。ログアウト時のChatGPTは時期により参照元の見え方が変わった、とも書かれています。Landwehr本人のLinkedIn原稿は未取得、1人・短期の観測です。Search Engine Journalなど既刊Insightsの「GSCにAIクリック行がない」という話題と同系統です。

## Bingは、AI回答なしの検索をどう選べるか？

Microsoft Bing Search Blog（2026-11-11）では、Chrome／Edge向け拡張機能（プレビュー）でAI回答の表示をオン／オフでき、検索語末尾に `-ai` を付けるとAI回答なしの結果になる、としています。利用者がAI回答を見ない選択肢がある前提で、マーケター側もAIあり／なしで計測条件を揃える必要がある、という実務上の含意です。Google側に同等の利用者向けスイッチがあるとは書いていません。

## Search Analytics APIの指名分類は、AI面を分けられるか？

Google Search Central Blog（2026-11-16）は、Search Analytics APIでbranded queries filterを紹介し、指名・非指名を分けて取れる、としています。webMultimodalタイプでLens・かこって検索・アップロード画像の成果も取れる、ともあります。**AIモードやAI Overviews専用のディメンションは、公開ブログ本文からは読み取れません。** 指名検索トレンドをAI影響の代理指標に使う場合、ブランド需要の変動と混ざる Caveat を残す必要があります。

## 計測戦略で何を諦め、何を残すか？

AIの影響がアクセス解析に十分乗らない、というのは欠損ではなく、現行ツールの設計です。Scrunchの91%（プレス数値）やRefererドキュメントの範囲説明は、last-click幻想を手放す材料になります。残せるのは、Search Consoleの指名クエリ推移、サイト内イベント、GSCのAIインプレッション系レポート（クリックではない）、実験コホートでのログイン有無などです。Landwehrログのように、エンジンごとにコンソール行が分断される点も、ダッシュボード一枚に収めようとしない理由になります。

> **出典：** [Identify Google Search traffic](https://developers.google.com/search/docs/monitor-debug/identify-google-search-traffic)（2026-11-12、Refererはドメインのみ；AIモード未記載）／[Scrunch press](https://www.sitecore.com/company/newsroom/press-releases/2026/11/40-of-ai-assistant-sessions-never-touch-the-open-web-new-scrunch-study-finds)（40.8% self-contained；~91% unattributed lift）／[Masters of Search on Landwehr log](https://www.masters-of-search.com/the-brief/landwehr-s-190-day-log-finds-only-two-llms-leaving-traces-in-gsc-and-bing)（1人観測）／[Bing AI on/off](https://blogs.bing.com/search/2026/11/your-choice-turn-ai-answers-on-or-off-in-bing)（2026-11-11）／[Search Analytics API update](https://developers.google.com/search/blog/2026/11/search-analytics-api-update)（branded filter；AI面分離なし）