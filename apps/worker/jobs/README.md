# jobs/

crawl / fetch_documents / fetch_documents_ic / parse / match / notify / remind / coverage_check / close
（実装仕様書_v1.md §5 ジョブ設計を参照）

- `import_awards.ts`：落札実績オープンデータの取り込み（タスク1-8）。`runFullImport(year)` / `runDiffImport(date)`
- `refresh_market_rates.ts`：`market_rates`（相場の集計キャッシュ）の再計算（タスク1-8）
- `crawl_geps.ts`：調達ポータルの巡回（タスク1-7）。`runDailyGepsCrawl(dateIso)`。
  ICカード不要（連絡先情報入力方式）のためcollector_agentsは使わない。
  `GEPS_CONTACT_COMPANY` / `GEPS_CONTACT_NAME` / `GEPS_CONTACT_TEL` / `GEPS_CONTACT_EMAIL`
  環境変数が必要
