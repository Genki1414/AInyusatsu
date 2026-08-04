// AI解析プロンプト集.md §4「提出書類の抽出」の出力スキーマ。
import { z } from "zod";
import { evidencedField } from "./common";

export const formsSchema = z.object({
  forms: z.array(
    z.object({
      name: z.string(),
      form_no: z.string().nullable(),
      required: z.boolean(),
      note: z.string().nullable(),
      quote: z.string(),
      source: z.string(),
    }),
  ),
  submission_method: evidencedField(z.string().nullable()),
  unknown_reason: z.string().nullable(),
});

export type Forms = z.infer<typeof formsSchema>;
