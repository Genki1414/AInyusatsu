import { describe, expect, it } from "vitest";
import {
  compareTender,
  evaluateGoldset,
  expandChecked,
  sameInstant,
  sameSet,
  sameText,
  showInstant,
  tradeF1,
  type ActualValues,
  type GoldEntry,
} from "./goldset";

function actual(over: Partial<ActualValues> = {}): ActualValues {
  return {
    submitDeadline: "2026-09-25T17:00:00+09:00",
    qaDeadline: "2026-09-10T17:00:00+09:00",
    bidOpenAt: "2026-09-30T10:00:00+09:00",
    qualCategory: "役務の提供等",
    item: "建物管理等各種保守管理",
    grade: "B以上",
    areas: ["東北"],
    trades: ["清掃"],
    ...over,
  };
}

function entry(expected: GoldEntry["expected"]): GoldEntry {
  return { tenderId: "t1", tenderName: "庁舎清掃業務", expected };
}

describe("sameInstant", () => {
  it("表記が違っても同じ時刻なら一致", () => {
    expect(sameInstant("2026-09-25T17:00:00+09:00", "2026-09-25T08:00:00Z")).toBe(true);
  });

  it("9時間ずれていれば不一致（timestamptzの取り違えを見逃さない）", () => {
    expect(sameInstant("2026-09-25T17:00:00+09:00", "2026-09-25T17:00:00Z")).toBe(false);
  });

  it("両方とも値が無ければ一致（取れないのが正しい案件）", () => {
    expect(sameInstant(null, null)).toBe(true);
  });

  it("片方だけ値が無ければ不一致", () => {
    expect(sameInstant("2026-09-25T17:00:00+09:00", null)).toBe(false);
    expect(sameInstant(null, "2026-09-25T17:00:00+09:00")).toBe(false);
  });
});

describe("sameText / sameSet", () => {
  it("空白のゆれを吸収する", () => {
    expect(sameText("役務の提供等", "役務の 提供等")).toBe(true);
    expect(sameText("　B以上　", "B以上")).toBe(true);
  });

  it("値が無いもの同士は一致", () => {
    expect(sameText(null, null)).toBe(true);
  });

  it("集合は順番を問わない", () => {
    expect(sameSet(["東北", "関東"], ["関東", "東北"])).toBe(true);
    expect(sameSet(["東北"], ["東北", "関東"])).toBe(false);
  });
});

describe("showInstant", () => {
  it("JSTで表示する", () => {
    expect(showInstant("2026-09-25T08:00:00Z")).toBe("2026-09-25 17:00");
  });

  it("値が無ければそう書く", () => {
    expect(showInstant(null)).toBe("（無し）");
  });
});

describe("compareTender", () => {
  it("未記入の項目は測らない", () => {
    const result = compareTender(entry({ submitDeadline: "2026-09-25T17:00:00+09:00" }), actual());
    expect(result.fields.map((f) => f.field)).toEqual(["提出期限"]);
    expect(result.mistakes).toEqual([]);
  });

  it("「値が無いのが正解」を、未記入と混同しない", () => {
    // 公告に質問期限が書かれていない案件。AIが日付を入れていたら誤り
    const result = compareTender(entry({ qaDeadline: null }), actual());
    expect(result.fields).toHaveLength(1);
    expect(result.mistakes.map((m) => m.field)).toEqual(["質問期限"]);
  });

  it("間違えた項目に、期待値と実際の値を残す", () => {
    const result = compareTender(entry({ item: "警備" }), actual());
    expect(result.mistakes[0]).toMatchObject({
      field: "営業品目",
      expected: "警備",
      actual: "建物管理等各種保守管理",
      correct: false,
    });
  });
});

describe("tradeF1", () => {
  it("完全に一致すれば1.0", () => {
    const score = tradeF1([{ expected: ["清掃"], actual: ["清掃"] }]);
    expect(score.f1).toBe(1);
  });

  it("余分に出したぶんは精度を下げる", () => {
    const score = tradeF1([{ expected: ["清掃"], actual: ["清掃", "警備"] }]);
    expect(score.truePositive).toBe(1);
    expect(score.falsePositive).toBe(1);
    expect(score.precision).toBe(0.5);
    expect(score.recall).toBe(1);
  });

  it("取りこぼしは再現率を下げる", () => {
    const score = tradeF1([{ expected: ["清掃", "警備"], actual: ["清掃"] }]);
    expect(score.recall).toBe(0.5);
  });

  it("測るものが無ければ null（0/0を1.0と見せない）", () => {
    expect(tradeF1([]).f1).toBeNull();
  });
});

