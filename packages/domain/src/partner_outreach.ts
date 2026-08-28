// 協力会社がいない業種の「開拓の打診文」を組み立てる（9月分：協力会社開拓）。
//
// 【見積依頼とは別のもの】
// buildQuoteRequestEmail は、すでに取引のある協力会社へ「この案件の見積をください」と
// 送るもの。こちらは、まだ関係の無い会社へ「こういう案件を扱っています。
// お取引いただけませんか」と打診するもの。相手が違うので、書く内容も違う。
//
// 【回答ページのURLを入れない】
// 見積依頼のメールには署名付きの回答ページURLが入る。それは依頼先を決めた相手に
// 出すもので、面識の無い会社に配ってよいものではない。ここでは絶対に入れない。
//
// 【数量表の中身を入れない】
// 数量表は本部が取得した資料をAIが解析した結果。まだ関係の無い会社に細かく渡す理由が
// 無く、量も多い。公告元のURLを載せて、相手が自分で公告を見られるようにする
// （CLAUDE.md 最重要の前提4「原本は配らない。解析結果と引用、公告元URLのみ」の考え方に合わせる）。
//
// 【AIを使わない】
// 書く内容は案件の事実（案件名・発注機関・履行場所・履行期間・業種）と定型の依頼文だけ。
// AIに書かせると、案件ごとに費用がかかるうえ、書いていないことを足す余地が生まれる。
// 相手ごとの言い回しの調整は、送信側（営業AI）のパーソナライズが担う。

export type OutreachInput = {
  /** 差出人（顧客企業）の会社名 */
  senderOrgName: string;
  /** 差出人の担当者名 */
  senderContactName: string;
  /** 返信先。無ければ本文に載せない */
  senderContactEmail: string | null;
  /** 探している業種 */
  trade: string;
  tenderName: string;
  agencyName: string | null;
  place: string | null;
  /** 履行期間。片方だけでも載せる */
  termFrom: string | null;
  termTo: string | null;
  /** いつまでに返事がほしいか。表示用の文字列（例：2026年9月10日） */
  replyByLabel: string | null;
  /** 公告元のURL。相手が自分で内容を確認できるようにする */
  sourceUrl: string | null;
};

export type OutreachMessage = { subject: string; body: string };

/** 値のある行だけを残す。「不明」と書かない（推測しない・埋めない）。 */
function lines(rows: (string | null)[]): string[] {
  return rows.filter((row): row is string => row !== null);
}

function term(from: string | null, to: string | null): string | null {
  if (from && to) return `履行期間：${from} 〜 ${to}`;
  if (from) return `履行期間：${from} から`;
  if (to) return `履行期間：${to} まで`;
  return null;
}

/**
 * 打診文を組み立てる。
 * 送信側（営業AI）の件名・本文にそのまま入れられる形にする。
 */
export function buildOutreachMessage(input: OutreachInput): OutreachMessage {
  const subject = `【お取引のご相談】${input.trade}の見積をお願いできる会社を探しております（${input.senderOrgName}）`;

  const facts = lines([
    `案件名：${input.tenderName}`,
    input.agencyName ? `発注機関：${input.agencyName}` : null,
    input.place ? `履行場所：${input.place}` : null,
    term(input.termFrom, input.termTo),
    `お願いしたい業種：${input.trade}`,
    input.sourceUrl ? `公告：${input.sourceUrl}` : null,
  ]);

  const closing = lines([
    input.replyByLabel
      ? `恐れ入りますが、${input.replyByLabel}までにご返信いただけますと幸いです。`
      : "ご返信をお待ちしております。",
    "",
    `${input.senderOrgName}`,
    `${input.senderContactName}`,
    input.senderContactEmail,
  ]);

  const body = [
    "突然のご連絡失礼いたします。",
    `${input.senderOrgName}の${input.senderContactName}と申します。`,
    "",
    "官公庁の入札案件に参加しており、下記の案件で",
    `${input.trade}をお願いできる協力会社を探しております。`,
    "",
    ...facts,
    "",
    "まずはお見積のご相談から、お取引の可否をご検討いただけないでしょうか。",
    "詳しい仕様は公告および入札説明書に記載がございます。",
    "",
    ...closing,
  ].join("\n");

  return { subject, body };
}
