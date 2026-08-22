import { describe, expect, it } from "vitest";
import { MIN_AWARD_SAMPLE, pickAwardScale, summarizeAwardAmounts, type ScaleAward } from "./award_scale";

function award(over: Partial<ScaleAward> = {}): ScaleAward {
  return { amount: 1_000_000, agencyId: "mlit", item: "清掃", ...over };
}

describe("summarizeAwardAmounts", () => {
  it("中央値・四分位・最小最大を出す", () => {
    const s = summarizeAwardAmounts([100, 200, 300, 400, 500], "同一品目");
    expect(s).toEqual({ scope: "同一品目", n: 5, median: 300, p25: 200, p75: 400, min: 100, max: 500 });
  });

  it("順序が入れ替わっていても同じ結果になる", () => {
    expect(summarizeAwardAmounts([500, 100, 300, 200, 400], "同一品目")?.median).toBe(300);
  });

  it("件数が足りなければ出さない（数件を相場と見せない）", () => {
    expect(summarizeAwardAmounts([100, 200], "同一品目")).toBeNull();
    expect(summarizeAwardAmounts([], "同一品目")).toBeNull();
  });

  it("ちょうど下限の件数なら出す", () => {
    expect(summarizeAwardAmounts([100, 200, 300], "同一品目")?.n).toBe(MIN_AWARD_SAMPLE);
  });

  it("0円・負の金額・数値でない値は数えない", () => {
    // 落札額0は「不調」等の記録であり、規模感の材料にならない
    expect(summarizeAwardAmounts([0, -1, Number.NaN, 100, 200, 300], "同一品目")?.n).toBe(3);
  });

  it("金額は円単位のintegerに丸める", () => {
    const s = summarizeAwardAmounts([100, 201, 300, 401], "同一品目");
    expect(Number.isInteger(s!.median)).toBe(true);
    expect(Number.isInteger(s!.p25)).toBe(true);
  });
});

describe("pickAwardScale", () => {
  const target = { agencyId: "mlit", item: "清掃" };

  it("同一機関・同一品目が足りていればそれを使う", () => {
    const awards = [
      award({ amount: 100 }),
      award({ amount: 200 }),
      award({ amount: 300 }),
      award({ agencyId: "mof", amount: 9_999 }),
    ];
    const s = pickAwardScale(awards, target);
    expect(s?.scope).toBe("同一機関・同一品目");
    expect(s?.n).toBe(3);
  });

  it("同一機関・同一品目が足りなければ同一品目に落とす", () => {
    const awards = [
      award({ amount: 100 }),
      award({ agencyId: "mof", amount: 200 }),
      award({ agencyId: "mext", amount: 300 }),
    ];
    const s = pickAwardScale(awards, target);
    expect(s?.scope).toBe("同一品目");
    expect(s?.n).toBe(3);
  });

  it("品目で足りなければ同一機関に落とす", () => {
    const awards = [
      award({ item: "警備", amount: 100 }),
      award({ item: "運送", amount: 200 }),
      award({ item: null, amount: 300 }),
    ];
    const s = pickAwardScale(awards, target);
    expect(s?.scope).toBe("同一機関");
    expect(s?.n).toBe(3);
  });

  it("どれも足りなければ出さない", () => {
    expect(pickAwardScale([award({ amount: 100 })], target)).toBeNull();
    expect(pickAwardScale([], target)).toBeNull();
  });

  it("案件の品目が未確認なら、品目の条件は使わない（推測で当てはめない）", () => {
    const awards = [award({ amount: 100 }), award({ amount: 200 }), award({ item: "警備", amount: 300 })];
    const s = pickAwardScale(awards, { agencyId: "mlit", item: null });
    expect(s?.scope).toBe("同一機関");
    expect(s?.n).toBe(3);
  });

  it("機関も品目も未確認なら出さない", () => {
    const awards = [award({ amount: 100 }), award({ amount: 200 }), award({ amount: 300 })];
    expect(pickAwardScale(awards, { agencyId: null, item: null })).toBeNull();
  });
});
