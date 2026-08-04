import { describe, expect, it } from "vitest";
import { lotsSchema } from "./lots";

describe("lotsSchema", () => {
  it("数量表がある案件の例を受理する", () => {
    const result = lotsSchema.safeParse({
      lots: [
        {
          line_no: 1,
          item: "日常清掃",
          spec: "床面清掃・ゴミ収集",
          qty: 1,
          unit: "式",
          trade: "清掃",
          confidence: 0.95,
          evidence: "日常清掃業務一式",
          source: "数量表 1行目",
        },
      ],
      trades_summary: [
        {
          trade: "清掃",
          confidence: 0.95,
          evidence: "日常清掃業務一式",
          source: "数量表 1行目",
          excluded: false,
          excluded_reason: null,
        },
        {
          trade: "廃棄物処理",
          confidence: 0.4,
          evidence: "廃棄物の処理は別契約とする",
          source: "仕様書 3条",
          excluded: true,
          excluded_reason: "廃棄物の処理は別契約とする",
        },
      ],
      no_quantity_table: false,
      unknown_reason: null,
    });
    expect(result.success).toBe(true);
  });

  it("数量表が無い案件（no_quantity_table: true）を受理する", () => {
    const result = lotsSchema.safeParse({
      lots: [],
      trades_summary: [
        { trade: "警備", confidence: 0.6, evidence: "常駐警備を行う", source: "仕様書 2条", excluded: false, excluded_reason: null },
      ],
      no_quantity_table: true,
      unknown_reason: "数量表の添付なし",
    });
    expect(result.success).toBe(true);
  });

  it("trade辞書外の値は拒否する", () => {
    const result = lotsSchema.safeParse({
      lots: [
        { line_no: 1, item: "x", spec: null, qty: 1, unit: null, trade: "IT保守", confidence: 0.5, evidence: "x", source: "x" },
      ],
      trades_summary: [],
      no_quantity_table: false,
      unknown_reason: null,
    });
    expect(result.success).toBe(false);
  });

  it("confidenceが0〜1の範囲外なら拒否する", () => {
    const result = lotsSchema.safeParse({
      lots: [],
      trades_summary: [
        { trade: "清掃", confidence: 1.5, evidence: "x", source: "x", excluded: false, excluded_reason: null },
      ],
      no_quantity_table: false,
      unknown_reason: null,
    });
    expect(result.success).toBe(false);
  });
});
