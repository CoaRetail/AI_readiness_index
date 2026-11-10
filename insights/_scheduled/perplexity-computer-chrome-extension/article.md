## Perplexity Computerは、Chromeをどう操作するか？

デスクトップアプリからChromium系ブラウザを動かす拡張です。Chrome Web StoreのPerplexity拡張（2026年10月31日更新、バージョン0.0.7）は、Perplexityデスクトップアプリ向けの拡張で、Computerがローカルブラウザ内でサイトを開き、ページを読み、フォームを埋め、タスクを完了できる、と説明しています。Chrome、Edge、Brave、ArcなどChromiumブラウザに対応し、Cometブラウザには同機能が内蔵で拡張不要、と書いています。Perplexityの2026年10月のチェンジログも、Mac版26.38.0以降でChromiumブラウザに拡張を追加し、Computerがブラウザでタスクを完了できる、と書いています。

## 構造化データではなく、何を読むのか？

Storeの説明は、画面操作上のナビゲーション・読取・フォーム入力・複数タブ作業を列挙しており、WebMCPやMerchant APIのような構造化呼び出しではない、という点がGeoParrotなどの論評で強調されていますが、本稿の一次根拠はStoreとチェンジログです。Storeは「open cnn.com and summarize the top three stories」「check my LinkedIn feed」など自然言語タスク例を挙げ、ログイン済みダッシュボードや社内ツールにも触れる、と書いています。HTMLやschema.orgの有無より、ユーザーが見えるUI要素を介した操作系統、と読むのがStore記述に沿った整理です。引用やSEO順位を上げるGEO施策が、この操作モードに効くかは、Perplexityの一次資料では検証されていません。

## ユーザーは、いつ権限を渡すか？

Computerはユーザーが開始したタスクの間だけ、指定したブラウザを使う、とStoreは書いています。バックグラウンドで閲覧データを収集しない、ともStoreは書いています。MacではSettings → Connectors、WindowsではSettings → Permissionsで、拡張を入れたブラウザと選択を一致させる手順がStoreにあります。チェンジログもSettings > Connectorsで接続ブラウザを変更できる、と書いています。ログイン済みセッションを使うため、どのアカウントで作業させるかは利用者側の判断です。

## データは、何が扱われるか？

Storeの詳細欄は、認証情報やウェブサイトコンテンツなどを扱う旨の開示項目を含みます（開発者Ramana Malik氏、Perplexity AI）。独立したプライバシー監査の結果ではありません。タスク中にページ内容がPerplexity側に送られる前提で、機密ダッシュボードを接続する前に範囲を区切る必要があります。CometJackingなど過去のエージェント脆弱性報告は、GeoParrot等の二次論評にあり、Perplexityの2026年10月の一次告知本文では解決状況まで確認できていないため、本稿では断定しません。

## 引用・API連携と、何が違うか？

回答エンジンがURLを引用して要約する流れと、Computerが既存タブでクリックや入力を代行する流れは別です。Google Connected AppsやMerchant APIのような公式連携とも別経路です。Storeが想定するのは、請求ポータルから請求書を取り出す、複数タブの提案書を比較する、といった作業代行です。サイト側から見れば、人間ユーザーと同様のブラウザ操作に近いトラフィックになりうる、という点だけが、公開説明から言えます。構造化カタログの整備だけでは届かないUI依存タスクがある、というのはStoreの用途例から読める含意であり、売上やリード改善の保証ではありません。

> **出典：** [Chrome Web Store — Perplexity extension](https://chromewebstore.google.com/detail/perplexity/pninphncmkphpjgfffammoenglghcjii)（2026-10-31更新 v0.0.7。ComputerがChromiumブラウザを操作。タスク中のみ。Perplexity AI）／[Perplexity Changelog](https://www.perplexity.ai/changelog/automations-inline-visualizations-and-gpt-6-1-sol)（Browser extensionでComputerがデスクトップブラウザを使用。Mac 26.38.0以降）
