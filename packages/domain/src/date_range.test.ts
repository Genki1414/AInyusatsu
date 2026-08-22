import { describe, expect, it } from "vitest";
import { expandDateRange, isDateIso, MAX_DATE_RANGE_DAYS } from "./date_range";

describe("isDateIso", () => {
  it("YYYY-MM-DD を受け付ける", () => {
    expect(isDateIso("2026-08-22")).toBe(true);
  });

  it("形が違えば受け付けない", () => {
    expect(isDateIso("2026/08/22")).toBe(false);
    expect(isDateIso("2026-8-22")).toBe(false);
    expect(isDateIso("")).toBe(false);
  });

  it("存在しない日付は受け付けない", () => {
    expect(isDateIso("2026-02-30")).toBe(false);
    expect(isDateIso("2026-13-01")).toBe(false);
  });
});

describe("expandDateRange", () => {
  it("両端を含めて1日ずつに展開する", () => {
    expect(expandDateRange("2026-08-20", "2026-08-23")).toEqual([
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
      "2026-08-23",
    ]);
  });

  it("同じ日を指定したら1日だけ", () => {
    expect(expandDateRange("2026-08-22", "2026-08-22")).toEqual(["2026-08-22"]);
  });

  it("月をまたいでも正しく並ぶ", () => {
    expect(expandDateRange("2026-07-30", "2026-08-02")).toEqual([
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
  });

  it("うるう年の2月29日を落とさない", () => {
    expect(expandDateRange("2028-02-28", "2028-03-01")).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });

  it("順序が逆ならエラー（推測で入れ替えない）", () => {
    expect(() => expandDateRange("2026-08-23", "2026-08-20")).toThrow("順序が逆");
  });

  it("読めない日付はエラー", () => {
    expect(() => expandDateRange("2026/08/20", "2026-08-23")).toThrow("日付として読めません");
    expect(() => expandDateRange("2026-08-20", "2026-02-30")).toThrow("日付として読めません");
  });

  it("上限を超えたら黙って切り詰めずエラーにする", () => {
    expect(() => expandDateRange("2026-01-01", "2026-12-31")).toThrow("31日まで");
  });

  it("ちょうど上限なら通る", () => {
    expect(expandDateRange("2026-08-01", "2026-08-31")).toHaveLength(MAX_DATE_RANGE_DAYS);
  });
});
