import { describe, expect, it } from "vitest";
import { canRescore, isUndelivered, nextProposalStatus } from "./proposal_status";

describe("canRescore", () => {
  it("ユーザーの判断が入った状態は上書きしない", () => {
    expect(canRescore("検討中")).toBe(false);
    expect(canRescore("対象外")).toBe(false);
  });

  it("まだ判断が入っていない状態は作り直す", () => {
    expect(canRescore("提案対象")).toBe(true);
    expect(canRescore("配信済")).toBe(true);
    expect(canRescore("既読")).toBe(true);
    expect(canRescore(null)).toBe(true);
  });
});

describe("nextProposalStatus", () => {
  it("知らせた事実は再採点しても消さない", () => {
    expect(nextProposalStatus("配信済", true)).toBe("配信済");
    expect(nextProposalStatus("既読", true)).toBe("既読");
  });

  it("新規と未配信は提案対象", () => {
    expect(nextProposalStatus(null, true)).toBe("提案対象");
    expect(nextProposalStatus("提案対象", true)).toBe("提案対象");
  });

  it("条件を満たさなくなったら対象外にする（知らせ済みでも）", () => {
    expect(nextProposalStatus("配信済", false)).toBe("対象外");
    expect(nextProposalStatus(null, false)).toBe("対象外");
  });
});

describe("isUndelivered", () => {
  it("新着として知らせるのは提案対象だけ", () => {
    expect(isUndelivered("提案対象")).toBe(true);
    expect(isUndelivered("配信済")).toBe(false);
    expect(isUndelivered("既読")).toBe(false);
  });
});
