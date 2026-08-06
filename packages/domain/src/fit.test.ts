import { describe, expect, it } from "vitest";
import { evaluateFit, meetsGradeRequirement, type FitCompanyProfile, type FitCriteriaSet, type FitTender } from "./fit";

const baseTender: FitTender = {
  agencyId: "agency-1",
  qualCategory: "役務の提供等",
  item: "清掃",
  grade: "B以上",
  areas: ["東北"],
  budget: 5_000_000,
  submitDeadline: "2026-08-20T17:00:00+09:00",
  name: "庁舎清掃業務委託",
  specText: "建物内外の清掃を行う。",
  trades: ["清掃"],
};

const baseCompany: FitCompanyProfile = {
  qualCategories: ["役務の提供等"],
  grades: { 役務の提供等: "A" },
  items: ["清掃"],
  areas: ["東北"],
};

const baseCriteria: FitCriteriaSet = {
  items: [],
  areas: [],
  keywords: [],
  ngWords: [],
  ngAgencies: [],
  minBudget: null,
  maxBudget: null,
  minDays: 5,
};

const now = new Date("2026-08-06T00:00:00+09:00");

describe("meetsGradeRequirement", () => {
  it("要件が無ければ常にtrue", () => {
    expect(meetsGradeRequirement(null, "D")).toBe(true);
  });

  it("'B以上'はA・Bを満たす", () => {
    expect(meetsGradeRequirement("B以上", "A")).toBe(true);
    expect(meetsGradeRequirement("B以上", "B")).toBe(true);
  });

  it("'B以上'はC・Dを満たさない", () => {
    expect(meetsGradeRequirement("B以上", "C")).toBe(false);
    expect(meetsGradeRequirement("B以上", "D")).toBe(false);
  });

  it("'C又はD'はC・Dのみ満たす", () => {
    expect(meetsGradeRequirement("C又はD", "C")).toBe(true);
    expect(meetsGradeRequirement("C又はD", "D")).toBe(true);
    expect(meetsGradeRequirement("C又はD", "B")).toBe(false);
  });

  it("単一等級は完全一致のみ満たす", () => {
    expect(meetsGradeRequirement("B", "B")).toBe(true);
    expect(meetsGradeRequirement("B", "A")).toBe(false);
  });

  it("自社の等級が不明ならfalse", () => {
    expect(meetsGradeRequirement("B以上", null)).toBe(false);
  });
});

