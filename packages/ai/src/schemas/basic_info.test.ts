import { describe, expect, it } from "vitest";
import { basicInfoSchema } from "./basic_info";

describe("basicInfoSchema", () => {
  it("すべて埋まった例を受理する", () => {
    const result = basicInfoSchema.safeParse({
      name: { value: "東京第3合同庁舎 建物清掃業務委託", quote: "建物清掃業務委託", source: "公告 1" },
      agency: { value: "関東地方整備局", quote: null, source: null },
      org_unit: { value: null, quote: null, source: null },
      notice_no: { value: "第123号", quote: null, source: null },
      notice_date: { value: "2026-07-01", quote: null, source: null },
      submit_deadline: { value: "2026-08-01T17:00", quote: null, source: null },
      qa_deadline: { value: "2026-07-20T17:00", quote: null, source: null },
      bid_open_at: { value: "2026-08-05T10:00", quote: null, source: null },
      term_from: { value: "2026-09-01", quote: null, source: null },
      term_to: { value: "2027-03-31", quote: null, source: null },
      place: { value: "東京都千代田区", quote: null, source: null },
      qual_category: { value: "役務の提供等", quote: null, source: null },
      item: { value: "建物管理等", quote: null, source: null },
      grade: { value: "B以上", quote: null, source: null },
      areas: { value: ["関東・甲信越"], quote: null, source: null },
      budget: { value: null, disclosed: false, quote: "非公表", source: "公告 3" },
      jv_allowed: { value: false, quote: null, source: null },
      electronic_bidding: { value: true, quote: null, source: null },
      unknown_fields: [],
    });
    expect(result.success).toBe(true);
  });

  it("すべてnullの最小構成でも受理する（資料が揃わない案件を推測しないため）", () => {
    const emptyField = { value: null, quote: null, source: null };
    const result = basicInfoSchema.safeParse({
      name: emptyField,
      agency: emptyField,
      org_unit: emptyField,
      notice_no: emptyField,
      notice_date: emptyField,
      submit_deadline: emptyField,
      qa_deadline: emptyField,
      bid_open_at: emptyField,
      term_from: emptyField,
      term_to: emptyField,
      place: emptyField,
      qual_category: emptyField,
      item: emptyField,
      grade: emptyField,
      areas: { value: [], quote: null, source: null },
      budget: { value: null, disclosed: false, quote: null, source: null },
      jv_allowed: emptyField,
      electronic_bidding: emptyField,
      unknown_fields: ["submit_deadline", "budget"],
    });
    expect(result.success).toBe(true);
  });

  it("qual_categoryが辞書外の値なら拒否する（推測・言い換えの検出）", () => {
    const emptyField = { value: null, quote: null, source: null };
    const result = basicInfoSchema.safeParse({
      name: emptyField,
      agency: emptyField,
      org_unit: emptyField,
      notice_no: emptyField,
      notice_date: emptyField,
      submit_deadline: emptyField,
      qa_deadline: emptyField,
      bid_open_at: emptyField,
      term_from: emptyField,
      term_to: emptyField,
      place: emptyField,
      qual_category: { value: "建設工事", quote: null, source: null }, // 対象外の辞書値
      item: emptyField,
      grade: emptyField,
      areas: { value: [], quote: null, source: null },
      budget: { value: null, disclosed: false, quote: null, source: null },
      jv_allowed: emptyField,
      electronic_bidding: emptyField,
      unknown_fields: [],
    });
    expect(result.success).toBe(false);
  });
});
