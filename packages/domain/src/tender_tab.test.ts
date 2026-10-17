import { describe, expect, it } from "vitest";
import { activeWorkTab, defaultTenderTab, isTenderTabKey, TENDER_TAB_KEYS } from "./tender_tab";
import { buildRoadmap, type RoadmapInput } from "./tender_stance";

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

const roadmap = (over: Partial<RoadmapInput> = {}) => buildRoadmap({ ...未着手, ...over }, NOW);

describe("isTenderTabKey", () => {
  it("タブの識別子だけを通す", () => {
    for (const key of TENDER_TAB_KEYS) expect(isTenderTabKey(key)).toBe(true);
    for (const bad of ["", "fit ", "Fit", "見積依頼", null, undefined]) {
      expect(isTenderTabKey(bad)).toBe(false);
    }
  });
});

describe("defaultTenderTab", () => {
  it("参加を決めた案件は、いまやる作業のタブを開く", () => {
    expect(defaultTenderTab("参加", roadmap())).toBe("docs");
    expect(defaultTenderTab("参加", roadmap({ officialStatus: "取得済" }))).toBe("request");
    expect(defaultTenderTab("参加", roadmap({ officialStatus: "取得済", quoteRequested: true }))).toBe("cost");
    expect(
      defaultTenderTab("参加", roadmap({ officialStatus: "取得済", quoteRequested: true, bidPriceDecided: true })),
    ).toBe("forms");
  });

  it("まだ決めていない案件は、決めるところから開く", () => {
    for (const stance of ["未定", "検討", "保留", "見送り"] as const) {
      expect(defaultTenderTab(stance, roadmap())).toBe("fit");
    }
  });

  it("開札待ちは、こちらから作業する画面が無いので参加判断を開く", () => {
    const 提出済 = roadmap({
      officialStatus: "取得済",
      quoteRequested: true,
      bidPriceDecided: true,
      formsReady: true,
      submitted: true,
    });
    expect(defaultTenderTab("参加", 提出済)).toBe("fit");
  });

  it("段取りが全部済んでいれば参加判断を開く", () => {
    const 終わり = roadmap({
      officialStatus: "取得済",
      quoteRequested: true,
      bidPriceDecided: true,
      formsReady: true,
      submitted: true,
      checkedSteps: ["open"],
    });
    expect(defaultTenderTab("参加", 終わり)).toBe("fit");
  });

  it("段取りが空でも落ちない（参加以外は段取りを組んでいない）", () => {
    expect(defaultTenderTab("参加", [])).toBe("fit");
  });
});

describe("activeWorkTab", () => {
  it("参加の案件は、いま作業するタブを返す", () => {
    expect(activeWorkTab("参加", roadmap())).toBe("docs");
  });

  it("決めていない案件・開札待ちは null（印を付けない）", () => {
    expect(activeWorkTab("検討", roadmap())).toBeNull();
    expect(
      activeWorkTab(
        "参加",
        roadmap({ officialStatus: "取得済", quoteRequested: true, bidPriceDecided: true, formsReady: true, submitted: true }),
      ),
    ).toBeNull();
  });
});
