// ゴールドセットでAI解析の精度を測る（タスク2-6）。
// 参照：docs/ClaudeCode_実装指示書.md §4「ゴールドセット20件で測定／
//       期限100%、参加資格95%、業種F1 0.85」
//
// 【なぜ必要か】
// 解析にはお金がかかる（実測 約69円/件・全体で月20万円規模）。
// 精度を測らずに本番で回すと、間違った期限で提案し続けることになる。
// 期限の誤りは失格に直結する（CLAUDE.md 最重要の前提5）ので、
// ここだけは「だいたい合っている」では済まない。
//
// 【全部を手で書かせない】
// 20件×8項目を人が書き写すのは現実的でない。解析結果には項目ごとに
// 引用と出典が付いている（CLAUDE.md 最重要の前提3）ので、それを読んで
// 「合っている／違う」を判断してもらう。合っていれば何も書かなくてよい。
//
//   checked   … 人が確認した項目（合っていたものも含む）
//   expected  … AIが間違えていた項目の、正しい値
//
// checked に入っていて expected に書かれていない項目は「人が見て合っていた」。
// checked に入っていない項目は測らない。
//
// 【確認していないものを正解に数えない】
// checked を空のままにすると、その案件は1項目も測らない。
// 「見ていないが多分合っている」を正解に数えると、数字が意味を失う。
//
// 【「値が無い」と「未記入」を分ける】
// 期限が公告に書かれていない案件では、正解は null（取れないのが正しい）。
// これは「まだ埋めていない」とは違う。前者は測る、後者は測らない。
// 混ぜると、取れなくて正しい案件を誤りとして数えてしまう。

import { dateOnly } from "./dedupe";

/** 完了の目安（実装指示書 §4）。 */
export const GOLDSET_TARGETS = {
  /** 期限は1件も間違えられない */
  deadlineAccuracy: 1.0,
  qualificationAccuracy: 0.95,
  tradeF1: 0.85,
} as const;

/** 未記入を表す。null（値が無いのが正解）と区別する。 */
export type Gold<T> = T | undefined;

export type GoldExpected = {
  /** null は「公告に書かれていない」が正解、という意味 */
  submitDeadline?: Gold<string | null>;
  qaDeadline?: Gold<string | null>;
  bidOpenAt?: Gold<string | null>;
  qualCategory?: Gold<string | null>;
  item?: Gold<string | null>;
  grade?: Gold<string | null>;
  areas?: Gold<string[]>;
  /** 数量表から割り当てた業種 */
  trades?: Gold<string[]>;
};

/** checked に書ける名前。まとめて指定できるようにしてある。 */
export const FIELD_GROUPS: Record<string, (keyof GoldExpected)[]> = {
  期限: ["submitDeadline", "qaDeadline", "bidOpenAt"],
  参加資格: ["qualCategory", "item", "grade", "areas"],
  業種: ["trades"],
  すべて: ["submitDeadline", "qaDeadline", "bidOpenAt", "qualCategory", "item", "grade", "areas", "trades"],
};

export type GoldEntry = {
  tenderId: string;
  tenderName: string;
  /**
   * 人が確認した項目。グループ名（期限／参加資格／業種／すべて）でも、
   * 項目名（submitDeadline など）でも書ける。
   */
  checked?: string[];
  /** AIが間違えていた項目の正しい値。合っていた項目は書かなくてよい */
  expected?: GoldExpected;
  note?: string;
};

/** checked の指定を、項目名の集合に開く。知らない名前は無視せず、そのまま項目名として扱う。 */
export function expandChecked(checked: string[] | undefined): Set<string> {
  const fields = new Set<string>();
  for (const entry of checked ?? []) {
    const group = FIELD_GROUPS[entry.trim()];
    if (group) for (const field of group) fields.add(field);
    else fields.add(entry.trim());
  }
  return fields;
}

