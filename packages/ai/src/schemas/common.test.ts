import { describe, expect, it } from "vitest";
import { toJstTimestamp } from "./common";

describe("toJstTimestamp", () => {
  it("タイムゾーンの無い日時に日本時間を付ける", () => {
    // これをやらないとPostgresがUTCとして解釈し、表示が9時間あとにずれる
    expect(toJstTimestamp("2026-09-25T17:00")).toBe("2026-09-25T17:00:00+09:00");
  });

  it("付けた結果が正しい時刻を指す", () => {
    const iso = toJstTimestamp("2026-09-25T17:00")!;
    expect(new Date(iso).toISOString()).toBe("2026-09-25T08:00:00.000Z");
  });

  it("秒まで書かれていても扱える", () => {
    expect(toJstTimestamp("2026-09-25T17:00:30")).toBe("2026-09-25T17:00:30+09:00");
  });

  it("すでにタイムゾーンが付いていればそのまま信じる", () => {
    expect(toJstTimestamp("2026-09-25T08:00:00Z")).toBe("2026-09-25T08:00:00Z");
    expect(toJstTimestamp("2026-09-25T17:00:00+09:00")).toBe("2026-09-25T17:00:00+09:00");
  });

  it("時刻の無い日付は、その日の00:00として扱う（早い側に倒す）", () => {
    // 実際の締切より遅く見せると「まだ間に合う」と誤解させる
    expect(toJstTimestamp("2026-09-25")).toBe("2026-09-25T00:00:00+09:00");
  });

  it("未確認はnullのまま", () => {
    expect(toJstTimestamp(null)).toBeNull();
    expect(toJstTimestamp("")).toBeNull();
    expect(toJstTimestamp("   ")).toBeNull();
  });

  it("読めない形式は推測せずnullにする", () => {
    expect(toJstTimestamp("令和8年9月25日 17時")).toBeNull();
    expect(toJstTimestamp("2026/09/25 17:00")).toBeNull();
    expect(toJstTimestamp("未定")).toBeNull();
  });

  it("存在しない日時はnullにする", () => {
    expect(toJstTimestamp("2026-02-30T17:00")).toBeNull();
    expect(toJstTimestamp("2026-09-25T25:00")).toBeNull();
  });

  it("前後の空白があっても扱える", () => {
    expect(toJstTimestamp("  2026-09-25T17:00  ")).toBe("2026-09-25T17:00:00+09:00");
  });
});
