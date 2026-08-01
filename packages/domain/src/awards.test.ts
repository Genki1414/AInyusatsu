import { describe, expect, it } from "vitest";
import {
  amountBand,
  classifyAgencyClass,
  classifyItem,
  computeMarketRates,
  dedupeLatestByProcurementNo,
  hasUnexpectedShape,
  normalizeAwardRow,
  normalizeDate,
  parseAwardsCsv,
  stripBom,
  type NormalizedAward,
} from "./awards";

// 実データ確認済み（2026-08-01、ユーザーがブラウザでダウンロードして直接確認）の1行の例。
// 見出し行は無く、この形の行が1行目から並ぶ。
const SAMPLE_ROW_CSV =
  '"0000000000000496653","令和７年度デジタル人材採用に係る求人サービス等の利用支援","2026-04-01","31389000.00","W1","8004030","Ｐｏｌｅ＆Ｌｉｎｅ合同会社","7011003005763"';

describe("stripBom / parseAwardsCsv", () => {
  it("UTF-8 BOM付きCSVでも1行目からデータとしてパースできる（見出し行は無い）", () => {
    const bom = "﻿";
    const csv = bom + SAMPLE_ROW_CSV + "\n";

    const rows = parseAwardsCsv(csv);

    expect(rows).toHaveLength(1);
    // BOMが1列目の値に混入していると procurementNo が取れなくなる
    expect(rows[0].procurementNo).toBe("0000000000000496653");
    expect(rows[0].corporateNumber).toBe("7011003005763");
  });

  it("BOMが無くても通常通りパースできる。列は位置で割り当てる", () => {
    const rows = parseAwardsCsv(SAMPLE_ROW_CSV + "\n");
    expect(rows).toEqual([
      {
        procurementNo: "0000000000000496653",
        name: "令和７年度デジタル人材採用に係る求人サービス等の利用支援",
        openedAtRaw: "2026-04-01",
        amountRaw: "31389000.00",
        taxCode: "W1",
        agencyCode: "8004030",
        winnerName: "Ｐｏｌｅ＆Ｌｉｎｅ合同会社",
        corporateNumber: "7011003005763",
      },
    ]);
  });

  it("空文字列は空配列を返す", () => {
    expect(parseAwardsCsv("")).toEqual([]);
    expect(parseAwardsCsv("﻿")).toEqual([]);
  });
});

describe("hasUnexpectedShape", () => {
  it("法人番号が13桁の数字なら想定どおりの構造とみなす", () => {
    const rows = parseAwardsCsv(SAMPLE_ROW_CSV + "\n");
    expect(hasUnexpectedShape(rows[0])).toBe(false);
  });

  it("法人番号が13桁でなければ構造がずれていると判定する（列がずれた場合の検知）", () => {
    expect(hasUnexpectedShape({ corporateNumber: "123" })).toBe(true);
    expect(hasUnexpectedShape({ corporateNumber: "" })).toBe(true);
    expect(hasUnexpectedShape({})).toBe(true);
  });
});

describe("normalizeDate", () => {
  it("和暦ではなく西暦の各表記をISO日付に正規化する", () => {
    expect(normalizeDate("2026年7月22日")).toBe("2026-07-22");
    expect(normalizeDate("2026/07/22")).toBe("2026-07-22");
    expect(normalizeDate("2026-7-22")).toBe("2026-07-22");
    expect(normalizeDate("20260722")).toBe("2026-07-22");
  });

  it("空・未知の形式はnull", () => {
    expect(normalizeDate(undefined)).toBeNull();
    expect(normalizeDate("")).toBeNull();
    expect(normalizeDate("令和8年7月22日")).toBeNull();
  });
});

