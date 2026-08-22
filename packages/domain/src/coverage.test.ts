import { describe, expect, it } from "vitest";
import {
  evaluateAgencyCoverage,
  evaluateCoverage,
  expectedIntervalDays,
  type CoverageAgency,
} from "./coverage";

const NOW = new Date("2026-08-22T10:00:00+09:00");

function agency(over: Partial<CoverageAgency> & { id: string }): CoverageAgency {
  return { name: "テスト機関", expectedFreq: "weekly", lastSuccessAt: "2026-08-20T10:00:00+09:00", ...over };
}

/** NOW から指定日数だけ前の時刻。 */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe("expectedIntervalDays", () => {
  it("daily / weekly / monthly を日数に直す", () => {
    expect(expectedIntervalDays("daily")).toBe(1);
    expect(expectedIntervalDays("weekly")).toBe(7);
    expect(expectedIntervalDays("monthly")).toBe(31);
  });

  it("前後の空白を許す", () => {
    expect(expectedIntervalDays(" weekly ")).toBe(7);
  });

  it("知らない値・未設定は基準なし（推測しない）", () => {
    expect(expectedIntervalDays("毎週")).toBeNull();
    expect(expectedIntervalDays("")).toBeNull();
    expect(expectedIntervalDays(null)).toBeNull();
  });
});

describe("evaluateAgencyCoverage", () => {
  it("想定間隔の内に取れていれば正常", () => {
    const r = evaluateAgencyCoverage(agency({ id: "a", lastSuccessAt: daysAgo(3) }), NOW);
    expect(r.status).toBe("正常");
  });

  it("ちょうど想定間隔なら、まだ正常", () => {
    const r = evaluateAgencyCoverage(agency({ id: "a", lastSuccessAt: daysAgo(7) }), NOW);
    expect(r.status).toBe("正常");
  });

  it("想定間隔を過ぎたら遅延", () => {
    const r = evaluateAgencyCoverage(agency({ id: "a", lastSuccessAt: daysAgo(10) }), NOW);
    expect(r.status).toBe("遅延");
  });

  it("想定間隔の倍を過ぎたら欠測", () => {
    const r = evaluateAgencyCoverage(agency({ id: "a", lastSuccessAt: daysAgo(20) }), NOW);
    expect(r.status).toBe("欠測");
  });

  it("ちょうど倍なら、まだ遅延（1回の失敗で警報にしない）", () => {
    const r = evaluateAgencyCoverage(agency({ id: "a", lastSuccessAt: daysAgo(14) }), NOW);
    expect(r.status).toBe("遅延");
  });

  it("一度も取れていなければ未取得", () => {
    const r = evaluateAgencyCoverage(agency({ id: "a", lastSuccessAt: null }), NOW);
    expect(r.status).toBe("未取得");
    expect(r.daysSince).toBeNull();
  });

  it("日時として読めない値は、正常とはみなさない", () => {
    const r = evaluateAgencyCoverage(agency({ id: "a", lastSuccessAt: "令和8年8月20日" }), NOW);
    expect(r.status).toBe("未取得");
  });

  it("expected_freqが無ければ判定しない（機関が出していないだけかもしれない）", () => {
    const r = evaluateAgencyCoverage(agency({ id: "a", expectedFreq: null, lastSuccessAt: null }), NOW);
    expect(r.status).toBe("基準なし");
    expect(r.allowedDays).toBeNull();
  });

  it("dailyは1日で遅延、2日を超えると欠測", () => {
    expect(evaluateAgencyCoverage(agency({ id: "a", expectedFreq: "daily", lastSuccessAt: daysAgo(0.5) }), NOW).status).toBe("正常");
    expect(evaluateAgencyCoverage(agency({ id: "a", expectedFreq: "daily", lastSuccessAt: daysAgo(1.5) }), NOW).status).toBe("遅延");
    expect(evaluateAgencyCoverage(agency({ id: "a", expectedFreq: "daily", lastSuccessAt: daysAgo(3) }), NOW).status).toBe("欠測");
  });
});

describe("evaluateCoverage", () => {
  it("対応が要るもの（欠測・未取得）と様子見（遅延）を分ける", () => {
    const summary = evaluateCoverage(
      [
        agency({ id: "ok", lastSuccessAt: daysAgo(1) }),
        agency({ id: "late", lastSuccessAt: daysAgo(10) }),
        agency({ id: "gone", lastSuccessAt: daysAgo(60) }),
        agency({ id: "never", lastSuccessAt: null }),
        agency({ id: "nofreq", expectedFreq: null }),
      ],
      NOW,
    );
    expect(summary.checked).toBe(4);
    expect(summary.healthy).toBe(1);
    expect(summary.delayed.map((r) => r.id)).toEqual(["late"]);
    expect(summary.missing.map((r) => r.id)).toEqual(["gone", "never"]);
  });

  it("基準なしは分母にも入れない（判定できないものを失敗として数えない）", () => {
    const summary = evaluateCoverage([agency({ id: "nofreq", expectedFreq: null, lastSuccessAt: null })], NOW);
    expect(summary.checked).toBe(0);
    expect(summary.missing).toEqual([]);
  });

  it("空の一覧でも落ちない", () => {
    expect(evaluateCoverage([], NOW)).toEqual({ results: [], checked: 0, healthy: 0, missing: [], delayed: [] });
  });
});
