# jobs/

crawl / fetch_documents / fetch_documents_ic / parse / match / notify / remind / coverage_check / close
（実装仕様書_v1.md §5 ジョブ設計を参照）

- `import_awards.ts`：落札実績オープンデータの取り込み（タスク1-8）。`runFullImport(year)` / `runDiffImport(date)`
- `refresh_market_rates.ts`：`market_rates`（相場の集計キャッシュ）の再計算（タスク1-8）
- `crawl_geps.ts`：調達ポータルの巡回（タスク1-7）。`runDailyGepsCrawl(dateIso)`。
  ICカード不要（連絡先情報入力方式）のためcollector_agentsは使わない。
  `GEPS_CONTACT_COMPANY` / `GEPS_CONTACT_NAME` / `GEPS_CONTACT_TEL` / `GEPS_CONTACT_EMAIL`
  環境変数が必要
- `kkj_sync.ts`：官公需情報ポータル（KKJ検索API）の同期（タスク1-5）。`runKkjSync(dateIso)`。
  資料のダウンロードは行わない（tendersへのupsertのみ）。`KKJ_API_URL`環境変数で
  エンドポイントを上書き可能（既定 `http://www.kkj.go.jp/api/`）
- `remind_quotes.ts`：見積依頼の自動催促（タスク4-4）。`runQuoteReminders(now?)`。
  回答期限の24時間前を切った未回答の見積へ1回だけ催促メールを送る（`quotes.reminded_at`
  で記録）。`RESEND_API_KEY` / `RESEND_FROM_ADDRESS` / `NEXT_PUBLIC_APP_URL` が必要。
  常駐（pg-boss）は未実装のため、いまは `pnpm --filter worker quotes:remind` で実行する
- `analysis_shared.ts`：AI解析の共通部分。資料の読み込み（`loadTenderForAnalysis`）と
  DBへの書き戻し（`persistAnalysis`）。同期実行とバッチ実行の両方が使う
- `analyze_tenders_batch.ts`：Batch API での案件解析（コスト対策③の骨格）。
  `submitAnalysisBatch(tenderIds, stage)` / `checkAnalysisBatch(batchId)` /
  `applyAnalysisBatch(batchId)` / `cancelAnalysisBatch(batchId)`。
  全トークンが50%引きになる代わりに、結果が出るまでたいてい1時間・最大24時間かかる。
  プロンプトキャッシュを効かせるため2段階に分ける（第1段=基本情報のみ、第2段=残り4本）。
  **バッチでキャッシュがどれだけ効くかは未検証**。`applyAnalysisBatch` が記録する
  `analysis_batches.usage` で必ず実測すること。
  定期実行は未実装で、いまは `pnpm --filter worker analyze:batch` から手で回す
