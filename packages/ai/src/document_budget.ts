// 資料が大きすぎる案件のガード（純ロジック）。
//
// 【なぜ要るか】
// 実データ（88件・2026-08-22）では、資料テキストの分布が極端に右へ伸びていた。
//   中央値 36,206文字 ／ 平均 58,941文字 ／ 最大 770,639文字
// 最大の案件は約716,000トークンで、モデルの入力上限100万トークンまで28%しか余裕が無い。
// これより3割大きい案件が来ると、5本のプロンプトが全部失敗して案件が丸ごと解析できなくなる。
// 手で流している間は気づけるが、自動で回し始めると気づかないまま積み上がる。
//
// 【何をするか】
// 資料の量を見て、渡し方を切り替える。
//   full     全資料を5本すべてに渡す（既定。前半が共通なのでキャッシュが効く）
//   focused  プロンプトごとに必要な資料だけ渡す（1回あたりの入力を小さくして上限を回避）
//   over     1本ぶんでも上限を超える（そのプロンプトは実行しない。理由を残す）
//
// 【誤解しないための注記】
// focused はコスト削減の手段ではない。資料を等分と仮定すると focused の合計入力は
// 全資料の約1.8倍で、キャッシュを効かせた full（約1.65倍相当）より高くつく。
// あくまで「1回あたりの入力を上限内に収める」ための退避モードで、
// 通常の案件では使わない。

import type { AnalysisPromptName } from "./analyze";
import type { PromptDocument } from "../prompts/user_template";

/**
 * 日本語1文字あたりのトークン数。
 * 実測値（2026-08-22）：124,025文字の案件が115,341トークンだった。
 * 推定に使うだけなので、正確さより「下振れしないこと」を優先する。
 */
export const TOKENS_PER_CHAR = 0.93;

export const MODEL_CONTEXT_TOKENS = 1_000_000;
/** adapters/claude.ts の max_tokens。入力と合わせて文脈に収まる必要がある */
export const MAX_OUTPUT_TOKENS = 32_768;
/** システムプロンプト＋出力スキーマ＋追加の指示のぶん */
export const PROMPT_OVERHEAD_TOKENS = 2_000;
/** 文字数からの換算なので、1割ぶれても落ちないように余裕を持たせる */
export const ESTIMATE_MARGIN = 1.1;

/**
 * 1回のリクエストに載せられる資料の上限（推定トークン）。
 * 実測の換算率で約877,000トークン＝約94万文字にあたる。
 */
export const DOCUMENT_BUDGET_TOKENS = Math.floor(
  (MODEL_CONTEXT_TOKENS - MAX_OUTPUT_TOKENS - PROMPT_OVERHEAD_TOKENS) / ESTIMATE_MARGIN,
);

/**
 * 「高額な案件」として記録に残す目安。
 * 平均（約55,000トークン）の4倍弱。上限には遠いが、1件で数百円かかるため見えるようにする。
 */
export const EXPENSIVE_TOKENS = 200_000;

/** 文字数からトークン数を見積もる。 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

/** 資料一式の推定トークン数。 */
export function estimateDocumentTokens(documents: PromptDocument[]): number {
  return documents.reduce((total, doc) => total + estimateTokens(doc.text), 0);
}

/**
 * AI解析プロンプト集.md §0-1 の表にある、各プロンプトの「主な入力資料」。
 * 退避モード（focused）でだけ使う。ここに無い種別（その他・契約書案など）は、
 * どのプロンプトにとっても主資料ではないため落とす。
 */
export const PRIMARY_DOCUMENT_KINDS: Record<AnalysisPromptName, readonly string[]> = {
  basic_info: ["公告"],
  qualifications: ["公告", "入札説明書"],
  lots: ["数量表", "仕様書"],
  forms: ["様式", "入札説明書"],
  notes: ["仕様書", "入札説明書"],
};

export type OmittedDocument = { kind: string; tokens: number };

export type DocumentPlan =
  /** 全資料を渡す。前半が5本で共通なのでキャッシュが効く */
  | { mode: "full"; documents: PromptDocument[]; tokens: number; cacheable: true }
  /** 主資料だけに絞る。プロンプトごとに中身が変わるためキャッシュは効かない */
  | { mode: "focused"; documents: PromptDocument[]; tokens: number; cacheable: false; omitted: OmittedDocument[] }
  /** 絞っても上限を超える。実行しない */
  | { mode: "over"; tokens: number; limit: number };

/**
 * そのプロンプトへ渡す資料を決める。
 *
 * 全資料が上限に収まるなら、いつもどおり全部渡す（キャッシュが効くので一番安い）。
 * 収まらない場合だけ主資料に絞り、それでも収まらなければ実行しない。
 * 黙って切り詰めることはしない（落とした資料は omitted に残す）。
 */
export function planPromptDocuments(
  promptName: AnalysisPromptName,
  documents: PromptDocument[],
  budgetTokens: number = DOCUMENT_BUDGET_TOKENS,
): DocumentPlan {
  const total = estimateDocumentTokens(documents);
  if (total <= budgetTokens) {
    return { mode: "full", documents, tokens: total, cacheable: true };
  }

  const primary = PRIMARY_DOCUMENT_KINDS[promptName];
  const kept = documents.filter((doc) => primary.includes(doc.kind));
  const omitted: OmittedDocument[] = documents
    .filter((doc) => !primary.includes(doc.kind))
    .map((doc) => ({ kind: doc.kind, tokens: estimateTokens(doc.text) }));
  const keptTokens = estimateDocumentTokens(kept);

  if (kept.length === 0 || keptTokens > budgetTokens) {
    return { mode: "over", tokens: kept.length === 0 ? total : keptTokens, limit: budgetTokens };
  }
  return { mode: "focused", documents: kept, tokens: keptTokens, cacheable: false, omitted };
}

/** 資料が大きすぎて実行できないときに投げる。理由がそのまま案件の「要確認」に出る。 */
export class DocumentsTooLargeError extends Error {
  constructor(
    public readonly promptName: string,
    public readonly tokens: number,
    public readonly limit: number,
  ) {
    super(
      `資料が大きすぎるため解析できません（${promptName}：推定${tokens.toLocaleString("ja-JP")}トークン ＞ 上限${limit.toLocaleString("ja-JP")}トークン）。` +
        `資料を分割するか、対象の資料を絞る必要があります。`,
    );
    this.name = "DocumentsTooLargeError";
  }
}
