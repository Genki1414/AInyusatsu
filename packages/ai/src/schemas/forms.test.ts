import { describe, expect, it } from "vitest";
import { formsSchema } from "./forms";

describe("formsSchema", () => {
  it("様式が複数ある例を受理する", () => {
    const result = formsSchema.safeParse({
      forms: [
        { name: "入札書", form_no: "様式第1号", required: true, note: null, quote: "様式第1号により提出", source: "入札説明書 5" },
        { name: "委任状", form_no: "様式第3号", required: false, note: "代理人が入札する場合のみ", quote: "代理人による場合は様式第3号", source: "入札説明書 6" },
      ],
      submission_method: { value: "電子調達システム", quote: "電子調達システムにより提出", source: "入札説明書 1" },
      unknown_reason: null,
    });
    expect(result.success).toBe(true);
  });

  it("様式が資料から確認できない場合を受理する", () => {
    const result = formsSchema.safeParse({
      forms: [],
      submission_method: { value: null, quote: null, source: null },
      unknown_reason: "様式資料が未取得のため確認できず",
    });
    expect(result.success).toBe(true);
  });
});
