// 日付の範囲を1日ずつに展開する（調達ポータルの巡回を過去にさかのぼって流すときに使う）。
//
// 巡回は「公開開始日1日ぶん」を対象にする作りなので、過去の取りこぼしを埋めるには
// 日付を1日ずつ渡す必要がある。手で31回コマンドを叩くのは現実的でないため、
// 範囲を展開する部分をここに置く。
//
// 【上限を設ける理由】
// 巡回は1日ぶんで数十分かかる。範囲を打ち間違えて1年ぶんを流すと、相手先にも負荷が
// かかり、こちらも半日以上塞がる。上限を超えたら黙って切り詰めず、エラーにして止める。

/** 一度に流せる日数の上限。 */
export const MAX_DATE_RANGE_DAYS = 31;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD として読めるか（存在しない日付も弾く）。 */
export function isDateIso(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * fromIso から toIso までを1日ずつの配列にする（両端を含む）。
 * 読めない日付・順序が逆・上限超えは、推測で直さずエラーにする。
 */
export function expandDateRange(fromIso: string, toIso: string, maxDays: number = MAX_DATE_RANGE_DAYS): string[] {
  if (!isDateIso(fromIso)) throw new Error(`日付として読めません: ${fromIso}（YYYY-MM-DD で指定してください）`);
  if (!isDateIso(toIso)) throw new Error(`日付として読めません: ${toIso}（YYYY-MM-DD で指定してください）`);

  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (to < from) throw new Error(`日付の順序が逆です: ${fromIso} 〜 ${toIso}`);

  const days = Math.round((to - from) / 86_400_000) + 1;
  if (days > maxDays) {
    throw new Error(`一度に指定できるのは${maxDays}日までです（${fromIso} 〜 ${toIso} は${days}日）`);
  }

  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    dates.push(new Date(from + i * 86_400_000).toISOString().slice(0, 10));
  }
  return dates;
}
