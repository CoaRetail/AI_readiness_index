# Insights ヒーロー画像の生成手順

新規の Insights ヒーロー（`assets/insights/<slug>/hero.webp`）は、次の手順だけで作る。

1. `createBriefPrompt` が Visual Canon（`ARI_INSIGHTS_VISUAL_CANON.md`）と記事 HTML からブリーフを組む。MODE は TYPOGRAPHIC ONLY。
2. `runNativeGeneration` が Codex Native を実行する。
   `codex exec --ephemeral --skip-git-repo-check --sandbox workspace-write`
   （実装は `--cd` と `--output-last-message` も付ける。`OPENAI_API_KEY` は渡さない。）
3. `readQualityGate` が一時 PNG の **1672×941**（`CANONICAL_HERO_SIZE`）と、生成側が書いた `quality.json` を見る。
4. `optimizeToWebp` が Mac 上の変換スクリプトを呼ぶ。

```text
/usr/local/bin/node /Users/takeshisasaki/ari-webp-tool-l5sDwJ/convert-webp.mjs <png> <hero.webp>
```

統合は既存の `integrateCanonicalHero` / `integrateScheduledCanonicalHero` / `integrateHoldStockHero` と `markHeroReady`。キャンバスサイズ、Visual Canon 本文、ブリーフ契約は変えない。

Pillow、Cursor の GenerateImage、ffmpeg `drawtext`、単体の `cwebp` は Insights ヒーローの代替にしない。ツールが足りないホストでは画像を作らず、`packageReadiness` を `HERO_PENDING` のままにする。

## ローカル（Mac）での実行

前提:

```bash
command -v codex
test -x /usr/local/bin/node
test -f /Users/takeshisasaki/ari-webp-tool-l5sDwJ/convert-webp.mjs
```

公開前（予約記事、公開 3 日以内、1 回あたり最大 2 本）:

対象は `hero.webp` が無い予約だけです。`packageReadiness` や予定カードの有無では除外しません。一度予約を外して別の日に入れ直した記事も、期間内でファイルが無ければ対象です。朝の preflight も、当日分が揃っていても期間内に欠けがあれば生成に進みます。

```bash
./scripts/run-prepublish-hero.sh
# または
npm run visual:prepublish
```

公開済みでヒーローが無い記事の回復:

```bash
./scripts/local-visual-worker.sh
# または
npm run visual:worker
```

`codex` のログイン状態は `CODEX_HOME`（既定は `$HOME/.codex`）を使う。launchd からの常駐は `scripts/install-local-visual-worker.sh`。

どちらも、ツールが無い状態で候補の生成に入ると `INSIGHTS_HERO_TOOLCHAIN_MISSING` で終了する。画像ファイルは作らない。

1 記事あたりの Codex 試行回数は `ARI_VISUAL_MAX_GENERATION_ATTEMPTS`（1 から 6 の整数、それ以外は既定の 3）。`codex exec` が画像を残せなかったときは、標準出力・標準エラーの末尾と `codex-N.final.txt` をワーカーログと終了 JSON の `codexFailures` に残す。

`codex exec` が終了コード 0 なのに `generation-N.png` を書かないときは、品質ゲートの前にワーカーがその PNG を揃える。Mac で確認した保存先は `$CODEX_HOME/generated_images/<thread-id>/exec-*.png`（`CODEX_HOME` の既定は `$HOME/.codex`）で、Codex はそこから作業ディレクトリへコピーしない。ワーカーは実行開始より新しい `exec-*.png` だけを見る。出力か、その実行中に更新されたセッションからスレッドが分かるときはそのディレクトリだけを使い、別スレッドの新しいファイルは取らない。スレッドが分からないときは、開始より新しいものの中で最も新しいファイルを使う。URL やメッセージ内の別パスは、そのコピーが無いときの予備です。`quality.json` があるときは従来の `readQualityGate` を通す。無いときは 1672×941 だけを確認して `convert-webp.mjs` に進む。新しい画像は作らない。Codex Native 以外（Pillow、GenerateImage、ffmpeg `drawtext`、単体の `cwebp`）には切り替えない。この回収は `scripts/lib/local-visual-worker.mjs` にあり、15:05 の launchd はマージ後のそのファイルを改変せずに実行する。

## 公開前ヒーローと一覧の予定カード

`insights/index.html` の予定カードは 1 件だけで、公開時刻が最も早い `scheduled` 記事を示す。10:00 JST の公開ジョブが、公開後に次の予約へ差し替える。

次の公開より先の予約には、まだ自分の `data-scheduled-slug` が無い。その状態では予定カードを書き換えず、予約 HTML と `hero.webp` と package readiness だけを更新する。予定カードが自分の slug にあるときだけ、そのカードの中のサムネイルを必須にする。1672×941 と `quality.json` の画質ゲートは変えない。

先頭候補の生成または統合が失敗しても、認証失敗・ツール不足・リモート分岐以外なら同じ実行で次の候補へ進む。認証失敗とタイムアウトはその記事で打ち切り、認証失敗はキューも止める。タイムアウトのあとは次の候補へ進む。

## クラウド VM / CI

`codex` または `convert-webp.mjs` が無い環境ではヒーローを生成しない。

- 記事のスケジュール直後の `triggerImmediatePrepublishHero` はワーカーを起動せず、`reports/prepublish-hero-request.json` に `DEFERRED_TO_LOCAL_RUNTIME` を残す。
- 予約記事で `hero.webp` が無い状態は `HERO_PENDING` として扱う。
- 公開と reconcile は、その記事を web だけ公開しない。ログに `HERO_PENDING_HOLD` を残し、`publishAt` と `scheduled` は動かさない。
- `node scripts/run-prepublish-hero.mjs` や `node scripts/run-insights-visual-worker.mjs` が生成段階まで進んだ場合は、非ゼロ終了と `VISUAL_WORKER_TOOLCHAIN_MISSING` になる。

既存の `assets/insights/*/hero.webp` は、この手順の復旧だけでは置き換えない。2026-10-01 以降に Pillow または GenerateImage で作った分を Codex Native で描き直す作業は、上記の Mac 前提が揃ったマシンで別途行う。
