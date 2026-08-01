import { describe, expect, it } from "vitest";
import {
  classifyDocumentKind,
  isSearchTruncated,
  normalizeGepsNoticeDate,
  normalizeGepsTender,
  type GepsDetail,
} from "./geps";

// docs/調達ポータルコネクタ設計.md §2-5 に記載された実例
// （国土交通省 高田管内消融雪設備点検整備業務、取得できた10ファイル）
describe("classifyDocumentKind", () => {
  it("実例の10ファイルすべてを正しく分類する", () => {
    const cases: [string, string, string][] = [
      ["調達案件情報関連", "02_入札公告.pdf", "公告"],
      ["調達説明書関連", "03_入札説明書.pdf", "入札説明書"],
      ["調達説明書関連", "04_提出様式.docx", "様式"],
      ["仕様書関連", "05_特記仕様書.pdf", "仕様書"],
      ["仕様書関連", "06_数量総括表.pdf", "数量表"],
      ["仕様書関連", "07_見積参考資料.pdf", "仕様書"],
      ["契約書関連", "08_契約書案.docx", "その他"],
      ["その他", "01_配布目録.pdf", "その他"],
      ["その他", "09_北陸地方整備局競争契約入札心得.pdf", "その他"],
      ["その他", "10_電子調達システムによる入札説明書等資料交付について.pdf", "その他"],
    ];
    for (const [category, filename, expected] of cases) {
      expect(classifyDocumentKind(category, filename)).toBe(expected);
    }
  });

  it("仕様書関連は「内訳」を含んでいても数量表と判定する", () => {
    expect(classifyDocumentKind("仕様書関連", "内訳書.pdf")).toBe("数量表");
  });

  it("未知の資料種別はその他になる", () => {
    expect(classifyDocumentKind("謎の分類", "何か.pdf")).toBe("その他");
  });
});

describe("isSearchTruncated", () => {
  it("500件ちょうど、またはそれ以上は打ち切りとみなす", () => {
    expect(isSearchTruncated(499)).toBe(false);
    expect(isSearchTruncated(500)).toBe(true);
    expect(isSearchTruncated(501)).toBe(true);
  });

  it("実測値123件は打ち切りではない", () => {
    expect(isSearchTruncated(123)).toBe(false);
  });
});

describe("normalizeGepsNoticeDate", () => {
  it("実データ確認済み（2026-08-01）：和暦・ゼロ埋め表記（末尾空白あり）をISO日付に変換する", () => {
    expect(normalizeGepsNoticeDate("令和08年07月31日 ")).toBe("2026-07-31");
  });

  it("令和元年はReiwaYear=1として扱う", () => {
    expect(normalizeGepsNoticeDate("令和元年04月01日")).toBe("2019-04-01");
  });

  it("すでにISO日付ならそのまま返す", () => {
    expect(normalizeGepsNoticeDate("2026-07-01")).toBe("2026-07-01");
  });

  it("null・空文字・変換できない表記はnull（推測しない）", () => {
    expect(normalizeGepsNoticeDate(null)).toBeNull();
    expect(normalizeGepsNoticeDate("")).toBeNull();
    expect(normalizeGepsNoticeDate("不明")).toBeNull();
  });
});

describe("normalizeGepsTender", () => {
  const detail: GepsDetail = {
    procurementNo: "0000000000000565084",
    category: "役務",
    name: "高田管内消融雪設備点検整備業務",
    publicFrom: "2026-07-01",
    agencyName: "北陸地方整備局",
    place: "新潟県上越市",
    announcementUrl: null,
  };

  it("外部リンクが無ければポータルの詳細ページURLをsourceUrlにする", () => {
    const t = normalizeGepsTender(detail, "https://www.p-portal.go.jp/detail/xxx");
    expect(t.sourceUrl).toBe("https://www.p-portal.go.jp/detail/xxx");
    expect(t.code).toBe("0000000000000565084");
    expect(t.qualCategory).toBe("未判定"); // 推測しない
    expect(t.procurement).toBe("役務");
    expect(t.agencyId).toMatch(/^auto-[0-9a-f]{12}$/);
  });

  it("公告内容が外部サイトへのリンクの場合はそのURLをsourceUrlにする（実例：高田河川国道事務所）", () => {
    const withExternal: GepsDetail = {
      ...detail,
      announcementUrl: "https://www.hrr.mlit.go.jp/takada/",
    };
    const t = normalizeGepsTender(withExternal, "https://www.p-portal.go.jp/detail/xxx");
    expect(t.sourceUrl).toBe("https://www.hrr.mlit.go.jp/takada/");
  });

  it("提出期限が確定できないためdedupe_keyの日付部分はunknownになる", () => {
    const t = normalizeGepsTender(detail, "https://www.p-portal.go.jp/detail/xxx");
    expect(t.dedupeKey).toBe(`${t.agencyId}/0000000000000565084/unknown`);
  });

  it("同じ調達案件番号・機関なら常に同じdedupe_keyになる（冪等性）", () => {
    const a = normalizeGepsTender(detail, "https://www.p-portal.go.jp/detail/xxx");
    const b = normalizeGepsTender(detail, "https://www.p-portal.go.jp/detail/yyy"); // URLが違っても
    expect(a.dedupeKey).toBe(b.dedupeKey);
  });
});
