import { describe, expect, it } from "vitest";
import {
  DOCUMENT_BUDGET_TOKENS,
  DocumentsTooLargeError,
  estimateDocumentTokens,
  estimateTokens,
  planPromptDocuments,
  PRIMARY_DOCUMENT_KINDS,
  TOKENS_PER_CHAR,
} from "./document_budget";
import type { PromptDocument } from "../prompts/user_template";

/** 指定した文字数の資料を作る（中身は問わない）。 */
function doc(kind: string, chars: number): PromptDocument {
  return { kind, text: "あ".repeat(chars) };
}

const DOCS: PromptDocument[] = [
  doc("公告", 5_000),
  doc("入札説明書", 20_000),
  doc("仕様書", 30_000),
  doc("数量表", 10_000),
  doc("様式", 5_000),
  doc("その他", 8_000),
];

describe("estimateTokens", () => {
  it("実測の換算率（1文字=0.93トークン）で見積もる", () => {
    expect(estimateTokens("あ".repeat(124_025))).toBe(Math.ceil(124_025 * TOKENS_PER_CHAR));
  });

  it("124,025文字の案件で、実測の115,341トークンに近い値になる", () => {
    // 実測（2026-08-22）との差が1%以内であることを固定しておく
    const estimated = estimateTokens("あ".repeat(124_025));
    expect(Math.abs(estimated - 115_341) / 115_341).toBeLessThan(0.01);
  });

  it("空文字は0", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("estimateDocumentTokens", () => {
  it("資料をすべて足す", () => {
    expect(estimateDocumentTokens(DOCS)).toBe(Math.ceil(78_000 * TOKENS_PER_CHAR));
  });

  it("資料が無ければ0", () => {
    expect(estimateDocumentTokens([])).toBe(0);
  });
});

describe("planPromptDocuments", () => {
  it("上限に収まるなら全資料を渡す（キャッシュが効くので一番安い）", () => {
    const plan = planPromptDocuments("lots", DOCS);
    expect(plan.mode).toBe("full");
    if (plan.mode === "full") {
      expect(plan.cacheable).toBe(true);
      expect(plan.documents).toHaveLength(6);
    }
  });

  it("実データの最大案件（770,639文字）でも、まだ全資料を渡せる", () => {
    // 約716,000トークン。上限（約877,000）には収まっている
    const huge = [doc("仕様書", 770_639)];
    expect(planPromptDocuments("notes", huge).mode).toBe("full");
  });

  it("上限を超えたら主資料だけに絞り、落とした資料を残す", () => {
    // 予算を小さくして退避モードを起こす
    const plan = planPromptDocuments("lots", DOCS, 40_000);
    expect(plan.mode).toBe("focused");
    if (plan.mode === "focused") {
      // §0-1：数量表は「数量表・仕様書」が主資料
      expect(plan.documents.map((d) => d.kind).sort()).toEqual(["仕様書", "数量表"]);
      expect(plan.cacheable).toBe(false);
      expect(plan.omitted.map((o) => o.kind).sort()).toEqual(["その他", "入札説明書", "公告", "様式"]);
      expect(plan.omitted.every((o) => o.tokens > 0)).toBe(true);
    }
  });

  it("プロンプトごとに残る資料が変わる", () => {
    const forms = planPromptDocuments("forms", DOCS, 40_000);
    const basic = planPromptDocuments("basic_info", DOCS, 40_000);
    if (forms.mode !== "focused" || basic.mode !== "focused") throw new Error("focusedになる想定");
    expect(forms.documents.map((d) => d.kind).sort()).toEqual(["入札説明書", "様式"]);
    expect(basic.documents.map((d) => d.kind)).toEqual(["公告"]);
  });

  it("主資料だけでも上限を超えるなら実行しない", () => {
    const plan = planPromptDocuments("notes", [doc("仕様書", 100_000)], 10_000);
    expect(plan.mode).toBe("over");
    if (plan.mode === "over") expect(plan.limit).toBe(10_000);
  });

  it("主資料が1件も無い場合も実行しない（空の資料でモデルを呼ばない）", () => {
    const plan = planPromptDocuments("lots", [doc("公告", 100_000)], 10_000);
    expect(plan.mode).toBe("over");
  });

  it("既定の上限は、出力ぶんと推定誤差を差し引いた値になっている", () => {
    // 入力上限100万 −（出力32,768 ＋ プロンプト2,000）を、誤差1.1で割った値
    expect(DOCUMENT_BUDGET_TOKENS).toBe(Math.floor((1_000_000 - 32_768 - 2_000) / 1.1));
    expect(DOCUMENT_BUDGET_TOKENS).toBeLessThan(1_000_000 - 32_768);
  });
});

describe("PRIMARY_DOCUMENT_KINDS", () => {
  it("AI解析プロンプト集.md §0-1 の「主な入力資料」と一致する", () => {
    expect(PRIMARY_DOCUMENT_KINDS).toEqual({
      basic_info: ["公告"],
      qualifications: ["公告", "入札説明書"],
      lots: ["数量表", "仕様書"],
      forms: ["様式", "入札説明書"],
      notes: ["仕様書", "入札説明書"],
    });
  });
});

describe("DocumentsTooLargeError", () => {
  it("推定量と上限を添えた、そのまま画面に出せる理由になる", () => {
    const err = new DocumentsTooLargeError("lots", 900_000, 877_483);
    expect(err.message).toContain("資料が大きすぎるため解析できません");
    expect(err.message).toContain("900,000");
    expect(err.message).toContain("877,483");
    expect(err.name).toBe("DocumentsTooLargeError");
  });
});
