import { describe, expect, it } from "vitest";
import { questionsSchema } from "./questions";

describe("questionsSchema", () => {
  it("質問案が複数ある例を受理する", () => {
    const result = questionsSchema.safeParse({
      questions: [
        {
          text: "数量表に記載のない範囲の清掃は、本業務に含まれますでしょうか。",
          basis: "数量表と仕様書の範囲記載に相違があるため",
          quote: "別途、必要に応じて清掃範囲を追加することがある",
          source: "仕様書 3条",
          impact: "見積",
        },
      ],
      qa_deadline: "2026-07-20T17:00",
      unknown_reason: null,
    });
    expect(result.success).toBe(true);
  });

  it("質問なし（0件）を受理する", () => {
    const result = questionsSchema.safeParse({ questions: [], qa_deadline: null, unknown_reason: null });
    expect(result.success).toBe(true);
  });

  it("impactが辞書外なら拒否する", () => {
    const result = questionsSchema.safeParse({
      questions: [{ text: "x", basis: "x", quote: "x", source: "x", impact: "予算" }],
      qa_deadline: null,
      unknown_reason: null,
    });
    expect(result.success).toBe(false);
  });
});

describe("questionsSchema（判定できない項目のnull許容）", () => {
  it("impact・引用・出典がnullでも質問案を捨てない", () => {
    const result = questionsSchema.safeParse({
      questions: [{ text: "範囲をご教示ください。", basis: "記載が無いため", quote: null, source: null, impact: null }],
      qa_deadline: null,
      unknown_reason: null,
    });
    expect(result.success).toBe(true);
  });
});
