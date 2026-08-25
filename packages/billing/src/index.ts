// 決済アダプタ置き場。副作用を持つ外部呼び出しはここに閉じ込める。
// 実装済み：
//   - stripe.ts   Checkout・Customer Portal・Webhookの検証（タスク4-7）
//
// CLAUDE.md「外部サービスは packages/*/adapters 経由でのみ呼ぶ」。
// 決済は譲渡時に差し替える可能性が最も高い部分なので、通知（notifications）とは分けている。

export * from "../adapters/stripe";
