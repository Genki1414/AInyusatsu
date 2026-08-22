// 過去の落札額から案件の規模感を出す。
//
// 【なぜ必要か】
// 国の入札は予定価格を原則として事前公表しない。実際、tenders.budget はほとんどが null。
// 一方で「いくらくらいの案件なのか」が分からないと、参加するかどうかを判断できない。
//
// 落札実績オープンデータ（awards）には、過去に実際いくらで落札されたかが入っている。
// 同じ機関・同じ品目の過去の落札額を並べれば、予定価格の代わりの目安になる。
//
// 【推測にならないようにする】
// これは予定価格ではなく、あくまで過去の実績。画面では必ず件数と期間を添えて出し、
// 件数が少なすぎるときは出さない（数件の外れ値を「相場」と見せない）。

/** これ未満の件数では目安として出さない。 */
export const MIN_AWARD_SAMPLE = 3;

/** 何を根拠にした数字かを示す。具体的なものほど信頼できる。 */
export type AwardScaleScope = "同一機関・同一品目" | "同一品目" | "同一機関";

export type ScaleAward = {
  amount: number;
  agencyId: string | null;
  item: string | null;
};

export type AwardScale = {
  scope: AwardScaleScope;
  /** 根拠にした件数 */
  n: number;
  median: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
};

/** 線形補間による分位点（PostgreSQLのpercentile_contと同じ方式）。昇順ソート済みであること。 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * 落札額の分布をまとめる。件数が MIN_AWARD_SAMPLE 未満なら null（目安として出さない）。
 * 金額は円単位のintegerに丸める（CLAUDE.md：小数を使わない）。
 */
export function summarizeAwardAmounts(
  amounts: number[],
  scope: AwardScaleScope,
  minSample: number = MIN_AWARD_SAMPLE,
): AwardScale | null {
  const valid = amounts.filter((a) => Number.isFinite(a) && a > 0);
  if (valid.length < minSample) return null;

  const sorted = [...valid].sort((a, b) => a - b);
  return {
    scope,
    n: sorted.length,
    median: Math.round(percentile(sorted, 0.5)),
    p25: Math.round(percentile(sorted, 0.25)),
    p75: Math.round(percentile(sorted, 0.75)),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

/**
 * 案件に一番近い根拠で規模感を出す。
 * 「同一機関・同一品目」→「同一品目」→「同一機関」の順に試し、
 * 件数が足りた最初のものを返す。どれも足りなければ null。
 *
 * 案件の品目・機関が分かっていない場合、その条件は使わない（推測で当てはめない）。
 */
export function pickAwardScale(
  awards: ScaleAward[],
  target: { agencyId: string | null; item: string | null },
  minSample: number = MIN_AWARD_SAMPLE,
): AwardScale | null {
  const amountsOf = (predicate: (a: ScaleAward) => boolean) => awards.filter(predicate).map((a) => a.amount);

  if (target.agencyId !== null && target.item !== null) {
    const both = summarizeAwardAmounts(
      amountsOf((a) => a.agencyId === target.agencyId && a.item === target.item),
      "同一機関・同一品目",
      minSample,
    );
    if (both) return both;
  }
  if (target.item !== null) {
    const byItem = summarizeAwardAmounts(amountsOf((a) => a.item === target.item), "同一品目", minSample);
    if (byItem) return byItem;
  }
  if (target.agencyId !== null) {
    const byAgency = summarizeAwardAmounts(amountsOf((a) => a.agencyId === target.agencyId), "同一機関", minSample);
    if (byAgency) return byAgency;
  }
  return null;
}
