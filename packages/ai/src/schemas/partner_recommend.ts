// 見積依頼先のAIおすすめ選定（タスク4-1拡張）の出力スキーマ。
// AI解析プロンプト集.md §1〜§6（案件資料の抽出）とは別の用途のため、番号は振らない。
import { z } from "zod";

export const partnerRecommendSchema = z.object({
  recommendations: z.array(
    z.object({
      partner_id: z.string(),
      reason: z.string(),
    }),
  ),
  note: z.string().nullable(),
});

export type PartnerRecommend = z.infer<typeof partnerRecommendSchema>;
