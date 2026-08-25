// メール送信の唯一の呼び出し口（CLAUDE.md「外部サービスはpackages/*/adaptersのみで呼ぶ」）。
// 参照：docs/ClaudeCode_実装指示書.md（環境変数一覧 RESEND_API_KEY）
//
// 【スコープ】タスク4-1時点ではLINE連携を行わない（協力会社への送信はメールのみ）。
// 理由：CLAUDE.md「LINE連携はユーザー企業のアカウントで行う（当社アカウントから
// 一斉送信しない）」の方針上、LINE公式アカウントは組織ごとに別チャンネルが必要になり、
// 現時点ではその設定画面・保存先（org単位の認証情報）が無い。メールのみで先に動かし、
// LINE対応は別タスクで組織ごとのチャンネル設定と合わせて追加する。
import { Resend } from "resend";

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  /**
   * 差出人。表示名は依頼元の顧客企業、実アドレスはサービスのもの
   * （packages/domain の buildFromHeader が組み立てる）。
   * 省略した場合はサービスのアドレスだけで送る。
   */
  from?: string;
  /**
   * 返信先。協力会社が返信したときに顧客企業へ届くようにする。
   * 複数指定すると、協力会社が「返信」を1回押すだけで全員に届く
   * （顧客企業と、見積ごとの受信アドレスの両方に届かせるために使う）。
   */
  replyTo?: string | string[] | null;
};

export type SendEmailResult = { id: string };

let client: Resend | null = null;

function getClient(): Resend {
  if (client) return client;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY が設定されていません（.envを確認してください）");
  }
  client = new Resend(apiKey);
  return client;
}

/**
 * サービスの送信元アドレス。認証済みドメインのアドレスを1つだけ持つ。
 * 顧客企業ごとの違いは、表示名（from）と返信先（replyTo）で表す。
 * 未設定のときはResendのサンドボックスを使う（自分宛にしか届かない）。
 */
export function serviceFromAddress(): string {
  return process.env.RESEND_FROM_ADDRESS ?? "onboarding@resend.dev";
}

/**
 * 返信を受け取るドメイン。Resendの受信（Enable Receiving）を有効にしたドメインを入れる。
 *
 * **未設定なら見積ごとの受信アドレスを返信先に入れない。**
 * 受信できない状態のアドレスを返信先にすると、協力会社が返信したときに
 * 「配信できませんでした」というエラーが返ってしまうため、明示的に指定されたときだけ使う。
 */
export function inboundEmailDomain(): string | null {
  const domain = process.env.INBOUND_EMAIL_DOMAIN?.trim();
  return domain ? domain : null;
}

/** 空の配列や空文字を渡さない（Resendが空の返信先を受け取ると失敗する）。 */
function replyToOrUndefined(value: string | string[] | null | undefined): string | string[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const list = value.filter((v) => v.trim() !== "");
    return list.length > 0 ? list : undefined;
  }
  return value.trim() === "" ? undefined : value;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const { data, error } = await getClient().emails.send({
    from: input.from ?? serviceFromAddress(),
    to: input.to,
    subject: input.subject,
    text: input.text,
    ...(replyToOrUndefined(input.replyTo) ? { replyTo: replyToOrUndefined(input.replyTo)! } : {}),
  });
  if (error) {
    throw new Error(`メール送信に失敗しました（${input.to}）: ${error.message}`);
  }
  if (!data) {
    throw new Error(`メール送信に失敗しました（${input.to}）: 応答が空です`);
  }
  return { id: data.id };
}
