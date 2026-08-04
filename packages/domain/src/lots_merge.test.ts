import { describe, expect, it } from "vitest";
import { dedupeLotsByLineNo, type LotRow } from "./lots_merge";

function lot(line_no: number, item = "item"): LotRow {
  return { line_no, item, spec: null, qty: 1, unit: "式", trade: "清掃", confidence: 0.9 };
}

describe("dedupeLotsByLineNo", () => {
  it("重複が無ければそのまま返す", () => {
    const lots = [lot(1), lot(2), lot(3)];
    expect(dedupeLotsByLineNo(lots)).toEqual(lots);
  });

  it("line_noが重複する行は、先に出てきたものだけを残す", () => {
    const first = lot(1, "最初の行");
    const duplicate = lot(1, "重複した行");
    const result = dedupeLotsByLineNo([first, duplicate]);
    expect(result).toEqual([first]);
  });

  it("空配列を渡すと空配列を返す", () => {
    expect(dedupeLotsByLineNo([])).toEqual([]);
  });
});
