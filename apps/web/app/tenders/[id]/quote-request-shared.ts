// request-tab.tsx（プレビュー生成）と actions.ts（送信処理）の両方から使う定数。
// プレビュー本文には実際の回答期限がまだ確定していない（フォーム送信前）ため、
// このマーカーを本文に埋め込んでおき、送信時（actions.ts）に実際の日時へ置換する。
export const DUE_AT_PLACEHOLDER = "{{DUE_AT}}";

// 協力会社の回答ページ（/q/[token]）のURLは、送信先の協力会社ごとに異なる
// （quotesの行ごとに発行するtoken）。トレード単位で1つの本文をプレビュー・編集するため、
// このマーカーを埋め込んでおき、実際に送信するときだけ協力会社ごとの値へ置換する。
export const RESPONSE_URL_PLACEHOLDER = "{{RESPONSE_URL}}";
