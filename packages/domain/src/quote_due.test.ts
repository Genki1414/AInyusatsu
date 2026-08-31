import { describe, expect, it } from "vitest";
import { QUOTE_DUE_LEAD_DAYS, suggestQuoteDueAt, validateQuoteDueAt } from "./quote_due";

// 2026-08-31 17:00 JST（実機で不具合を見つけた時刻に合わせる）
const NOW = new Date("2026-08-31T17:00:00+09:00");

describe("suggestQuoteDueAt", () => {
  it("余裕があれば提出期限の3日前", () => {
    // 提出期限 9/12 17:00 → 9/9 17:00
    expect(suggestQuoteDueAt("2026-09-12T17:00:00+09:00", NOW)).toEqual({
      dueAt: "2026-09-09T17:00",
      warning: null,
    });
  });

  it("3日ちょうど先は目安に足りる（境界）", () => {
    const result = suggestQuoteDueAt("2026-09-06T17:00:00+09:00", NOW);
    expect(result.dueAt).toBe("2026-09-03T17:00");
    expect(result.warning).toBeNull();
  });

  it("提出期限が近いと、過去の日付を入れずに真ん中へ寄せる", () => {
    // 実機で起きた形：8/31に送る案件の提出期限が 9/1。3日前だと 8/29 で過去になる
    const result = suggestQuoteDueAt("2026-09-01T17:00:00+09:00", NOW);
    expect(result.dueAt).toBe("2026-09-01T05:00"); // いま(8/31 17:00)と9/1 17:00 の真ん中
    expect(result.warning).toContain("短くしています");
  });

  it("短くしたことを必ず画面に書く（黙って詰めない）", () => {
    const result = suggestQuoteDueAt("2026-09-02T12:00:00+09:00", NOW);
    expect(result.warning).toContain("提出期限まであと");
    expect(result.warning).toContain("手で直してください");
  });

  it("寄せた日付も必ず未来になる", () => {
    for (const hours of [2, 6, 24, 48, 70]) {
      const deadline = new Date(NOW.getTime() + hours * 60 * 60 * 1000).toISOString();
      const result = suggestQuoteDueAt(deadline, NOW);
      expect(result.dueAt).not.toBeNull();
      // datetime-local は日本時間なので、比べる側も日本時間として読む
      expect(Date.parse(`${result.dueAt}:00+09:00`)).toBeGreaterThan(NOW.getTime());
    }
  });

  it("24時間を切ったら、自動催促が動かないことも書く", () => {
    const result = suggestQuoteDueAt("2026-09-01T09:00:00+09:00", NOW);
    expect(result.warning).toContain("自動催促は動きません");
  });

  it("提出期限を過ぎていたら日付を作らない", () => {
    const result = suggestQuoteDueAt("2026-08-29T17:00:00+09:00", NOW);
    expect(result.dueAt).toBeNull();
    expect(result.warning).toContain("提出期限を過ぎています");
  });

  it("提出期限が取れていなければ日付を作らない（推測しない）", () => {
    for (const value of [null, "", "未定"]) {
      const result = suggestQuoteDueAt(value, NOW);
      expect(result.dueAt).toBeNull();
      expect(result.warning).toContain("未確認");
    }
  });

  it("目安の日数は3日", () => {
    expect(QUOTE_DUE_LEAD_DAYS).toBe(3);
  });
});

describe("validateQuoteDueAt", () => {
  it("未来なら通す", () => {
    expect(validateQuoteDueAt("2026-09-05T12:00", NOW)).toBeNull();
  });

  it("過去は止める（切れた期限で送らせない）", () => {
    expect(validateQuoteDueAt("2026-08-29T12:00", NOW)).toContain("過去");
  });

  it("時間帯の無い値は日本時間として読む（UTCで読むと9時間ずれる）", () => {
    // 8/31 17:00 JST から見て、9/1 01:00 JST は未来。UTCとして読むと過去になってしまう
    expect(validateQuoteDueAt("2026-09-01T01:00", NOW)).toBeNull();
    // 8/31 16:00 JST は過去。UTCとして読むと未来に見えてしまう
    expect(validateQuoteDueAt("2026-08-31T16:00", NOW)).toContain("過去");
  });

  it("空や壊れた値は止める", () => {
    expect(validateQuoteDueAt("", NOW)).toContain("入力してください");
    expect(validateQuoteDueAt("きのう", NOW)).toContain("入力してください");
  });
});
