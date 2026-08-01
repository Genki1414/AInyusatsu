import { describe, expect, it } from "vitest";
import { decodeKkjId, isOnDate, normalizeKkjItem, stripFileSizeSuffix, type KkjRawFields } from "./kkj";

// docs/案件収集戦略_v2.md §1-2, §8 に記載された実例（田村市の案件）を元にしたテストデータ。
const TAMURA_ID_DECODED = "fukushima/tamura_city/2026/20260731_01361";
const TAMURA_ID_BASE64 = Buffer.from(TAMURA_ID_DECODED, "utf-8").toString("base64");

function tamuraFields(overrides: Partial<KkjRawFields> = {}): KkjRawFields {
  return {
    idBase64: TAMURA_ID_BASE64,
    noticeUrl: "https://www.city.tamura.lg.jp/site/nyusatsu/260731jouken250.pdf",
    nameWithSize: "たむらクリーンセンターごみクレーン点検整備業務委託 (138.4KB)",
    registeredAt: "2026-07-07T19:07:43+09:00",
    fileFormat: "pdf",
    fileSize: "141706",
    prefCode: "07",
    prefName: "福島県",
    cityCode: "072117",
    cityName: "田村市",
    areaName: "福島県田村市",
    noticeDate: "2026-07-31",
    procurementType: "役務",
    nameRepeated: "たむらクリーンセンターごみクレーン点検整備業務委託 (138.4KB)",
    bodyText: "（公告本文の全文が入る想定）",
    ...overrides,
  };
}

describe("decodeKkjId", () => {
  it("pref/agency/year/date_seq の4分割にデコードする", () => {
    expect(decodeKkjId(TAMURA_ID_BASE64)).toEqual({
      prefKey: "fukushima",
      agencyKey: "tamura_city",
      year: "2026",
      dateSeq: "20260731_01361",
    });
  });

  it("4分割でないデコード結果はnull（推測しない）", () => {
    const badId = Buffer.from("only/three/parts", "utf-8").toString("base64");
    expect(decodeKkjId(badId)).toBeNull();
  });

  it("base64として不正な値はnull", () => {
    // Buffer.from は不正なbase64でも例外を投げないことがあるため、
    // 「デコード結果が4分割にならない」ケースとしても検証される
    expect(decodeKkjId("")).toBeNull();
  });
});

describe("stripFileSizeSuffix", () => {
  it("半角括弧のファイルサイズ表記を除去する", () => {
    expect(stripFileSizeSuffix("○○業務委託 (138.4KB)")).toBe("○○業務委託");
  });

  it("全角括弧・単位違い（MB/B、大文字小文字）にも対応する", () => {
    expect(stripFileSizeSuffix("○○業務委託（850KB）")).toBe("○○業務委託");
    expect(stripFileSizeSuffix("○○業務委託 (1.2MB)")).toBe("○○業務委託");
    expect(stripFileSizeSuffix("○○業務委託(2048b)")).toBe("○○業務委託");
  });

  it("末尾以外の括弧や、サイズ表記が無い件名は変更しない", () => {
    expect(stripFileSizeSuffix("○○業務委託（単年度）")).toBe("○○業務委託（単年度）");
    expect(stripFileSizeSuffix("○○業務委託")).toBe("○○業務委託");
  });
});

describe("normalizeKkjItem", () => {
  it("実例（田村市の案件）を正しく正規化する", () => {
    const seed = normalizeKkjItem(tamuraFields());

    expect(seed.sourceId).toBe(TAMURA_ID_BASE64);
    expect(seed.prefKey).toBe("fukushima");
    expect(seed.agencyKey).toBe("tamura_city");
    expect(seed.year).toBe("2026");
    expect(seed.noticeUrl).toBe("https://www.city.tamura.lg.jp/site/nyusatsu/260731jouken250.pdf");
    expect(seed.name).toBe("たむらクリーンセンターごみクレーン点検整備業務委託"); // サイズ表記除去済み
    expect(seed.registeredAt).toBe("2026-07-07T19:07:43+09:00");
    expect(seed.noticeDate).toBe("2026-07-31");
    expect(seed.prefCode).toBe("07");
    expect(seed.prefName).toBe("福島県");
    expect(seed.cityCode).toBe("072117");
    expect(seed.cityName).toBe("田村市");
    expect(seed.areaName).toBe("福島県田村市");
    expect(seed.procurement).toBe("役務");
    expect(seed.bodyText).toContain("公告本文");
  });

  it("15(件名再掲)が無ければ4(件名)にフォールバックする", () => {
    const seed = normalizeKkjItem(tamuraFields({ nameRepeated: "" }));
    expect(seed.name).toBe("たむらクリーンセンターごみクレーン点検整備業務委託");
  });

  it("フィールドが全く無くても例外を投げず、nullで埋める", () => {
    const seed = normalizeKkjItem({});
    expect(seed.sourceId).toBe("");
    expect(seed.prefKey).toBeNull();
    expect(seed.name).toBe("");
    expect(seed.registeredAt).toBeNull();
    expect(seed.noticeDate).toBeNull();
    expect(seed.procurement).toBe("不明");
    expect(seed.bodyText).toBe("");
  });

  it("IDのデコードに失敗しても他のフィールドは正規化される", () => {
    const seed = normalizeKkjItem(tamuraFields({ idBase64: "not-a-valid-structured-id" }));
    expect(seed.prefKey).toBeNull();
    expect(seed.agencyKey).toBeNull();
    expect(seed.name).toBe("たむらクリーンセンターごみクレーン点検整備業務委託");
  });
});

describe("isOnDate", () => {
  it("noticeDateが対象日と一致すればtrue", () => {
    const seed = normalizeKkjItem(tamuraFields());
    expect(isOnDate(seed, "2026-07-31")).toBe(true);
    expect(isOnDate(seed, "2026-07-30")).toBe(false);
  });
});
