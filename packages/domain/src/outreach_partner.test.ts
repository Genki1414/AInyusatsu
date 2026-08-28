import { describe, expect, it } from "vitest";
import {
  canRegisterAsPartner,
  canRequestQuote,
  findExistingPartner,
  normalizePartnerName,
  toPartnerDraft,
  tradesAfterAdding,
  type OutreachCompanyInput,
} from "./outreach_partner";

const company: OutreachCompanyInput = {
  companyId: 42,
  name: "株式会社山田電機",
  pref: "宮城県",
  tel: "022-000-0000",
  email: "info@example.co.jp",
  contactUrl: "https://example.co.jp/contact",
  websiteUrl: "https://example.co.jp",
};

describe("canRegisterAsPartner", () => {
  it("社名があれば登録できる", () => {
    expect(canRegisterAsPartner(company)).toBe(true);
  });

  it("社名が無いものは登録させない（あとから見分けがつかない）", () => {
    expect(canRegisterAsPartner({ ...company, name: "  " })).toBe(false);
    expect(canRegisterAsPartner({ ...company, name: "（社名不明）" })).toBe(false);
  });
});

describe("canRequestQuote", () => {
  it("メールアドレスが無ければ見積依頼は出せない", () => {
    expect(canRequestQuote({ ...company, email: null })).toBe(false);
    expect(canRequestQuote({ ...company, email: " " })).toBe(false);
  });

  it("あれば出せる", () => {
    expect(canRequestQuote(company)).toBe(true);
  });
});

describe("toPartnerDraft", () => {
  const context = { trade: "電気", tenderName: "◯◯庁舎 電気設備保守", sentOnLabel: "2026/08/28" };

  it("営業AIの列名をpartnersの列名へ詰め替える", () => {
    const draft = toPartnerDraft(company, context);
    expect(draft.name).toBe("株式会社山田電機");
    expect(draft.tel).toBe("022-000-0000");
    expect(draft.email).toBe("info@example.co.jp");
    expect(draft.base).toBe("宮城県");
    expect(draft.trades).toEqual(["電気"]);
    expect(draft.areas).toEqual(["宮城県"]);
  });

  it("どこから来た会社かをmemoに残す", () => {
    const memo = toPartnerDraft(company, context).memo;
    expect(memo).toContain("◯◯庁舎 電気設備保守");
    expect(memo).toContain("電気");
    expect(memo).toContain("2026/08/28");
    expect(memo).toContain("https://example.co.jp/contact");
  });

  it("都道府県が取れなければ対応地域は空にする（全国対応とみなさない）", () => {
    const draft = toPartnerDraft({ ...company, pref: null }, context);
    expect(draft.areas).toEqual([]);
    expect(draft.base).toBeNull();
  });

  it("取れなかった連絡先は推測で埋めない", () => {
    const draft = toPartnerDraft({ ...company, tel: null, email: null }, context);
    expect(draft.tel).toBeNull();
    expect(draft.email).toBeNull();
  });

  it("打診日が分からなくても組み立てられる", () => {
    const memo = toPartnerDraft(company, { ...context, sentOnLabel: null }).memo;
    expect(memo).toContain("案件：");
    expect(memo).not.toContain("打診：");
  });
});

describe("normalizePartnerName", () => {
  it("株式会社の表記ゆれを吸収する", () => {
    expect(normalizePartnerName("㈱山田")).toBe(normalizePartnerName("株式会社山田"));
    expect(normalizePartnerName("(株)山田")).toBe(normalizePartnerName("株式会社山田"));
    expect(normalizePartnerName("（株）山田")).toBe(normalizePartnerName("株式会社山田"));
    expect(normalizePartnerName("㈲山田")).toBe(normalizePartnerName("有限会社山田"));
  });

  it("空白の有無で別会社にしない", () => {
    expect(normalizePartnerName("株式会社 山田")).toBe(normalizePartnerName("株式会社山田"));
    expect(normalizePartnerName("株式会社　山田")).toBe(normalizePartnerName("株式会社山田"));
  });

  it("名前が違えば別会社のまま（似ているだけで同じにしない）", () => {
    expect(normalizePartnerName("株式会社山田電機")).not.toBe(normalizePartnerName("株式会社山田電気"));
    expect(normalizePartnerName("山田工業")).not.toBe(normalizePartnerName("山田工務店"));
  });
});

describe("findExistingPartner", () => {
  const partners = [
    { id: "a", name: "株式会社山田電機" },
    { id: "b", name: "佐藤設備" },
  ];

  it("表記ゆれでも見つける（二重登録で同じ会社へ2通行くのを防ぐ）", () => {
    expect(findExistingPartner(partners, "㈱山田電機")?.id).toBe("a");
    expect(findExistingPartner(partners, "株式会社 山田電機")?.id).toBe("a");
  });

  it("無ければ null", () => {
    expect(findExistingPartner(partners, "鈴木電設")).toBeNull();
  });
});

describe("tradesAfterAdding", () => {
  it("同じ会社が別の業種でも返信をくれたら、行を増やさず業種を足す", () => {
    expect(tradesAfterAdding(["電気"], "清掃")).toEqual(["電気", "清掃"]);
  });

  it("すでにある業種は足さない", () => {
    expect(tradesAfterAdding(["電気", "清掃"], "電気")).toEqual(["電気", "清掃"]);
  });
});
