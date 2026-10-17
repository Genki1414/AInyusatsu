// 提案の扱い（proposals.status）を変えたとき、案件の判断（company_tenders.stance）も
// 合わせて動かすかどうか。
//
// 【なぜ必要か】
// 判断の軸が2つある。
//   proposals.status      ：AIの提案をまだ机に載せておくか
//                           （提案対象 / 配信済 / 既読 / 検討中 / 対象外）
//   company_tenders.stance：利用者がどうしたいか（未定 / 検討 / 保留 / 参加 / 見送り）
// 提案一覧の「参加を検討する」「今回は見送る」は status だけを変えていた。
// 一方でホームの「今日やること」も案件ページの段取りも stance を見る。
// つまり**提案一覧で押しても「今日やること」に出てこない**（2026-10-17 に気づいた）。
// 押した操作が効いていないのと同じなので、stance も一緒に動かす。
//
// 【参加を決めた案件は落とさない】
// 参加にすると提出までの段取りが始まる。資料を取り、見積を集め、書類をそろえている
// 途中の案件を、提案一覧のボタン1つで見送りにしてはいけない。
// 参加の案件は stance を動かさない（提案の扱いだけ変える）。

import type { ProposalStatus } from "./proposal_status";
import type { TenderStance } from "./tender_stance";

/**
 * 提案一覧のボタンで選べる扱い。
 * 配信済・既読は「知らせた記録」で、人が選ぶものではないので入れない。
 */
export const SELECTABLE_PROPOSAL_STATUSES: readonly ProposalStatus[] = ["提案対象", "検討中", "対象外"];

export function isSelectableProposalStatus(value: string | null | undefined): value is ProposalStatus {
  return typeof value === "string" && (SELECTABLE_PROPOSAL_STATUSES as readonly string[]).includes(value);
}

/**
 * 提案の扱いを変えたときに、判断をどう動かすか。
 * 動かさないときは null を返す（**いまの判断をそのまま残す**）。
 *
 * - 検討中：「参加を検討する」を押した → 検討
 * - 対象外：「今回は見送る」を押した → 見送り
 * - 提案対象：「戻す」を押した。見送りにしていたものだけ未定へ戻す
 *   （検討・保留のものは、机に戻しただけで判断は変わっていない）
 * - 配信済・既読：知らせた記録なので、判断は動かさない
 *
 * いずれも、参加を決めた案件は動かさない。
 */
export function stanceForProposalStatus(status: ProposalStatus, current: TenderStance): TenderStance | null {
  // 段取りが進んでいる案件を、提案一覧のボタンで落とさない
  if (current === "参加") return null;

  if (status === "検討中") return current === "検討" ? null : "検討";
  if (status === "対象外") return current === "見送り" ? null : "見送り";
  // 「戻す」。見送りを解いて、まだ決めていない状態へ戻す
  if (status === "提案対象") return current === "見送り" ? "未定" : null;
  // 配信済・既読は人の判断ではない
  return null;
}
