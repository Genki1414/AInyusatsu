// 案件を一覧で見せるときの判定（タスク3-5「すべての案件」）。
//
// 【なぜ必要か】
// 「提案された案件」は提案条件（criteria_sets）で絞った結果しか出ないため、
// 収集・解析まで終わっている案件が画面に出てこない。実際には集まっているのに
// 「案件が少ない」と見えてしまう。ここでは条件で絞らず、解析まで終わった案件を
// すべて出すための判定を置く。
//
// 【1つの案件に複数の提案がぶら下がる】
// proposals は org × tender × criteria_set の組で作られるので、条件セットを複数
// 持つ会社では1案件に複数行できる。片方が「提案対象」でもう片方が「対象外」のとき、
// 「対象外」を見せてしまうと参加できる案件を見落とす。参加できる側を優先する。

/** 一覧に出す案件の状態。公告取得・資料取得・解析まで終わったもの。 */
export const BROWSABLE_COLLECT_STATUSES = ["解析完了", "公開中"] as const;

/** まだ解析が終わっていない状態（「ほかに解析待ちが何件あるか」の表示に使う）。 */
export const PENDING_COLLECT_STATUSES = ["未取得", "取得中", "取得済", "AI解析中"] as const;

export type BrowseProposal = {
  tenderId: string;
  /** proposals.status（提案対象/配信済/既読/検討中/対象外） */
  status: string;
  score: number;
  excludedReason: string | null;
};

export type TenderVerdict =
  /** 参加できる見込み。scoreは適合度 */
  | { kind: "提案対象"; status: string; score: number }
  /** 条件に合わない。理由を添える */
  | { kind: "対象外"; status: string; score: number; excludedReason: string | null }
  /** 提案条件が未登録などで、まだ採点されていない */
  | { kind: "未判定" };

/**
 * 1案件にぶら下がる提案から、画面に出す1件を選ぶ。
 * 「対象外」でないものを優先し、その中で適合度が高いものを選ぶ。
 * すべて「対象外」なら、その中で適合度が高いものを選ぶ（理由を見せるため）。
 */
export function pickBestProposal(proposals: BrowseProposal[]): BrowseProposal | null {
  if (proposals.length === 0) return null;
  const eligible = proposals.filter((p) => p.status !== "対象外");
  const pool = eligible.length > 0 ? eligible : proposals;
  return pool.reduce((best, p) => (p.score > best.score ? p : best));
}

/** 案件IDごとに、画面に出す提案を1件ずつ選んだ対応表を作る。 */
export function proposalsByTender(proposals: BrowseProposal[]): Map<string, BrowseProposal> {
  const grouped = new Map<string, BrowseProposal[]>();
  for (const p of proposals) {
    const list = grouped.get(p.tenderId);
    if (list) list.push(p);
    else grouped.set(p.tenderId, [p]);
  }

  const picked = new Map<string, BrowseProposal>();
  for (const [tenderId, list] of grouped) {
    const best = pickBestProposal(list);
    if (best) picked.set(tenderId, best);
  }
  return picked;
}

/**
 * 提案から画面の判定を作る。
 * 提案が無い場合は「未判定」。推測で「参加できません」とは出さない
 * （提案条件が未登録なだけかもしれないため）。
 */
export function tenderVerdict(best: BrowseProposal | null): TenderVerdict {
  if (best === null) return { kind: "未判定" };
  if (best.status === "対象外") {
    return { kind: "対象外", status: best.status, score: best.score, excludedReason: best.excludedReason };
  }
  return { kind: "提案対象", status: best.status, score: best.score };
}

// ---------------------------------------------------------------------------
// 絞り込み条件の読み取り
//
// URLのクエリはユーザーが自由に書き換えられる。数値でない値や負の金額が来ても
// 落ちないようにし、想定外の値は「指定なし」に落とす（推測で別の値に読み替えない）。
// ---------------------------------------------------------------------------

/** 提出期限の絞り込みで選べる日数。ここに無い値は指定なしとして扱う。 */
export const DEADLINE_WITHIN_OPTIONS = [7, 14, 30] as const;
export type DeadlineWithin = (typeof DEADLINE_WITHIN_OPTIONS)[number];

/**
 * 予定価格の絞り込みを読む。円単位のintegerのみ受け付ける（CLAUDE.md：小数を使わない）。
 * 空・数値でない・負の値は「指定なし」（null）にする。
 */
export function parseBudgetFilter(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

/** 提出期限の絞り込み（残り日数）を読む。選択肢に無い値は「指定なし」にする。 */
export function parseDeadlineWithin(raw: string | undefined): DeadlineWithin | null {
  const parsed = Number(raw);
  return (DEADLINE_WITHIN_OPTIONS as readonly number[]).includes(parsed) ? (parsed as DeadlineWithin) : null;
}

/** 「残りN日以内」の締め切り時刻を返す。この時刻より前の提出期限だけを出す。 */
export function deadlineCutoff(withinDays: DeadlineWithin, now: Date): Date {
  return new Date(now.getTime() + withinDays * 86_400_000);
}

/**
 * 選んだ地域を、案件の areas と突き合わせる値の一覧に広げる。
 *
 * 案件の areas には「関東・甲信越」のような地方区分が入ることも、「東京都」のような
 * 都道府県が入ることもある。「関東・甲信越」で絞ったときに東京都の案件が消えると
 * 取りこぼすので、地方区分を選んだらその地方の都道府県も一緒に探す。
 *
 * 対応表（地方区分→都道府県）は画面側の辞書を渡す。domainに画面の選択肢を持たせない。
 */
export function expandAreaFilter(area: string, regionPrefectures: Record<string, readonly string[]>): string[] {
  const trimmed = area.trim();
  if (trimmed === "") return [];
  const prefectures = regionPrefectures[trimmed] ?? [];
  return [...new Set([trimmed, ...prefectures])];
}

/** 絞り込みが1つでも指定されているか（「絞り込みを解除」を出すかの判定）。 */
export function hasActiveFilter(values: Array<string | number | null | undefined>): boolean {
  return values.some((v) => v !== null && v !== undefined && String(v).trim() !== "");
}
