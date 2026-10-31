## Merchant APIのUCPレポートで、何が取れるか？

AI Mode in SearchとGeminiでのUCP（Universal Commerce Protocol）のチェックアウトとコンバージョン指標です。Google for Developersのガイド「Analyze UCP agentic performance (Alpha)」は、Merchant CenterのUCP分析ダッシュボードと同じ洞察をAPIで取れる、と書いています。機能は**alpha（実験的）**で、変更される可能性がある、と明記しています。v1alphaの`accounts.reports.search`を使います。

## アカウント全体のファネルでは、どの指標があるか？

`ucp_agentic_performance_view`は、日付と顧客の国別に、購入ボタンのクリック（`buy_button_clicks`）、アカウント連携（`accounts_linked`）、連携率（`account_linking_rate`）、購入件数（`purchase_count`）、キャンセル（`cancellations`）、カート移動（`cart_transfers`）、平均商品数など、とガイドは列挙しています。金額系の`Price`指標（`purchase_value`、`average_order_value`など）は通貨付きオブジェクトです。ファネル件数と金額指標を同じクエリに混ぜると、通貨のない行が分割される、とガイドは警告しています。件数だけと、通貨別の金額は、クエリを分ける、と書いています。

## 商品別では、何が取れるか？

`ucp_agentic_product_performance_view`は、`offer_id`ごとの購入ボタンクリックを、日付と国別に取れる、とガイドは書いています。`WHERE date BETWEEN ...`で期間集計も例示しています。どの商品がGoogle面上の「買う」に触られたかを見る用途です。在庫や利益の因果までは、このAPIだけでは分かりません。

## クエリの前提は何か？

両ビューとも、`WHERE`に`date`条件が必須です。リーフアカウントとアドバンスドアカウント（MCA）の両方に対応し、`account_id`をSELECTに含めるかで、サブアカウント別か集約かが変わる、とガイドは書いています。例示の数値（420クリックなど）はサンプルレスポンスであり、実データではありません。

## alphaであることは、何を意味するか？

スキーマ、列名、利用可能な国、保持期間が変わりうる、という一般的なalphaの意味です。GoogleはMerchant Center UIとAPIの一致を目指す、とガイドは書いていますが、ダッシュボードに無い指標をAPIだけが返す、逆もありえます。自社のAI ModeやGemini経由の売上を、参照トラフィックの増減と同一視しないでください。ここで数えるのは、UCP連携経路のイベントです。11/24付近の転換率の話とは、母数が異なります。<a href="/insights/ai-referral-volume-and-conversion/">AI経由の訪問は少なく、転換は高い——0.62%と13.8%をどう読むか</a>

> **出典：** [Google for Developers — Analyze UCP agentic performance (Alpha)](https://developers.google.com/merchant/api/guides/reports/ucp-performance-reports)（v1alpha。`ucp_agentic_performance_view`と`ucp_agentic_product_performance_view`。AI Mode in SearchとGemini。date必須。Price指標は通貨別クエリ。Experimental/alpha明記）
