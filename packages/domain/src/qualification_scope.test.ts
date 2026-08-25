import { describe, expect, it } from "vitest";
import { classifyAgencyScope, isSourceAgency, judgeQualificationScope, shouldAnalyze } from "./qualification_scope";

describe("classifyAgencyScope", () => {
  it("府省庁を国と判定する", () => {
    expect(classifyAgencyScope("国土交通省")).toBe("国");
    expect(classifyAgencyScope("厚生労働省")).toBe("国");
    expect(classifyAgencyScope("内閣府")).toBe("国");
    expect(classifyAgencyScope("会計検査院")).toBe("国");
    expect(classifyAgencyScope("特許庁")).toBe("国");
  });

  it("地方支分部局を国と判定する", () => {
    expect(classifyAgencyScope("関東地方整備局")).toBe("国");
    expect(classifyAgencyScope("東京国税局")).toBe("国");
    expect(classifyAgencyScope("大阪労働局")).toBe("国");
    expect(classifyAgencyScope("北海道開発局")).toBe("国");
    expect(classifyAgencyScope("沖縄総合事務局")).toBe("国");
    expect(classifyAgencyScope("新潟地方検察庁")).toBe("国");
  });

  it("自治体名を含む国の機関を、自治体と取り違えない", () => {
    expect(classifyAgencyScope("国土交通省 北海道開発局")).toBe("国");
    expect(classifyAgencyScope("東京都千代田区 東京法務局")).toBe("国");
  });

  it("都道府県・市区町村を自治体と判定する", () => {
    expect(classifyAgencyScope("新潟県")).toBe("自治体");
    expect(classifyAgencyScope("北海道")).toBe("自治体");
    expect(classifyAgencyScope("東京都")).toBe("自治体");
    expect(classifyAgencyScope("横浜市")).toBe("自治体");
    expect(classifyAgencyScope("三条市役所")).toBe("自治体");
    expect(classifyAgencyScope("〇〇町教育委員会")).toBe("自治体");
  });

  it("県警察本部を国の警察庁と取り違えない", () => {
    expect(classifyAgencyScope("新潟県警察本部")).toBe("自治体");
    expect(classifyAgencyScope("警察庁")).toBe("国");
  });

  it("一部事務組合・広域連合を自治体と判定する", () => {
    expect(classifyAgencyScope("〇〇地区一部事務組合")).toBe("自治体");
    expect(classifyAgencyScope("後期高齢者医療広域連合")).toBe("自治体");
  });

  it("独立行政法人等を分けて判定する", () => {
    expect(classifyAgencyScope("独立行政法人 国立印刷局")).toBe("独立行政法人等");
    expect(classifyAgencyScope("国立大学法人 新潟大学")).toBe("独立行政法人等");
    expect(classifyAgencyScope("国立研究開発法人 宇宙航空研究開発機構")).toBe("独立行政法人等");
    expect(classifyAgencyScope("独立行政法人 国立病院機構")).toBe("独立行政法人等");
  });

  it("判定できない名前は不明（推測しない）", () => {
    expect(classifyAgencyScope("")).toBe("不明");
    expect(classifyAgencyScope("〇〇センター")).toBe("不明");
    expect(classifyAgencyScope("日本〇〇協会")).toBe("不明");
  });
});

