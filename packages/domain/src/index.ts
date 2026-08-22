// 純ロジック置き場。副作用を持たせない。テストを必ず書く。
// 実装済み：
//   - awards.ts        落札実績オープンデータの正規化・market_rates集計（タスク1-8）
//   - dedupe.ts        重複排除キーの生成と正規化（タスク1-4）
//   - agency.ts         発注機関名からagency_idを導出（GEPS/KKJ共通）
//   - kkj.ts            KKJ APIレスポンスの正規化（タスク1-5）
//   - geps.ts           調達ポータルの正規化（タスク1-7）
//   - document_text.ts  資料テキスト抽出のOCR要否判定（タスク2-2）
//   - document_status.ts 資料が無い理由の判定（機関が出していない／取得失敗）
//   - tender_merge.ts   AI解析結果をtendersへ安全にマージする（タスク2-4）
//   - lots_merge.ts     数量表の行をtender_lotsへ保存する前の重複排除（タスク2-5）
//   - tender_date_validation.ts  期限の前後関係・和暦変換ミスの検出（タスク2-3b）
//   - fit.ts            適合判定（タスク3-1）
//   - tender_lifecycle.ts 案件を公開中・終了へ進める判定（実装仕様書 §5 close）
//   - tender_browse.ts  すべての案件を一覧で見せるときの判定（タスク3-5）
//   - quote_request.ts  数量表の業種別切り出し・見積依頼メールの組み立て（タスク4-1）
//   - quote_response.ts 協力会社の回答（資料送付・回答通知メール、署名付きURLの有効期限）（タスク4-2）
// 実装予定（実装仕様書_v1.md §1 / ClaudeCode_実装指示書.md §4 参照）
//   - costing.ts    原価集計・応札価格の検討（タスク4-5）
//   - guide.ts       10ステップの状態導出
//   - recommend.ts   協力会社の推薦（見積実績に基づくランキング。実績データが無いため未着手）

export * from "./awards";
export * from "./dedupe";
export * from "./agency";
export * from "./kkj";
export * from "./geps";
export * from "./document_text";
export * from "./document_status";
export * from "./tender_merge";
export * from "./lots_merge";
export * from "./tender_date_validation";
export * from "./fit";
export * from "./quote_request";
export * from "./quote_response";
export * from "./quote_reminder";
export * from "./sender_identity";
export * from "./cost_estimate";
export * from "./submission_checklist";
export * from "./tender_lifecycle";
export * from "./tender_browse";
export * from "./date_range";
export * from "./analysis_scope";
export * from "./coverage";
