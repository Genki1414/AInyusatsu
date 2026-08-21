import { describe, expect, it } from "vitest";
import {
  classifyDocumentKind,
  classifyDocumentKindByFilename,
  decodeZipEntryName,
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

  it("未知の資料種別で、ファイル名からも判断できなければその他になる", () => {
    expect(classifyDocumentKind("謎の分類", "何か.pdf")).toBe("その他");
  });

  // 添付一覧のスクレイピングに失敗すると資料種別が空になり、全ての資料が「その他」に
  // 落ちてしまうため、ファイル名からの判定を併用する（実機で発生）。
  it("資料種別が取れない場合はファイル名から判定する", () => {
    const cases: [string, string][] = [
      ["02_入札公告.pdf", "公告"],
      ["03_入札説明書.pdf", "入札説明書"],
      ["05_特記仕様書.pdf", "仕様書"],
      ["06_数量総括表.pdf", "数量表"],
      ["04_提出様式.docx", "様式"],
    ];
    for (const [filename, expected] of cases) {
      expect(classifyDocumentKindByFilename(filename)).toBe(expected);
      expect(classifyDocumentKind("", filename)).toBe(expected);
    }
  });

  it("ファイル名判定でも、数量表は仕様書より先に判定する", () => {
    expect(classifyDocumentKindByFilename("仕様書別紙_数量内訳.pdf")).toBe("数量表");
  });

  it("ファイル名から判断できなければ推測せずその他にする", () => {
    expect(classifyDocumentKindByFilename("01_配布目録.pdf")).toBe("その他");
    expect(classifyDocumentKindByFilename("08_契約書案.docx")).toBe("その他");
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

describe("decodeZipEntryName", () => {
  // 調達ポータルの資料zipはファイル名がCP932で入っており、UTF-8として読むと文字化けする
  // （実機で確認：協力会社へ送った資料名が「3.\ufffdd\ufffdl\ufffd\ufffd.pdf」になった）。
  const cp932 = (text: string): Uint8Array => {
    // テスト用に、代表的なファイル名のCP932バイト列を直接持つ
    const table: Record<string, number[]> = {
      // 「仕様書.pdf」
      "仕様書.pdf": [0x8e, 0x64, 0x97, 0x6c, 0x8f, 0x91, 0x2e, 0x70, 0x64, 0x66],
      // 「入札公告.pdf」
      "入札公告.pdf": [0x93, 0xfc, 0x8e, 0x44, 0x8c, 0xf6, 0x8d, 0x90, 0x2e, 0x70, 0x64, 0x66],
    };
    const bytes = table[text];
    if (!bytes) throw new Error(`テストデータにありません: ${text}`);
    return Uint8Array.from(bytes);
  };

  it("UTF-8フラグが立っていなければCP932として読む", () => {
    expect(decodeZipEntryName(cp932("仕様書.pdf"), false, "壊れた名前.pdf")).toBe("仕様書.pdf");
    expect(decodeZipEntryName(cp932("入札公告.pdf"), false, "壊れた名前.pdf")).toBe("入札公告.pdf");
  });

  it("UTF-8フラグが立っていれば、そのまま（AdmZipの解釈）を使う", () => {
    const utf8 = new TextEncoder().encode("仕様書.pdf");
    expect(decodeZipEntryName(utf8, true, "仕様書.pdf")).toBe("仕様書.pdf");
  });

  it("CP932として読めないバイト列は、推測せず元の解釈のまま使う", () => {
    const invalid = Uint8Array.from([0x80, 0xff, 0xfe]);
    expect(decodeZipEntryName(invalid, false, "そのまま.pdf")).toBe("そのまま.pdf");
  });

  it("ASCIIだけのファイル名はどちらでも同じ結果になる", () => {
    const ascii = new TextEncoder().encode("readme.txt");
    expect(decodeZipEntryName(ascii, false, "readme.txt")).toBe("readme.txt");
  });
});

