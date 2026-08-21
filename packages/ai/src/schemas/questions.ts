// AI解析プロンプト集.md §6「質問案の生成」の出力スキーマ。
import { z } from "zod";
import { evidenceShape, maybe } from "./common";

export const questionsSchema = z.object({
  questions: z
    .array(
      z.object({
        text: z.string(),
        basis: z.string(),
        // 影響範囲の区分が付かない質問では null が返る（§全体ルール1）。
        impact: maybe(z.enum(["見積", "参加可否", "工程", "その他"])),
        ...evidenceShape,
      }),
    )
    .default([]),
  qa_deadline: maybe(z.string()),
  unknown_reason: maybe(z.string()),
});

export type Questions = z.infer<typeof questionsSchema>;
