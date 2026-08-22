// market_rates（相場の集計キャッシュ）を再計算するジョブ（A-5）。
// 参照：docs/落札実績オープンデータ_取り込み設計.md §4, §9
//
// awards から直近 periodMonths（既定24か月）ぶんの行を読み、packages/domain の
// computeMarketRates（純関数・単体テスト済み）で品目×機関区分×金額帯ごとに
// 中央値・平均・25%点・75%点を算出し、market_rates へ upsert する。
//
// 【現状 0件になる】
// 落札実績オープンデータには予定価格・品目分類・調達機関名称の列が無い
// （docs/reference/落札実績オープンデータ_列定義（推定）.md §1、2026-08-01にユーザーと合意）。
// そのため awards.item / agency_class / rate は常に null で、集計対象が1件も残らない。
// これは不具合ではなく、このデータソースの限界。黙って 0 を返すと原因が分からないので、
// どの条件で何件落ちたかを出す。予定価格・品目を持つ別のデータソースを
// procurement_no で突き合わせられるようになったら再開する。

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { computeMarketRates, type NormalizedAward } from "@ai-nyusatsu-bu/domain";

const DEFAULT_PERIOD_MONTHS = 24;

type AwardsRow = {
  item: string | null;
  agency_class: string | null;
  budget: number | null;
  amount: number | null;
  rate: number | null;
  outlier: boolean;
  tax_included: boolean | null;
  opened_at: string | null;
  procurement_no: string | null;
};

function toNormalizedAward(row: AwardsRow): NormalizedAward {
  return {
    procurementNo: row.procurement_no,
    name: null,
    item: row.item,
    agencyClass: row.agency_class,
    contractType: null,
    budget: row.budget,
    amount: row.amount,
    bidders: null,
    openedAt: row.opened_at,
    rate: row.rate,
    disclosed: row.budget != null,
    taxIncluded: row.tax_included,
    taxUnknown: row.tax_included == null,
    outlier: row.outlier,
    winnerName: null,
    corporateNumber: null,
  };
}

export type RefreshOutcome = {
  groupsUpserted: number;
  awardsConsidered: number;
};

/**
 * 集計対象が0件だった理由を、条件ごとの件数で示す。
 * 「awards が空なのか」「列が埋まっていないのか」を切り分けられるようにする。
 */
async function explainEmptyResult(client: ReturnType<typeof createServiceClient>, cutoffIso: string): Promise<void> {
  const countWhere = async (label: string, build: (q: ReturnType<typeof baseQuery>) => ReturnType<typeof baseQuery>) => {
    const { count } = await build(baseQuery(client));
    return `${label}=${count ?? 0}`;
  };
  const baseQuery = (c: ReturnType<typeof createServiceClient>) =>
    c.from("awards").select("id", { count: "exact", head: true });

  const parts = await Promise.all([
    countWhere("全件", (q) => q),
    countWhere("直近期間内", (q) => q.gte("opened_at", cutoffIso)),
    countWhere("品目あり", (q) => q.not("item", "is", null)),
    countWhere("機関区分あり", (q) => q.not("agency_class", "is", null)),
    countWhere("落札率あり", (q) => q.not("rate", "is", null)),
  ]);

  console.warn(`[refresh_market_rates] 集計対象が0件です（${parts.join(" / ")}）`);
  console.warn(
    "[refresh_market_rates] 落札実績オープンデータには予定価格・品目分類・調達機関名称の列が無いため、" +
      "このデータソースだけでは落札率の相場を算出できません" +
      "（docs/reference/落札実績オープンデータ_列定義（推定）.md §1）",
  );
}

export async function refreshMarketRates(periodMonths = DEFAULT_PERIOD_MONTHS): Promise<RefreshOutcome> {
  const client = createServiceClient();
  const asOfDate = new Date().toISOString().slice(0, 10);
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - periodMonths);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const { data, error } = await client
    .from("awards")
    .select("item, agency_class, budget, amount, rate, outlier, tax_included, opened_at, procurement_no")
    .not("item", "is", null)
    .not("agency_class", "is", null)
    .eq("outlier", false)
    .not("rate", "is", null)
    .gte("opened_at", cutoffIso);

  if (error) {
    throw new Error(`awards の取得に失敗しました: ${error.message}`);
  }

  const awards = (data ?? []).map(toNormalizedAward);
  if (awards.length === 0) {
    // なぜ0件なのかを、条件ごとの件数で示す（握りつぶさない）
    await explainEmptyResult(client, cutoffIso);
  }
  const rows = computeMarketRates(awards, { periodMonths, asOfDate });

  if (rows.length > 0) {
    const { error: upsertError } = await client.from("market_rates").upsert(
      rows.map((r) => ({
        item: r.item,
        agency_class: r.agencyClass,
        amount_band: r.amountBand,
        period_months: r.periodMonths,
        n: r.n,
        rate_median: r.rateMedian,
        rate_avg: r.rateAvg,
        rate_p25: r.rateP25,
        rate_p75: r.rateP75,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "item,agency_class,amount_band,period_months" },
    );
    if (upsertError) {
      throw new Error(`market_rates の upsert に失敗しました: ${upsertError.message}`);
    }
  }

  return { groupsUpserted: rows.length, awardsConsidered: awards.length };
}