/** DBに入っている解析結果。 */
export type ActualValues = {
  submitDeadline: string | null;
  qaDeadline: string | null;
  bidOpenAt: string | null;
  qualCategory: string | null;
  item: string | null;
  grade: string | null;
  areas: string[];
  trades: string[];
};

export type FieldComparison = {
  field: string;
  expected: string;
  actual: string;
  correct: boolean;
};

export type TenderResult = {
  tenderId: string;
  tenderName: string;
  /** 記入があった項目の比較結果 */
  fields: FieldComparison[];
  /** 間違えた項目だけ */
  mistakes: FieldComparison[];
};

export type Accuracy = {
  /** 測った項目の数 */
  total: number;
  correct: number;
  /** 測った項目が0なら null（0/0を1.0と見せない） */
  rate: number | null;
};

export type F1Score = {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
};

export type GoldsetReport = {
  /** 突き合わせた案件の数 */
  tenders: number;
  deadlines: Accuracy;
  qualification: Accuracy;
  trades: F1Score;
  results: TenderResult[];
  /** 目安に届いているか。測っていない指標は判定に入れない */
  meets: { deadlines: boolean | null; qualification: boolean | null; trades: boolean | null };
};

/** 日時の比較。表記ゆれ（+09:00 と Z など）を吸収するため、分単位に丸めて比べる。 */
export function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a.trim() === b.trim();
  return Math.floor(ta / 60_000) === Math.floor(tb / 60_000);
}

