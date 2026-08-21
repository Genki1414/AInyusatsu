// 見積依頼の自動催促（タスク4-4）の純ロジック。
// 回答期限の24時間前になっても未回答の協力会社へ、1回だけ催促を送る。
// 送信そのものは apps/worker/jobs/remind_quotes.ts が行う（ここは副作用を持たない）。

/** 催促を送る、回答期限までの残り時間（ミリ秒）。 */
export const REMIND_BEFORE_MS = 24 * 60 * 60 * 1000;

/** 催促の判定に必要な見積の状態。DBの列名に合わせている。 */
export type RemindableQuote = {
  /** 回答済みなら日時が入る */
  repliedAt: string | null;
  /** 「今回は見送る」を選んだ */
  declined: boolean;
  /** 催促済みなら日時が入る（1回だけ送るための記録） */
  remindedAt: string | null;
  /** 依頼の回答期限。未設定なら催促しない */
  dueAt: string | null;
  /** 送信先。未登録なら催促しない */
  partnerEmail: string | null;
};

export type SkipReason =
  | "回答済み"
  | "見送り済み"
  | "催促済み"
  | "回答期限が未設定"
  | "メールアドレスが未登録"
  | "回答期限まで24時間以上ある"
  | "回答期限を過ぎている";

export type RemindDecision = { remind: true } | { remind: false; reason: SkipReason };

/**
 * 催促を送るかどうかを判定する。
 *
 * 期限を過ぎたものは送らない。今から間に合わない催促は、協力会社に手間をかけるだけで
 * 何も生まないため（依頼元が期限を延ばす判断をするのが先）。
 * 催促は1回だけにする。繰り返し送ると迷惑メール扱いになり、本来の依頼まで届かなくなる。
 */
export function shouldRemind(quote: RemindableQuote, now: Date): RemindDecision {
  if (quote.repliedAt) return { remind: false, reason: "回答済み" };
  if (quote.declined) return { remind: false, reason: "見送り済み" };
  if (quote.remindedAt) return { remind: false, reason: "催促済み" };
  if (!quote.dueAt) return { remind: false, reason: "回答期限が未設定" };
  if (!quote.partnerEmail) return { remind: false, reason: "メールアドレスが未登録" };

  const due = new Date(quote.dueAt);
  if (Number.isNaN(due.getTime())) return { remind: false, reason: "回答期限が未設定" };

  const remaining = due.getTime() - now.getTime();
  if (remaining <= 0) return { remind: false, reason: "回答期限を過ぎている" };
  if (remaining > REMIND_BEFORE_MS) return { remind: false, reason: "回答期限まで24時間以上ある" };
  return { remind: true };
}

export type QuoteReminderEmailInput = {
  partnerName: string;
  senderOrgName: string;
  senderContactEmail: string | null; // 協力会社が返信できる連絡先。無ければ署名から省く
  tenderName: string;
  trade: string;
  dueAtLabel: string; // 表示用に整形済み（timezone変換は呼び出し側の責務）
  responseUrl: string;
};

/**
 * 催促メールの件名・本文。
 * 催促であることが件名で分かるようにしつつ、見送りも同じフォームから返せることを明記する
 * （返事をしにくくして無回答が増えるのを避けるため）。
 */
export function buildQuoteReminderEmail(input: QuoteReminderEmailInput): { subject: string; body: string } {
  const lines: string[] = [
    `${input.partnerName} 様`,
    "",
    "お世話になっております。",
    `${input.senderOrgName}でございます。`,
    "",
    `先日お送りした「${input.tenderName}」（${input.trade}）のお見積りの件、`,
    `回答期限が${input.dueAtLabel}に迫っております。`,
    "",
    "下記の専用フォームから、資料のご請求または見送りのご連絡をお願いいたします。",
    input.responseUrl,
    "",
    "お忙しいところ恐れ入りますが、ご都合が合わない場合も上記フォームから「今回は見送る」をお選びください。",
    "行き違いで既にご対応いただいておりましたら、何卒ご容赦ください。",
    "",
    "--",
    input.senderOrgName,
  ];
  if (input.senderContactEmail) lines.push(input.senderContactEmail);
  return { subject: `【再送】お見積りのご依頼（${input.tenderName}）`, body: lines.join("\n") };
}
