// 純ロジック置き場。副作用を持たせない。テストを必ず書く。
// 実装済み：
//   - awards.ts        落札実績オープンデータの正規化・market_rates集計（タスク1-8）
//   - dedupe.ts        重複排除キーの生成と正規化（タスク1-4）
//   - agency.ts         発注機関名からagency_idを導出（GEPS/KKJ共通）
//   - kkj.ts            KKJ APIレスポンスの正規化（タスク1-5）
//   - geps.ts           調達ポータルの正規化（タスク1-7）
//   - document_text.ts  資料テキスト抽出のOCR要否判定（タスク2-2）
//   - tender_merge.ts   AI解析結果をtendersへ安全にマージする（タスク2-4）
// 実装予定（実装仕様書_v1.md §1 / ClaudeCode_実装指示書.md §4 参照）
//   - fit.ts        適合判定（タスク3-1）
//   - costing.ts    原価集計・応札価格の検討（タスク4-5）
//   - guide.ts       10ステップの状態導出
//   - recommend.ts   協力会社の推薦

export * from "./awards";
export * from "./dedupe";
export * from "./agency";
export * from "./kkj";
export * from "./geps";
export * from "./document_text";
export * from "./tender_merge";
