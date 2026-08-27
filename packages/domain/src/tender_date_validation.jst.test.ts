import { describe, expect, it } from "vitest";
import { toJstInstant } from "./tender_date_validation";

describe("toJstInstant", () => {
  it("タイムゾーンが無い日時は日本時間として保存する", () => {
    // これを付けないと、DBのセッションのタイムゾーン次第で9時間ずれる
    expect(toJstInstant("2026-09-24T17:00")).toBe("2026-09-24T17:00+09:00");
    expect(toJstInstant("2026-09-24T17:00:00")).toBe("2026-09-24T17:00:00+09:00");
  });

  it("付いているタイムゾーンは付け替えない", () => {
    expect(toJstInstant("2026-09-24T17:00+09:00")).toBe("2026-09-24T17:00+09:00");
    expect(toJstInstant("2026-09-24T08:00Z")).toBe("2026-09-24T08:00Z");
    expect(toJstInstant("2026-09-24T17:00+0900")).toBe("2026-09-24T17:00+0900");
  });

  it("日付だけのものは日付のまま返す（date型の列に入る）", () => {
    expect(toJstInstant("2026-09-24")).toBe("2026-09-24");
  });

  it("値が無いときは null", () => {
    expect(toJstInstant(null)).toBeNull();
    expect(toJstInstant(undefined)).toBeNull();
    expect(toJstInstant("   ")).toBeNull();
  });

  it("日本時間として読むと、意図した時刻になる", () => {
    const at = toJstInstant("2026-09-24T17:00");
    expect(new Date(at!).toISOString()).toBe("2026-09-24T08:00:00.000Z");
  });
});
