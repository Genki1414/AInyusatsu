import { describe, expect, it } from "vitest";
import { notesSchema } from "./notes";

describe("notesSchema", () => {
  it("critical/normalの注意事項を受理する", () => {
    const result = notesSchema.safeParse({
      notes: [
        { text: "廃棄物処理費用は落札者負担とする", importance: "critical", reason: "コスト", quote: "処分費は落札者の負担とする", source: "仕様書 4条" },
        { text: "作業は平日9時〜17時に限る", importance: "normal", reason: "工程", quote: "作業時間は平日9時から17時までとする", source: "仕様書 5条" },
      ],
      unknown_reason: null,
    });
    expect(result.success).toBe(true);
  });

  it("importanceが辞書外なら拒否する", () => {
    const result = notesSchema.safeParse({
      notes: [{ text: "x", importance: "medium", reason: "コスト", quote: "x", source: "x" }],
      unknown_reason: null,
    });
    expect(result.success).toBe(false);
  });
});
