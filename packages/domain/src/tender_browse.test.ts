import { describe, expect, it } from "vitest";
import {
  BROWSABLE_COLLECT_STATUSES,
  deadlineCutoff,
  expandAreaFilter,
  hasActiveFilter,
  parseDeadlineWithin,
  PENDING_COLLECT_STATUSES,
  pickBestProposal,
  proposalsByTender,
  tenderVerdict,
  type BrowseProposal,
} from "./tender_browse";

function proposal(over: Partial<BrowseProposal> = {}): BrowseProposal {
  return { tenderId: "t1", status: "提案対象", score: 50, excludedReason: null, ...over };
}

describe("BROWSABLE_COLLECT_STATUSES", () => {
  it("解析まで終わった状態だけを出す（収集途中の案件は出さない）", () => {
    expect([...BROWSABLE_COLLECT_STATUSES]).toEqual(["解析完了", "公開中"]);
  });

  it("一覧に出す状態と解析待ちの状態が重ならない", () => {
    const browsable = new Set<string>(BROWSABLE_COLLECT_STATUSES);
    expect([...PENDING_COLLECT_STATUSES].some((s) => browsable.has(s))).toBe(false);
  });

  it("終了はどちらにも入らない（期限切れは一覧にも解析待ちにも出さない）", () => {
    expect([...BROWSABLE_COLLECT_STATUSES, ...PENDING_COLLECT_STATUSES]).not.toContain("終了");
  });
});

describe("pickBestProposal", () => {
  it("提案が無ければnull", () => {
    expect(pickBestProposal([])).toBeNull();
  });

  it("適合度が高いものを選ぶ", () => {
    const best = pickBestProposal([proposal({ score: 40 }), proposal({ score: 90 }), proposal({ score: 70 })]);
    expect(best?.score).toBe(90);
  });

  it("対象外でないものを優先する（点が低くても）", () => {
    // 片方の条件セットで対象外でも、もう片方で参加できるなら見落とさせない
    const best = pickBestProposal([
      proposal({ status: "対象外", score: 95, excludedReason: "等級が不足しています" }),
      proposal({ status: "提案対象", score: 30 }),
    ]);
    expect(best?.status).toBe("提案対象");
    expect(best?.score).toBe(30);
  });

  it("すべて対象外なら、その中で適合度が高いものを選ぶ（理由を見せるため）", () => {
    const best = pickBestProposal([
      proposal({ status: "対象外", score: 10, excludedReason: "地域が対象外です" }),
      proposal({ status: "対象外", score: 60, excludedReason: "等級が不足しています" }),
    ]);
    expect(best?.excludedReason).toBe("等級が不足しています");
  });

  it("ユーザーが判断した状態（検討中）も対象外より優先される", () => {
    const best = pickBestProposal([
      proposal({ status: "対象外", score: 99 }),
      proposal({ status: "検討中", score: 20 }),
    ]);
    expect(best?.status).toBe("検討中");
  });
});

describe("proposalsByTender", () => {
  it("案件ごとに1件ずつ選ぶ", () => {
    const map = proposalsByTender([
      proposal({ tenderId: "t1", score: 30 }),
      proposal({ tenderId: "t1", score: 80 }),
      proposal({ tenderId: "t2", score: 10 }),
    ]);
    expect(map.size).toBe(2);
    expect(map.get("t1")?.score).toBe(80);
    expect(map.get("t2")?.score).toBe(10);
  });

  it("提案が無ければ空", () => {
    expect(proposalsByTender([]).size).toBe(0);
  });
});

describe("tenderVerdict", () => {
  it("提案が無ければ未判定（推測で「参加できません」とは出さない）", () => {
    expect(tenderVerdict(null)).toEqual({ kind: "未判定" });
  });

  it("対象外は理由を添えて返す", () => {
    expect(tenderVerdict(proposal({ status: "対象外", score: 12, excludedReason: "等級が不足しています" }))).toEqual({
      kind: "対象外",
      status: "対象外",
      score: 12,
      excludedReason: "等級が不足しています",
    });
  });

  it("対象外でなければ提案対象として返す", () => {
    expect(tenderVerdict(proposal({ status: "検討中", score: 88 }))).toEqual({
      kind: "提案対象",
      status: "検討中",
      score: 88,
    });
  });
});

describe("parseDeadlineWithin", () => {
  it("選択肢の値だけを受け付ける", () => {
    expect(parseDeadlineWithin("7")).toBe(7);
    expect(parseDeadlineWithin("30")).toBe(30);
  });

  it("選択肢に無い値は指定なし", () => {
    expect(parseDeadlineWithin("3")).toBeNull();
    expect(parseDeadlineWithin("abc")).toBeNull();
    expect(parseDeadlineWithin(undefined)).toBeNull();
  });
});

describe("deadlineCutoff", () => {
  it("指定した日数ぶん先の時刻を返す", () => {
    const now = new Date("2026-08-22T10:00:00+09:00");
    expect(deadlineCutoff(7, now).toISOString()).toBe(new Date("2026-08-29T10:00:00+09:00").toISOString());
  });
});

describe("expandAreaFilter", () => {
  const REGIONS = {
    "東北": ["青森県", "岩手県", "宮城県"],
    "関東・甲信越": ["東京都", "神奈川県"],
  };

  it("地方区分を選んだら、その地方の都道府県も一緒に探す", () => {
    expect(expandAreaFilter("東北", REGIONS)).toEqual(["東北", "青森県", "岩手県", "宮城県"]);
  });

  it("都道府県を選んだらそれだけ", () => {
    expect(expandAreaFilter("東京都", REGIONS)).toEqual(["東京都"]);
  });

  it("北海道のように地方区分と都道府県が同名でも重複しない", () => {
    expect(expandAreaFilter("北海道", { "北海道": ["北海道"] })).toEqual(["北海道"]);
  });

  it("空なら何も指定しない", () => {
    expect(expandAreaFilter("", REGIONS)).toEqual([]);
    expect(expandAreaFilter("  ", REGIONS)).toEqual([]);
  });
});

describe("hasActiveFilter", () => {
  it("1つでも指定されていればtrue", () => {
    expect(hasActiveFilter([null, "", "清掃"])).toBe(true);
    expect(hasActiveFilter([null, undefined, 0])).toBe(true);
  });

  it("すべて未指定ならfalse", () => {
    expect(hasActiveFilter([null, undefined, "", "   "])).toBe(false);
    expect(hasActiveFilter([])).toBe(false);
  });
});
