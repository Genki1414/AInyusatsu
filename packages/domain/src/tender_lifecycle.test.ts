import { describe, expect, it } from "vitest";
import { isDeadlinePassed, planTenderLifecycle, type LifecycleTender } from "./tender_lifecycle";

const NOW = new Date("2026-08-22T10:00:00+09:00");

function tender(over: Partial<LifecycleTender> & { id: string }): LifecycleTender {
  return { collectStatus: "解析完了", submitDeadline: "2026-09-30T17:00:00+09:00", ...over };
}

describe("isDeadlinePassed", () => {
  it("期限が現在より前なら過ぎている", () => {
    expect(isDeadlinePassed("2026-08-22T09:59:00+09:00", NOW)).toBe(true);
  });

  it("期限が現在より後なら過ぎていない", () => {
    expect(isDeadlinePassed("2026-08-22T10:01:00+09:00", NOW)).toBe(false);
  });

  it("ちょうど同時刻はまだ過ぎていない扱い", () => {
    expect(isDeadlinePassed("2026-08-22T10:00:00+09:00", NOW)).toBe(false);
  });

  it("期限が取れていなければ過ぎたと判断しない（推測しない）", () => {
    expect(isDeadlinePassed(null, NOW)).toBe(false);
    expect(isDeadlinePassed("", NOW)).toBe(false);
  });

  it("日付として読めない値でも過ぎたと判断しない", () => {
    expect(isDeadlinePassed("令和8年9月30日", NOW)).toBe(false);
  });
});

describe("planTenderLifecycle", () => {
  it("解析完了の案件を公開中にする", () => {
    const plan = planTenderLifecycle([tender({ id: "t1" })], NOW);
    expect(plan.publish).toEqual([
      { id: "t1", from: "解析完了", to: "公開中", reason: "AI解析が完了しています" },
    ]);
    expect(plan.close).toEqual([]);
  });

  it("解析完了より手前の案件は公開しない", () => {
    const plan = planTenderLifecycle(
      [
        tender({ id: "t1", collectStatus: "未取得" }),
        tender({ id: "t2", collectStatus: "取得中" }),
        tender({ id: "t3", collectStatus: "取得済" }),
        tender({ id: "t4", collectStatus: "AI解析中" }),
      ],
      NOW,
    );
    expect(plan.publish).toEqual([]);
  });

  it("すでに公開中の案件は二重に公開しない", () => {
    const plan = planTenderLifecycle([tender({ id: "t1", collectStatus: "公開中" })], NOW);
    expect(plan.publish).toEqual([]);
    expect(plan.close).toEqual([]);
  });

  it("提出期限を過ぎた案件は状態を問わず終了にする", () => {
    const past = "2026-08-20T17:00:00+09:00";
    const plan = planTenderLifecycle(
      [
        tender({ id: "t1", collectStatus: "公開中", submitDeadline: past }),
        tender({ id: "t2", collectStatus: "取得済", submitDeadline: past }),
        tender({ id: "t3", collectStatus: "未取得", submitDeadline: past }),
      ],
      NOW,
    );
    expect(plan.close.map((c) => c.id)).toEqual(["t1", "t2", "t3"]);
    expect(plan.close[0].to).toBe("終了");
  });

  it("期限切れの解析完了は、公開せずそのまま終了にする", () => {
    // 公開してから終了にすると、その間に提案が作られてしまう
    const plan = planTenderLifecycle(
      [tender({ id: "t1", collectStatus: "解析完了", submitDeadline: "2026-08-01T17:00:00+09:00" })],
      NOW,
    );
    expect(plan.publish).toEqual([]);
    expect(plan.close.map((c) => c.id)).toEqual(["t1"]);
  });

  it("すでに終了の案件は何もしない", () => {
    const plan = planTenderLifecycle(
      [tender({ id: "t1", collectStatus: "終了", submitDeadline: "2026-08-01T17:00:00+09:00" })],
      NOW,
    );
    expect(plan.close).toEqual([]);
    expect(plan.publish).toEqual([]);
  });

  it("提出期限が取れていない案件は終了にせず、件数だけ残す", () => {
    const plan = planTenderLifecycle(
      [
        tender({ id: "t1", collectStatus: "公開中", submitDeadline: null }),
        tender({ id: "t2", collectStatus: "解析完了", submitDeadline: null }),
      ],
      NOW,
    );
    expect(plan.close).toEqual([]);
    expect(plan.unknownDeadline).toEqual(["t1", "t2"]);
    // 期限が不明でも解析が終わっていれば公開はする（前提7：出せる情報は出す）
    expect(plan.publish.map((p) => p.id)).toEqual(["t2"]);
  });

  it("空の一覧でも落ちない", () => {
    expect(planTenderLifecycle([], NOW)).toEqual({ publish: [], close: [], unknownDeadline: [] });
  });
});
