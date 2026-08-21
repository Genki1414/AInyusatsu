import { describe, expect, it } from "vitest";
import { buildQuoteRequestEmail, groupLotsByTrade } from "./quote_request";

describe("groupLotsByTrade", () => {
  it("業種ごとにグループ化する（登場順を維持）", () => {
    const result = groupLotsByTrade([
      { line_no: 1, item: "日常清掃", spec: null, qty: 1, unit: "式", trade: "清掃" },
      { line_no: 2, item: "常駐警備", spec: null, qty: 1, unit: "式", trade: "警備" },
      { line_no: 3, item: "定期清掃", spec: null, qty: 4, unit: "回", trade: "清掃" },
    ]);
    expect(result).toEqual([
      {
        trade: "清掃",
        lots: [
          { line_no: 1, item: "日常清掃", spec: null, qty: 1, unit: "式", trade: "清掃" },
          { line_no: 3, item: "定期清掃", spec: null, qty: 4, unit: "回", trade: "清掃" },
        ],
      },
      { trade: "警備", lots: [{ line_no: 2, item: "常駐警備", spec: null, qty: 1, unit: "式", trade: "警備" }] },
    ]);
  });

  it("業種が未判定（null）の行は除外する", () => {
    const result = groupLotsByTrade([{ line_no: 1, item: "不明", spec: null, qty: 1, unit: null, trade: null }]);
    expect(result).toEqual([]);
  });

  it("行が無ければ空配列", () => {
    expect(groupLotsByTrade([])).toEqual([]);
  });
});

describe("buildQuoteRequestEmail", () => {
  it("件名は「【見積依頼】案件名」になる", () => {
    const { subject } = buildQuoteRequestEmail({
      senderOrgName: "東葉総合サービス株式会社",
      senderContactName: "山田 太郎",
      senderContactEmail: "yamada@example.co.jp",
      tenderName: "庁舎清掃業務委託",
      agencyName: "関東地方整備局",
      place: null,
      termFrom: null,
      termTo: null,
      dueAtLabel: "2026/08/20 17:00",
      trade: "清掃",
      lots: [],
      responseUrl: "https://example.com/q/abc123",
    });
    expect(subject).toBe("【見積依頼】庁舎清掃業務委託");
  });

  it("本文に挨拶・送信元・案件名・回答期限・数量表の行が含まれる", () => {
    const { body } = buildQuoteRequestEmail({
      senderOrgName: "東葉総合サービス株式会社",
      senderContactName: "山田 太郎",
      senderContactEmail: "yamada@example.co.jp",
      tenderName: "庁舎清掃業務委託",
      agencyName: "関東地方整備局",
      place: "東京都千代田区",
      termFrom: "2026-09-01",
      termTo: "2027-03-31",
      dueAtLabel: "2026/08/20 17:00",
      trade: "清掃",
      lots: [{ line_no: 1, item: "日常清掃", spec: "床面清掃", qty: 1, unit: "式", trade: "清掃" }],
      responseUrl: "https://example.com/q/abc123",
    });
    expect(body).toContain("お世話になっております。");
    expect(body).toContain("東葉総合サービス株式会社でございます。");
    expect(body).toContain("案件名：庁舎清掃業務委託");
    expect(body).toContain("履行場所：東京都千代田区");
    expect(body).toContain("履行期間：2026-09-01 〜 2027-03-31");
    expect(body).toContain("回答期限：2026/08/20 17:00");
    expect(body).toContain("1. 日常清掃（床面清掃） 1式");
  });

  it("本文に回答ページのURLと、見積可能な場合・見送る場合の案内が含まれる", () => {
    const { body } = buildQuoteRequestEmail({
      senderOrgName: "東葉総合サービス株式会社",
      senderContactName: "山田 太郎",
      senderContactEmail: "yamada@example.co.jp",
      tenderName: "庁舎清掃業務委託",
      agencyName: "関東地方整備局",
      place: null,
      termFrom: null,
      termTo: null,
      dueAtLabel: "2026/08/20 17:00",
      trade: "清掃",
      lots: [],
      responseUrl: "https://example.com/q/abc123",
    });
    expect(body).toContain("下記の専用フォームから、資料のご請求または見送りのご連絡をお願いいたします。");
    expect(body).toContain("https://example.com/q/abc123");
    expect(body).toContain("「今回は見送る」をお選びください。");
  });

  it("末尾に送信元の署名（組織名・担当者名・連絡先メール）が入る", () => {
    const { body } = buildQuoteRequestEmail({
      senderOrgName: "東葉総合サービス株式会社",
      senderContactName: "山田 太郎",
      senderContactEmail: "yamada@example.co.jp",
      tenderName: "庁舎清掃業務委託",
      agencyName: "関東地方整備局",
      place: null,
      termFrom: null,
      termTo: null,
      dueAtLabel: "2026/08/20 17:00",
      trade: "清掃",
      lots: [],
      responseUrl: "https://example.com/q/abc123",
    });
    const lines = body.split("\n");
    expect(lines.slice(-3)).toEqual(["東葉総合サービス株式会社", "山田 太郎", "yamada@example.co.jp"]);
  });

  it("履行場所・履行期間が無ければ「未確認」と表示する（推測しない）", () => {
    const { body } = buildQuoteRequestEmail({
      senderOrgName: "東葉総合サービス株式会社",
      senderContactName: "山田 太郎",
      senderContactEmail: "yamada@example.co.jp",
      tenderName: "庁舎清掃業務委託",
      agencyName: "関東地方整備局",
      place: null,
      termFrom: null,
      termTo: null,
      dueAtLabel: "2026/08/20 17:00",
      trade: "清掃",
      lots: [],
      responseUrl: "https://example.com/q/abc123",
    });
    expect(body).toContain("履行場所：未確認");
    expect(body).toContain("履行期間：未確認 〜 未確認");
  });
});
