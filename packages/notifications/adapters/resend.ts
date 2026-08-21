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

/** 送信元アドレス。Resendのサンドボックスドメインを既定値にする（本番運用時は要変更）。 */
function fromAddress(): string {
  return process.env.RESEND_FROM_ADDRESS ?? "onboarding@resend.dev";
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const { data, error } = await getClient().emails.send({
    from: fromAddress(),
    to: input.to,
    subject: input.subject,
    text: input.text,
  });
  if (error) {
    throw new Error(`メール送信に失敗しました（${input.to}）: ${error.message}`);
  }
  if (!data) {
    throw new Error(`メール送信に失敗しました（${input.to}）: 応答が空です`);
  }
  return { id: data.id };
}
