// 案件の重複排除キーの生成と正規化。副作用を持たない純関数のみを置く。
// 参照：docs/実装仕様書_v1.md §3「コネクタ」（重複排除）
//
//   dedupe_key = agency_id + "/" + notice_no + "/" + date(submit_deadline)
//   notice_no が無い機関は agency_id + "/" + sha1(normalize(name)) + "/" + date(submit_deadline)
//   normalize は空白・全半角・括弧・年度表記を統一する

import { createHash } from "node:crypto";

// 令和1年 = 2019年。年度表記の表記ゆれ（令和8年度 / R8年度 / 2026年度）を西暦に統一するために使う。
const REIWA_OFFSET = 2018;

// 内容ごと除去する括弧のペア。公告の再掲・年度表記の付記など、同一案件でも
// 括弧内の注記だけが変わることが多いため、括弧とその中身をまるごと除去する。
// 全角の丸括弧・角括弧・山括弧はNFKC正規化で半角に変換されるため、ここでは
// NFKC変換後に残るCJK固有の括弧（隅付き・鉤括弧など）と半角括弧を対象にする。
const BRACKET_PAIRS: [string, string][] = [
  ["(", ")"],
  ["[", "]"],
  ["【", "】"],
  ["〔", "〕"],
  ["「", "」"],
  ["『", "』"],
];

function escapeRegExp(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripBracketedContent(text: string): string {
  let result = text;
  for (const [open, close] of BRACKET_PAIRS) {
    const pattern = new RegExp(`${escapeRegExp(open)}[^${escapeRegExp(open)}${escapeRegExp(close)}]*${escapeRegExp(close)}`, "g");
    result = result.replace(pattern, "");
  }
  return result;
}

function normalizeFiscalYear(text: string): string {
  return text
    .replace(/令和(\d+)年度?/g, (_match, n: string) => `${Number(n) + REIWA_OFFSET}年度`)
    .replace(/[Rr](\d+)年度?/g, (_match, n: string) => `${Number(n) + REIWA_OFFSET}年度`);
}

/**
 * 案件名の表記ゆれを吸収する。
 * - 全角/半角（英数字・記号・スペース）：NFKC正規化で統一
 * - 括弧とその中身：除去（BRACKET_PAIRS参照）
 * - 空白：すべて除去
 * - 年度表記（令和8年度 / R8年度 / 2026年度）：西暦「2026年度」に統一
 */
export function normalize(text: string): string {
  let s = text.normalize("NFKC");
  s = normalizeFiscalYear(s);
  s = stripBracketedContent(s);
  s = s.replace(/\s+/g, "");
  return s.trim();
}

/**
 * timestamptz（ISO文字列・Dateオブジェクト）からJSTの日付部分（YYYY-MM-DD）を取り出す。
 * DBはtimestamptz・表示はAsia/Tokyo（CLAUDE.md）のため、日付境界はJSTで判定する。
 * 値が無い／不正な場合は null。
 */
export function dateOnly(input: string | Date | null | undefined): string | null {
  if (input == null) return null;
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function sha1(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

export type DedupeKeyInput = {
  agencyId: string;
  noticeNo?: string | null;
  name: string;
  submitDeadline: string | Date | null | undefined;
};

/**
 * 重複排除キーを生成する。
 *   notice_noがある場合: agency_id + "/" + notice_no + "/" + date(submit_deadline)
 *   notice_noが無い場合: agency_id + "/" + sha1(normalize(name)) + "/" + date(submit_deadline)
 *
 * submit_deadlineが取れない案件は、日付部分を "unknown" とする（推測して埋めない）。
 * この場合、同一agency_id・同一notice_no（またはname）で提出期限未確定の案件同士は
 * 同じキーになりうる点に注意（期限が確定した時点でキーが変わり別案件扱いになる）。
 */
export function dedupeKey(input: DedupeKeyInput): string {
  const datePart = dateOnly(input.submitDeadline) ?? "unknown";
  const noticeNo = input.noticeNo?.trim();
  const middle = noticeNo ? noticeNo : sha1(normalize(input.name));
  return `${input.agencyId}/${middle}/${datePart}`;
}
