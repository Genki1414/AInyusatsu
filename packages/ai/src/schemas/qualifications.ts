// AI解析プロンプト集.md §2「参加資格と参加条件」の出力スキーマ。
import { z } from "zod";

export const QUALIFICATION_CATEGORIES = ["資格", "等級", "地域", "実績", "認証・許可", "体制", "その他"] as const;

export const qualificationsSchema = z.object({
  qualifications: z.array(
    z.object({
      text: z.string(),
      category: z.enum(QUALIFICATION_CATEGORIES),
      quote: z.string(),
      source: z.string(),
    }),
  ),
  conditions: z.array(
    z.object({
      text: z.string(),
      quote: z.string(),
      source: z.string(),
    }),
  ),
  unknown_reason: z.string().nullable(),
});

export type Qualifications = z.infer<typeof qualificationsSchema>;
