import { describe, expect, it } from "vitest";
import { needsOcr } from "./document_text";

describe("needsOcr", () => {
  it("空文字（テキストレイヤーなし）はOCRが必要", () => {
    expect(needsOcr("")).toBe(true);
  });

  it("空白だけのページはOCRが必要", () => {
    expect(needsOcr("   \n\n\t  ")).toBe(true);
  });

  it("短すぎる抽出結果（ページ番号だけ等）はOCRが必要", () => {
    expect(needsOcr("- 1 -")).toBe(true);
  });

  it("十分な文字数のテキストが抽出できていればOCR不要", () => {
    const text = "調達案件名称：東京第3合同庁舎建物清掃業務委託\n提出期限：令和8年8月31日";
    expect(needsOcr(text)).toBe(false);
  });

  it("空白の量に関わらず、実質的な文字数で判定する", () => {
    const paddedShort = "短い" + " ".repeat(100);
    expect(needsOcr(paddedShort)).toBe(true);
  });
});
