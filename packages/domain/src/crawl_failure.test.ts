import { describe, expect, it } from "vitest";
import { classifyCrawlFailure } from "./crawl_failure";

describe("classifyCrawlFailure", () => {
  // 実機で積まれた34件のメッセージ（2026-09-01〜09-03）
  const 実例 = [
    "locator.click: Timeout 30000ms exceeded. Call log: - waiting for getByRole('button', { name: '次へ', exact: true })",
    'page.goto: Timeout 30000ms exceeded. Call log: - navigating to "https://www.geps.go.jp/biz-contract/UKB06/OKB06_M01_B01?PRM=xxx", waiting until "load"',
    'page.waitForLoadState: Timeout 30000ms exceeded. ==== logs ==== "networkidle" event fired ====',
    "locator.waitFor: Timeout 30000ms exceeded. Call log: - waiting for locator('th:text-is(\"商号又は名称\") + td input').first() to be visible",
    "locator.evaluate: Timeout 30000ms exceeded. Call log: - waiting for getByRole('radio', { name: '連絡先情報をはじめから入力する' })",
  ];

  it("実機で積まれたものは全部タイムアウトとして扱う（セレクタは壊れていない）", () => {
    for (const message of 実例) {
      expect(classifyCrawlFailure(message), message.slice(0, 40)).toBe("TIMEOUT");
    }
  });

  it("Navigation timeout も拾う", () => {
    expect(classifyCrawlFailure("Navigation timeout of 30000 ms exceeded")).toBe("TIMEOUT");
  });

  it("ICカードやログインが要るものは AUTH_REQUIRED", () => {
    expect(classifyCrawlFailure("ICカードが必要です")).toBe("AUTH_REQUIRED");
    expect(classifyCrawlFailure("この資料はログインが必要です")).toBe("AUTH_REQUIRED");
  });

  it("認証はタイムアウトより先に見る（両方含む文でも認証を選ぶ）", () => {
    expect(classifyCrawlFailure("ICカードが必要です（Timeout 30000ms exceeded）")).toBe("AUTH_REQUIRED");
  });

  it("当てはまらないものは LAYOUT_CHANGED（人が見る側に倒す）", () => {
    expect(classifyCrawlFailure("要素が見つかりません")).toBe("LAYOUT_CHANGED");
    expect(classifyCrawlFailure("strict mode violation: locator resolved to 3 elements")).toBe("LAYOUT_CHANGED");
  });

  it("メッセージが無くても落ちない", () => {
    expect(classifyCrawlFailure(null)).toBe("LAYOUT_CHANGED");
    expect(classifyCrawlFailure(undefined)).toBe("LAYOUT_CHANGED");
    expect(classifyCrawlFailure("   ")).toBe("LAYOUT_CHANGED");
  });
});
