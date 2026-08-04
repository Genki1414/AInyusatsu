// AI解析プロンプト集.md §8「実装メモ」の呼び出し共通処理。
// LLMの出力を必ずZodで検証してから返す。失敗したら1回だけ再実行し、2回失敗したら
// ParseInvalidErrorを投げる（呼び出し元はPARSE_INVALIDとして記録し、案件は「解析失敗」として残す。
// 黙って落とさない＝CLAUDE.mdの「エラーは握りつぶさない」）。

import type { ZodType } from "zod";

/** 2回試行してもスキーマに適合する出力が得られなかった場合に投げる。 */
export class ParseInvalidError extends Error {
  constructor(public readonly promptName: string) {
    super(`AI解析結果がスキーマに適合しませんでした（${promptName}）。2回試行して失敗しました。`);
    this.name = "ParseInvalidError";
  }
}

/** モデル呼び出しの抽象。実運用では adapters/claude.ts の callClaude を渡す（テストではモックを渡す）。 */
export type CallModel = (args: { system: string; user: string; temperature: number }) => Promise<string>;

export type ExtractInvalidEvent = { promptName: string; attempt: number; issue: unknown };
export type OnInvalid = (event: ExtractInvalidEvent) => void;

/**
 * ```json ... ``` のようなコードフェンスが付いていれば取り除いてからJSONとしてパースする。
 * モデルがCLAUDE.mdの指示（コードブロックの記号を付けない）に従わなかった場合の保険。
 */
export function safeJsonParse(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

export type ExtractParams<T> = {
  promptName: string;
  system: string;
  user: string;
  schema: ZodType<T>;
  callModel: CallModel;
  onInvalid?: OnInvalid;
};

/** プロンプトを実行し、Zodスキーマで検証する。失敗時は最大2回まで試行する。 */
export async function extract<T>(params: ExtractParams<T>): Promise<T> {
  const { promptName, system, user, schema, callModel, onInvalid } = params;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await callModel({ system, user, temperature: 0 });
    try {
      const parsed = safeJsonParse(raw);
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;
      onInvalid?.({ promptName, attempt, issue: result.error.issues });
    } catch (err) {
      onInvalid?.({ promptName, attempt, issue: err });
    }
  }

  throw new ParseInvalidError(promptName);
}