describe("classifyItem / classifyAgencyClass", () => {
  it("キーワードに一致すれば分類できる", () => {
    expect(classifyItem("建物清掃業務")).toBe("建物管理等");
    expect(classifyItem("機械警備")).toBe("警備");
    expect(classifyItem("植栽管理")).toBe("植栽等管理");
  });

  it("一致しなければnull（推測しない）", () => {
    expect(classifyItem("未知の分類")).toBeNull();
    expect(classifyItem(undefined)).toBeNull();
  });

  it("機関名から機関区分を推定する", () => {
    expect(classifyAgencyClass("関東財務局")).toBe("地方支分部局");
    expect(classifyAgencyClass("独立行政法人国立病院機構")).toBe("独立行政法人等");
    expect(classifyAgencyClass("気象庁")).toBe("本省");
    expect(classifyAgencyClass("よく分からない組織")).toBeNull();
  });
});

describe("normalizeAwardRow", () => {
  const ctx = { sourceBatch: "successful_bid_record_info_all_2026.zip" };

  it("実データの行から、取得できる項目（案件番号・案件名・日付・金額・落札者・法人番号）を正規化する", () => {
    const rows = parseAwardsCsv(SAMPLE_ROW_CSV + "\n");
    const { award, skipped } = normalizeAwardRow(rows[0], ctx);

    expect(skipped).toBe(false);
    expect(award.procurementNo).toBe("0000000000000496653");
    expect(award.name).toBe("令和７年度デジタル人材採用に係る求人サービス等の利用支援");
    expect(award.openedAt).toBe("2026-04-01");
    expect(award.amount).toBe(31_389_000);
    expect(award.winnerName).toBe("Ｐｏｌｅ＆Ｌｉｎｅ合同会社");
    expect(award.corporateNumber).toBe("7011003005763");
  });

  it("予定価格・品目分類・機関区分・契約方式・入札者数はこのCSVに列が無いため常にnull（推測しない）", () => {
    const rows = parseAwardsCsv(SAMPLE_ROW_CSV + "\n");
    const { award } = normalizeAwardRow(rows[0], ctx);

    expect(award.item).toBeNull();
    expect(award.agencyClass).toBeNull();
    expect(award.contractType).toBeNull();
    expect(award.budget).toBeNull();
    expect(award.bidders).toBeNull();
    expect(award.rate).toBeNull();
    expect(award.disclosed).toBe(false);
    expect(award.taxIncluded).toBeNull();
    expect(award.taxUnknown).toBe(true);
    expect(award.outlier).toBe(false);
  });

  it("落札金額が取れない行は skipped=true", () => {
    const { skipped, skipReason } = normalizeAwardRow({ procurementNo: "P1" }, ctx);
    expect(skipped).toBe(true);
    expect(skipReason).toBe("amount_missing");
  });

  it("調達案件番号が取れない行は skipped=true（同一ファイル再取込の冪等性が保てないため）", () => {
    const { skipped, skipReason } = normalizeAwardRow({ amountRaw: "1000" }, ctx);
    expect(skipped).toBe(true);
    expect(skipReason).toBe("procurement_no_missing");
  });
});

describe("dedupeLatestByProcurementNo", () => {
  it("同一procurementNoは最新のopenedAtだけを残す（再度公告・不調対応）", () => {
    const a: NormalizedAward = base({ procurementNo: "P1", openedAt: "2026-05-01" });
    const b: NormalizedAward = base({ procurementNo: "P1", openedAt: "2026-07-01" });
    const c: NormalizedAward = base({ procurementNo: "P2", openedAt: "2026-06-01" });

    const result = dedupeLatestByProcurementNo([a, b, c]);

    expect(result).toHaveLength(2);
    expect(result.find((x) => x.procurementNo === "P1")).toEqual(b);
    expect(result.find((x) => x.procurementNo === "P2")).toEqual(c);
  });

  it("procurementNoが無い行はすべて残す（自社手入力等）", () => {
    const a = base({ procurementNo: null, openedAt: "2026-05-01" });
    const b = base({ procurementNo: null, openedAt: "2026-06-01" });
    expect(dedupeLatestByProcurementNo([a, b])).toHaveLength(2);
  });
});

