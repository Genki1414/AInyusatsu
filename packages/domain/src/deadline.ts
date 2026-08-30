// 期限の残り日数と、その表示。
//
// 【なぜ1か所にまとめたか】
// 同じ提出期限に対して、画面ごとに違う日数が出ていた（2026-08-31 に発見）。
// 案件ページの見出しは「2026/09/02（残3日）」、同じ画面の段取りは「あと2日」。
// 経過ミリ秒を切り上げていたため、**見る時刻で数字が変わっていた**。
// 朝に見れば残3日、夜に見れば残2日。同じ日の同じ期限なのに、である。
//
// 期限の誤りは失格に直結する（CLAUDE.md 最重要の前提5）。
// 日本時間の「日付の差」で数えれば、その日のあいだは何時に見ても同じ数字になる。
//
// 【時刻は捨てる】
// 締切が 9/2 17:00 でも 9/2 09:00 でも「9/2 が締切」であることは変わらない。
// 何時までかは公告の原本で確かめてもらう（画面の数字で締切時刻を判断させない）。

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** その時刻が日本時間で何日目か（1970-01-01 を0とする通し番号）。 */
function jstDayNumber(ms: number): number {
  return Math.floor((ms + JST_OFFSET_MS) / DAY_MS);
}

/**
 * 期限までの残り日数。日本時間の日付で数える。
 *
 * 今日が期限なら 0、明日なら 1、過ぎていれば負の数。
 * 期限が無い・読めない場合は null（**推測して0や大きい数を返さない**）。
 */
export function daysUntilDeadline(deadline: string | null | undefined, now: Date = new Date()): number | null {
  if (deadline === null || deadline === undefined || deadline === "") return null;
  const at = Date.parse(deadline);
  if (Number.isNaN(at)) return null;
  return jstDayNumber(at) - jstDayNumber(now.getTime());
}

/** 期限の日付。日本時間で「2026/09/02」の形。読めなければ null。 */
export function deadlineDate(deadline: string | null | undefined): string | null {
  if (deadline === null || deadline === undefined || deadline === "") return null;
  const at = Date.parse(deadline);
  if (Number.isNaN(at)) return null;
  return new Date(at).toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * 残り日数を日本語にする。
 * **期限が取れていないものは「期限は未確認」**（推測した日付を出さない）。
 */
export function remainingText(daysLeft: number | null): string {
  if (daysLeft === null) return "期限は未確認";
  if (daysLeft < 0) return `${Math.abs(daysLeft)}日過ぎています`;
  if (daysLeft === 0) return "今日まで";
  if (daysLeft === 1) return "明日まで";
  return `あと${daysLeft}日`;
}

/**
 * 期限を「2026/09/02（あと2日）」の形にする。
 *
 * 【日付と残り日数を必ず並べる】
 * 「あと2日」だけでは、いつが締切かを数えさせることになる。
 * 日付だけでは、急ぎかどうかが一目で分からない。両方出す。
 */
export function deadlineText(deadline: string | null | undefined, now: Date = new Date()): string {
  const date = deadlineDate(deadline);
  if (date === null) return "未確認";
  return `${date}（${remainingText(daysUntilDeadline(deadline, now))}）`;
}

/** 急ぎか（画面で色を変える）。期限が取れていなければ急ぎ扱いしない。 */
export function isDeadlineNear(daysLeft: number | null, withinDays = 3): boolean {
  return daysLeft !== null && daysLeft <= withinDays;
}
