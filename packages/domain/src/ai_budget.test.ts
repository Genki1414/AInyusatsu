import { describe, expect, it } from "vitest";
import { aiBudgetFromValues, budgetExceeded, jstBudgetWindows, parseYenBudget } from "./ai_budget";

describe("AI budget", () => {
  it("整数と0を受け付け、不正値は既定値に戻す", () => {
    expect(parseYenBudget("12000", 100)).toBe(12000);
    expect(parseYenBudget("0", 100)).toBe(0);
    expect(parseYenBudget("-1", 100)).toBe(100);
    expect(parseYenBudget("1.5", 100)).toBe(100);
    expect(parseYenBudget("高い", 100)).toBe(100);
    expect(aiBudgetFromValues({})).toEqual({ dailyYen: 7_500, monthlyYen: 200_000 });
  });

  it("日本時間の日次・月次境界を作る", () => {
    expect(jstBudgetWindows(new Date("2026-09-20T23:30:00Z"))).toEqual({
      dayFrom: "2026-09-20T15:00:00.000Z",
      dayTo: "2026-09-21T15:00:00.000Z",
      monthFrom: "2026-08-31T15:00:00.000Z",
      monthTo: "2026-09-30T15:00:00.000Z",
    });
  });

  it("日次を先に判定し、0は上限なしとして扱う", () => {
    expect(budgetExceeded({ dailyYen: 7_500, monthlyYen: 200_000 }, { dailyYen: 7_500, monthlyYen: 10_000 })).toBe("daily");
    expect(budgetExceeded({ dailyYen: 0, monthlyYen: 0 }, { dailyYen: 999_999, monthlyYen: 999_999 })).toBeNull();
  });
});
