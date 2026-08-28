// 名称が近い落札実績から「誰が取っているか」を出す（9月分：落札結果の分析）。
//
// 【なぜ必要か】
// いまの画面は落札額の一覧までしか出していない。参加を決めるときに知りたいのは
// 金額だけでなく「相手が誰で、毎回同じ会社が取っているのか」。
// 同じ相手が繰り返し取っている案件は、価格を下げても入りにくい。
// 毎回違う会社が取っているなら、入る余地がある。
//
// 【データを増やさない】
// 案件画面がすでに引いている落札実績（find_similar_awards の結果）を集計するだけ。
// 追加の取得も費用も発生しない。
//
// 【落札者が分からない件数を隠さない】
// オープンデータには落札者名の無い行がある。分母から外すが、件数は必ず出す
// （CLAUDE.md 最重要の前提7）。出さないと「3件中3件が同じ会社」に見えてしまう。
//
// 【会社を勝手にまとめない】
// 表記のゆれ（㈱ / (株) / 全角空白）だけを揃える。似た社名を同じ会社と見なすと、
// 別会社を1社に潰してしまう。ここは間違えるより取りこぼすほうがましなので、
// 明らかな表記の違いだけを吸収する。

import type { MatchedAward } from "./award_match";

export type CompetitorSummary = {
  /** 表示に使う社名（最初に出てきた表記） */
  name: string;
  /** 落札した件数 */
  wins: number;
  /** 落札額の中央値。平均だと1件の大型案件で歪む */
  medianAmount: number;
  /** いちばん新しい落札日 */
  latestOpenedAt: string | null;
};

export type CompetitorResult = {
  /** 件数の多い順。同数なら落札日の新しい順 */
  competitors: CompetitorSummary[];
  /** 落札者が分かっている件数 */
  known: number;
  /** 落札者が分からない件数。隠さずに出す */
  unknown: number;
  /**
   * 落札者が分かっている件数の過半を1社が取っているとき、その会社。
   * 「同じ相手が繰り返し取っている」と言えるのはこの場合だけ。
   */
  repeatWinner: CompetitorSummary | null;
};

/** 繰り返し取っていると言うために必要な件数。1勝1敗を「繰り返し」と呼ばない。 */
export const REPEAT_WINNER_MIN_WINS = 2;

/**
 * 社名の表記ゆれを揃える。
 * 法人格の記号を語に直し、空白と全角英数字を揃えるだけ。似た社名はまとめない。
 */
export function normalizeWinnerName(name: string): string {
  return name
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/㈱|\(株\)|（株）/g, "株式会社")
    .replace(/㈲|\(有\)|（有）/g, "有限会社")
    .replace(/[\s　]+/g, "")
    .trim();
}

/** 中央値。金額は円単位の整数（CLAUDE.md）なので、偶数個のときは丸める。 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function newer(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

/** 名称が近い落札実績から、落札者ごとの実績をまとめる。 */
export function summarizeCompetitors(awards: MatchedAward[]): CompetitorResult {
  const groups = new Map<string, { name: string; amounts: number[]; latest: string | null }>();
  let unknown = 0;

  for (const award of awards) {
    const raw = award.winnerName?.trim();
    if (!raw) {
      unknown += 1;
      continue;
    }
    const key = normalizeWinnerName(raw);
    if (key === "") {
      unknown += 1;
      continue;
    }
    const group = groups.get(key) ?? { name: raw, amounts: [], latest: null };
    group.amounts.push(award.amount);
    group.latest = newer(group.latest, award.openedAt);
    groups.set(key, group);
  }

  const competitors: CompetitorSummary[] = [...groups.values()]
    .map((group) => ({
      name: group.name,
      wins: group.amounts.length,
      medianAmount: median(group.amounts),
      latestOpenedAt: group.latest,
    }))
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return (b.latestOpenedAt ?? "").localeCompare(a.latestOpenedAt ?? "");
    });

  const known = awards.length - unknown;
  const top = competitors[0] ?? null;
  // 過半を取っていて、かつ2件以上。1件しか実績が無いものを「繰り返し」と呼ばない
  const repeatWinner =
    top && top.wins >= REPEAT_WINNER_MIN_WINS && top.wins * 2 > known ? top : null;

  return { competitors, known, unknown, repeatWinner };
}
