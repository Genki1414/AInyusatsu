import { describe, expect, it } from "vitest";
import { agencyIdFromName } from "./agency";

describe("agencyIdFromName", () => {
  it("同じ機関名は常に同じidになる（決定的）", () => {
    expect(agencyIdFromName("北陸地方整備局")).toBe(agencyIdFromName("北陸地方整備局"));
  });

  it("表記ゆれ（空白）があっても同じidになる（normalize経由）", () => {
    expect(agencyIdFromName("北陸地方整備局")).toBe(agencyIdFromName("北陸 地方整備局"));
  });

  it("異なる機関名は異なるidになる", () => {
    expect(agencyIdFromName("北陸地方整備局")).not.toBe(agencyIdFromName("関東地方整備局"));
  });

  it("auto-プレフィックス付きの12文字hexになる", () => {
    expect(agencyIdFromName("北陸地方整備局")).toMatch(/^auto-[0-9a-f]{12}$/);
  });

  it("異なるソース（GEPS/KKJ）から同じ機関名が得られた場合、同じidに収束する", () => {
    // GEPSの「調達機関」・KKJの「OrganizationName」が同じ表記であれば、
    // 正規化ロジックが共通のため同じagency_idになる。
    const fromGeps = agencyIdFromName("北陸地方整備局");
    const fromKkj = agencyIdFromName("北陸地方整備局");
    expect(fromGeps).toBe(fromKkj);
  });
});
