import { describe, expect, it } from "vitest";
import { looksLikeUtcMisread } from "./repair_deadlines";

/** 日本時間の文字列を、DBが返す形（ミリ秒）にする。 */
function jst(iso: string): number {
  return Date.parse(`${iso}+09:00`);
}

describe("looksLikeUtcMisread", () => {
  it("時刻付きがUTCとして読まれた形（9時間あと）を見分ける", () => {
    // "2026-09-24T17:00" が 17:00 UTC として保存された ＝ 日本時間の翌日2:00
    expect(looksLikeUtcMisread("2026-09-24T17:00", jst("2026-09-25T02:00"))).toBe(true);
  });

  it("日付だけの値がUTCの0時として読まれた形も見分ける", () => {
    // これを取りこぼしていた。日本時間では9:00に見える
    expect(looksLikeUtcMisread("2026-09-10", jst("2026-09-10T09:00"))).toBe(true);
  });

  it("正しく保存されているものは対象にしない", () => {
    expect(looksLikeUtcMisread("2026-09-24T17:00", jst("2026-09-24T17:00"))).toBe(false);
    expect(looksLikeUtcMisread("2026-09-10", jst("2026-09-10T00:00"))).toBe(false);
  });

  it("別の理由で違う値は対象にしない（コネクタの確定値を上書きしない）", () => {
    // 9時間ではなく、日付そのものが違う
    expect(looksLikeUtcMisread("2026-09-24T17:00", jst("2026-09-30T17:00"))).toBe(false);
  });

  it("タイムゾーンが付いている読み取りは、この不具合ではない", () => {
    expect(looksLikeUtcMisread("2026-09-24T17:00:00+09:00", jst("2026-09-25T02:00"))).toBe(false);
    expect(looksLikeUtcMisread("2026-09-24T08:00:00Z", jst("2026-09-25T02:00"))).toBe(false);
  });

  it("読めない値は対象にしない", () => {
    expect(looksLikeUtcMisread("令和8年9月24日", jst("2026-09-25T02:00"))).toBe(false);
  });
});
