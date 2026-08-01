import { describe, expect, it } from "vitest";
import {
  ALL_PREFECTURE_CODES,
  buildKkjQuery,
  isOnDate,
  normalizeKkjItem,
  stripFileSizeSuffix,
  type KkjSearchResultItem,
} from "./kkj";

// docs/reference/KKJ_api_guide.pdf の出力XML例を元にしたテストデータ（田村市の案件）。
function tamuraItem(overrides: Partial<KkjSearchResultItem> = {}): KkjSearchResultItem {
  return {
    resultId: "1",
    key: "fukushima/tamura_city/2026/20260731_01361",
    externalDocumentUri: "https://www.city.tamura.lg.jp/site/nyusatsu/260731jouken250.pdf",
    projectName: "たむらクリーンセンターごみクレーン点検整備業務委託",
    date: "2026-07-07T19:07:43+09:00",
    fileType: "pdf",
    fileSize: "141706",
    lgCode: "07",
    prefectureName: "福島県",
    cityCode: "072117",
    cityName: "田村市",
    organizationName: "田村市",
    certification: "C",
    cftIssueDate: "2026-07-31",
    periodEndTime: "2027-03-31T00:00:00+09:00",
    category: "役務",
    procedureType: "一般競争入札",
    location: "福島県田村市",
    tenderSubmissionDeadline: "2026-08-10T00:00:00+09:00",
    openingTendersEvent: "2026-08-20T10:00:00+09:00",
    itemCode: "12345",
    projectDescription: "（公告本文の全文が入る想定）",
    attachments: [{ name: "仕様書", uri: "https://example.com/spec.pdf" }],
    ...overrides,
  };
}

describe("stripFileSizeSuffix", () => {
  it("半角括弧のファイルサイズ表記を除去する", () => {
    expect(stripFileSizeSuffix("○○業務委託 (138.4KB)")).toBe("○○業務委託");
  });

  it("末尾以外の括弧や、サイズ表記が無い件名は変更しない", () => {
    expect(stripFileSizeSuffix("○○業務委託（単年度）")).toBe("○○業務委託（単年度）");
    expect(stripFileSizeSuffix("○○業務委託")).toBe("○○業務委託");
  });
});

describe("normalizeKkjItem", () => {
  it("実例（田村市の案件）をタグ名から正しく正規化する", () => {
    const tender = normalizeKkjItem(tamuraItem());

    expect(tender.sourceKey).toBe("fukushima/tamura_city/2026/20260731_01361");
    expect(tender.noticeUrl).toBe("https://www.city.tamura.lg.jp/site/nyusatsu/260731jouken250.pdf");
    expect(tender.name).toBe("たむらクリーンセンターごみクレーン点検整備業務委託");
    expect(tender.fetchedAt).toBe("2026-07-07T19:07:43+09:00");
    expect(tender.noticeDate).toBe("2026-07-31");
    expect(tender.agencyName).toBe("田村市");
    expect(tender.prefCode).toBe("07");
    expect(tender.prefName).toBe("福島県");
    expect(tender.cityCode).toBe("072117");
    expect(tender.cityName).toBe("田村市");
    expect(tender.grade).toBe("C");
    expect(tender.periodEndTime).toBe("2027-03-31T00:00:00+09:00");
    expect(tender.procurement).toBe("役務");
    expect(tender.procedureType).toBe("一般競争入札");
    expect(tender.place).toBe("福島県田村市");
    expect(tender.bidOpenAt).toBe("2026-08-20T10:00:00+09:00");
    expect(tender.itemCode).toBe("12345");
    expect(tender.bodyText).toContain("公告本文");
    expect(tender.attachments).toEqual([{ name: "仕様書", uri: "https://example.com/spec.pdf" }]);
  });

  it("件名末尾にファイルサイズ表記があれば除去する", () => {
    const tender = normalizeKkjItem(tamuraItem({ projectName: "○○業務委託 (138.4KB)" }));
    expect(tender.name).toBe("○○業務委託");
  });

  it("名称と説明が食い違うTenderSubmissionDeadlineは取り込まない（期限は推測しない）", () => {
    const tender = normalizeKkjItem(tamuraItem());
    expect(tender).not.toHaveProperty("tenderSubmissionDeadline");
    expect(tender).not.toHaveProperty("submitDeadline");
  });

  it("フィールドが全く無くても例外を投げず、nullで埋める", () => {
    const tender = normalizeKkjItem({});
    expect(tender.sourceKey).toBe("");
    expect(tender.noticeUrl).toBe("");
    expect(tender.name).toBe("");
    expect(tender.fetchedAt).toBeNull();
    expect(tender.noticeDate).toBeNull();
    expect(tender.agencyName).toBeNull();
    expect(tender.prefCode).toBeNull();
    expect(tender.procurement).toBe("不明");
    expect(tender.bodyText).toBe("");
    expect(tender.attachments).toEqual([]);
  });

  it("公告日（CftIssueDate）が無い場合はDateの値をそのまま使う想定に合わせnullにしない", () => {
    // 仕様書：CftIssueDateが存在しない場合はDateと同じ値がAPI側で入る。
    // ここではAPI側が既にDateの値をCftIssueDateへ入れて返す前提で、正規化側はそのまま反映する。
    const tender = normalizeKkjItem(tamuraItem({ cftIssueDate: "2026-07-07T19:07:43+09:00" }));
    expect(tender.noticeDate).toBe("2026-07-07T19:07:43+09:00");
  });
});

describe("isOnDate", () => {
  it("noticeDateが対象日と一致すればtrue", () => {
    const tender = normalizeKkjItem(tamuraItem());
    expect(isOnDate(tender, "2026-07-31")).toBe(true);
    expect(isOnDate(tender, "2026-07-30")).toBe(false);
  });
});

describe("ALL_PREFECTURE_CODES", () => {
  it("01から47までの2桁コード47件になる", () => {
    expect(ALL_PREFECTURE_CODES).toHaveLength(47);
    expect(ALL_PREFECTURE_CODES[0]).toBe("01");
    expect(ALL_PREFECTURE_CODES[46]).toBe("47");
  });
});

describe("buildKkjQuery", () => {
  it("LG_Codeに全都道府県コード・CFT_Issue_Date・Count=1000を設定する", () => {
    const query = buildKkjQuery({ cftIssueDate: "2026-07-31" });
    expect(query.LG_Code).toBe(ALL_PREFECTURE_CODES.join(","));
    expect(query.CFT_Issue_Date).toBe("2026-07-31");
    expect(query.Count).toBe("1000");
    expect(query.Category).toBeUndefined();
  });

  it("Categoryを指定すると仕様書のコード（物品=1,工事=2,役務=3）に変換する", () => {
    expect(buildKkjQuery({ cftIssueDate: "2026-07-31", category: "物品" }).Category).toBe("1");
    expect(buildKkjQuery({ cftIssueDate: "2026-07-31", category: "工事" }).Category).toBe("2");
    expect(buildKkjQuery({ cftIssueDate: "2026-07-31", category: "役務" }).Category).toBe("3");
  });

  it("countを指定すればCountに反映される", () => {
    expect(buildKkjQuery({ cftIssueDate: "2026-07-31", count: 500 }).Count).toBe("500");
  });
});
