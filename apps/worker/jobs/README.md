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
