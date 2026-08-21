// AI解析プロンプト集.md §8「実装メモ」の呼び出し共通処理。
// LLMの出力を必ずZodで検証してから返す。失敗したら1回だけ再実行し、2回失敗したら
// ParseInvalidErrorを投げる（呼び出し元はPARSE_INVALIDとして記録し、案件は「解析失敗」として残す。
// 黙って落とさない＝CLAUDE.mdの「エラーは握りつぶさない」）。

import type { ZodType, ZodTypeDef } from "zod";

// スキーマは「入力（モデルの生JSON）」と「出力（検証後の値）」の型が食い違う。
// 省略されたキーを既定値で埋める（.default(null) など）ため、入力側は unknown として受ける。
type OutputSchema<T> = ZodType<T, ZodTypeDef, unknown>;

/** 2回試行してもスキーマに適合する出力が得られなかった場合に投げる。 */
export class ParseInvalidError extends Error {
  constructor(public readonly promptName: string) {
    super(`AI解析結果がスキーマに適合しませんでした（${promptName}）。2回試行して失敗しました。`);
    this.name = "ParseInvalidError";
  }
}

/**
 * ユーザープロンプト。前半と後半に分けて渡す。
 *
 * 同じ案件に対して6本のプロンプトを走らせるが、前半（案件の既知情報＋資料）は6本とも
 * まったく同じで、違うのは後半（出力スキーマ＋追加の指示）だけになる。前半をプロンプト
 * キャッシュの対象にすると、2本目以降はその分の入力が1/10の値段になる。
 * 資料テキストは1案件で数万トークンあり、入力コストの大半を占めるため効き方が大きい。
 *
 * 共通の前半を持たない単発のプロンプト（協力会社のおすすめなど）は cachedPrefix を null にする。
 */
export type UserPrompt = {
  /** 同じ案件の他のプロンプトと共通する前半。ここまでをキャッシュする */
  cachedPrefix: string | null;
  /** このプロンプト固有の後半 */
  body: string;
};

/** モデルが実際に消費したトークン。キャッシュが効いているかの計測に使う。 */
export type TokenUsage = {
  /** キャッシュに当たらなかった入力 */
  inputTokens: number;
  /** キャッシュへの書き込み（1.25倍で課金される） */
  cacheCreationTokens: number;
  /** キャッシュからの読み出し（0.1倍で課金される） */
  cacheReadTokens: number;
  outputTokens: number;
};

export type ModelUsage = TokenUsage & { promptName: string; attempt: number };
export type OnUsage = (usage: ModelUsage) => void;

/** モデル呼び出しの抽象。実運用では adapters/claude.ts の callClaude を渡す（テストではモックを渡す）。 */
export type CallModel = (args: {
  system: string;
  user: UserPrompt;
  temperature: number;
  onUsage?: (usage: TokenUsage) => void;
}) => Promise<string>;

export type ExtractInvalidEvent = {
  promptName: string;
  attempt: number;
  issue: unknown;
  /** モデルの生出力。JSONとして壊れている場合、issueだけでは原因が分からないため添える */
  raw: string;
};
export type OnInvalid = (event: ExtractInvalidEvent) => void;

/**
 * 文字列リテラルの中に生の制御文字（改行・タブなど）が含まれていればエスケープする。
 * JSONの仕様では文字列中の制御文字は \n のようにエスケープする必要があるが、
 * モデルは資料からの引用（quote）に改行をそのまま入れてくることがあり、
 * その場合 JSON.parse が "Bad control character in string literal" で失敗する（実機で発生）。
 * 引用の中身は変えず、JSONとして読める形に直すだけ。
 */
export function escapeControlCharsInStrings(json: string): string {
  const ESCAPES: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };
  let out = "";
  let inString = false;
  let escaped = false;

  for (const char of json) {
    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      out += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      out += char;
      continue;
    }
    if (inString && char < " ") {
      // 制御文字。既知のものは対応するエスケープに、それ以外は \u00XX にする
      out += ESCAPES[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
      continue;
    }
    out += char;
  }
  return out;
}

/**
 * ```json ... ``` のようなコードフェンスが付いていれば取り除いてからJSONとしてパースする。
 * モデルがCLAUDE.mdの指示（コードブロックの記号を付けない）に従わなかった場合の保険。
 * 文字列中の生の制御文字も、そのままではパースできないためエスケープしてから読む。
 */
export function safeJsonParse(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const body = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    // そのまま読めない場合だけ、制御文字を直して読み直す（正常な出力の挙動は変えない）
    return JSON.parse(escapeControlCharsInStrings(body));
  }
}

export type ExtractParams<T> = {
  promptName: string;
  system: string;
  user: UserPrompt;
  schema: OutputSchema<T>;
  callModel: CallModel;
  onInvalid?: OnInvalid;
  /** 実際のトークン消費を受け取る。キャッシュが効いているかを測るために使う */
  onUsage?: OnUsage;
};

/** プロンプトを実行し、Zodスキーマで検証する。失敗時は最大2回まで試行する。 */
export async function extract<T>(params: ExtractParams<T>): Promise<T> {
  const { promptName, system, user, schema, callModel, onInvalid, onUsage } = params;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await callModel({
      system,
      user,
      temperature: 0,
      onUsage: onUsage ? (usage) => onUsage({ ...usage, promptName, attempt }) : undefined,
    });
    try {
      const parsed = safeJsonParse(raw);
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;
      onInvalid?.({ promptName, attempt, issue: result.error.issues, raw });
    } catch (err) {
      onInvalid?.({ promptName, attempt, issue: err, raw });
    }
  }

  throw new ParseInvalidError(promptName);
}
