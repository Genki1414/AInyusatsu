// 案件ごとの「参加するかどうか」と、参加を決めたあとの段取り。
//
// 【なぜ段取りを機械が出すか】
// 入札は、期限の違うことを順番にやらないと間に合わない。
// 資料を自社名義で取り、質問があれば質問期限までに出し、協力会社の見積を集め、
// 応札価格を決め、書類をそろえ、提出期限までに出す——どれか1つ遅れると参加できない。
// 「あと何日で、次に何をするか」を1か所に出す。
//
// 【期限は推測しない】
// 期限が取れていない項目は、日付を出さずに「未確認」とする（CLAUDE.md 最重要の前提5）。
// 推測した日付を段取りに載せると、それに合わせて動いてしまう。

import { daysUntilDeadline } from "./deadline";

export const TENDER_STANCES = ["未定", "検討", "保留", "参加", "見送り"] as const;
export type TenderStance = (typeof TENDER_STANCES)[number];

/** 利用者が選べるもの。「未定」は初期値で、選び直して戻ることはできる。 */
export const SELECTABLE_STANCES: readonly TenderStance[] = ["検討", "保留", "参加", "見送り"];

export function isTenderStance(value: string | null | undefined): value is TenderStance {
  return typeof value === "string" && (TENDER_STANCES as readonly string[]).includes(value);
}

/** 一覧の並び順。手を動かすものを先に、終わったものを後ろに。 */
export const STANCE_ORDER: Record<TenderStance, number> = {
  参加: 0,
  検討: 1,
  保留: 2,
  未定: 3,
  見送り: 4,
};

/** その状態の案件を「進行中」として扱うか（今日やること・一覧の既定の絞り込み）。 */
export function isActiveStance(stance: TenderStance): boolean {
  return stance === "参加" || stance === "検討";
}

// ── 参加を決めたあとの段取り ────────────────────────────────

export type RoadmapInput = {
  /** 資料の正式取得（自社名義）。未取得 / 申請中 / 取得済 */
  officialStatus: string;
  /** 見積依頼を1件でも送っているか */
  quoteRequested: boolean;
  /** 協力会社から見積が1件でも返っているか */
  quoteReceived: boolean;
  /** 応札価格を決めたか */
  bidPriceDecided: boolean;
  /** 提出書類がすべて「用意できた」になっているか */
  formsReady: boolean;
  /** 提出済みか（work_status） */
  submitted: boolean;
  /** 質問期限。無ければ null */
  qaDeadline: string | null;
  /** 提出期限。無ければ null */
  submitDeadline: string | null;
  /** 開札日時。無ければ null */
  bidOpenAt: string | null;
};

export type RoadmapStepState = "済" | "いま" | "これから";

export type RoadmapStep = {
  /** 画面に出す短い動詞。「◯◯する」 */
  label: string;
  /** なぜ要るか・気をつけること。1文 */
  note: string;
  state: RoadmapStepState;
  /** この段取りの期限。取れていなければ null（推測しない） */
  deadline: string | null;
  /** 期限までの日数。期限が無ければ null。過ぎていれば負の数 */
  daysLeft: number | null;
};

/**
 * 参加を決めた案件の段取りを組み立てる。
 *
 * 【「いま」は1つだけ】
 * まだ終わっていないもののうち、いちばん手前を「いま」にする。
 * 全部に印を付けると、どれから手を付けるか分からない。
 *
 * 【終わった段取りも消さない】
 * 済んだものを消すと、何をやったか分からなくなる。印を変えて残す。
 */
