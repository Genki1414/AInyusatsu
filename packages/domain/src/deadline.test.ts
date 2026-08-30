import { describe, expect, it } from "vitest";
import {
  daysUntilDeadline,
  deadlineDate,
  deadlineText,
  isDeadlineNear,
  remainingText,
} from "./deadline";

// 2026-08-31 07:43 JST（画面で数字の食い違いを見つけたときの時刻）
const MORNING = new Date("2026-08-31T07:43:00+09:00");
const NIGHT = new Date("2026-08-31T22:10:00+09:00");

describe("daysUntilDeadline", () => {
  it("日本時間の日付の差で数える", () => {
    expect(daysUntilDeadline("2026-09-02T17:00:00+09:00", MORNING)).toBe(2);
  });

  it("同じ日なら、何時に見ても同じ数字になる（時刻で変わらない）", () => {
    const deadline = "2026-09-02T17:00:00+09:00";
    expect(daysUntilDeadline(deadline, MORNING)).toBe(daysUntilDeadline(deadline, NIGHT));
  });

  it("締切の時刻が違っても、同じ日なら同じ数字になる", () => {
    expect(daysUntilDeadline("2026-09-02T09:00:00+09:00", MORNING)).toBe(2);
    expect(daysUntilDeadline("2026-09-02T23:59:00+09:00", MORNING)).toBe(2);
  });

  it("今日が期限なら0、明日なら1", () => {
    expect(daysUntilDeadline("2026-08-31T17:00:00+09:00", MORNING)).toBe(0);
    expect(daysUntilDeadline("2026-09-01T10:00:00+09:00", MORNING)).toBe(1);
  });

  it("過ぎていれば負の数", () => {
    expect(daysUntilDeadline("2026-08-29T17:00:00+09:00", MORNING)).toBe(-2);
  });

  it("UTCで書かれていても日本時間の日付で数える", () => {
    // 2026-09-01T16:00Z = 2026-09-02 01:00 JST。UTCのまま数えると1日ずれる
    expect(daysUntilDeadline("2026-09-01T16:00:00Z", MORNING)).toBe(2);
  });

  it("期限が無い・読めないものは null（推測しない）", () => {
    expect(daysUntilDeadline(null, MORNING)).toBeNull();
    expect(daysUntilDeadline(undefined, MORNING)).toBeNull();
    expect(daysUntilDeadline("", MORNING)).toBeNull();
    expect(daysUntilDeadline("未定", MORNING)).toBeNull();
  });
});

describe("deadlineDate", () => {
  it("日本時間の日付を返す", () => {
    expect(deadlineDate("2026-09-02T17:00:00+09:00")).toBe("2026/09/02");
  });

  it("UTCで書かれていても日本時間の日付にする", () => {
    expect(deadlineDate("2026-09-01T16:00:00Z")).toBe("2026/09/02");
  });

  it("読めなければ null", () => {
    expect(deadlineDate(null)).toBeNull();
    expect(deadlineDate("未定")).toBeNull();
  });
});

describe("remainingText", () => {
  it("残りを日本語にする", () => {
    expect(remainingText(0)).toBe("今日まで");
    expect(remainingText(1)).toBe("明日まで");
    expect(remainingText(2)).toBe("あと2日");
    expect(remainingText(-3)).toBe("3日過ぎています");
  });

  it("期限が取れていなければ「期限は未確認」（日付を作らない）", () => {
    expect(remainingText(null)).toBe("期限は未確認");
  });
});

describe("deadlineText", () => {
  it("日付と残り日数を並べる", () => {
    expect(deadlineText("2026-09-02T17:00:00+09:00", MORNING)).toBe("2026/09/02（あと2日）");
  });

  it("過ぎたものは日付を残したまま、過ぎたと書く", () => {
    expect(deadlineText("2026-08-29T17:00:00+09:00", MORNING)).toBe("2026/08/29（2日過ぎています）");
  });

  it("期限が無ければ「未確認」", () => {
    expect(deadlineText(null, MORNING)).toBe("未確認");
  });
});

describe("isDeadlineNear", () => {
  it("3日以内は急ぎ", () => {
    expect(isDeadlineNear(3)).toBe(true);
    expect(isDeadlineNear(4)).toBe(false);
    expect(isDeadlineNear(-1)).toBe(true);
  });

  it("期限が取れていないものは急かさない", () => {
    expect(isDeadlineNear(null)).toBe(false);
  });
});
