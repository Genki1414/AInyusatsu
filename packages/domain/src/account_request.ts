// アカウント追加の依頼まわりの純ロジック。
//
// 【なぜ顧客が自分で発行できないか】
// 追加するたびに月5,000円が発生する（docs/reference/価格.md）。
// 請求書払いなので、料金が増える操作を顧客が自分で完了できてはいけない。
// 顧客は依頼を出すだけ、発行するのは本部。
//
// 【人数と請求額を必ず両方の画面に出す】
// 価格.md にこう書いてある。
//   「気づかないうちに人数が増えて請求が上がるのがいちばん困る」
// 依頼のフォームにも、本部の一覧にも、発行したらいくらになるかを出す。

export const ACCOUNT_REQUEST_STATUSES = ["依頼中", "発行済み", "取り下げ"] as const;
export type AccountRequestStatus = (typeof ACCOUNT_REQUEST_STATUSES)[number];

/** 基本プランに含まれるログイン数。これを超えたぶんが追加料金になる。 */
export const INCLUDED_LOGINS = 1;

/** 追加ログイン1つあたりの月額（円）。金額は整数で持つ（CLAUDE.md）。 */
export const ADDITIONAL_LOGIN_MONTHLY_YEN = 5000;

/**
 * いまのログイン数から、追加ぶんの月額を出す。
 * 基本プランの1つは無料なので、超えたぶんだけ数える。
 */
export function additionalLoginMonthlyYen(loginCount: number): number {
  const extra = Math.max(0, loginCount - INCLUDED_LOGINS);
  return extra * ADDITIONAL_LOGIN_MONTHLY_YEN;
}

export type AccountRequestInput = { name: string; email: string; note: string };
export type AccountRequestValidation =
  | { ok: true; value: { name: string; email: string; note: string | null } }
  | { ok: false; error: string };

/** メールアドレスの形。ログインIDになるので、ここで弾いておく。 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 依頼のメモが長すぎると本部の一覧が読めなくなる。 */
export const NOTE_MAX_LENGTH = 200;

export function validateAccountRequest(input: AccountRequestInput): AccountRequestValidation {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const note = input.note.trim();

  if (name === "") return { ok: false, error: "追加する方のお名前を入力してください" };
  if (email === "") return { ok: false, error: "メールアドレスを入力してください" };
  if (!EMAIL.test(email)) return { ok: false, error: "メールアドレスの形で入力してください" };
  if (note.length > NOTE_MAX_LENGTH) {
    return { ok: false, error: `備考は${NOTE_MAX_LENGTH}文字までにしてください` };
  }

  return { ok: true, value: { name, email, note: note === "" ? null : note } };
}

export type ExistingLogin = { email: string };

/**
 * すでにログインがあるアドレスか。
 *
 * 同じアドレスで2つ目を作ろうとすると Supabase 側で失敗する。
 * 依頼の時点で気づけるようにして、本部が発行して初めて分かる、を避ける。
 */
export function isAlreadyRegistered(logins: ExistingLogin[], email: string): boolean {
  const target = email.trim().toLowerCase();
  return logins.some((login) => login.email.trim().toLowerCase() === target);
}

/**
 * 依頼を承ったときに顧客へ出す文言。
 *
 * **いくら増えるかを必ず書く。** 依頼した本人が金額を知らないまま
 * 請求書を受け取るのが、いちばん困る。
 */
export function requestAcceptedMessage(name: string, loginCountAfter: number): string {
  const after = additionalLoginMonthlyYen(loginCountAfter);
  return (
    `${name} さまのアカウント追加を承りました。本部が発行しだい、初期パスワードをお伝えします。` +
    `発行後の追加料金は月 ${after.toLocaleString("ja-JP")}円（ログイン ${loginCountAfter}つ）になります。`
  );
}
