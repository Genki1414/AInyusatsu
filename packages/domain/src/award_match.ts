// 過去の落札実績を、案件名で照合する。
//
// 【なぜ機関・品目で照合しないのか】
// 落札実績オープンデータには予定価格・品目分類・調達機関名称の列が無い
// （docs/reference/落札実績オープンデータ_列定義（推定）.md §1）。
// awards に入るのは 調達案件番号 / 案件名 / 落札日 / 落札金額 / 落札者名 / 法人番号 の6項目だけ。
// つまり awards.item も awards.agency_id も常に null で、そこでは照合できない。
//
// 【案件名で照合する】
// 役務の案件の多くは毎年度くり返される。案件名から年度の表記を外せば、
// 前年度の同じ案件を見つけられる。「昨年度は◯◯円で落札された」は、
// 統計的な相場よりも直接的な規模感の手がかりになる。
//
// 推測を混ぜないため、照合は次の2段階だけにする。
//   完全一致：年度を外した名称が一致する（同じ案件のくり返しとみなせる）
//   部分一致：一方が他方を含む（名称に補足が付いただけの可能性がある）
// 語を分解して似ているかを測ることはしない（形態素解析なしの分解は推測になるため）。

/** 部分一致で照合してよい最小の長さ。短い名称は関係ない案件まで拾ってしまう。 */
export const MIN_PARTIAL_MATCH_LENGTH = 8;

export type AwardNameMatchKind = "完全一致" | "部分一致";

export type NameMatchableAward = {
  name: string | null;
  amount: number;
  openedAt: string | null;
  winnerName: string | null;
};

export type MatchedAward = NameMatchableAward & { match: AwardNameMatchKind };

/** 全角の英数字を半角にする（同じ案件名でも表記が揺れるため）。 */
function toHalfWidth(value: string): string {
  return value.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * 案件名から年度の表記を外す。
 * 「令和８年度」「平成30年度」「R8年度」「2026年度」を対象にする。
 */
export function stripFiscalYear(name: string): string {
  return toHalfWidth(name)
    .replace(/(令和|平成|昭和)\s*(元|[0-9]+)\s*年度?/g, "")
    .replace(/\b(R|H|S)\s*[0-9]{1,2}\s*年度?/gi, "")
    .replace(/[0-9]{4}\s*年度/g, "");
}

/**
 * 照合用に案件名をそろえる。年度・空白・区切り記号を落とす。
 * 名称そのものを書き換えるわけではなく、比較のためだけに使う。
 */
export function normalizeAwardName(name: string): string {
  return stripFiscalYear(name)
    .replace(/[\s　]+/g, "")
    .replace(/[（）()「」『』【】［］[\]、,，。．・･/／\-ー―－_]/g, "");
}

/**
 * 案件名で過去の落札を探す。
 * 完全一致を先に、次に部分一致を返す（確からしい順に並べる）。
 * 名称が短すぎる場合、部分一致は行わない（関係ない案件まで拾うため）。
 */
export function matchAwardsByName(awards: NameMatchableAward[], tenderName: string): MatchedAward[] {
  const target = normalizeAwardName(tenderName);
  if (target === "") return [];

  const exact: MatchedAward[] = [];
  const partial: MatchedAward[] = [];

  for (const award of awards) {
    if (award.name === null) continue;
    const candidate = normalizeAwardName(award.name);
    if (candidate === "") continue;

    if (candidate === target) {
      exact.push({ ...award, match: "完全一致" });
      continue;
    }
    if (target.length < MIN_PARTIAL_MATCH_LENGTH || candidate.length < MIN_PARTIAL_MATCH_LENGTH) continue;
    if (candidate.includes(target) || target.includes(candidate)) {
      partial.push({ ...award, match: "部分一致" });
    }
  }

  // 新しい落札から見せる。日付が取れていない行は後ろへ。
  const byNewest = (a: MatchedAward, b: MatchedAward) => (b.openedAt ?? "").localeCompare(a.openedAt ?? "");
  return [...exact.sort(byNewest), ...partial.sort(byNewest)];
}

/**
 * ilike 検索に使う語を作る。年度を外したうえで、区切り記号で分けた一番長い部分を使う。
 * 短すぎる語は関係ない案件まで拾うため使わない（null を返す＝検索しない）。
 */
export function nameSearchNeedle(tenderName: string): string | null {
  const segments = stripFiscalYear(tenderName)
    .split(/[（）()「」『』【】［］[\]、,，。．・･/／\s　]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return null;

  const longest = segments.reduce((best, s) => (s.length > best.length ? s : best));
  return longest.length >= MIN_PARTIAL_MATCH_LENGTH ? longest : null;
}
