import { describe, expect, it } from "vitest";
import { mergeBasicInfoIntoTender, type TenderBasicFields } from "./tender_merge";

const emptyCurrent: TenderBasicFields = {
  org_unit: null,
  submit_deadline: null,
  qa_deadline: null,
  bid_open_at: null,
  term_from: null,
  term_to: null,
  place: null,
  qual_category: "未判定",
  item: null,
  grade: null,
  areas: [],
  budget: null,
};

describe("mergeBasicInfoIntoTender", () => {
  it("空欄の項目はAI解析の値で埋める", () => {
    const patch = mergeBasicInfoIntoTender(emptyCurrent, {
      submit_deadline: "2026-08-01T17:00",
      qual_category: "役務の提供等",
      areas: ["関東・甲信越"],
      budget: 5000000,
    });
    expect(patch).toEqual({
      submit_deadline: "2026-08-01T17:00",
      qual_category: "役務の提供等",
      areas: ["関東・甲信越"],
      budget: 5000000,
    });
  });

  it("既にコネクタが値を持っている項目は上書きしない", () => {
    const current: TenderBasicFields = { ...emptyCurrent, place: "東京都千代田区", grade: "B" };
    const patch = mergeBasicInfoIntoTender(current, {
      place: "AIが読み違えた場所",
      grade: "A",
    });
    expect(patch).toEqual({});
  });

  it("qual_categoryが「未判定」でなく実値なら上書きしない", () => {
    const current: TenderBasicFields = { ...emptyCurrent, qual_category: "役務の提供等" };
    const patch = mergeBasicInfoIntoTender(current, { qual_category: "物品の販売" });
    expect(patch).toEqual({});
  });

  it("areasが既に入っていれば上書きしない", () => {
    const current: TenderBasicFields = { ...emptyCurrent, areas: ["関東・甲信越"] };
    const patch = mergeBasicInfoIntoTender(current, { areas: ["近畿"] });
    expect(patch).toEqual({});
  });

  it("抽出値がnullの項目はパッチに含めない（推測で埋めない）", () => {
    const patch = mergeBasicInfoIntoTender(emptyCurrent, { submit_deadline: null, budget: null });
    expect(patch).toEqual({});
  });

  it("抽出値の空配列はパッチに含めない", () => {
    const patch = mergeBasicInfoIntoTender(emptyCurrent, { areas: [] });
    expect(patch).toEqual({});
  });
});
