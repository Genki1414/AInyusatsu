// 見積依頼先の推薦。候補はすでに業種で絞られているため、地域と人が付けた評価だけで
// 決定的に並べる。AIへ会社情報を送らず、画面を開くたびのAPI原価も発生させない。

export type RuleRecommendationCandidate = {
  id: string;
  name: string;
  areas: string[];
  rating: number | null;
};

export type RuleRecommendation = { partner_id: string; reason: string };

function matchesPlace(areas: string[], place: string | null): boolean {
  if (!place || areas.length === 0) return false;
  return areas.some((area) => area.trim() !== "" && (place.includes(area) || area.includes(place)));
}

/**
 * 明確にエリア外の会社は除き、エリア一致→評価→会社名の順で最大5社を推薦する。
 * 対応エリア未登録は「不一致」と断定できないため候補に残すが、一致企業より後ろに置く。
 */
export function recommendPartnersByRules(
  candidates: RuleRecommendationCandidate[],
  place: string | null,
  limit = 5,
): RuleRecommendation[] {
  return candidates
    .map((candidate) => ({ candidate, areaMatch: matchesPlace(candidate.areas, place) }))
    .filter(({ candidate, areaMatch }) => candidate.areas.length === 0 || place === null || areaMatch)
    .sort((a, b) => {
      if (a.areaMatch !== b.areaMatch) return a.areaMatch ? -1 : 1;
      const ratingDiff = (b.candidate.rating ?? 0) - (a.candidate.rating ?? 0);
      if (ratingDiff !== 0) return ratingDiff;
      return a.candidate.name.localeCompare(b.candidate.name, "ja");
    })
    .slice(0, Math.max(0, limit))
    .map(({ candidate, areaMatch }) => {
      const reasons = [areaMatch ? "履行場所と対応エリアが一致" : "対応エリアは未登録"];
      if (candidate.rating !== null) reasons.push(`評価${candidate.rating}`);
      return { partner_id: candidate.id, reason: reasons.join("・") };
    });
}
