// 通知アダプタ置き場。副作用を持つ外部呼び出しはここに閉じ込める。
// 実装済み：
//   - resend.ts          メール送信（タスク4-1）
//   - resend_inbound.ts  受信メールの本文・添付の取得（タスク4-3）
// 実装予定：
//   - line.ts     LINE Messaging API（組織ごとのチャンネル設定が必要。別タスク）

export * from "../adapters/resend";
export * from "../adapters/resend_inbound";
