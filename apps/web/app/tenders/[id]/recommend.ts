// 見積依頼先のAIおすすめ選定（タスク4-1拡張）。
//
// Server Component（page.tsx）からのみ呼ぶ。@ai-nyusatsu-bu/ai は
// @anthropic-ai/sdk に依存するため、Client Componentからは絶対にimportしないこと
// （このファイルを "use client" のファイルからimportしない）。
//
// org×tender×trade単位で結果をキャッシュする。未作成のときは業種（呼び出し側で絞込済み）・
// 対応エリア・人が付けた評価で決定的に並べる。案件資料の理解が不要な処理へClaudeを使わず、
// 画面を開くたびのAPI原価と待ち時間を発生させない。
import { recommendPartnersByRules } from "@ai-nyusatsu-bu/domain";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const MODEL_NAME = "rules-v1";

export type PartnerRecommendationResult = {
  recommendations: { partner_id: string; reason: string }[];
  note: string | null;
  unavailableReason: string | null;
};

type TradeGroup = { trade: string; lots: { item: string; spec: string | null; qty: number | string | null; unit: string | null }[] };

type CandidatePartner = { id: string; name: string; email: string | null; trades: string[]; areas: string[]; rating: number | null; memo: string | null };

/** 対応業種が一致する（または未登録の）メール登録済み協力会社だけを候補にする。 */
function candidatesForTrade(partners: CandidatePartner[], trade: string): CandidatePartner[] {
  return partners.filter((p) => p.email && (p.trades.length === 0 || p.trades.includes(trade)));
}

/** 業種ごとにAIおすすめを取得する（キャッシュ済みならそれを返す）。 */
export async function getPartnerRecommendations(
  supabase: Supabase,
  orgId: string,
  tenderId: string,
  tenderItem: string | null,
  place: string | null,
  tradeGroups: TradeGroup[],
  partners: CandidatePartner[],
): Promise<Record<string, PartnerRecommendationResult | null>> {
  const result: Record<string, PartnerRecommendationResult | null> = {};

  await Promise.all(
    tradeGroups.map(async (group) => {
      const candidates = candidatesForTrade(partners, group.trade);
      if (candidates.length === 0) {
        result[group.trade] = null;
        return;
      }

      const { data: cached } = await supabase
        .from("quote_recommendations")
        .select("recommendations, note")
        .eq("org_id", orgId)
        .eq("tender_id", tenderId)
        .eq("trade", group.trade)
        .maybeSingle<{ recommendations: { partner_id: string; reason: string }[]; note: string | null }>();
      if (cached) {
        result[group.trade] = { recommendations: cached.recommendations, note: cached.note, unavailableReason: null };
        return;
      }

      try {
        const recommendations = recommendPartnersByRules(candidates, place);
        const note = recommendations.length === 0 ? "対応業種・エリアが一致する協力会社がありません" : null;
        await supabase.from("quote_recommendations").insert({
          org_id: orgId,
          tender_id: tenderId,
          trade: group.trade,
          model: MODEL_NAME,
          recommendations,
          note,
        });
        result[group.trade] = { recommendations, note, unavailableReason: null };
      } catch (err) {
        result[group.trade] = {
          recommendations: [],
          note: null,
          unavailableReason: err instanceof Error ? err.message : "AIによるおすすめの取得に失敗しました",
        };
      }
    }),
  );

  return result;
}
