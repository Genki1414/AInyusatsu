import { describe, expect, it } from "vitest";
import {
  amountBand,
  classifyAgencyClass,
  classifyItem,
  computeMarketRates,
  dedupeLatestByProcurementNo,
  normalizeAwardRow,
  normalizeDate,
  parseAwardsCsv,
  stripBom,
  type NormalizedAward,
} from "./awards";

describe("stripBom / parseAwardsCsv", () => {
  it("UTF-8 BOM付きCSVでもヘッダが壊れずパースできる", () => {
    const bom = "﻿";
    const csv =
      bom +
      "調達案件番号,調達機関名称,品目分類名称,予定価格,予定価格税区分,落札金額,落札金額税区分,契約方式,入札者数,落札日\n" +
      "0000000000000565084,関東財務局,清掃,9200000,税抜,8740000,税抜,総額,2,2026年7月22日\n";

    const rows = parseAwardsCsv(csv);

    expect(rows).toHaveLength(1);
    // BOMがヘッダの1文字目に混入していると "調達案件番号" キーが取れなくなる
    expect(rows[0]["調達案件番号"]).toBe("0000000000000565084");
    expect(Object.keys(rows[0])).not.toContain(bom + "調達案件番号");
  });

  it("BOMが無くても通常通りパースできる", () => {
    const csv = "調達案件番号,落札金額\n123,100\n";
    const rows = parseAwardsCsv(csv);
    expect(rows).toEqual([{ 調達案件番号: "123", 落札金額: "100" }]);
  });

  it("空文字列は空配列を返す", () => {
    expect(parseAwardsCsv("")).toEqual([]);
    expect(parseAwardsCsv("﻿")).toEqual([]);
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

  it("正常な行は落札率を計算し disclosed=true になる", () => {
    const { award, skipped } = normalizeAwardRow(
      {
        調達案件番号: "0000000000000565084",
        調達機関名称: "関東財務局",
        品目分類名称: "清掃",
        予定価格: "9,200,000円",
        予定価格税区分: "税抜",
        落札金額: "8,740,000円",
        落札金額税区分: "税抜",
        契約方式: "総額",
        入札者数: "2",
        落札日: "2026年7月22日",
      },
      ctx,
    );

    expect(skipped).toBe(false);
    expect(award.procurementNo).toBe("0000000000000565084");
    expect(award.item).toBe("建物管理等");
    expect(award.agencyClass).toBe("地方支分部局");
    expect(award.budget).toBe(9_200_000);
    expect(award.amount).toBe(8_740_000);
    expect(award.bidders).toBe(2);
    expect(award.openedAt).toBe("2026-07-22");
    expect(award.rate).toBeCloseTo(0.95, 4);
    expect(award.disclosed).toBe(true);
    expect(award.taxIncluded).toBe(false); // 税抜
    expect(award.taxUnknown).toBe(false);
    expect(award.outlier).toBe(false);
  });

  it("予定価格が非公表の行は disclosed=false・rate=null で、金額があれば保存対象", () => {
    const { award, skipped } = normalizeAwardRow(
      { 調達案件番号: "P1", 落札金額: "1,000,000", 予定価格: "非公表" },
      ctx,
    );
    expect(skipped).toBe(false);
    expect(award.disclosed).toBe(false);
    expect(award.rate).toBeNull();
  });

  it("落札金額が取れない行は skipped=true", () => {
    const { skipped, skipReason } = normalizeAwardRow({ 調達案件番号: "P1", 予定価格: "1000" }, ctx);
    expect(skipped).toBe(true);
    expect(skipReason).toBe("amount_missing");
  });

  it("調達案件番号が取れない行は skipped=true（同一ファイル再取込の冪等性が保てないため）", () => {
    const { skipped, skipReason } = normalizeAwardRow({ 落札金額: "1000", 予定価格: "1000" }, ctx);
    expect(skipped).toBe(true);
    expect(skipReason).toBe("procurement_no_missing");
  });

  it("税区分が判別できない場合は taxUnknown=true", () => {
    const { award } = normalizeAwardRow(
      { 落札金額: "1000", 予定価格: "2000", 落札金額税区分: "不明" },
      ctx,
    );
    expect(award.taxIncluded).toBeNull();
    expect(award.taxUnknown).toBe(true);
    expect(award.rate).not.toBeNull(); // taxUnknownはrate計算自体は妨げない（集計時に除外する）
  });

  it("落札率が50%未満・100%超は outlier=true", () => {
    const low = normalizeAwardRow({ 落札金額: "100", 予定価格: "1000" }, ctx).award;
    const high = normalizeAwardRow({ 落札金額: "1500", 予定価格: "1000" }, ctx).award;
    const normal = normalizeAwardRow({ 落札金額: "900", 予定価格: "1000" }, ctx).award;
    expect(low.outlier).toBe(true);
    expect(high.outlier).toBe(true);
    expect(normal.outlier).toBe(false);
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
    ...overrides,
  };
}
