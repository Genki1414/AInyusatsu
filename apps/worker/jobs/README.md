# jobs/

crawl / fetch_documents / fetch_documents_ic / parse / match / notify / remind / coverage_check / close
（実装仕様書_v1.md §5 ジョブ設計を参照）

- `import_awards.ts`：落札実績オープンデータの取り込み（タスク1-8）。`runFullImport(year)` / `runDiffImport(date)`
- `refresh_market_rates.ts`：`market_rates`（相場の集計キャッシュ）の再計算（タスク1-8）
