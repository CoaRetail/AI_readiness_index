## 学習拒否は、robots.txtで一括で書けるようになるか？

書ける方向です。Googleは2026年10月30日、IETFのAIPREF作業部会の共通シグナルをrobots.txtで受け取る予定だとSearch Central Blogに書いています。OpenAIも同日、複数のAI事業者に同じ意思表示を一度に伝える共通シグナルをrobots.txtで尊重すると発表しています。Googleは2027年初めの対応を目指す、と書いています。IETFのドラフト `draft-kelley-aipref-training-preference-signal` は、User-Agent行にポリシートークン `__usage_ai-training` を置き、Disallow/Allowで学習利用の可否をパス単位で示す案です。Internet-Draftであり、参照は作業中の文書として扱います。

## その一行は、検索用クローラーの許可も変えるか？

変えない、とGoogleは書いています。共通シグナルはAI学習の選好向けで、クローラー向けの従来のルールとは独立です。ドラフトも、トラフィック管理のシグナルとコンテンツ利用の選好は直交すると書いています。Google-Extendedは2023年からの学習向け制御として残り、Google-Extendedを明示的に許可したサイトだけがGemini Appsのグラウンディング回答に載りクリックを受け取れる、と10月30日の投稿は書いています。OpenAIも、既存のクローラー別コントロールは引き続き有効だと書いています。学習を断っても、検索・引用用のボット設定は別途必要です。

## Google-Extendedを書いていないとき、共通トークンはどう読まれるか？

Googleは、共通トークンで学習を拒否し、Google-Extendedを明示していない場合、その拒否をGoogle-ExtendedをDisallowしたのと同等に解釈する予定だ、と10月30日に書いています。逆にGoogle-Extendedを明示的にAllowすれば、共通トークンで広く拒否していてもGemini側の扱いは別途設計できる、という説明です。事業者ごとの制御と業界共通シグナルを併用できる、とGoogleは書いています。

## OpenAIはいつから尊重するか？

OpenAIは2026年10月30日、今後数か月で実装し、詳細は別途共有すると書いています。IETFのAI Preferences作業部会の議論に参加し、標準化の議論が進むにつれて慣行も変わりうる、とも書いています。他のAI事業者にも同シグナルの尊重を促しています。Bingが同トークンに対応する、という報道は、本稿執筆時点でMicrosoft Bingの一次確認が取れていないため、本文では採用していません。

## サイト運営者が誤解しやすい点は何か？

「学習用を一括で断ったから、検索回答にも載らない」とは限りません。Googleの説明は、学習選好と検索・グラウンディングの制御を分けることです。ドラフトのポリシートークンはクロール行為そのものの指令ではなく、取得したコンテンツの生成AI学習への利用選好を示す、と書いています。実装時期は2027年初め（Google）と数か月以内（OpenAI）で、現時点のrobots.txtだけでは全事業者に即効しません。Muck Rackの2026年10月版「What Is AI Reading?」は、Claude-SearchBotの許可と引用の関係を示す自社分析として紹介されていますが、当該URLはCloudflareチャレンジで本文を取得できず、81%・12%などの数値は本稿では検証していません。

> **出典：** [Google Search Central Blog 2026-10-30](https://developers.google.cn/search/blog/2026/10/ai-training-control)（John Mueller氏。共通AI学習制御。Google-Extendedとの関係。2027年初め対応目標）／[OpenAI 2026-10-30](https://openai.com/index/helping-websites-express-ai-training-preferences/)（共通robots.txtシグナル。既存クローラー制御は継続）／[IETF draft-kelley-aipref-training-preference-signal](https://datatracker.ietf.org/doc/html/draft-kelley-aipref-training-preference-signal)（`__usage_ai-training`。Internet-Draft、作業中）
