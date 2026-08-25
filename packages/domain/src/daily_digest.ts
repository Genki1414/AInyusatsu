// 毎朝1通のダイジェスト（タスク3-2 notify）の純ロジック。
// 参照：docs/実装仕様書_v1.md §8「毎朝1通のダイジェスト（新着提案・今日の期限・未回答の見積）」
//       同 §5「notify：match直後／1日1通にまとめる（案件ごとに送らない）」
//
// 【なぜ必要か】
// 提案（proposals）は作られていたが、誰にも知らされていなかった。
// 毎日ログインしてもらう前提の設計になっており、期限が近い案件を見落とす。
//
// 【1通にまとめる】
// 案件ごとに送ると、1日に何通も届いて読まれなくなる。1日1通だけにする。
//
// 【次にやることは1つだけ】
// 仕様書 §8「通知は「次にやること」を1つだけ書く。複数書くと読まれない」。
// 一覧は参考として下に置き、先頭には行動を1つだけ書く。
//
// 【空のメールは送らない】
// 知らせることが何も無い日に「本日は何もありません」を送ると、読まなくなる。
// 読まれなくなった通知は、本当に急ぎのときにも効かない。

import { dateOnly } from "./dedupe";

/** 「期限が近い」とみなす残り日数。今日を0日として数える。 */
export const URGENT_DEADLINE_DAYS = 3;

/** 一覧に載せる上限。これを超えるぶんは件数だけ示す（長いメールは読まれない）。 */
export const DIGEST_LIST_LIMIT = 5;

export type DeadlineKind = "質問期限" | "提出期限" | "開札";

export type DigestDeadline = {
  tenderId: string;
  tenderName: string;
  kind: DeadlineKind;
  /** timestamptz。null は「取れていない」なので載せない（推測しない） */
  at: string | null;
};

export type DigestProposal = {
  tenderId: string;
  tenderName: string;
  score: number;
  submitDeadline: string | null;
};

export type DigestWaitingQuote = {
  tenderId: string;
  tenderName: string;
  trade: string;
  partnerName: string;
  dueAt: string | null;
};

export type DigestInput = {
  orgName: string;
  /** まだ配信していない提案（対象外は含めない） */
  newProposals: DigestProposal[];
  deadlines: DigestDeadline[];
  waitingQuotes: DigestWaitingQuote[];
  /** 案件へのリンクの土台（例：https://example.com） */
  appUrl: string;
};

/** 期限に残り日数を付けたもの。過ぎたものと、期限が取れていないものは含まれない。 */
export type DatedDeadline = DigestDeadline & { at: string; daysLeft: number };

export type DigestNextAction = {
  /** 何をするか。1つだけ書く */
  label: string;
  tenderName: string;
  url: string;
};

export type DailyDigest = {
  /** 送るかどうか。知らせることが無ければ送らない */
  send: boolean;
  /** 送らない理由（ログに残す用） */
  skipReason: string | null;
  nextAction: DigestNextAction | null;
  newProposals: DigestProposal[];
  urgentDeadlines: DatedDeadline[];
  waitingQuotes: DigestWaitingQuote[];
};

/**
 * JSTの日付で数えた残り日数。今日なら0、明日なら1。
 * 読めない値は null（推測しない。期限の誤りは失格に直結する）。
 */