export function buildRoadmap(input: RoadmapInput, now: Date = new Date()): RoadmapStep[] {
  const steps: Omit<RoadmapStep, "state" | "daysLeft">[] = [
    {
      label: "資料を御社の名義で取得する",
      note: "本部が取得した資料はAIの解析用です。参加するには御社ご自身で入札説明書等を取得してください。",
      deadline: input.qaDeadline ?? input.submitDeadline,
    },
    {
      label: "不明点を質問する",
      note: "質問期限を過ぎると聞けません。仕様に迷いがあれば早めに。",
      deadline: input.qaDeadline,
    },
    {
      label: "協力会社へ見積を依頼する",
      note: "回答を待つ時間が要ります。提出期限の直前に依頼しても間に合いません。",
      deadline: input.submitDeadline,
    },
    {
      label: "見積を集めて応札価格を決める",
      note: "「見積・原価」タブで原価を集計し、応札価格を決めます。",
      deadline: input.submitDeadline,
    },
    {
      label: "提出書類をそろえる",
      note: "「提出書類」タブの一覧を、すべて用意できた状態にします。",
      deadline: input.submitDeadline,
    },
    {
      label: "入札書を提出する",
      note: "提出期限を1分でも過ぎると受け付けられません。",
      deadline: input.submitDeadline,
    },
    {
      label: "開札",
      note: "結果を確認します。",
      deadline: input.bidOpenAt,
    },
  ];

  const done = [
    input.officialStatus === "取得済",
    // 質問は「しないで進む」ことがある。資料が取れていれば済んだものとして扱い、
    // 期限だけ見せる（質問しなかったことを未完了として残さない）
    input.officialStatus === "取得済",
    input.quoteRequested,
    input.bidPriceDecided,
    input.formsReady,
    input.submitted,
    // 開札は待つだけ。こちらから終わらせるものではない
    false,
  ];

  const firstUndone = done.findIndex((d) => !d);

  return steps.map((step, i) => ({
    ...step,
    state: done[i] ? "済" : i === firstUndone ? "いま" : "これから",
    daysLeft: daysUntilDeadline(step.deadline, now),
  }));
}

/**
 * 段取りのうち、いま手を付けるもの。無ければ null（全部終わっている）。
 * 一覧や「今日やること」に1行で出すのに使う。
 */
export function currentStep(steps: RoadmapStep[]): RoadmapStep | null {
  return steps.find((s) => s.state === "いま") ?? null;
}

// ── 入札の結果 ──────────────────────────────────────────────
//
// 【なぜ利用者が入れるか】
// 開札の結果は発注機関が公表するが、形も時期も機関ごとにばらばらで自動では拾えない。
// 落札実績オープンデータは月次で、案件との突き合わせも名称頼りなので、
// 「この案件で自社が落札したか」は分からない。
// **取れないものを取れたことにしない**（CLAUDE.md 最重要の前提7）。

export const BID_RESULTS = ["未入力", "落札", "落札できず", "辞退", "中止"] as const;
export type BidResult = (typeof BID_RESULTS)[number];

/** 利用者が選べるもの。「未入力」は初期値。 */
export const SELECTABLE_BID_RESULTS: readonly BidResult[] = ["落札", "落札できず", "辞退", "中止"];

export function isBidResult(value: string | null | undefined): value is BidResult {
  return typeof value === "string" && (BID_RESULTS as readonly string[]).includes(value);
}

/**
 * 金額の入力欄に出すラベル。結果によって、誰の金額かが変わる。
 * どちらも「その案件がいくらで決まったか」で、次の応札価格を決める材料は同じ。
 */
export function amountLabel(result: BidResult): string | null {
  if (result === "落札") return "落札金額（御社）";
  if (result === "落札できず") return "落札金額（他社。分かれば）";
  // 辞退・中止では、決まった金額が無いか、入れる意味がない
  return null;
}

/** 金額を入れられる結果か。 */
export function acceptsAmount(result: BidResult): boolean {
  return amountLabel(result) !== null;
}

/**
 * 結果を入れる段階か。
 *
 * 開札の日時が分かっていれば、その日を過ぎてから。分からなければ提出期限で代える。
 * **どちらも取れていなければ、いつでも入れられるようにする**（推測で止めない）。
 */
export function canEnterResult(
  input: { bidOpenAt: string | null; submitDeadline: string | null },
  now: Date = new Date(),
): boolean {
  const at = input.bidOpenAt ?? input.submitDeadline;
  if (at === null) return true;
  const days = daysUntilDeadline(at, now);
  return days === null || days <= 0;
}

/** 結果を入れ終わった案件か（一覧で「落札案件」として出す判定に使う）。 */
export function isWon(result: string | null | undefined): boolean {
  return result === "落札";
}
