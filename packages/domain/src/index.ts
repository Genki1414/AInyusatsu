// 純ロジック置き場。副作用を持たせない。テストを必ず書く。
// 実装済み：
//   - awards.ts    落札実績オープンデータの正規化・market_rates集計（タスク1-8）
//   - dedupe.ts    重複排除キーの生成と正規化（タスク1-4）
//   - kkj.ts        KKJ APIレスポンスの正規化（タスク1-5）
//   - geps.ts       調達ポータルの正規化（タスク1-7）
// 実装予定（実装仕様書_v1.md §1 / ClaudeCode_実装指示書.md §4 参照）
//   - fit.ts        適合判定（タスク3-1）
//   - costing.ts    原価集計・応札価格の検討（タスク4-5）
//   - guide.ts       10ステップの状態導出
//   - recommend.ts   協力会社の推薦

export * from "./awards";
export * from "./dedupe";
export * from "./kkj";
export * from "./geps";
