import { describe, expect, it } from "vitest";
import { aggregateCost, bidGuide, type QuoteForCosting } from "./cost_estimate";

const RATES = { overheadRate: 0.12, profitRate: 0.1 };

function quote(over: Partial<QuoteForCosting> & { id: string; trade: string }): QuoteForCosting {
  return { partnerName: `協力${over.id}`, amount: null, adopted: false, declined: false, ...over };
}

describe("aggregateCost", () => {
  it("業種ごとに最安を仮に採用し、原価・一般管理費・利益・応札価格の案を出す", () => {
    const result = aggregateCost(
      [
        quote({ id: "a", trade: "清掃", amount: 1_000_000 }),
        quote({ id: "b", trade: "清掃", amount: 900_000 }),
        quote({ id: "c", trade: "警備", amount: 500_000 }),
      ],
      RATES,
    );
    expect(result.cost).toBe(1_400_000); // 900,000 + 500,000
    expect(result.overhead).toBe(168_000); // 1,400,000 * 0.12
    expect(result.profit).toBe(156_800); // (1,400,000 + 168,000) * 0.10
    expect(result.bid).toBe(1_724_800);
    expect(result.rows.map((r) => r.adopted?.id)).toEqual(["b", "c"]);
    expect(result.rows.every((r) => r.autoSelected)).toBe(true);
  });

  it("採用が明示されていれば、最安でなくてもそれを使う", () => {
    const result = aggregateCost(
      [
        quote({ id: "a", trade: "清掃", amount: 1_000_000, adopted: true }),
        quote({ id: "b", trade: "清掃", amount: 900_000 }),
      ],
      RATES,
    );
    expect(result.rows[0].adopted?.id).toBe("a");
    expect(result.rows[0].autoSelected).toBe(false);
    expect(result.rows[0].lowestAmount).toBe(900_000);
    expect(result.cost).toBe(1_000_000);
  });

  it("業種の並びは見積の登場順を保つ", () => {
    const result = aggregateCost(
      [quote({ id: "a", trade: "警備", amount: 1 }), quote({ id: "b", trade: "清掃", amount: 1 })],
      RATES,
    );
    expect(result.rows.map((r) => r.trade)).toEqual(["警備", "清掃"]);
  });

  it("金額の回答が無い業種は採用なしになり、原価が揃っていないことが分かる", () => {
    const result = aggregateCost(
      [quote({ id: "a", trade: "清掃", amount: 900_000 }), quote({ id: "b", trade: "警備" })],
      RATES,
    );
    expect(result.rows[1].adopted).toBeNull();
    expect(result.hasMissingTrade).toBe(true);
    expect(result.cost).toBe(900_000);
  });

  it("見送りは未回答に数えない（待っても返事が来ないため）", () => {
    const result = aggregateCost(
      [
        quote({ id: "a", trade: "清掃", amount: 900_000 }),
        quote({ id: "b", trade: "清掃", declined: true }),
        quote({ id: "c", trade: "清掃" }),
      ],
      RATES,
    );
    expect(result.rows[0]).toMatchObject({ answered: 1, requested: 3, waiting: 1 });
    expect(result.waiting).toBe(1);
  });

  it("金額は円単位の整数に丸める（小数を使わない）", () => {
    const result = aggregateCost([quote({ id: "a", trade: "清掃", amount: 333_333 })], RATES);
    expect(Number.isInteger(result.overhead)).toBe(true);
    expect(Number.isInteger(result.profit)).toBe(true);
    expect(Number.isInteger(result.bid)).toBe(true);
    expect(result.overhead).toBe(40_000); // 333,333 * 0.12 = 39,999.96
  });

  it("見積が1件も無ければ、すべて0で原価も揃っていない扱いにしない", () => {
    const result = aggregateCost([], RATES);
    expect(result).toMatchObject({ rows: [], cost: 0, overhead: 0, profit: 0, bid: 0, waiting: 0, hasMissingTrade: false });
  });
});

describe("bidGuide", () => {
  it("予定価格に落札率をかけて目安のラインを出す", () => {
    expect(bidGuide(8_000_000, 9_200_000, { rate: 0.95, n: 12 })).toEqual({
      target: 8_740_000,
      withinTarget: true,
      overBy: -740_000,
    });
  });

  it("目安ラインを超えていたら超過額が分かる", () => {
    const guide = bidGuide(9_000_000, 9_200_000, { rate: 0.95, n: 12 });
    expect(guide.withinTarget).toBe(false);
    expect(guide.overBy).toBe(260_000);
  });

  it("目安ラインちょうどは「ライン内」として扱う", () => {
    expect(bidGuide(8_740_000, 9_200_000, { rate: 0.95, n: 12 }).withinTarget).toBe(true);
  });

  it("予定価格が非公表なら目安を出さない（落札率だけでは金額に換算できない）", () => {
    expect(bidGuide(8_000_000, null, { rate: 0.95, n: 12 })).toEqual({ target: null, withinTarget: null, overBy: null });
  });

  it("同種案件の実績が無ければ目安を出さない", () => {
    expect(bidGuide(8_000_000, 9_200_000, null)).toEqual({ target: null, withinTarget: null, overBy: null });
  });
});
