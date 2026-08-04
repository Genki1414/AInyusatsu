// AI解析プロンプト集.md §6「質問案の生成」の出力スキーマ。
import { z } from "zod";

export const questionsSchema = z.object({
  questions: z.array(
    z.object({
      text: z.string(),
      basis: z.string(),
      quote: z.string(),
      source: z.string(),
      impact: z.enum(["見積", "参加可否", "工程", "その他"]),
    }),
  ),
  qa_deadline: z.string().nullable(),
  unknown_reason: z.string().nullable(),
});

export type Questions = z.infer<typeof questionsSchema>;