describe("judgeQualificationScope", () => {
  it("国の機関の物品・役務は対象", () => {
    expect(judgeQualificationScope({ govScope: "国", procurement: "役務" })).toEqual({
      verdict: "対象",
      reason: "国の機関（役務）",
    });
    expect(judgeQualificationScope({ govScope: "国", procurement: "物品" }).verdict).toBe("対象");
  });

  it("種別が取れていなくても、国の機関なら対象にする", () => {
    const decision = judgeQualificationScope({ govScope: "国", procurement: "不明" });
    expect(decision.verdict).toBe("対象");
    expect(decision.reason).toBe("国の機関（種別は不明）");
  });

  it("建設工事は機関によらず対象外", () => {
    expect(judgeQualificationScope({ govScope: "国", procurement: "工事" })).toEqual({
      verdict: "対象外",
      reason: "建設工事（V2）",
    });
  });

  it("自治体・独立行政法人等は対象外（理由を残す）", () => {
    expect(judgeQualificationScope({ govScope: "自治体", procurement: "役務" })).toEqual({
      verdict: "対象外",
      reason: "自治体（V2）",
    });
    expect(judgeQualificationScope({ govScope: "独立行政法人等", procurement: "物品" }).verdict).toBe("対象外");
  });

  it("設定を変えれば独立行政法人等を対象に含められる", () => {
    const input = { govScope: "独立行政法人等" as const, procurement: "役務" };
    expect(judgeQualificationScope(input).verdict).toBe("対象外");
    expect(judgeQualificationScope(input, { includeIncorporated: true }).verdict).toBe("対象");
  });

  it("独立行政法人等を含める設定でも、建設工事は対象外のまま", () => {
    const decision = judgeQualificationScope(
      { govScope: "独立行政法人等", procurement: "工事" },
      { includeIncorporated: true },
    );
    expect(decision).toEqual({ verdict: "対象外", reason: "建設工事（V2）" });
  });

  it("機関を分類できないものは未判定（対象にも対象外にもしない）", () => {
    expect(judgeQualificationScope({ govScope: "不明", procurement: "役務" })).toEqual({
      verdict: "未判定",
      reason: "発注機関を分類できない",
    });
  });
});

describe("shouldAnalyze", () => {
  it("対象だけ解析する。未判定には費用をかけない", () => {
    expect(shouldAnalyze({ verdict: "対象", reason: "" })).toBe(true);
    expect(shouldAnalyze({ verdict: "未判定", reason: "" })).toBe(false);
    expect(shouldAnalyze({ verdict: "対象外", reason: "" })).toBe(false);
  });
});

// 実データ（2026-08-25 の agencies:classify）で「不明」になった機関。
// 分類できなかったものを、次に同じ取りこぼしをしないためテストに残す。
describe("実データで取りこぼした機関", () => {
  it("地方整備局の下の事務所を国と判定する", () => {
    expect(classifyAgencyScope("仙台河川国道事務所")).toBe("国");
    expect(classifyAgencyScope("東北技術事務所")).toBe("国");
  });

  it("「地方」が付かない地方支分部局を国と判定する", () => {
    expect(classifyAgencyScope("東北防衛局")).toBe("国");
    expect(classifyAgencyScope("関東信越厚生局")).toBe("国");
    expect(classifyAgencyScope("東北農政局")).toBe("国");
    expect(classifyAgencyScope("関東経済産業局")).toBe("国");
  });

  it("法人名の付かない大学を独立行政法人等と判定する", () => {
    expect(classifyAgencyScope("東北大学")).toBe("独立行政法人等");
    expect(classifyAgencyScope("放送大学学園")).toBe("独立行政法人等");
    expect(classifyAgencyScope("日本私立学校振興・共済事業団")).toBe("独立行政法人等");
  });

  it("省庁の大学校は国のまま（末尾が「校」）", () => {
    expect(classifyAgencyScope("防衛大学校")).toBe("国");
    expect(classifyAgencyScope("気象大学校")).toBe("国");
  });

  it("自治体の工事事務所を国と取り違えない", () => {
    expect(classifyAgencyScope("東京都第三建設事務所")).toBe("自治体");
    expect(classifyAgencyScope("新潟県 河川事務所")).toBe("自治体");
  });

  it("収集元そのものは発注機関ではないので不明のまま", () => {
    expect(classifyAgencyScope("官公需情報ポータル(API)")).toBe("不明");
    expect(classifyAgencyScope("調達ポータル")).toBe("不明");
  });
});

describe("国の委員会", () => {
  it("委員会名のあとに住所が続いても国と判定する（実データ例）", () => {
    expect(classifyAgencyScope("個人情報保護委員会東京都")).toBe("国");
    expect(classifyAgencyScope("公正取引委員会")).toBe("国");
    expect(classifyAgencyScope("原子力規制委員会")).toBe("国");
  });

  it("県の委員会と取り違えない", () => {
    expect(classifyAgencyScope("新潟県教育委員会")).toBe("自治体");
  });
});

describe("isSourceAgency", () => {
  it("収集元そのものは発注機関ではない", () => {
    expect(isSourceAgency("kkj")).toBe(true);
    expect(isSourceAgency("p-portal")).toBe(true);
    expect(isSourceAgency("auto-51e03e554603")).toBe(false);
  });
});
