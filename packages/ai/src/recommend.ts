// 見積依頼先のAIおすすめ選定（タスク4-1拡張）。
// analyze.ts（案件資料の抽出6本）とは入力の形が異なる（資料テキストではなく、
// 案件の業種・数量表と協力会社マスタの情報を渡す）ため、別ファイルにしている。
import { PARTNER_RECOMMEND_INSTRUCTIONS, PARTNER_RECOMMEND_SCHEMA_DESCRIPTION, PARTNER_RECOMMEND_SYSTEM_PROMPT } from "../prompts/partner_recommend";
import { extract, type CallModel, type OnInvalid } from "./extract";
import { partnerRecommendSchema, type PartnerRecommend } from "./schemas/partner_recommend";

export type PartnerRecommendLot = { item: string; spec: string | null; qty: number | string | null; unit: string | null };

export type PartnerRecommendCandidate = {
  id: string;
  name: string;
  trades: string[];
  areas: string[];
  rating: number | null;
  memo: string | null;
};

export type PartnerRecommendInput = {
  trade: string;
  tenderItem: string | null;
  place: string | null;
  lots: PartnerRecommendLot[];
  candidates: PartnerRecommendCandidate[];
};

function formatCandidate(c: PartnerRecommendCandidate): string {
  const lines = [
    `- id: ${c.id}`,
    `  会社名: ${c.name}`,
    `  対応業種: ${c.trades.length > 0 ? c.trades.join("・") : "未登録"}`,
    `  対応エリア: ${c.areas.length > 0 ? c.areas.join("・") : "未登録"}`,
    `  評価: ${c.rating ?? "未登録"}`,
  ];
  if (c.memo) lines.push(`  メモ: ${c.memo}`);
  return lines.join("\n");
}

export function buildPartnerRecommendUserPrompt(input: PartnerRecommendInput): string {
  const lotsText =
    input.lots.length > 0
      ? input.lots.map((l) => `- ${l.item}${l.spec ? `（${l.spec}）` : ""} ${l.qty ?? ""}${l.unit ?? ""}`).join("\n")
      : "（数量表の記載なし）";

  return `# 案件情報
業種: ${input.trade}
営業品目: ${input.tenderItem ?? "不明"}
履行場所: ${input.place ?? "不明"}

## この業種の数量表
${lotsText}

# 候補の協力会社
${input.candidates.map(formatCandidate).join("\n")}

# 出力形式
${PARTNER_RECOMMEND_SCHEMA_DESCRIPTION}

${PARTNER_RECOMMEND_INSTRUCTIONS}`;
}

/** 見積依頼先のAIおすすめ選定。候補が無ければ呼び出し側でスキップすること。 */
export async function analyzePartnerRecommendation(
  input: PartnerRecommendInput,
  callModel: CallModel,
  onInvalid?: OnInvalid,
): Promise<PartnerRecommend> {
  return extract({
    promptName: "partner_recommend",
    system: PARTNER_RECOMMEND_SYSTEM_PROMPT,
    user: buildPartnerRecommendUserPrompt(input),
    schema: partnerRecommendSchema,
    callModel,
    onInvalid,
  });
}
