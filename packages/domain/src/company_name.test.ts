import { describe, expect, it } from "vitest";
import { findSameNameOrg, isSameCompanyName, normalizeCompanyName } from "./company_name";

describe("normalizeCompanyName", () => {
  it("株式会社・有限会社の表記ゆれを吸収する", () => {
    expect(isSameCompanyName("㈱山田", "株式会社山田")).toBe(true);
    expect(isSameCompanyName("(株)山田", "株式会社山田")).toBe(true);
    expect(isSameCompanyName("（株）山田", "株式会社山田")).toBe(true);
    expect(isSameCompanyName("㈲山田", "有限会社山田")).toBe(true);
    expect(isSameCompanyName("(有)山田", "有限会社山田")).toBe(true);
  });

  it("空白の有無で別会社にしない", () => {
    expect(isSameCompanyName("株式会社 山田", "株式会社山田")).toBe(true);
    expect(isSameCompanyName("株式会社　山田", "株式会社山田")).toBe(true);
    expect(isSameCompanyName(" 東北三上機材株式会社 ", "東北三上機材株式会社")).toBe(true);
  });

  it("名前が違えば別会社のまま（似ているだけで同じにしない）", () => {
    expect(isSameCompanyName("株式会社山田電機", "株式会社山田電気")).toBe(false);
    expect(isSameCompanyName("山田工業", "山田工務店")).toBe(false);
    expect(isSameCompanyName("東北三上機材株式会社", "三上機材株式会社")).toBe(false);
  });

  it("表示用には使わない（元の表記を壊す）", () => {
    // 突き合わせ専用であることを、戻り値の形で分かるようにしておく
    expect(normalizeCompanyName("㈱山田 電機")).toBe("株式会社山田電機");
  });
});

describe("findSameNameOrg", () => {
  const orgs = [
    { id: "a", name: "東北三上機材株式会社" },
    { id: "b", name: "佐藤設備工業" },
  ];

  it("表記ゆれでも見つける", () => {
    expect(findSameNameOrg(orgs, "東北三上機材株式会社")?.id).toBe("a");
    expect(findSameNameOrg(orgs, "東北三上機材 株式会社")?.id).toBe("a");
    // ㈱ は位置に関係なく「株式会社」に開くので、末尾でも一致する
    expect(findSameNameOrg(orgs, "東北三上機材㈱")?.id).toBe("a");
  });

  it("無ければ null（新しい会社として発行できる）", () => {
    expect(findSameNameOrg(orgs, "鈴木電設株式会社")).toBeNull();
  });
});
