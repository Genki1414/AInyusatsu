// 案件ページのタブ。どれを開くかを決める。
//
// 【なぜ必要か】
// タブが7つ並んでいて、どこで作業するのか分からない。しかもURLに指定が無いときは
// 常に「参加判断」が開くので、すでに参加を決めて途中まで進めた案件でも、
// 毎回いちばん最初の画面へ戻される（ユーザー要望 2026-10-17）。
//
// 【段取りに合わせる】
// 「いま何をするか」は段取り（buildRoadmap）が既に出している。
// その作業の画面を開く。決めていない案件は、決めるところ（参加判断）から。

import { currentStep, type RoadmapStep, type TenderStance } from "./tender_stance";

/**
 * タブの識別子。**画面の並び順・ラベル・アイコンとは別に持つ。**
 * URLに出る値なので、ラベルを直しても変わらない。
 */
export const TENDER_TAB_KEYS = ["fit", "docs", "analysis", "request", "quote-status", "cost", "forms"] as const;
export type TenderTabKey = (typeof TENDER_TAB_KEYS)[number];

export function isTenderTabKey(value: string | null | undefined): value is TenderTabKey {
  return typeof value === "string" && (TENDER_TAB_KEYS as readonly string[]).includes(value);
}

/**
 * URLにタブの指定が無いときに開くタブ。
 *
 * - 参加：いまやる作業の画面。段取りが全部済んでいる・開札待ちのように
 *   こちらから作業する画面が無いときは「参加判断」
 * - それ以外：まだやるかどうかを決めていないので「参加判断」
 *
 * **指定があるときはそれを優先する。** 勝手に別のタブへ飛ばすと、
 * リンクを共有しても相手が同じ画面を見られない。
 */
export function defaultTenderTab(stance: TenderStance, steps: readonly RoadmapStep[]): TenderTabKey {
  if (stance !== "参加") return "fit";
  return currentStep([...steps])?.tab ?? "fit";
}

/**
 * いま作業するタブ。無ければ null。
 * タブの並びに印を付けて、「どこを開けばよいか」を見せるのに使う。
 */
export function activeWorkTab(stance: TenderStance, steps: readonly RoadmapStep[]): TenderTabKey | null {
  if (stance !== "参加") return null;
  return currentStep([...steps])?.tab ?? null;
}