describe("evaluateGoldset", () => {
  it("期限は1件でも外すと目安に届かない", () => {
    const report = evaluateGoldset([
      { entry: entry({ submitDeadline: "2026-09-25T17:00:00+09:00" }), actual: actual() },
      { entry: entry({ submitDeadline: "2026-09-20T17:00:00+09:00" }), actual: actual() },
    ]);
    expect(report.deadlines).toMatchObject({ total: 2, correct: 1, rate: 0.5 });
    expect(report.meets.deadlines).toBe(false);
  });

  it("全部合っていれば目安に届く", () => {
    const report = evaluateGoldset([
      {
        entry: entry({
          submitDeadline: "2026-09-25T17:00:00+09:00",
          qualCategory: "役務の提供等",
          trades: ["清掃"],
        }),
        actual: actual(),
      },
    ]);
    expect(report.meets).toEqual({ deadlines: true, qualification: true, trades: true });
  });

  it("測っていない指標は、届いた／届かないを言わない", () => {
    const report = evaluateGoldset([{ entry: entry({ submitDeadline: "2026-09-25T17:00:00+09:00" }), actual: actual() }]);
    expect(report.meets.qualification).toBeNull();
    expect(report.meets.trades).toBeNull();
    expect(report.qualification.rate).toBeNull();
  });

  it("案件ごとではなく全体で業種のF1を出す", () => {
    const report = evaluateGoldset([
      { entry: entry({ trades: ["清掃"] }), actual: actual({ trades: ["清掃"] }) },
      { entry: entry({ trades: ["警備"] }), actual: actual({ trades: ["清掃"] }) },
    ]);
    expect(report.trades).toMatchObject({ truePositive: 1, falsePositive: 1, falseNegative: 1 });
    expect(report.trades.f1).toBeCloseTo(0.5);
  });
});

describe("checked（確認した項目）", () => {
  it("グループ名で項目に開く", () => {
    expect([...expandChecked(["期限"])]).toEqual(["submitDeadline", "qaDeadline", "bidOpenAt"]);
    expect(expandChecked(["業種"]).has("trades")).toBe(true);
    expect(expandChecked(["すべて"]).size).toBe(8);
  });

  it("項目名を直接書いてもよい", () => {
    expect([...expandChecked(["submitDeadline"])]).toEqual(["submitDeadline"]);
  });

  it("確認した項目は、間違いを書かなければ正解として数える", () => {
    const result = compareTender({ tenderId: "t1", tenderName: "A", checked: ["期限"] }, actual());
    expect(result.fields.map((f) => f.field)).toEqual(["提出期限", "質問期限", "開札"]);
    expect(result.mistakes).toEqual([]);
  });

  it("確認したうえで違っていた項目は、書いた値で判定する", () => {
    const result = compareTender(
      { tenderId: "t1", tenderName: "A", checked: ["期限"], expected: { submitDeadline: "2026-09-20T17:00:00+09:00" } },
      actual(),
    );
    expect(result.fields).toHaveLength(3);
    expect(result.mistakes.map((m) => m.field)).toEqual(["提出期限"]);
  });

  it("確認していない案件は1項目も測らない（見ていないものを正解に数えない）", () => {
    const result = compareTender({ tenderId: "t1", tenderName: "A" }, actual());
    expect(result.fields).toEqual([]);
  });

  it("checked に書き忘れても、expected に書いた項目は測る", () => {
    const result = compareTender({ tenderId: "t1", tenderName: "A", expected: { item: "警備" } }, actual());
    expect(result.fields.map((f) => f.field)).toEqual(["営業品目"]);
    expect(result.mistakes).toHaveLength(1);
  });

  it("確認していない案件だけなら、指標は「測っていない」になる", () => {
    const report = evaluateGoldset([{ entry: { tenderId: "t1", tenderName: "A" }, actual: actual() }]);
    expect(report.deadlines.rate).toBeNull();
    expect(report.meets.deadlines).toBeNull();
  });

  it("業種を確認して合っていればF1は1.0", () => {
    const report = evaluateGoldset([
      { entry: { tenderId: "t1", tenderName: "A", checked: ["業種"] }, actual: actual({ trades: ["清掃"] }) },
    ]);
    expect(report.trades.f1).toBe(1);
  });
});
