// market_rates（相場の集計キャッシュ）を再計算するジョブ（A-5）。
// 参照：docs/落札実績オープンデータ_取り込み設計.md §4, §9
//
// awards から直近 periodMonths（既定24か月）ぶんの行を読み、packages/domain の
// computeMarketRates（純関数・単体テスト済み）で品目×機関区分×金額帯ごとに
// 中央値・平均・25%点・75%点を算出し、market_rates へ upsert する。

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
  };
}

export type RefreshOutcome = {
  groupsUpserted: number;
  awardsConsidered: number;
};

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
