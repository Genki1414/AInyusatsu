import { describe, expect, it } from "vitest";
import { qualificationsSchema } from "./qualifications";

describe("qualificationsSchema", () => {
  it("資格・条件が埋まった例を受理する", () => {
    const result = qualificationsSchema.safeParse({
      qualifications: [
        { text: "全省庁統一資格（役務の提供等）B等級以上", category: "資格", quote: "役務の提供等の資格を有する者", source: "公告 4" },
        { text: "東京都内に本店または営業所を有する者", category: "地域", quote: "都内に本店等を有する者", source: "入札説明書 2" },
      ],
      conditions: [{ text: "予算決算及び会計令第70条・第71条に該当しない者", quote: "第70条及び第71条", source: "公告 5" }],
      unknown_reason: null,
    });
    expect(result.success).toBe(true);
  });

  it("空配列（資料に記載がない）を受理する", () => {
    const result = qualificationsSchema.safeParse({
      qualifications: [],
      conditions: [],
      unknown_reason: "入札説明書が未取得のため確認できず",
    });
    expect(result.success).toBe(true);
  });

  it("categoryが辞書外なら拒否する", () => {
    const result = qualificationsSchema.safeParse({
      qualifications: [{ text: "x", category: "その他の区分", quote: "x", source: "x" }],
      conditions: [],
      unknown_reason: null,
    });
    expect(result.success).toBe(false);
  });
});
