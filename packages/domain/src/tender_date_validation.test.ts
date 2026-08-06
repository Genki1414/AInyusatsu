import { describe, expect, it } from "vitest";
import { validateTenderDates } from "./tender_date_validation";

const noDates = { noticeDate: null, submitDeadline: null, qaDeadline: null, bidOpenAt: null };

describe("validateTenderDates", () => {
  it("日付が1つも無ければ違反なし", () => {
    expect(validateTenderDates(noDates)).toEqual([]);
  });

  it("正しい前後関係（公告日 < 質問期限 < 提出期限 < 開札日時）なら違反なし", () => {
    const issues = validateTenderDates({
      noticeDate: "2026-07-01",
      qaDeadline: "2026-07-20T17:00",
      submitDeadline: "2026-08-01T17:00",
      bidOpenAt: "2026-08-05T10:00",
    });
    expect(issues).toEqual([]);
  });

  it("提出期限が開札日時以降だと違反（取り違えの可能性）", () => {
    const issues = validateTenderDates({
      ...noDates,
      submitDeadline: "2026-08-05T10:00",
      bidOpenAt: "2026-08-01T17:00",
    });
    expect(issues.map((i) => i.rule)).toContain("submit_before_bid_open");
  });

  it("質問期限が提出期限以降だと違反", () => {
    const issues = validateTenderDates({
      ...noDates,
      qaDeadline: "2026-08-01T17:00",
      submitDeadline: "2026-07-20T17:00",
    });
    expect(issues.map((i) => i.rule)).toContain("qa_before_submit");
  });

  it("公告日が提出期限より後だと違反", () => {
    const issues = validateTenderDates({
      ...noDates,
      noticeDate: "2026-08-10",
      submitDeadline: "2026-08-01T17:00",
    });
    expect(issues.map((i) => i.rule)).toContain("notice_before_submit");
  });

  it("公告日から2年を超える期限は和暦変換ミスの疑いとして違反", () => {
    const issues = validateTenderDates({
      ...noDates,
      noticeDate: "2026-07-01",
      submitDeadline: "2029-08-01T17:00", // 3年以上先
    });
    expect(issues.map((i) => i.rule)).toContain("date_within_two_years");
  });

  it("2年ちょうど以内なら違反にしない", () => {
    const issues = validateTenderDates({
      ...noDates,
      noticeDate: "2026-07-01",
      submitDeadline: "2026-12-01T17:00",
    });
    expect(issues).toEqual([]);
  });

  it("複数のルールに同時に違反した場合、それぞれ報告する", () => {
    const issues = validateTenderDates({
      noticeDate: "2026-08-10",
      submitDeadline: "2026-08-01T17:00",
      qaDeadline: "2026-08-05T17:00",
      bidOpenAt: "2026-07-30T10:00",
    });
    const rules = issues.map((i) => i.rule);
    expect(rules).toContain("submit_before_bid_open");
    expect(rules).toContain("qa_before_submit");
    expect(rules).toContain("notice_before_submit");
  });

  it("日付として解釈できない文字列はnull同様に無視する", () => {
    const issues = validateTenderDates({
      ...noDates,
      noticeDate: "not-a-date",
      submitDeadline: "2026-08-01T17:00",
    });
    expect(issues).toEqual([]);
  });
});
