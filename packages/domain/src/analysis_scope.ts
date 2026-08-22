// AI解析の対象をどこまでにするかの判定。
//
// 【なぜ必要か】
// 提出期限（submit_deadline）はコネクタからは取れず、AI解析で初めて埋まる
// （KKJ APIにもGEPSの一覧にも提出期限の項目が無い）。つまり解析前の案件は
// すべて submit_deadline が null で、期限切れとして終了に落とすことができない。
//
// その結果、解析を後回しにするほど「解析待ち」が減らずに積み上がり、
// いざ解析するときに、とっくに締め切られた案件にも費用（実測 約69円/件）がかかる。
//
// 【公告日で代用する】
// 公告日（notice_date）はコネクタから取れている。公告から一定の日数が過ぎた案件は
// ほぼ確実に締め切られているので、公告日を提出期限の代わりの目安に使う。
// これは推測なので既定では有効にしない。使うかどうかは実行時に明示的に指定する。

/** 公告日で絞るときの、ありがちな目安（日数）。 */
export const DEFAULT_MAX_NOTICE_AGE_DAYS = 90;

/**
 * 「公告日が何日前まで」の指定を読む。1以上の整数のみ受け付ける。
 * 空・数値でない・0以下は「指定なし」（null＝絞らない）にする。
 */
export function parseMaxNoticeAgeDays(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

/** 公告日がこの日以降の案件だけを解析する、という下限の日付を返す。 */
export function noticeDateCutoff(maxAgeDays: number, now: Date): Date {
  return new Date(now.getTime() - maxAgeDays * 86_400_000);
}

/** 日付を YYYY-MM-DD にする（notice_date は date 型なので時刻を付けない）。 */
export function toDateIso(value: Date): string {
  return value.toISOString().slice(0, 10);
}
