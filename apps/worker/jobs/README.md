# jobs/

crawl / fetch_documents / fetch_documents_ic / parse / match / notify / remind / coverage_check / close
（実装仕様書_v1.md §5 ジョブ設計を参照）

## 常駐ワーカー

`pnpm --filter worker start` で pg-boss が起動し、下記のジョブを定時実行する
（スケジュールは `apps/worker/src/schedule.ts`。時刻はすべて Asia/Tokyo）。

| 時刻 | ジョブ | 内容 |
|---|---|---|
| 04:00 / 12:00 | kkj-sync | 官公需情報ポータルAPIで新規案件を検知 |
| 04:30 / 12:30 | crawl-geps | 調達ポータルを巡回し資料を取得（数時間かかる） |
| 08:00 / 16:00 | extract-text | 資料からテキストを抽出（必要ならOCR） |
| 09:00 / 17:00 | analyze-pending | 解析待ちの案件をAI解析（`ANALYZE_DAILY_LIMIT` 件まで） |
| 11:00 / 19:00 | match-tenders | 条件セットごとに採点して提案を作る |
| 毎時 | remind-quotes | 回答期限24時間前の未回答へ催促 |
| 月次 1日 03:00 | import-awards | 落札実績オープンデータの差分を取り込む |
| 月次 1日 03:30 | refresh-market-rates | 落札率の集計を作り直す |

費用のかかるジョブは `DISABLED_JOBS=analyze-pending` のように環境変数で止められる
（コードの変更もデプロイの巻き戻しも要らない）。

**未実装**：fetch_documents_ic（収集端末）、notify（提案の通知）、coverage_check、close。

## 個別のジョブ

- `import_awards.ts`：落札実績オープンデータの取り込み（タスク1-8）。`runFullImport(year)` / `runDiffImport(date)`
- `refresh_market_rates.ts`：`market_rates`（相場の集計キャッシュ）の再計算（タスク1-8）
- `crawl_geps.ts`：調達ポータルの巡回（タスク1-7）。`runDailyGepsCrawl(dateIso)`。
  ICカード不要（連絡先情報入力方式）のためcollector_agentsは使わない。
  `GEPS_CONTACT_COMPANY` / `GEPS_CONTACT_NAME` / `GEPS_CONTACT_TEL` / `GEPS_CONTACT_EMAIL`
  環境変数が必要
- `kkj_sync.ts`：官公需情報ポータル（KKJ検索API）の同期（タスク1-5）。`runKkjSync(dateIso)`。
  資料のダウンロードは行わない（tendersへのupsertのみ）。`KKJ_API_URL`環境変数で
  エンドポイントを上書き可能（既定 `http://www.kkj.go.jp/api/`）
- `analysis_shared.ts`：AI解析の共通部分。資料の読み込み（`loadTenderForAnalysis`）と
  DBへの書き戻し（`persistAnalysis`）。同期実行とバッチ実行の両方が使う
- `analyze_pending.ts`：解析待ちの案件をまとめて解析する（常駐ワーカー用）。
  `runAnalyzePending(limit)`。1回あたりの件数に上限を設け、推定費用をログに出す
- `analyze_tenders_batch.ts`：Batch API での案件解析（コスト対策③の骨格）。
  `submitAnalysisBatch(tenderIds, stage)` / `checkAnalysisBatch(batchId)` /
  `applyAnalysisBatch(batchId)` / `cancelAnalysisBatch(batchId)`。
  全トークンが50%引きになる代わりに、結果が出るまでたいてい1時間・最大24時間かかる。
  プロンプトキャッシュを効かせるため2段階に分ける（第1段=基本情報のみ、第2段=残り4本）。
  **バッチでキャッシュがどれだけ効くかは未検証**。`applyAnalysisBatch` が記録する
  `analysis_batches.usage` で必ず実測すること。
  常駐ワーカーには繋いでいない（`pnpm --filter worker analyze:batch` から手で回す）
- `remind_quotes.ts`：見積依頼の自動催促（タスク4-4）。`runQuoteReminders(now?)`。
  回答期限の24時間前を切った未回答の見積へ1回だけ催促メールを送る（`quotes.reminded_at`
  で記録）。`RESEND_API_KEY` / `RESEND_FROM_ADDRESS` / `NEXT_PUBLIC_APP_URL` が必要
