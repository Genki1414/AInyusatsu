import { describe, expect, it } from "vitest";
import { noticeDateCutoff, parseMaxNoticeAgeDays, toDateIso } from "./analysis_scope";

describe("parseMaxNoticeAgeDays", () => {
  it("1以上の整数を読む", () => {
    expect(parseMaxNoticeAgeDays("90")).toBe(90);
    expect(parseMaxNoticeAgeDays("1")).toBe(1);
  });

  it("空・未指定は「絞らない」", () => {
    expect(parseMaxNoticeAgeDays(undefined)).toBeNull();
    expect(parseMaxNoticeAgeDays("")).toBeNull();
    expect(parseMaxNoticeAgeDays("   ")).toBeNull();
  });

  it("0以下・小数・数値でない値は「絞らない」に落とす（推測で読み替えない）", () => {
    expect(parseMaxNoticeAgeDays("0")).toBeNull();
    expect(parseMaxNoticeAgeDays("-30")).toBeNull();
    expect(parseMaxNoticeAgeDays("30.5")).toBeNull();
    expect(parseMaxNoticeAgeDays("さんじゅう")).toBeNull();
  });
});

describe("noticeDateCutoff", () => {
  it("指定した日数ぶん前の日付を返す", () => {
    const now = new Date("2026-08-22T10:00:00Z");
    expect(toDateIso(noticeDateCutoff(90, now))).toBe("2026-05-24");
  });

  it("1日なら前日", () => {
    const now = new Date("2026-08-22T10:00:00Z");
    expect(toDateIso(noticeDateCutoff(1, now))).toBe("2026-08-21");
  });
});
