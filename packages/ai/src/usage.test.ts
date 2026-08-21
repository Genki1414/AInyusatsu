import { describe, expect, it } from "vitest";
import {
  CACHE_WRITE_MULTIPLIER_1H,
  formatUsageSummary,
  summarizeUsage,
  type UsageSummary,
} from "./usage";
import type { TokenUsage } from "./extract";

/** 資料72,000トークンの案件を5本のプロンプトで解析したときの、実際に近い消費。 */
const CACHED_RUN: TokenUsage[] = [
  // 1本目：資料をキャッシュへ書き込む。固有の後半だけが通常の入力
  { inputTokens: 1_500, cacheCreationTokens: 72_000, cacheReadTokens: 0, outputTokens: 1_500 },
  // 2〜5本目：資料はキャッシュから読む
  { inputTokens: 1_500, cacheCreationTokens: 0, cacheReadTokens: 72_000, outputTokens: 2_000 },
  { inputTokens: 1_500, cacheCreationTokens: 0, cacheReadTokens: 72_000, outputTokens: 8_000 },
  { inputTokens: 1_500, cacheCreationTokens: 0, cacheReadTokens: 72_000, outputTokens: 2_000 },
  { inputTokens: 1_500, cacheCreationTokens: 0, cacheReadTokens: 72_000, outputTokens: 1_500 },
];

describe("summarizeUsage", () => {
  it("キャッシュの読み書きを重み付けして、入力の課金相当トークンを出す", () => {
    const s = summarizeUsage(CACHED_RUN);
    // 通常 7,500 + 書込 72,000×1.25 + 読出 288,000×0.1 = 7,500 + 90,000 + 28,800
    expect(s.billableInputEquivalent).toBe(126_300);
    // キャッシュを使わなければ 7,500 + 72,000 + 288,000
    expect(s.uncachedInputEquivalent).toBe(367_500);
  });

  it("入力コストの削減率を出す（この例では約66%）", () => {
    const s = summarizeUsage(CACHED_RUN);
    expect(s.inputSavingRate).toBeCloseTo(0.656, 3);
  });

  it("有効期間1時間なら書き込みが2倍になり、削減率が下がる", () => {
    const s = summarizeUsage(CACHED_RUN, CACHE_WRITE_MULTIPLIER_1H);
    // 7,500 + 144,000 + 28,800
    expect(s.billableInputEquivalent).toBe(180_300);
    expect(s.inputSavingRate).toBeCloseTo(0.509, 3);
  });

  it("キャッシュが1つも効いていなければ削減率0（気づけるようにする）", () => {
    const s = summarizeUsage([
      { inputTokens: 73_500, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 1_500 },
      { inputTokens: 73_500, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 2_000 },
    ]);
    expect(s.inputSavingRate).toBe(0);
    expect(s.billableInputEquivalent).toBe(s.uncachedInputEquivalent);
  });

  it("書き込みだけで読み出しが無い場合、削減率は0にする（負の値を出さない）", () => {
    // 1本しか走らなかった場合。書き込み1.25倍のぶん割高だが、率としては0で表す
    const s = summarizeUsage([{ inputTokens: 0, cacheCreationTokens: 72_000, cacheReadTokens: 0, outputTokens: 1_500 }]);
    expect(s.inputSavingRate).toBe(0);
  });

  it("呼び出しが0件でも落ちない", () => {
    expect(summarizeUsage([])).toMatchObject({ calls: 0, billableInputEquivalent: 0, inputSavingRate: 0 });
  });

  it("出力トークンと呼び出し回数を数える", () => {
    const s = summarizeUsage(CACHED_RUN);
    expect(s.calls).toBe(5);
    expect(s.outputTokens).toBe(15_000);
  });
});

describe("formatUsageSummary", () => {
  it("削減率と、課金相当・キャッシュ無しの両方を1行に出す", () => {
    const s: UsageSummary = summarizeUsage(CACHED_RUN);
    const line = formatUsageSummary(s);
    expect(line).toContain("呼び出し5回");
    expect(line).toContain("入力コスト削減 65.6%");
    expect(line).toContain("126,300");
    expect(line).toContain("367,500");
  });
});
