// 見積依頼先のAIおすすめ選定（タスク4-1拡張）。
//
// Server Component（page.tsx）からのみ呼ぶ。@ai-nyusatsu-bu/ai は
// @anthropic-ai/sdk に依存するため、Client Componentからは絶対にimportしないこと
// （このファイルを "use client" のファイルからimportしない）。
//
// 「見積依頼」タブを開くたびにAIへ問い合わせるとコスト・待ち時間が積み重なるため、
// org×tender×trade単位で quote_recommendations に結果をキャッシュし、既にあれば
// 再利用する（ユーザーからの要望：タブを開いたら自動でAIが推薦する）。
// AI呼び出しに失敗しても見積依頼の送信自体は妨げないよう、その業種のおすすめだけを
// 「取得できませんでした」として返す（失敗を握りつぶさず、UIに理由を残す）。
import { analyzePartnerRecommendation, callClaude, type PartnerRecommendCandidate } from "@ai-nyusatsu-bu/ai";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const MODEL_NAME = "claude-sonnet-5";

export type PartnerRecommendationResult = {
  recommendations: { partner_id: string; reason: string }[];
  note: string | null;
  unavailableReason: string | null;
};

type TradeGroup = { trade: string; lots: { item: string; spec: string | null; qty: number | string | null; unit: string | null }[] };

type CandidatePartner = { id: string; name: string; email: string | null; trades: string[]; areas: string[]; rating: number | null; memo: string | null };

/** 対応業種が一致する（または未登録の）メール登録済み協力会社だけを候補にする。 */
function candidatesForTrade(partners: CandidatePartner[], trade: string): PartnerRecommendCandidate[] {
  return partners
    .filter((p) => p.email && (p.trades.length === 0 || p.trades.includes(trade)))
    .map((p) => ({ id: p.id, name: p.name, trades: p.trades, areas: p.areas, rating: p.rating, memo: p.memo }));
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
        const recommended = await analyzePartnerRecommendation(
          { trade: group.trade, tenderItem, place, lots: group.lots, candidates },
          callClaude,
        );
        await supabase.from("quote_recommendations").insert({
          org_id: orgId,
          tender_id: tenderId,
          trade: group.trade,
          model: MODEL_NAME,
          recommendations: recommended.recommendations,
          note: recommended.note,
        });
        result[group.trade] = { recommendations: recommended.recommendations, note: recommended.note, unavailableReason: null };
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
