import { describe, expect, it } from "vitest";
import { buildOpsAlert, countAttention, type OpsAlertInput } from "./ops_alert";
import { groupCollectionIssues, type CollectionIssue } from "./admin_console";

function issue(code: string, n: number): CollectionIssue[] {
  return Array.from({ length: n }, (_, i) => ({
    tenderId: `t${i}`,
    tenderName: `案件${i}`,
    agencyName: "◯◯局",
    failureCode: code,
    failureReason: null,
    at: "2026-08-20T00:00:00+09:00",
  }));
}

const base: OpsAlertInput = {
  groups: [],
  stalled: 0,
  coverage: { checked: 20, healthy: 20, missing: 0, delayed: 0 },
  failedJobs: [],
  dateLabel: "2026-08-29",
};

describe("countAttention", () => {
  it("人が動かないと直らないものだけを数える", () => {
    const groups = groupCollectionIssues([...issue("LAYOUT_CHANGED", 3), ...issue("RATE_LIMITED", 5)]);
    // RATE_LIMITED は自動で再試行される。数に入れると、動かないまま数字が大きく残る
    expect(countAttention({ ...base, groups })).toBe(3);
  });

  it("欠測と失敗したジョブも数える", () => {
    expect(
      countAttention({
        ...base,
        coverage: { checked: 20, healthy: 17, missing: 3, delayed: 1 },
        failedJobs: ["crawl-geps"],
      }),
    ).toBe(4);
  });

  it("何も無ければ0", () => {
    expect(countAttention(base)).toBe(0);
  });
});

describe("buildOpsAlert", () => {
  it("正常なときも件名で分かる（異常が無くても毎朝送るため）", () => {
    const alert = buildOpsAlert(base);
    expect(alert.subject).toBe("［AI入札部］正常　2026-08-29");
    expect(alert.attention).toBe(0);
    expect(alert.body).toContain("対応が必要なものはありません");
  });

  it("件名に要対応の件数を出す（開かなくても判断できるように）", () => {
    const groups = groupCollectionIssues(issue("LAYOUT_CHANGED", 2));
    const alert = buildOpsAlert({ ...base, groups });
    expect(alert.subject).toBe("［AI入札部］要対応 2件　2026-08-29");
  });

  it("失敗したジョブをいちばん上に出す（収集が止まっているのが最悪）", () => {
    const groups = groupCollectionIssues(issue("LAYOUT_CHANGED", 1));
    const alert = buildOpsAlert({ ...base, groups, failedJobs: ["crawl-geps", "kkj-sync"] });
    expect(alert.body.indexOf("失敗したジョブ")).toBeLessThan(alert.body.indexOf("対応が必要な失敗"));
    expect(alert.body).toContain("crawl-geps");
    expect(alert.body).toContain("kkj-sync");
  });

  it("48時間直っていない失敗を明示する", () => {
    const alert = buildOpsAlert({ ...base, stalled: 4 });
    expect(alert.body).toContain("48時間以上直っていない失敗が4件");
  });

  it("対応が要る失敗には、取るべき行動を添える", () => {
    const groups = groupCollectionIssues(issue("LAYOUT_CHANGED", 1));
    const alert = buildOpsAlert({ ...base, groups });
    expect(alert.body).toContain("LAYOUT_CHANGED");
    // FAILURE_ACTIONS の action がそのまま入る（画面と説明を食い違わせない）
    expect(alert.body).toMatch(/LAYOUT_CHANGED（.+）1件\n　　.+/);
  });

  it("自動で再試行するものは件数だけにする（本題が埋もれないように）", () => {
    const groups = groupCollectionIssues(issue("RATE_LIMITED", 7));
    const alert = buildOpsAlert({ ...base, groups });
    expect(alert.body).toContain("様子見（自動で再試行します）");
    expect(alert.body).toContain("7件");
    expect(alert.subject).toContain("正常");
  });

  it("カバレッジを必ず載せる", () => {
    const alert = buildOpsAlert({
      ...base,
      coverage: { checked: 20, healthy: 15, missing: 3, delayed: 2 },
    });
    expect(alert.body).toContain("正常：15 / 20");
    expect(alert.body).toContain("欠測・未取得：3件");
    expect(alert.body).toContain("遅延：2件");
  });

  it("届かない日が異常の合図であることを本文に書く", () => {
    expect(buildOpsAlert(base).body).toContain("届かない日があれば");
  });
});
