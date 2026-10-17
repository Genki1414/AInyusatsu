// ホーム（今日やること）に出す、実際にやること。
//
// 【なぜ作ったか】
// 「今日やること」という題名なのに、中身は数字が3つ並ぶだけだった
// （提案されている案件／検討中の案件／3日以内の期限）。
// 件数は分かっても、**何をすればよいかが書いていない**（ユーザー要望 2026-10-17）。
//
// 【案件ページと同じ判定を使う】
// やることは案件ごとの段取り（buildRoadmap）が既に出している。
// ホームで別の計算をすると、2つの画面が違うことを言い出す。
// 同じ関数を通して、同じ「いま」を出す。
//
// 【決めていない案件は出さない】
// 未定・保留・見送りの案件に「やること」は無い。
// 全部並べると、本当に手を動かすものが埋もれる。

import { daysUntilDeadline } from "./deadline";
import {
  buildRoadmap,
  currentStep,
  type RoadmapInput,
  type RoadmapTab,
  type TenderStance,
} from "./tender_stance";

export type TodayTaskSource = {
  tenderId: string;
  tenderName: string;
  stance: TenderStance;
  /** 参加のときだけ使う。検討のときは submitDeadline しか見ない */
  roadmap: RoadmapInput;
};

export type TodayTask = {
  tenderId: string;
  tenderName: string;
  stance: TenderStance;
  /** 何をするか。短い動詞 */
  label: string;
  /** なぜ要るか・気をつけること。無ければ null */
  note: string | null;
  /** その作業の期限。取れていなければ null（推測しない） */
  deadline: string | null;
  /** 期限までの日数。取れていなければ null（推測しない） */
  daysLeft: number | null;
  /** その作業の画面。無ければ案件ページのトップへ */
  tab: RoadmapTab | null;
};

/**
 * やることを、急ぐ順に並べて返す。
 *
 * - 参加：段取りの「いま」をそのまま出す
 * - 検討：まだ決めていないので「参加するか決める」
 * - それ以外：出さない
 */
export function todayTasks(sources: TodayTaskSource[], now: Date = new Date()): TodayTask[] {
  const tasks: TodayTask[] = [];

  for (const source of sources) {
    if (source.stance === "参加") {
      const step = currentStep(buildRoadmap(source.roadmap, now));
      // 全部終わっている案件には、やることが無い
      if (step === null) continue;
      tasks.push({
        tenderId: source.tenderId,
        tenderName: source.tenderName,
        stance: source.stance,
        label: step.label,
        note: step.note,
        deadline: step.deadline,
        daysLeft: step.daysLeft,
        tab: step.tab,
      });
      continue;
    }

    if (source.stance === "検討") {
      tasks.push({
        tenderId: source.tenderId,
        tenderName: source.tenderName,
        stance: source.stance,
        label: "参加するか決める",
        // 決めないまま期限が来るのがいちばん多い取りこぼし
        note: "参加すると決めてから、資料の取得・見積依頼・書類の用意に日数がかかります。",
        deadline: source.roadmap.submitDeadline,
        daysLeft: daysUntilDeadline(source.roadmap.submitDeadline, now),
        tab: null,
      });
    }
  }

  return sortByUrgency(tasks);
}

/**
 * 急ぐ順。**期限が取れていないものは最後に置く。**
 *
 * 取れていないものを「期限なし＝急がない」として扱うのではなく、
 * 日付が分かっているものを先に見せる、という並びにする。
 * 取れていないこと自体は画面で「期限は未確認」と書く。
 */
function sortByUrgency(tasks: TodayTask[]): TodayTask[] {
  return [...tasks].sort((a, b) => {
    if (a.daysLeft === null && b.daysLeft === null) return a.tenderName.localeCompare(b.tenderName, "ja");
    if (a.daysLeft === null) return 1;
    if (b.daysLeft === null) return -1;
    if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
    return a.tenderName.localeCompare(b.tenderName, "ja");
  });
}
