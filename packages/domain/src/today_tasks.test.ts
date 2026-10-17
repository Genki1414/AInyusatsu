import { describe, expect, it } from "vitest";
import { todayTasks, type TodayTaskSource } from "./today_tasks";
import type { RoadmapInput } from "./tender_stance";

const NOW = new Date("2026-10-17T10:00:00+09:00");

const 未着手: RoadmapInput = {
  checkedSteps: [],
  officialStatus: "未取得",
  quoteRequested: false,
  quoteReceived: false,
  bidPriceDecided: false,
  formsReady: false,
  submitted: false,
  qaDeadline: "2026-10-24T17:00:00+09:00",
  submitDeadline: "2026-10-31T17:00:00+09:00",
  bidOpenAt: "2026-11-05T10:00:00+09:00",
};

const source = (over: Partial<TodayTaskSource> & { roadmap?: Partial<RoadmapInput> } = {}): TodayTaskSource => ({
  tenderId: over.tenderId ?? "t1",
  tenderName: over.tenderName ?? "◯◯庁舎 電気設備保守",
  stance: over.stance ?? "参加",
  roadmap: { ...未着手, ...(over.roadmap ?? {}) },
});

describe("todayTasks", () => {
  it("参加の案件は、段取りの「いま」をそのまま出す", () => {
    const [task] = todayTasks([source()], NOW);
    expect(task.label).toContain("御社の名義で取得");
    expect(task.tab).toBe("docs");
    expect(task.daysLeft).toBe(7); // 質問期限 10/24
    expect(task.deadline).toBe("2026-10-24T17:00:00+09:00");
  });

  it("進んだぶんだけ、やることが先へ動く", () => {
    const [task] = todayTasks([source({ roadmap: { officialStatus: "取得済", quoteRequested: true } })], NOW);
    expect(task.label).toContain("応札価格");
    expect(task.tab).toBe("cost");
  });

  it("検討の案件は「参加するか決める」", () => {
    const [task] = todayTasks([source({ stance: "検討" })], NOW);
    expect(task.label).toBe("参加するか決める");
    expect(task.daysLeft).toBe(14); // 提出期限 10/31
    expect(task.tab).toBeNull();
  });

  it("未定・保留・見送りは出さない（やることが無い）", () => {
    for (const stance of ["未定", "保留", "見送り"] as const) {
      expect(todayTasks([source({ stance })], NOW)).toHaveLength(0);
    }
  });

  it("全部終わった案件は出さない", () => {
    const 終わり = {
      officialStatus: "取得済",
      quoteRequested: true,
      bidPriceDecided: true,
      formsReady: true,
      submitted: true,
      checkedSteps: ["open"],
    };
    expect(todayTasks([source({ roadmap: 終わり })], NOW)).toHaveLength(0);
  });

  it("急ぐ順に並べる", () => {
    const tasks = todayTasks(
      [
        source({ tenderId: "far", tenderName: "後", roadmap: { qaDeadline: "2026-11-10T17:00:00+09:00" } }),
        source({ tenderId: "near", tenderName: "先", roadmap: { qaDeadline: "2026-10-18T17:00:00+09:00" } }),
      ],
      NOW,
    );
    expect(tasks.map((t) => t.tenderId)).toEqual(["near", "far"]);
  });

  it("期限が取れていないものは最後に置く（日付が分かるものを先に見せる）", () => {
    const tasks = todayTasks(
      [
        source({ tenderId: "unknown", tenderName: "未確認", roadmap: { qaDeadline: null, submitDeadline: null } }),
        source({ tenderId: "known", tenderName: "既知" }),
      ],
      NOW,
    );
    expect(tasks.map((t) => t.tenderId)).toEqual(["known", "unknown"]);
    expect(tasks[1].daysLeft).toBeNull();
    expect(tasks[1].deadline).toBeNull();
  });

  it("期限を過ぎたものは、過ぎた順にいちばん上へ来る", () => {
    const tasks = todayTasks(
      [
        source({ tenderId: "today", tenderName: "今日", roadmap: { qaDeadline: "2026-10-17T17:00:00+09:00" } }),
        source({ tenderId: "over", tenderName: "超過", roadmap: { qaDeadline: "2026-10-10T17:00:00+09:00" } }),
      ],
      NOW,
    );
    expect(tasks.map((t) => t.tenderId)).toEqual(["over", "today"]);
    expect(tasks[0].daysLeft).toBeLessThan(0);
  });

  it("参加と検討が混ざっていても、期限の近い順に並ぶ", () => {
    const tasks = todayTasks(
      [
        source({ tenderId: "join", stance: "参加", roadmap: { qaDeadline: "2026-10-30T17:00:00+09:00" } }),
        source({ tenderId: "think", stance: "検討", roadmap: { submitDeadline: "2026-10-20T17:00:00+09:00" } }),
      ],
      NOW,
    );
    expect(tasks.map((t) => t.tenderId)).toEqual(["think", "join"]);
  });

  it("1件も無ければ空（画面側で「ありません」と出せる）", () => {
    expect(todayTasks([], NOW)).toEqual([]);
  });
});
