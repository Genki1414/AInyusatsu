import { describe, expect, it } from "vitest";
import { buildPartnerRecommendUserPrompt } from "./recommend";

describe("buildPartnerRecommendUserPrompt", () => {
  it("案件情報・数量表・候補一覧を含める", () => {
    const prompt = buildPartnerRecommendUserPrompt({
      trade: "清掃",
      tenderItem: "建物管理等",
      place: "東京都千代田区",
      lots: [{ item: "日常清掃", spec: "床面清掃", qty: 1, unit: "式" }],
      candidates: [
        { id: "p1", name: "東葉クリーン株式会社", trades: ["清掃"], areas: ["関東・甲信越"], rating: 4.5, memo: "対応が早い" },
        { id: "p2", name: "サンプル商事", trades: [], areas: [], rating: null, memo: null },
      ],
    });

    expect(prompt).toContain("業種: 清掃");
    expect(prompt).toContain("営業品目: 建物管理等");
    expect(prompt).toContain("履行場所: 東京都千代田区");
    expect(prompt).toContain("日常清掃（床面清掃） 1式");
    expect(prompt).toContain("id: p1");
    expect(prompt).toContain("会社名: 東葉クリーン株式会社");
    expect(prompt).toContain("対応業種: 清掃");
    expect(prompt).toContain("評価: 4.5");
    expect(prompt).toContain("メモ: 対応が早い");
    expect(prompt).toContain("id: p2");
    expect(prompt).toContain("対応業種: 未登録");
  });

  it("数量表が無い場合はその旨を書く", () => {
    const prompt = buildPartnerRecommendUserPrompt({
      trade: "警備",
      tenderItem: null,
      place: null,
      lots: [],
      candidates: [],
    });
    expect(prompt).toContain("（数量表の記載なし）");
    expect(prompt).toContain("営業品目: 不明");
  });
});
