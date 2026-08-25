// 即時通知（タスク3-2 notify）の純ロジック。
// 参照：docs/実装仕様書_v1.md §8「即時通知は3つだけ：質問期限48時間前、提出期限48時間前、見積の返信受信」
//
// 【なぜ3つだけか】
// 毎朝のダイジェストで足りるものを即時に送ると、通知が多すぎて読まれなくなる。
// 「読まれない通知は、本当に急ぎのときにも効かない」ため、種類を増やさない。
// 逆に、この3つはダイジェストを待つと手遅れになりうる：
//   - 質問期限・提出期限：過ぎたら参加できない（CLAUDE.md 最重要の前提5）
//   - 見積の返信：応札価格を決める材料。届いたことに気づかないと商談が止まる
//
// 【1件につき1回だけ】
// 送ったかどうかは notification_log の dedupe_key で覚える。
// 毎時走るジョブなので、記録が無いと同じ通知が48時間ぶん繰り返し飛ぶ。

import { dateOnly } from "./dedupe";

/** 期限の何時間前に知らせるか。 */
export const INSTANT_NOTICE_BEFORE_MS = 48 * 60 * 60 * 1000;

export type DeadlineNoticeKind = "質問期限" | "提出期限";

export type DeadlineCandidate = {
  tenderId: string;
  tenderName: string;
  kind: DeadlineNoticeKind;
  /** timestamptz。null は「取れていない」なので知らせない（推測しない） */
  at: string | null;
  /** 案件の状態。終了した案件には送らない */
  collectStatus: string;
};

export type DeadlineNotice = DeadlineCandidate & { at: string; hoursLeft: number };

/**
 * 期限が48時間を切ったものを返す。
 *
 * 過ぎたものは送らない（今から間に合わない通知は不安を与えるだけで何も生まない）。
 * 期限が取れていない案件も送らない。「無い」ことと「まだ先」を混ぜない。
 */
export function dueDeadlineNotices(candidates: DeadlineCandidate[], now: Date): DeadlineNotice[] {
  const due: DeadlineNotice[] = [];
  for (const candidate of candidates) {
    if (candidate.collectStatus === "終了") continue;
    if (candidate.at === null) continue;

    const at = Date.parse(candidate.at);
    if (Number.isNaN(at)) continue;

    const remaining = at - now.getTime();
    if (remaining <= 0) continue;
    if (remaining > INSTANT_NOTICE_BEFORE_MS) continue;

    due.push({ ...candidate, at: candidate.at, hoursLeft: Math.floor(remaining / 3_600_000) });
  }
  return due.sort((a, b) => a.hoursLeft - b.hoursLeft);
}

/** 送ったことを覚えるための鍵。1つの期限につき1回だけ送るために使う。 */
export function deadlineDedupeKey(kind: DeadlineNoticeKind, tenderId: string): string {
  return `${kind}48h:${tenderId}`;
}

/** 見積の返信を知らせたことを覚えるための鍵。受信メッセージ1件につき1回。 */
export function quoteReplyDedupeKey(inboundMessageId: string): string {
  return `見積の返信:${inboundMessageId}`;
}

/** 毎朝のダイジェストの鍵。1日1通を守るために使う。 */
export function digestDedupeKey(dateIso: string): string {
  return `daily_digest:${dateIso}`;
}

/** JSTの「M/D HH:MM」表記。読めなければ null。 */
export function formatJstDateTime(at: string | null): string | null {
  if (at === null) return null;
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return null;
  const date = dateOnly(at);
  if (date === null) return null;
  const [, month, day] = date.split("-");
  const jst = new Date(parsed.getTime() + 9 * 60 * 60 * 1000);
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${Number(month)}/${Number(day)} ${hh}:${mm}`;
}

export type NoticeEmail = { subject: string; text: string };

function tenderUrl(appUrl: string, tenderId: string, tab: string): string {
  return `${appUrl.replace(/\/+$/, "")}/tenders/${tenderId}?tab=${tab}`;
}

function signature(appUrl: string): string[] {
  return ["", "--", "AI入札部", appUrl.replace(/\/+$/, "")];
}

/**
 * 期限が近いことを知らせるメール。
 * 仕様書 §8「次にやることを1つだけ書く」。何をすればよいかを先頭に置く。
 */
export function buildDeadlineNoticeEmail(
  notice: DeadlineNotice,
  input: { orgName: string; appUrl: string },
): NoticeEmail {
  // 質問は「出すかどうか」を決める段階、提出は「そろえる」段階。見る画面も違う
  const isSubmit = notice.kind === "提出期限";
  const action = isSubmit ? "提出書類をそろえる" : "質問の要否を決める";
  const tab = isSubmit ? "forms" : "analysis";
  const at = formatJstDateTime(notice.at);

  const text = [
    `${input.orgName} ご担当者さま`,
    "",
    `${notice.tenderName} の${notice.kind}が近づいています。`,
    "",
    "■ 次にやること",
    `  ${action}`,
    `  ${tenderUrl(input.appUrl, notice.tenderId, tab)}`,
    "",
    `${notice.kind}：${at ?? "（表示できません）"}（あと${notice.hoursLeft}時間）`,
    ...signature(input.appUrl),
  ].join("\n");

  return { subject: `【AI入札部】${notice.kind}まで48時間を切りました：${notice.tenderName}`, text };
}

export type QuoteReplyNotice = {
  tenderId: string;
  tenderName: string;
  trade: string;
  partnerName: string;
  /** 本文から読めた金額の候補。読めなければ null（推測で入れない） */
  parsedAmount: number | null;
  /** 添付として保存できた見積書のファイル名 */
  attachmentNames: string[];
};

/**
 * 見積の返信が届いたことを知らせるメール。
 *
 * 金額は「候補」であって確定ではない。取り込みは画面で人が押す（実装仕様書 §4.4）ので、
 * メールでも確定した金額のように書かない。
 */
export function buildQuoteReplyNoticeEmail(
  notice: QuoteReplyNotice,
  input: { orgName: string; appUrl: string },
): NoticeEmail {
  const lines = [
    `${input.orgName} ご担当者さま`,
    "",
    `${notice.partnerName} から見積の返信が届きました。`,
    "",
    "■ 次にやること",
    "  金額を確かめて取り込む",
    `  ${tenderUrl(input.appUrl, notice.tenderId, "cost")}`,
    "",
    `案件：${notice.tenderName}`,
    `業種：${notice.trade}`,
  ];

  if (notice.attachmentNames.length > 0) {
    lines.push(`見積書：${notice.attachmentNames.join("、")}`);
  }
  if (notice.parsedAmount !== null) {
    // 「候補」であることを必ず書く。読み違えたまま応札価格に入ると取り返しがつかない
    lines.push(`本文から読めた金額（候補）：${notice.parsedAmount.toLocaleString("ja-JP")}円`);
  }
  lines.push("", "金額は自動で入れていません。見積書を確認して画面で入力してください。");
  lines.push(...signature(input.appUrl));

  return { subject: `【AI入札部】${notice.partnerName}から見積の返信が届きました`, text: lines.join("\n") };
}