describe("evaluateFit", () => {
  it("すべて満たす場合は満点かつ対象外にならない", () => {
    const result = evaluateFit(baseTender, baseCompany, baseCriteria, { partnerTrades: ["清掃"], now });
    expect(result.eligible).toBe(true);
    expect(result.excludedReason).toBeNull();
    expect(result.score).toBe(100);
    expect(result.breakdown).toEqual({
      qualCategory: 20,
      item: 20,
      grade: 15,
      areas: 15,
      budget: 10,
      daysLeft: 10,
      partners: 10,
    });
  });

  it("資格区分を保有していなければ対象外", () => {
    const company: FitCompanyProfile = { ...baseCompany, qualCategories: [] };
    const result = evaluateFit(baseTender, company, baseCriteria, { partnerTrades: [], now });
    expect(result.eligible).toBe(false);
    expect(result.excludedReason).toContain("資格区分");
    expect(result.breakdown.qualCategory).toBe(0);
  });

  it("営業品目に対応していなければ対象外", () => {
    const company: FitCompanyProfile = { ...baseCompany, items: [] };
    const result = evaluateFit(baseTender, company, baseCriteria, { partnerTrades: [], now });
    expect(result.eligible).toBe(false);
    expect(result.excludedReason).toContain("営業品目");
  });

  it("等級要件を満たさなければ対象外", () => {
    const company: FitCompanyProfile = { ...baseCompany, grades: { 役務の提供等: "D" } };
    const result = evaluateFit(baseTender, company, baseCriteria, { partnerTrades: [], now });
    expect(result.eligible).toBe(false);
    expect(result.excludedReason).toContain("等級");
  });

  it("資格区分が未確認（null）なら対象外にはせず0点でNGに記録する", () => {
    const tender: FitTender = { ...baseTender, qualCategory: null };
    const result = evaluateFit(tender, baseCompany, baseCriteria, { partnerTrades: ["清掃"], now });
    expect(result.eligible).toBe(true);
    expect(result.breakdown.qualCategory).toBe(0);
    expect(result.reasonsNg).toContain("資格区分が未確認のため判定できません");
  });

  it("営業品目が未確認（null）なら対象外にはせず0点でNGに記録する", () => {
    const tender: FitTender = { ...baseTender, item: null };
    const result = evaluateFit(tender, baseCompany, baseCriteria, { partnerTrades: ["清掃"], now });
    expect(result.eligible).toBe(true);
    expect(result.breakdown.item).toBe(0);
  });

  it("自社の等級情報が未登録（null）なら対象外にはせず0点でNGに記録する", () => {
    const company: FitCompanyProfile = { ...baseCompany, grades: {} };
    const result = evaluateFit(baseTender, company, baseCriteria, { partnerTrades: ["清掃"], now });
    expect(result.eligible).toBe(true);
    expect(result.breakdown.grade).toBe(0);
  });

  it("等級指定なし（null）は制限なしとして満点", () => {
    const tender: FitTender = { ...baseTender, grade: null };
    const result = evaluateFit(tender, baseCompany, baseCriteria, { partnerTrades: ["清掃"], now });
    expect(result.breakdown.grade).toBe(15);
  });

  it("条件セットのitemsで絞り込まれた場合、絞り込み後の品目のみ一致とみなす", () => {
    const criteria: FitCriteriaSet = { ...baseCriteria, items: ["電気"] };
    const result = evaluateFit(baseTender, baseCompany, criteria, { partnerTrades: [], now });
    expect(result.breakdown.item).toBe(0);
    expect(result.eligible).toBe(false);
  });

  it("地域が対応外でも対象外にはせず加点のみ0にする", () => {
    const tender: FitTender = { ...baseTender, areas: ["九州"] };
    const result = evaluateFit(tender, baseCompany, baseCriteria, { partnerTrades: ["清掃"], now });
    expect(result.eligible).toBe(true);
    expect(result.breakdown.areas).toBe(0);
  });

  it("地域指定なし（空配列）は制限なしとして満点", () => {
    const tender: FitTender = { ...baseTender, areas: [] };
    const result = evaluateFit(tender, baseCompany, baseCriteria, { partnerTrades: ["清掃"], now });
    expect(result.breakdown.areas).toBe(15);
  });

  it("予定価格が非公表なら中立の5点", () => {
    const tender: FitTender = { ...baseTender, budget: null };
    const result = evaluateFit(tender, baseCompany, baseCriteria, { partnerTrades: ["清掃"], now });
    expect(result.breakdown.budget).toBe(5);
  });

  it("予定価格が希望範囲外なら0点（対象外にはしない）", () => {
    const criteria: FitCriteriaSet = { ...baseCriteria, minBudget: 10_000_000 };
    const result = evaluateFit(baseTender, baseCompany, criteria, { partnerTrades: ["清掃"], now });
    expect(result.breakdown.budget).toBe(0);
    expect(result.eligible).toBe(true);
  });

  it("残日数が必要日数ちょうどなら満点", () => {
    const tender: FitTender = { ...baseTender, submitDeadline: "2026-08-11T00:00:00+09:00" };
    const result = evaluateFit(tender, baseCompany, baseCriteria, { partnerTrades: ["清掃"], now });
    expect(result.breakdown.daysLeft).toBe(10);
  });

  it("残日数が必要日数を1日でも下回れば0点", () => {
    const tender: FitTender = { ...baseTender, submitDeadline: "2026-08-10T00:00:00+09:00" };
    const result = evaluateFit(tender, baseCompany, baseCriteria, { partnerTrades: ["清掃"], now });
    expect(result.breakdown.daysLeft).toBe(0);
  });

  it("提出期限を過ぎていれば0点（対象外にはしない）", () => {
    const tender: FitTender = { ...baseTender, submitDeadline: "2026-08-01T00:00:00+09:00" };
    const result = evaluateFit(tender, baseCompany, baseCriteria, { partnerTrades: ["清掃"], now });
    expect(result.breakdown.daysLeft).toBe(0);
    expect(result.eligible).toBe(true);
  });

  it("提出期限が未確認（null）なら0点でNGに記録する", () => {
    const tender: FitTender = { ...baseTender, submitDeadline: null };
    const result = evaluateFit(tender, baseCompany, baseCriteria, { partnerTrades: ["清掃"], now });
    expect(result.breakdown.daysLeft).toBe(0);
    expect(result.reasonsNg).toContain("提出期限が未確認のため残日数を判定できません");
  });

  it("必要業種が無ければ満点", () => {
    const tender: FitTender = { ...baseTender, trades: [] };
    const result = evaluateFit(tender, baseCompany, baseCriteria, { partnerTrades: [], now });
    expect(result.breakdown.partners).toBe(10);
  });

  it("必要業種の一部にのみ対応する協力会社があれば比例配点", () => {
    const tender: FitTender = { ...baseTender, trades: ["清掃", "電気"] };
    const result = evaluateFit(tender, baseCompany, baseCriteria, { partnerTrades: ["清掃"], now });
    expect(result.breakdown.partners).toBe(5);
  });

  it("必要業種に対応する協力会社が無ければ0点", () => {
    const tender: FitTender = { ...baseTender, trades: ["清掃"] };
    const result = evaluateFit(tender, baseCompany, baseCriteria, { partnerTrades: [], now });
    expect(result.breakdown.partners).toBe(0);
  });

  it("除外対象の発注機関なら対象外", () => {
    const criteria: FitCriteriaSet = { ...baseCriteria, ngAgencies: ["agency-1"] };
    const result = evaluateFit(baseTender, baseCompany, criteria, { partnerTrades: ["清掃"], now });
    expect(result.eligible).toBe(false);
    expect(result.excludedReason).toContain("発注機関");
  });

  it("除外キーワードが案件名・仕様書本文に含まれれば対象外", () => {
    const criteria: FitCriteriaSet = { ...baseCriteria, ngWords: ["清掃"] };
    const result = evaluateFit(baseTender, baseCompany, criteria, { partnerTrades: ["清掃"], now });
    expect(result.eligible).toBe(false);
    expect(result.excludedReason).toContain("除外キーワード");
  });

  it("キーワード指定があり、案件名・仕様書本文のいずれにも一致しなければ対象外", () => {
    const criteria: FitCriteriaSet = { ...baseCriteria, keywords: ["電気工事"] };
    const result = evaluateFit(baseTender, baseCompany, criteria, { partnerTrades: ["清掃"], now });
    expect(result.eligible).toBe(false);
    expect(result.excludedReason).toContain("キーワード");
  });

  it("キーワード指定があり、仕様書本文に一致すれば対象外にしない", () => {
    const criteria: FitCriteriaSet = { ...baseCriteria, keywords: ["清掃"] };
    const result = evaluateFit(baseTender, baseCompany, criteria, { partnerTrades: ["清掃"], now });
    expect(result.eligible).toBe(true);
  });

  it("複数のゲート条件に同時に違反した場合、理由をすべて連結する", () => {
    const company: FitCompanyProfile = { qualCategories: [], grades: { 役務の提供等: "D" }, items: [], areas: [] };
    const result = evaluateFit(baseTender, company, baseCriteria, { partnerTrades: [], now });
    expect(result.eligible).toBe(false);
    expect(result.excludedReason).toContain("資格区分");
    expect(result.excludedReason).toContain("営業品目");
    expect(result.excludedReason).toContain("等級");
  });
});
