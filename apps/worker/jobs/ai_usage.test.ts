import { describe, expect, it } from "vitest";
import {
  aiBudgetFromEnv,
  budgetExceeded,
  jstBudgetWindows,
  parseYenBudget,
} from "./ai_usage";

describe("parseYenBudget", () => {
  it("整数と0を受け付ける", () => {
    expect(parseYenBudget("12000", 100)).toBe(12000);
    expect(parseYenBudget("0", 100)).toBe(0);
  });

  it("未設定・負数・小数・文字列は既定値に戻す", () => {
    expect(parseYenBudget(undefined, 100)).toBe(100);
    expect(parseYenBudget("-1", 100)).toBe(100);
    expect(parseYenBudget("1.5", 100)).toBe(100);
    expect(parseYenBudget("高い", 100)).toBe(100);
  });
});

describe("jstBudgetWindows", () => {
  it("UTC日付ではなく日本時間の日付で日次・月次の境界を作る", () => {
    const result = jstBudgetWindows(new Date("2026-09-20T23:30:00Z")); // 日本時間 9/21 08:30
    expect(result).toEqual({
      dayFrom: "2026-09-20T15:00:00.000Z",
      dayTo: "2026-09-21T15:00:00.000Z",
      monthFrom: "2026-08-31T15:00:00.000Z",
      monthTo: "2026-09-30T15:00:00.000Z",
    });
  });

  it("月末から翌日・翌月へ正しく進む", () => {
    const result = jstBudgetWindows(new Date("2026-01-31T15:30:00Z")); // 日本時間 2/1
    expect(result.dayFrom).toBe("2026-01-31T15:00:00.000Z");
    expect(result.dayTo).toBe("2026-02-01T15:00:00.000Z");
    expect(result.monthFrom).toBe("2026-01-31T15:00:00.000Z");
    expect(result.monthTo).toBe("2026-02-28T15:00:00.000Z");
  });
});

describe("budgetExceeded", () => {
  it("日次を先に、次に月次を判定する", () => {
    expect(budgetExceeded({ dailyYen: 7500, monthlyYen: 200000 }, { dailyYen: 7500, monthlyYen: 10000 })).toBe("daily");
    expect(budgetExceeded({ dailyYen: 7500, monthlyYen: 200000 }, { dailyYen: 100, monthlyYen: 200000 })).toBe("monthly");
    expect(budgetExceeded({ dailyYen: 7500, monthlyYen: 200000 }, { dailyYen: 100, monthlyYen: 10000 })).toBeNull();
  });

  it("0は上限なし", () => {
    expect(budgetExceeded({ dailyYen: 0, monthlyYen: 0 }, { dailyYen: 999999, monthlyYen: 999999 })).toBeNull();
  });
});

describe("aiBudgetFromEnv", () => {
  it("未設定なら安全な既定値を使う", () => {
    expect(aiBudgetFromEnv({} as NodeJS.ProcessEnv)).toEqual({ dailyYen: 7500, monthlyYen: 200000 });
  });
});
