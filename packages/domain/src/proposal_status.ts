// 提案の状態の遷移（タスク3-2）。
// 参照：docs/実装仕様書_v1.md §7「再照合：条件セット変更時に 提案対象・配信済・既読 のみ作り直す」
//
// 【なぜ切り出したか】
// match（提案の作成）は1日2回走る。再照合のたびに状態を 提案対象 に戻していたため、
// 一度知らせた提案が翌朝もう一度「新着」として出てしまう。
// 毎日同じものが届く通知は読まれなくなり、本当に新しい提案も埋もれる。
//
// 「作り直す」のは点数と理由であって、知らせた事実ではない。
// 配信済・既読はユーザーに届いた記録なので、再採点しても消さない。

export const PROPOSAL_STATUSES = ["提案対象", "配信済", "既読", "検討中", "対象外"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/**
 * 再採点してよい状態。
 * 検討中・対象外はユーザーの判断が入っているため上書きしない。
 */
export const RESCORABLE_STATUSES: readonly ProposalStatus[] = ["提案対象", "配信済", "既読"];

export function canRescore(status: string | null | undefined): boolean {
  if (status == null) return true; // 新規はいつでも作る
  return (RESCORABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * 再採点したあとの状態を決める。
 *
 * - 条件を満たさなくなったら 対象外（理由が変わったことはユーザーに見せる）
 * - すでに知らせた（配信済・既読）ものは、その記録を残す
 * - それ以外（新規・未配信）は 提案対象
 */
export function nextProposalStatus(current: string | null | undefined, eligible: boolean): ProposalStatus {
  if (!eligible) return "対象外";
  if (current === "配信済" || current === "既読") return current;
  return "提案対象";
}

/** まだ知らせていない提案か（毎朝のダイジェストで「新着」として出す対象）。 */
export function isUndelivered(status: string): boolean {
  return status === "提案対象";
}