export function daysLeftJst(at: string | null, now: Date): number | null {
  const target = dateOnly(at);
  const today = dateOnly(now);
  if (target === null || today === null) return null;
  return Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** JSTの「M/D」表記。読めなければ null。 */
export function formatJstDate(at: string | null): string | null {
  const iso = dateOnly(at);
  if (iso === null) return null;
  const [, month, day] = iso.split("-");
  return `${Number(month)}/${Number(day)}`;
}

/** 期限が近い順に並べる。過ぎたもの・取れていないものは落とす。 */
export function urgentDeadlines(deadlines: DigestDeadline[], now: Date): DatedDeadline[] {
  const dated: DatedDeadline[] = [];
  for (const deadline of deadlines) {
    if (deadline.at === null) continue;
    const daysLeft = daysLeftJst(deadline.at, now);
    // 期限が取れていない案件は載せない（「無い」ことと「近くない」ことを混ぜない）
    if (daysLeft === null) continue;
    // 過ぎたものは載せない。今から間に合わないものを並べても行動につながらない
    if (daysLeft < 0 || daysLeft > URGENT_DEADLINE_DAYS) continue;
    dated.push({ ...deadline, at: deadline.at, daysLeft });
  }
  return dated.sort((a, b) => a.daysLeft - b.daysLeft || a.tenderName.localeCompare(b.tenderName, "ja"));
}

function tenderUrl(appUrl: string, tenderId: string, tab: string): string {
  return `${appUrl.replace(/\/+$/, "")}/tenders/${tenderId}?tab=${tab}`;
}

/**
 * 次にやることを1つだけ決める。
 *
 * 失格に直結するものから順に見る。提出期限 → 質問期限 → 新着提案 → 未回答の見積。
 * どれも無ければ null（送らない）。
 */
export function pickNextAction(digest: Omit<DailyDigest, "send" | "skipReason" | "nextAction">, appUrl: string): DigestNextAction | null {
  const submit = digest.urgentDeadlines.find((d) => d.kind === "提出期限");
  if (submit) {
    return { label: "提出書類をそろえる", tenderName: submit.tenderName, url: tenderUrl(appUrl, submit.tenderId, "forms") };
  }

  const qa = digest.urgentDeadlines.find((d) => d.kind === "質問期限");
  if (qa) {
    return { label: "質問の要否を決める", tenderName: qa.tenderName, url: tenderUrl(appUrl, qa.tenderId, "analysis") };
  }

  const best = [...digest.newProposals].sort((a, b) => b.score - a.score)[0];
  if (best) {
    return { label: "参加するか決める", tenderName: best.tenderName, url: tenderUrl(appUrl, best.tenderId, "fit") };
  }

  const waiting = digest.waitingQuotes[0];
  if (waiting) {
    return { label: "見積の回答状況を確かめる", tenderName: waiting.tenderName, url: tenderUrl(appUrl, waiting.tenderId, "sent") };
  }

  const opening = digest.urgentDeadlines[0];
  if (opening) {
    return { label: "案件を開く", tenderName: opening.tenderName, url: tenderUrl(appUrl, opening.tenderId, "fit") };
  }
  return null;
}

/** 送る内容を組み立てる。知らせることが無ければ send: false。 */
export function buildDailyDigest(input: DigestInput, now: Date): DailyDigest {
  const body = {
    newProposals: [...input.newProposals].sort((a, b) => b.score - a.score),
    urgentDeadlines: urgentDeadlines(input.deadlines, now),
    waitingQuotes: input.waitingQuotes,
  };

  const nextAction = pickNextAction(body, input.appUrl);
  if (nextAction === null) {
    // 何も無い日に「本日は何もありません」を送ると読まれなくなる
    return { send: false, skipReason: "知らせることがありません", nextAction: null, ...body };
  }
  return { send: true, skipReason: null, nextAction, ...body };
}

export type DigestEmail = { subject: string; text: string };

/** 件名。開く前に「自分に関係があるか」が分かるようにする。 */
export function buildDigestSubject(digest: DailyDigest): string {
  const parts: string[] = [];
  if (digest.newProposals.length > 0) parts.push(`新着の提案${digest.newProposals.length}件`);
  if (digest.urgentDeadlines.length > 0) parts.push(`${URGENT_DEADLINE_DAYS}日以内の期限${digest.urgentDeadlines.length}件`);
  if (parts.length === 0 && digest.waitingQuotes.length > 0) parts.push(`未回答の見積${digest.waitingQuotes.length}件`);
  return `【AI入札部】${parts.join("／")}`;
}

function listWithLimit(lines: string[]): string[] {
  if (lines.length <= DIGEST_LIST_LIMIT) return lines;
  const shown = lines.slice(0, DIGEST_LIST_LIMIT);
  shown.push(`ほか${lines.length - DIGEST_LIST_LIMIT}件`);
  return shown;
}

function withDeadline(name: string, submitDeadline: string | null): string {
  const date = formatJstDate(submitDeadline);
  return date === null ? `${name}（提出期限は未確認）` : `${name}（提出期限 ${date}）`;
}

/** ダイジェストのメール本文。先頭に「次にやること」を1つだけ置く。 */
export function buildDigestEmail(digest: DailyDigest, input: { orgName: string; appUrl: string }): DigestEmail {
  if (!digest.send || digest.nextAction === null) {
    throw new Error("送る内容がないダイジェストのメールは作れません");
  }

  const lines: string[] = [`${input.orgName} ご担当者さま`, "", "本日お知らせすることをまとめました。", ""];

  lines.push("■ 次にやること");
  lines.push(`  ${digest.nextAction.label}`);
  lines.push(`  ${digest.nextAction.tenderName}`);
  lines.push(`  ${digest.nextAction.url}`);

  if (digest.newProposals.length > 0) {
    lines.push("", `■ 新着の提案（${digest.newProposals.length}件）`);
    for (const line of listWithLimit(digest.newProposals.map((p) => `  ・${withDeadline(p.tenderName, p.submitDeadline)} 適合度${p.score}`))) {
      lines.push(line);
    }
  }

  if (digest.urgentDeadlines.length > 0) {
    lines.push("", `■ ${URGENT_DEADLINE_DAYS}日以内の期限（${digest.urgentDeadlines.length}件）`);
    for (const line of listWithLimit(
      digest.urgentDeadlines.map((d) => `  ・${d.tenderName} ${d.kind} ${formatJstDate(d.at)}（${d.daysLeft === 0 ? "本日" : `あと${d.daysLeft}日`}）`),
    )) {
      lines.push(line);
    }
  }

  if (digest.waitingQuotes.length > 0) {
    lines.push("", `■ 未回答の見積（${digest.waitingQuotes.length}件）`);
    for (const line of listWithLimit(
      digest.waitingQuotes.map((q) => {
        const due = formatJstDate(q.dueAt);
        return `  ・${q.tenderName} ${q.trade} ${q.partnerName}${due === null ? "" : `（回答期限 ${due}）`}`;
      }),
    )) {
      lines.push(line);
    }
    lines.push("  ※ 回答期限の24時間前になると、未回答の会社へ自動で催促します。");
  }

  lines.push("", "--", "AI入札部", input.appUrl.replace(/\/+$/, ""));

  return { subject: buildDigestSubject(digest), text: lines.join("\n") };
}