describe("amountBand", () => {
  it("設計書の4区分の境界通りに分類する", () => {
    expect(amountBand(4_999_999)).toBe("〜500万");
    expect(amountBand(5_000_000)).toBe("500万〜2000万");
    expect(amountBand(19_999_999)).toBe("500万〜2000万");
    expect(amountBand(20_000_000)).toBe("2000万〜1億");
    expect(amountBand(99_999_999)).toBe("2000万〜1億");
    expect(amountBand(100_000_000)).toBe("1億〜");
  });
});

describe("computeMarketRates", () => {
  it("品目×機関区分×金額帯で中央値・平均・25%点・75%点を算出する", () => {
    // 建物管理等・地方支分部局・500万〜2000万 のグループを5件作る（budget=10,000,000固定）
    const rates = [0.8, 0.85, 0.9, 0.95, 1.0];
    const awards: NormalizedAward[] = rates.map((rate, i) =>
      base({
        procurementNo: `G${i}`,
        item: "建物管理等",
        agencyClass: "地方支分部局",
        budget: 10_000_000,
        amount: Math.round(10_000_000 * rate),
        rate,
        disclosed: true,
        openedAt: "2026-06-01",
      }),
    );

    const result = computeMarketRates(awards);

    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.item).toBe("建物管理等");
    expect(row.agencyClass).toBe("地方支分部局");
    expect(row.amountBand).toBe("500万〜2000万");
    expect(row.n).toBe(5);
    expect(row.rateMedian).toBeCloseTo(0.9, 4);
    expect(row.rateAvg).toBeCloseTo(0.9, 4);
    expect(row.rateP25).toBeCloseTo(0.85, 4);
    expect(row.rateP75).toBeCloseTo(0.95, 4);
  });

  it("outlier・非公表・税区分不明・未分類の行は集計から除外する", () => {
    const good = base({ procurementNo: "A", item: "警備", agencyClass: "本省", budget: 1_000_000, rate: 0.9, disclosed: true });
    const outlier = base({ procurementNo: "B", item: "警備", agencyClass: "本省", budget: 1_000_000, rate: 0.3, disclosed: true, outlier: true });
    const undisclosed = base({ procurementNo: "C", item: "警備", agencyClass: "本省", budget: null, rate: null, disclosed: false });
    const taxUnknown = base({ procurementNo: "D", item: "警備", agencyClass: "本省", budget: 1_000_000, rate: 0.9, disclosed: true, taxUnknown: true });
    const noItem = base({ procurementNo: "E", item: null, agencyClass: "本省", budget: 1_000_000, rate: 0.9, disclosed: true });

    const result = computeMarketRates([good, outlier, undisclosed, taxUnknown, noItem]);

    expect(result).toHaveLength(1);
    expect(result[0].n).toBe(1);
  });

  it("同一procurementNoの重複（再度公告）は最新分のみを集計対象にする", () => {
    const old = base({ procurementNo: "X", item: "警備", agencyClass: "本省", budget: 1_000_000, rate: 0.5, disclosed: true, openedAt: "2026-01-01" });
    const latest = base({ procurementNo: "X", item: "警備", agencyClass: "本省", budget: 1_000_000, rate: 0.9, disclosed: true, openedAt: "2026-06-01" });

    const result = computeMarketRates([old, latest]);

    expect(result).toHaveLength(1);
    expect(result[0].n).toBe(1);
    expect(result[0].rateMedian).toBeCloseTo(0.9, 4);
  });

  it("該当データが無ければ空配列", () => {
    expect(computeMarketRates([])).toEqual([]);
  });
});

function base(overrides: Partial<NormalizedAward>): NormalizedAward {
  return {
    procurementNo: null,
    name: null,
    item: null,
    agencyClass: null,
    contractType: null,
    budget: null,
    amount: null,
    bidders: null,
    openedAt: null,
    rate: null,
    disclosed: false,
    taxIncluded: null,
    taxUnknown: false,
    outlier: false,
    winnerName: null,
    corporateNumber: null,
    ...overrides,
  };
}
