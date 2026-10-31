Google Merchant APIに、UCP agentic performanceレポート（v1alpha・Experimental）が追加されています。AI Mode in SearchとGeminiでの購入ボタンクリック、アカウント連携、購入、キャンセル、カート移動を、日付と顧客国別にMCQLで取れる、と開発者ドキュメントは書いています。

`ucp_agentic_performance_view`はファネル全体、`ucp_agentic_product_performance_view`はoffer_id別の購入ボタンクリックです。`WHERE`にdateが必須。件数指標とPrice指標を同一クエリに混ぜると行が通貨で分割される、と警告があります。

alphaはスキーマ変更がありうる、という意味です。Merchant Center UIと同じ洞察をAPI化する、と書いていますが、参照トラフィックの増減とUCPイベントは母数が異なります。自社のプロトコル経路を店側で監視する用途の話です。

https://readiness.coaretail.com/insights/merchant-ucp-agentic-performance-api/
#AgentReadiness #UCP #MerchantCenter
