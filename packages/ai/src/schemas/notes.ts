// AI解析プロンプト集.md §5「注意事項の抽出」の出力スキーマ。
import { z } from "zod";

export const notesSchema = z.object({
  notes: z.array(
    z.object({
      text: z.string(),
      importance: z.enum(["critical", "normal"]),
      reason: z.enum(["失格", "コスト", "工程", "その他"]),
      quote: z.string(),
      source: z.string(),
    }),
  ),
  unknown_reason: z.string().nullable(),
});

export type Notes = z.infer<typeof notesSchema>;
