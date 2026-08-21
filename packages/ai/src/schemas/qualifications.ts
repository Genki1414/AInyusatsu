// AI解析プロンプト集.md §2「参加資格と参加条件」の出力スキーマ。
import { z } from "zod";
import { evidenceShape, maybe } from "./common";

export const QUALIFICATION_CATEGORIES = ["資格", "等級", "地域", "実績", "認証・許可", "体制", "その他"] as const;

export const qualificationsSchema = z.object({
  qualifications: z
    .array(
      z.object({
        text: z.string(),
        // 辞書に当てはめられない要件では null が返る（§全体ルール1）。UIでは「区分 未判定」として扱う。
        // 区分が分からないことを理由に要件そのものを捨てない（参加資格の取りこぼしは失格に直結する）。
        category: maybe(z.enum(QUALIFICATION_CATEGORIES)),
        ...evidenceShape,
      }),
    )
    .default([]),
  conditions: z
    .array(
      z.object({
        text: z.string(),
        ...evidenceShape,
      }),
    )
    .default([]),
  unknown_reason: maybe(z.string()),
});

export type Qualifications = z.infer<typeof qualificationsSchema>;
