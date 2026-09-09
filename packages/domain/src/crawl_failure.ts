// 巡回の失敗を、原因のコードに振り分ける。
//
// 【なぜ分けるか】
// これまでは資料取得の失敗をすべて LAYOUT_CHANGED（画面構成の変化）にしていた。
// 2026-09-01〜09-03 に34件が積まれたが、中身は**すべて30秒のタイムアウト**で、
// セレクタは壊れていなかった。原因は巡回が三重に走ってメモリを食い合っていたこと
// （#152で修正）。
//
// 「セレクタを直せ」と出し続けると、本当に直すべきものが埋もれる。
// 対応の内容が違うものは、別のコードにする。
//
// 【推測で決めない】
// 判別できるのは、Playwrightが吐くメッセージの形がはっきりしているものだけ。
// 当てはまらないものは LAYOUT_CHANGED に置く（人が見る側に倒す）。

/** タイムアウトだと確実に分かる文言。Playwrightが出す形。 */
const TIMEOUT_PATTERNS = [
  /Timeout \d+ms exceeded/i,
  /timeout of \d+ms exceeded/i,
  /Navigation timeout/i,
];

/** ICカードやログインが要ると分かる文言。 */
const AUTH_PATTERNS = [/ICカード/, /ログインが必要/, /認証が必要/];

/**
 * 失敗のメッセージから、扱いの違うコードへ振り分ける。
 *
 * - タイムアウト → TIMEOUT（次回に回る。人の対応は要らない）
 * - 認証が要る   → AUTH_REQUIRED（自動化しない）
 * - それ以外     → LAYOUT_CHANGED（セレクタを直す）
 */
export function classifyCrawlFailure(message: string | null | undefined): string {
  const text = (message ?? "").trim();
  if (text === "") return "LAYOUT_CHANGED";
  if (AUTH_PATTERNS.some((p) => p.test(text))) return "AUTH_REQUIRED";
  if (TIMEOUT_PATTERNS.some((p) => p.test(text))) return "TIMEOUT";
  return "LAYOUT_CHANGED";
}
