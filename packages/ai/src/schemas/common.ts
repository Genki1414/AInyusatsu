// AI解析プロンプト集.md の全プロンプトに共通するスキーマ部品。
import { z } from "zod";

/** 「値・引用・出典」の3点セット。出典のない項目はUIで「未確認」として扱う（CLAUDE.md）。 */
export function evidencedField<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    value,
    quote: z.string().nullable(),
    source: z.string().nullable(),
  });
}
