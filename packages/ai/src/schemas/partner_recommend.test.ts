import { describe, expect, it } from "vitest";
import { partnerRecommendSchema } from "./partner_recommend";

describe("partnerRecommendSchema", () => {
  it("推薦ありの出力を受理する", () => {
    const result = partnerRecommendSchema.safeParse({
      recommendations: [
        { partner_id: "p1", reason: "対応業種・エリアが一致し、評価も高い" },
        { partner_id: "p2", reason: "対応業種が一致する" },
      ],
      note: null,
    });
    expect(result.success).toBe(true);
  });

  it("推薦なし（判断材料が乏しい）の出力も受理する", () => {
    const result = partnerRecommendSchema.safeParse({
      recommendations: [],
      note: "候補間に判断できるだけの差がありませんでした",
    });
    expect(result.success).toBe(true);
  });

  it("reasonが無い推薦は拒否する", () => {
    const result = partnerRecommendSchema.safeParse({
      recommendations: [{ partner_id: "p1" }],
      note: null,
    });
    expect(result.success).toBe(false);
  });
});