/** 表示用。日時は「YYYY-MM-DD HH:MM（JST）」にする。 */
export function showInstant(value: string | null): string {
  if (value === null) return "（無し）";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const jst = new Date(parsed + 9 * 60 * 60 * 1000);
  const day = dateOnly(value) ?? "";
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${day} ${hh}:${mm}`;
}

/** 文字列の比較。全角空白・前後の空白・大文字小文字のゆれを吸収する。 */
export function sameText(a: string | null, b: string | null): boolean {
  const normalize = (v: string | null) => (v ?? "").replace(/[\s　]+/g, "").toLowerCase();
  return normalize(a) === normalize(b);
}

/** 集合の比較（順番は問わない）。 */
export function sameSet(a: string[], b: string[]): boolean {
  const normalize = (list: string[]) => new Set(list.map((v) => v.replace(/[\s　]+/g, "")));
  const sa = normalize(a);
  const sb = normalize(b);
  if (sa.size !== sb.size) return false;
  for (const value of sa) if (!sb.has(value)) return false;
  return true;
}

function accuracy(fields: FieldComparison[]): Accuracy {
  const total = fields.length;
  const correct = fields.filter((f) => f.correct).length;
  // 測っていないものを100%と見せない
  return { total, correct, rate: total === 0 ? null : correct / total };
}

const DEADLINE_FIELDS = ["提出期限", "質問期限", "開札"] as const;
const QUALIFICATION_FIELDS = ["資格区分", "営業品目", "等級", "競争参加地域"] as const;

/**
 * 1件を突き合わせる。
 *
 * 測るのは「人が確認した（checked）項目」と「正しい値を書いた（expected）項目」だけ。
 * 確認した項目で expected が書かれていなければ、AIの答えが正しかったということ。
 */
export function compareTender(entry: GoldEntry, actual: ActualValues): TenderResult {
  const checked = expandChecked(entry.checked);
  const expected = entry.expected ?? {};
  const fields: FieldComparison[] = [];

  /** その項目を測るか。expected に書いてあれば必ず測る（checked の書き忘れを救う）。 */
  const measured = (key: keyof GoldExpected) => expected[key] !== undefined || checked.has(key);

  const instant = (label: string, key: "submitDeadline" | "qaDeadline" | "bidOpenAt", got: string | null) => {
    if (!measured(key)) return;
    // 確認して合っていた項目は、正解＝AIの答え
    const want = expected[key] !== undefined ? (expected[key] as string | null) : got;
    fields.push({ field: label, expected: showInstant(want), actual: showInstant(got), correct: sameInstant(want, got) });
  };
  const text = (label: string, key: "qualCategory" | "item" | "grade", got: string | null) => {
    if (!measured(key)) return;
    const want = expected[key] !== undefined ? (expected[key] as string | null) : got;
    fields.push({ field: label, expected: want ?? "（無し）", actual: got ?? "（無し）", correct: sameText(want, got) });
  };
  const set = (label: string, key: "areas" | "trades", got: string[]) => {
    if (!measured(key)) return;
    const want = expected[key] !== undefined ? (expected[key] as string[]) : got;
    fields.push({
      field: label,
      expected: want.length === 0 ? "（無し）" : want.join("、"),
      actual: got.length === 0 ? "（無し）" : got.join("、"),
      correct: sameSet(want, got),
    });
  };

  instant("提出期限", "submitDeadline", actual.submitDeadline);
  instant("質問期限", "qaDeadline", actual.qaDeadline);
  instant("開札", "bidOpenAt", actual.bidOpenAt);
  text("資格区分", "qualCategory", actual.qualCategory);
  text("営業品目", "item", actual.item);
  text("等級", "grade", actual.grade);
  set("競争参加地域", "areas", actual.areas);
  set("業種", "trades", actual.trades);

  return {
    tenderId: entry.tenderId,
    tenderName: entry.tenderName,
    fields,
    mistakes: fields.filter((f) => !f.correct),
  };
}

/**
 * 業種のF1。
 * 案件ごとの平均ではなく、全案件の当たり外れを合算して出す（micro平均）。
 * 業種が1つしかない案件が多いため、案件ごとに平均すると数字が動きすぎる。
 */
export function tradeF1(pairs: { expected: string[]; actual: string[] }[]): F1Score {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;

  const normalize = (list: string[]) => new Set(list.map((v) => v.replace(/[\s　]+/g, "")));

  for (const pair of pairs) {
    const expected = normalize(pair.expected);
    const actual = normalize(pair.actual);
    for (const value of actual) {
      if (expected.has(value)) truePositive++;
      else falsePositive++;
    }
    for (const value of expected) {
      if (!actual.has(value)) falseNegative++;
    }
  }

  const precision = truePositive + falsePositive === 0 ? null : truePositive / (truePositive + falsePositive);
  const recall = truePositive + falseNegative === 0 ? null : truePositive / (truePositive + falseNegative);
  const f1 =
    precision === null || recall === null || precision + recall === 0 ? null : (2 * precision * recall) / (precision + recall);

  return { truePositive, falsePositive, falseNegative, precision, recall, f1 };
}

/** 目安に届いているか。測っていない指標は null（届いた／届かないを言わない）。 */
function meets(rate: number | null, target: number): boolean | null {
  return rate === null ? null : rate >= target;
}

export function evaluateGoldset(pairs: { entry: GoldEntry; actual: ActualValues }[]): GoldsetReport {
  const results = pairs.map(({ entry, actual }) => compareTender(entry, actual));
  const all = results.flatMap((r) => r.fields);

  const deadlines = accuracy(all.filter((f) => (DEADLINE_FIELDS as readonly string[]).includes(f.field)));
  const qualification = accuracy(all.filter((f) => (QUALIFICATION_FIELDS as readonly string[]).includes(f.field)));

  const trades = tradeF1(
    pairs
      .filter(({ entry }) => entry.expected?.trades !== undefined || expandChecked(entry.checked).has("trades"))
      .map(({ entry, actual }) => ({ expected: entry.expected?.trades ?? actual.trades, actual: actual.trades })),
  );

  return {
    tenders: pairs.length,
    deadlines,
    qualification,
    trades,
    results,
    meets: {
      deadlines: meets(deadlines.rate, GOLDSET_TARGETS.deadlineAccuracy),
      qualification: meets(qualification.rate, GOLDSET_TARGETS.qualificationAccuracy),
      trades: meets(trades.f1, GOLDSET_TARGETS.tradeF1),
    },
  };
}
