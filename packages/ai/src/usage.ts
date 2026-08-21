// プロンプトキャッシュが実際に効いているかを測るための集計（純ロジック）。
//
// キャッシュは「効いているつもりで効いていない」が起きやすい。前半の文字列が1文字でも
// 変われば外れるし、実行の間隔が有効期間を超えても外れる。どちらも失敗としては現れず、
// 請求額に静かに出るだけなので、解析のたびにヒット率を残して気づけるようにする。

import type { ModelUsage, TokenUsage } from "./extract";

/**
 * 入力トークンの課金の重み。
 * キャッシュの読み出しは0.1倍、書き込みは有効期間5分で1.25倍・1時間で2倍
 * （Claude API の料金体系）。
 */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER_5M = 1.25;
export const CACHE_WRITE_MULTIPLIER_1H = 2;

export type UsageSummary = {
  /** モデルを呼んだ回数（再試行も1回と数える） */
  calls: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  /** キャッシュの重みを掛けた、入力の課金相当トークン */
  billableInputEquivalent: number;
  /** キャッシュを使わなかった場合の入力トークン（同じ内容を毎回そのまま送った場合） */
  uncachedInputEquivalent: number;
  /** 入力コストの削減率（0〜1）。キャッシュが1つも効いていなければ0 */
  inputSavingRate: number;
};

/**
 * 実際のトークン消費をまとめ、キャッシュによる入力コストの削減率を出す。
 * 書き込みの重みは有効期間で変わるため引数にする（既定は5分）。
 */
export function summarizeUsage(
  usages: (TokenUsage | ModelUsage)[],
  cacheWriteMultiplier: number = CACHE_WRITE_MULTIPLIER_5M,
): UsageSummary {
  const sum = (pick: (u: TokenUsage) => number) => usages.reduce((total, u) => total + pick(u), 0);
  const inputTokens = sum((u) => u.inputTokens);
  const cacheCreationTokens = sum((u) => u.cacheCreationTokens);
  const cacheReadTokens = sum((u) => u.cacheReadTokens);

  const billableInputEquivalent =
    inputTokens + cacheCreationTokens * cacheWriteMultiplier + cacheReadTokens * CACHE_READ_MULTIPLIER;
  // キャッシュを使わなければ、同じ内容が毎回そのままの値段で入力される
  const uncachedInputEquivalent = inputTokens + cacheCreationTokens + cacheReadTokens;

  return {
    calls: usages.length,
    inputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    outputTokens: sum((u) => u.outputTokens),
    billableInputEquivalent: Math.round(billableInputEquivalent),
    uncachedInputEquivalent,
    inputSavingRate:
      uncachedInputEquivalent === 0 ? 0 : Math.max(0, 1 - billableInputEquivalent / uncachedInputEquivalent),
  };
}

/** ログに1行で出すための文字列。 */
export function formatUsageSummary(summary: UsageSummary): string {
  const pct = (summary.inputSavingRate * 100).toFixed(1);
  return (
    `呼び出し${summary.calls}回 / 入力: 通常${summary.inputTokens.toLocaleString("ja-JP")} ` +
    `キャッシュ書込${summary.cacheCreationTokens.toLocaleString("ja-JP")} ` +
    `キャッシュ読出${summary.cacheReadTokens.toLocaleString("ja-JP")} ` +
    `/ 出力${summary.outputTokens.toLocaleString("ja-JP")} ` +
    `/ 入力コスト削減 ${pct}%（課金相当 ${summary.billableInputEquivalent.toLocaleString("ja-JP")} ` +
    `＜ キャッシュ無し ${summary.uncachedInputEquivalent.toLocaleString("ja-JP")}）`
  );
}
