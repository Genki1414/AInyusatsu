// Batch API での案件解析（コスト対策③）の純ロジック。
//
// Batch API は全トークンが50%引きになるが、代わりに「いつ・どの順で処理されるか」を
// こちらから制御できない（たいてい1時間以内、最大24時間）。
// プロンプトキャッシュは「先に書き込んだものを後から読む」前提なので、5本を1つのバッチに
// 混ぜると1本目の書き込みを待たずに残りが走り、キャッシュが効かない可能性が高い。
//
// そのため2段階に分ける。
//   第1段：基本情報だけを全案件ぶん投入する（資料をキャッシュへ書き込む）
//   第2段：第1段の完了後に、残り4本を全案件ぶん投入する（キャッシュから読む）
//
// 第2段が第1段の書き込みから1時間以内に処理される保証は無いため、キャッシュの有効期間は
// 1時間を指定する。それでも外れうるので、実際のヒット率は必ず実測する（未検証）。

import type { AnalysisPromptName } from "./analyze";

/** 第1段で投入するプロンプト。資料をキャッシュへ書き込む役目を持つ。 */
export const CACHE_WARMING_PROMPT: AnalysisPromptName = "basic_info";

/** 第2段で投入するプロンプト。第1段が書き込んだキャッシュを読む。 */
export const CACHE_READING_PROMPTS: AnalysisPromptName[] = ["qualifications", "lots", "forms", "notes"];

export type BatchStage = 1 | 2;

/** その段で投入するプロンプトを返す。 */
export function promptsForStage(stage: BatchStage): AnalysisPromptName[] {
  return stage === 1 ? [CACHE_WARMING_PROMPT] : [...CACHE_READING_PROMPTS];
}

/**
 * バッチの1リクエストを案件・プロンプトに紐づけるID。
 * 結果は投入順に返らないため、custom_id だけを頼りに突き合わせる。
 */
export function buildCustomId(tenderId: string, promptName: AnalysisPromptName): string {
  return `${tenderId}#${promptName}`;
}

export type ParsedCustomId = { tenderId: string; promptName: AnalysisPromptName };

/**
 * custom_id を案件IDとプロンプト名に戻す。
 * 見覚えのない形式なら null を返す（黙って捨てず、呼び出し側で記録できるようにする）。
 */
export function parseCustomId(customId: string): ParsedCustomId | null {
  const at = customId.lastIndexOf("#");
  if (at <= 0) return null;
  const tenderId = customId.slice(0, at);
  const promptName = customId.slice(at + 1);
  if (!isAnalysisPromptName(promptName)) return null;
  return { tenderId, promptName };
}

const KNOWN_PROMPTS: string[] = [CACHE_WARMING_PROMPT, ...CACHE_READING_PROMPTS];

export function isAnalysisPromptName(value: string): value is AnalysisPromptName {
  return KNOWN_PROMPTS.includes(value);
}

/** バッチから返ってきた1件ぶんの結果。成功なら本文、失敗なら理由が入る。 */
export type BatchResultEntry = {
  customId: string;
  /** モデルの出力。失敗していれば null */
  text: string | null;
  /** 失敗の理由。成功していれば null */
  error: string | null;
};

export type TenderBatchResults = {
  tenderId: string;
  /** プロンプト名 → モデルの出力 */
  outputs: Partial<Record<AnalysisPromptName, string>>;
  /** プロンプト名 → 失敗の理由 */
  errors: Partial<Record<AnalysisPromptName, string>>;
};

export type GroupedBatchResults = {
  byTender: TenderBatchResults[];
  /** custom_id を読めなかった結果。捨てずに呼び出し側へ渡して記録させる */
  unmatched: BatchResultEntry[];
};

/**
 * バッチの結果を案件ごとにまとめる。
 * 案件の並びは custom_id が最初に出てきた順を保つ（結果の並び自体は保証されない）。
 */
export function groupResultsByTender(results: BatchResultEntry[]): GroupedBatchResults {
  const order: string[] = [];
  const map = new Map<string, TenderBatchResults>();
  const unmatched: BatchResultEntry[] = [];

  for (const result of results) {
    const parsed = parseCustomId(result.customId);
    if (!parsed) {
      unmatched.push(result);
      continue;
    }
    let entry = map.get(parsed.tenderId);
    if (!entry) {
      entry = { tenderId: parsed.tenderId, outputs: {}, errors: {} };
      map.set(parsed.tenderId, entry);
      order.push(parsed.tenderId);
    }
    if (result.text !== null) {
      entry.outputs[parsed.promptName] = result.text;
    } else {
      entry.errors[parsed.promptName] = result.error ?? "理由不明";
    }
  }

  return { byTender: order.map((id) => map.get(id)!), unmatched };
}
