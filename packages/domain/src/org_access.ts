// 本部が発行・停止する利用権の判定。
//
// 【なぜ本部が発行するか】
// 支払いは請求書払いのみ（ユーザー決定 2026-08-25）。カード決済のように自動で
// 契約が始まらないため、アカウントの発行と停止は本部が行う。
//
// 【分からないときは使わせない】
// 状態が読めない・行が無い場合は「停止」として扱う。
// 作り忘れや読み取りの失敗で「使えてしまう」より、「使えない」ほうが安全。
// 使えない側に倒れたときは本部に連絡が来るので、気づける。

export const ACCESS_STATUSES = ["利用中", "停止"] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

/**
 * サービスを使えるか。
 * null / undefined / 知らない値はすべて false（分からないなら使わせない）。
 */
export function isActive(status: string | null | undefined): boolean {
  return status === "利用中";
}

/** 停止中の画面に出す案内。理由が入っていればそれを見せる。 */
export function suspendedMessage(reason: string | null | undefined): string {
  const detail = reason?.trim();
  return detail
    ? `ご利用を停止しています。理由：${detail}`
    : "ご利用を停止しています。お心当たりが無い場合は、運営までご連絡ください。";
}

// --- 初期パスワード ---------------------------------------------------------
//
// 本部がアカウントを発行するとき、初期パスワードを作って画面に一度だけ出す。
// 招待メールにしないのは、メール送信の設定に依存させたくないため
// （届かないと発行そのものが止まる）。

/**
 * 初期パスワードに使う文字。
 * 電話や口頭で伝えることがあるため、見間違えやすい文字を外す。
 *   0 O o / 1 l I / 2 Z / 5 S / 8 B
 */
export const INITIAL_PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXY34679";

/** 長さ。人が読み上げられる範囲で、総当たりに耐える長さにする。 */
export const INITIAL_PASSWORD_LENGTH = 16;

/**
 * 乱数の並びから初期パスワードを組み立てる。
 * 乱数そのものは呼び出し側が用意する（ここは副作用を持たない）。
 */
export function buildInitialPassword(picks: number[]): string {
  if (picks.length < INITIAL_PASSWORD_LENGTH) {
    throw new Error(`初期パスワードには${INITIAL_PASSWORD_LENGTH}個の乱数が必要です（受け取った数: ${picks.length}）`);
  }
  return picks
    .slice(0, INITIAL_PASSWORD_LENGTH)
    .map((pick) => INITIAL_PASSWORD_ALPHABET[Math.abs(pick) % INITIAL_PASSWORD_ALPHABET.length])
    .join("");
}

// --- 発行の入力チェック -----------------------------------------------------

export type IssueAccountInput = {
  orgName: string;
  userName: string;
  email: string;
};

export type IssueValidation = { ok: true; value: IssueAccountInput } | { ok: false; error: string };

/** メールアドレスらしいか。厳密な検証はしない（送ってみないと分からないため）。 */
function looksLikeEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * 発行フォームの入力を確かめる。
 * 会社名は協力会社へ送るメールの差出人名になるため、空では発行させない。
 */
export function validateIssueAccount(input: {
  orgName: string;
  userName: string;
  email: string;
}): IssueValidation {
  const orgName = input.orgName.trim();
  const userName = input.userName.trim();
  const email = input.email.trim().toLowerCase();

  if (orgName === "") return { ok: false, error: "会社名を入力してください" };
  if (orgName.length > 100) return { ok: false, error: "会社名は100文字以内で入力してください" };
  if (userName === "") return { ok: false, error: "担当者名を入力してください" };
  if (userName.length > 100) return { ok: false, error: "担当者名は100文字以内で入力してください" };
  if (email === "") return { ok: false, error: "メールアドレスを入力してください" };
  if (!looksLikeEmailAddress(email)) return { ok: false, error: "メールアドレスの形で入力してください" };

  return { ok: true, value: { orgName, userName, email } };
}
