// AI解析プロンプト集.md §5「注意事項の抽出」の出力スキーマ。
import { z } from "zod";
import { evidenceShape, maybe } from "./common";

export const notesSchema = z.object({
  notes: z
    .array(
      z.object({
        text: z.string(),
        // 重要度・理由の判定が付かない注意事項では null が返る（§全体ルール1）。
        // 判定できないことを理由に注意事項そのものを捨てない（見落とすと失格・赤字になる）。
        importance: maybe(z.enum(["critical", "normal"])),
        reason: maybe(z.enum(["失格", "コスト", "工程", "その他"])),
        ...evidenceShape,
      }),
    )
    .default([]),
  unknown_reason: maybe(z.string()),
});

export type Notes = z.infer<typeof notesSchema>;
