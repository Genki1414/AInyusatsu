import { describe, expect, it } from "vitest";
import { recommendPartnersByRules } from "./partner_recommendation";

const candidates = [
  { id: "miyagi-low", name: "宮城B社", areas: ["宮城県"], rating: 3 },
  { id: "unknown-high", name: "未登録A社", areas: [], rating: 5 },
  { id: "tokyo", name: "東京社", areas: ["東京都"], rating: 5 },
  { id: "miyagi-high", name: "宮城A社", areas: ["宮城県"], rating: 5 },
];

describe("recommendPartnersByRules", () => {
  it("エリア一致を優先し、明確なエリア外を除く", () => {
    expect(recommendPartnersByRules(candidates, "宮城県仙台市").map((x) => x.partner_id)).toEqual([
      "miyagi-high",
      "miyagi-low",
      "unknown-high",
    ]);
  });

  it("場所が未確認ならエリアを理由に除外しない", () => {
    expect(recommendPartnersByRules(candidates, null).map((x) => x.partner_id)).toEqual([
      "miyagi-high",
      "tokyo",
      "unknown-high",
      "miyagi-low",
    ]);
  });

  it("上限を守り、理由を返す", () => {
    const result = recommendPartnersByRules(candidates, "宮城県仙台市", 1);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toContain("対応エリアが一致");
    expect(result[0].reason).toContain("評価5");
  });
});
