// 見積依頼の回答期限の目安。
//
// 【なぜ機械が入れるか】
// 協力会社に「いつまでに返してほしいか」を書かないと、返事が来ないまま提出期限が来る。
// かといって毎回考えるのも手間なので、提出期限から逆算した目安を初期値に入れる。
//
// 【なぜ過去にならないようにするか】
// 以前は「提出期限の3日前」を機械的に入れていた。提出期限が近い案件では
// **その日付が過去になり、切れた期限のまま見積依頼が送られていた**
// （2026-08-31 実機で確認：8/31に送った依頼の回答期限が 8/29 12:00 だった）。
// 協力会社から見ると期限切れの依頼で、まともに扱われない。
//
// 【間に合わないことを隠さない】
// 日が足りないときは、勝手に「大丈夫な日付」を作らず、短くしたことを画面に書く。
// 提出期限が取れていない・過ぎている場合は日付を作らない（CLAUDE.md 最重要の前提5）。

const DAY_MS = 24 * 60 * 60 * 1000;

/** 提出期限の何日前を目安にするか。自社が見積を集めて応札価格を決める時間。 */
export const QUOTE_DUE_LEAD_DAYS = 3;

export type QuoteDueSuggestion = {
  /** datetime-local 用の "YYYY-MM-DDTHH:mm"（日本時間）。入れられなければ null */
  dueAt: string | null;
  /** 画面に出す注意。問題が無ければ null */
  warning: string | null;
};

/** Date を datetime-local の入力欄が読める日本時間の文字列にする。 */
function toJstLocalInput(at: Date): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/**
 * 見積依頼の回答期限の目安を出す。
 *
 * - 提出期限の3日前が未来なら、それを使う
 * - 過去になるなら、いまから提出期限までの真ん中に寄せる
 *   （協力会社が回答する時間と、自社が価格を決める時間を半分ずつ確保する）
 * - 提出期限が取れていない・すでに過ぎている場合は日付を作らない
 */
export function suggestQuoteDueAt(submitDeadline: string | null, now: Date = new Date()): QuoteDueSuggestion {
  if (submitDeadline === null || submitDeadline === "") {
    return { dueAt: null, warning: "提出期限が未確認のため、回答期限を入れていません。公告の原本でご確認ください。" };
  }
  const deadline = Date.parse(submitDeadline);
  if (Number.isNaN(deadline)) {
    return { dueAt: null, warning: "提出期限が未確認のため、回答期限を入れていません。公告の原本でご確認ください。" };
  }

  const remaining = deadline - now.getTime();
  if (remaining <= 0) {
    // 過ぎた案件に見積を頼んでも間に合わない。日付を作らず、そのことを書く
    return { dueAt: null, warning: "提出期限を過ぎています。この案件では見積依頼を出しても間に合いません。" };
  }

  const ideal = deadline - QUOTE_DUE_LEAD_DAYS * DAY_MS;
  if (ideal > now.getTime()) {
    return { dueAt: toJstLocalInput(new Date(ideal)), warning: null };
  }

  // 3日前が過去。いまから提出期限までを半分ずつに割る
  const half = new Date(now.getTime() + Math.floor(remaining / 2));
  const daysLeft = Math.floor(remaining / DAY_MS);
  const base =
    daysLeft >= 1
      ? `提出期限まであと${daysLeft}日しかないため、回答期限を短くしています。`
      : "提出期限まで24時間を切っています。回答期限を短くしています。";
  const reminder =
    remaining < DAY_MS ? "回答期限の24時間前に送る自動催促は動きません。" : "";
  return { dueAt: toJstLocalInput(half), warning: `${base}${reminder}短すぎる場合は手で直してください。` };
}

/**
 * 入力された回答期限が使えるか。**過去の日付で送らせない。**
 *
 * datetime-local の値（"2026-09-05T12:00"）には時間帯が付いていない。
 * そのまま Date.parse するとサーバーの時間帯（UTC）で読まれ、日本時間と9時間ずれる。
 * 保存側（toJstIso）と同じく、時間帯が無ければ日本時間として読む。
 */
export function validateQuoteDueAt(dueAt: string, now: Date = new Date()): string | null {
  const at = parseJstLocal(dueAt);
  if (at === null) return "回答期限を入力してください";
  if (at <= now.getTime()) return "回答期限が過去になっています。今日より後の日時にしてください";
  return null;
}

/** 時間帯の付いていない "YYYY-MM-DDTHH:mm" を日本時間として読む。読めなければ null。 */
function parseJstLocal(value: string): number | null {
  const text = value.trim();
  if (text === "") return null;
  const naive = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text);
  const at = Date.parse(naive ? `${text}${text.length === 16 ? ":00" : ""}+09:00` : text);
  return Number.isNaN(at) ? null : at;
}
