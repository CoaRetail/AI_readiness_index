## 翌日には、どのくらいの引用が消えるか？

Ahrefsの自社研究「How Stable Are AI Citations?」（2026-10、Mateusz Makosiewicz氏ほか）は、5つのAIツールに同じ質問を20日間毎日投げ、初日に引用された約37,500件を追跡したとしています。Google AI Overviewsでは翌日までに50%が消え、20日間すべて残ったのは6.6%です。Google AI Modeは翌日58%、20日間6.8%。ChatGPTは翌日59%、20日間4.0%。Geminiは81%が翌日に消え、20日間残るのは0.2%。Ahrefsの社内計測であり、全クエリ市場の代表値ではありません。

## 一度消えた引用は、戻ってくるか？

同じAhrefs研究では、少なくとも一度消えた引用の約75%が20日以内に戻り、約半数が3日以内に戻った、としています。ブランド名が質問に含まれる場合、Google AI Modeで自社サイトが20日間すべて引用され続けたのは33%（任意の引用サイトが20日間残るのは6.8%）という表も公開されています。あくまでAhrefsが選んだ質問集合です。

## 半年後には、何割だけが同じ検索で残るか？

PageSpeed Mattersの自社データ（2026-11-12）は、423の同一検索で2025年11月〜2026年1月にAI Overviewで引用された2,585ページのうち、2026年7〜11月に同じ検索で再引用されたのは25.9%（669ページ）、としています。1,277検索全体では引用ページの18.1%、サイトでは26.4%が再引用、ともあります。商用寄りのクエリ集合で、中間時期の引用は数えていない、と研究は注記しています。

## エンジン横断では、名前の出方はどれだけ揃わないか？

グラッドキューブINSIGHT CUBE（2026-10-19、21サービス・25,281回答）の自社計測では、10回以上観測した系列のうち自社名が毎回出たのは3.0%、一度も出なかったのは45.3%です。1回の計測が期間中央値から平均26.2ポイントずれる系列もある、と報告しています。同一記事内の表では、Geminiで「AIモードとGoogle AI Overviewsの重なり」が13.0%（変動幅30.8%）など、エンジンごとの揺らぎが示されています。ベンダーツール会社のデータです。

## 小規模な再計測は、何を示すか？

CiteCurrentの2026年11月レポート（2026-11-16、80問×3回×4サービス、米国11/12時点）は小標本ですが、ChatGPTで240回答中34件が引用なし（10月は4件）など、月次の構成変化を記録しています。HasmordのテストはPickedByRobots報道（2026-11-11）経由で、AIO引用リンクの30%（3,138件中951件）がgoogle.comリダイレクトを向いた、また同じ60の買い物質問を2週間空けて再計測したとき、同じサイトを再引用したのはPerplexity 62%、AIO 57%、ChatGPT 37%だとされています。Hasmord原典は未取得、数値は報道の要約です。

## 監測設計で何を固定するか？

引用の「安定性」は、翌日半分消える（Ahrefs）ことと、6〜11か月後に約4分の3が入れ替わる（PageSpeed Matters）ことを同時に見る必要があります。1回スナップショットや1エンジンだけのGEOスコアで勝敗を決めないでください。質問セット・地点・ログイン状態・計測間隔を固定し、ブランド名入り質問と一般質問を分けて追う。リダイレクト経由のリンク（Hasmord報道）がトラッキングを狂わせ得る点も、ログ解析と別にメモします。

> **出典：** [Ahrefs 37,500 / 20 days](https://ahrefs.com/blog/how-stable-are-ai-citations/)（自社データ）／[PageSpeed Matters citation churn](https://www.pagespeedmatters.com/resources/data-studies/ai-overview-citation-churn)（25.9% of 2,585 pages；商用クエリ集合）／[グラッドキューブ INSIGHT CUBE](https://www.glad-cube.com/insightcube/archives/4011)（毎回3.0%；Gemini重なり13.0%など）／[CiteCurrent Nov 2026](https://citecurrent.com/reports/2026-11/)（小標本）／[PickedByRobots on Hasmord](https://pickedbyrobots.com/blog/google-hides-ai-overview-citation-links-redirect-drift/)（30% redirect；2週再引用37–62%）