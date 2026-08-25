// AI解析プロンプト集.md の全プロンプトに共通するスキーマ部品。
import { z } from "zod";

/**
 * 「分からない項目は null にする」（AI解析プロンプト集.md §全体ルール1・7）を受け取る側の型。
 * null だけでなくキーごと省略された場合も null として受け取る。
 *
 * ここを厳しくすると、モデルが仕様どおり null を返しただけで解析全体が失敗する。
 * 実データではこの食い違いが繰り返し障害になっているため（予定価格・競争参加地域・数量）、
 * 「判定できない値が来ること」を前提にした型を共通部品として置く。
 */
export function maybe<T extends z.ZodTypeAny>(value: T) {
  return value.nullable().default(null);
}

/**
 * 抽出項目に付ける引用と出典。プロンプトでは必ず付けるよう指示している（§全体ルール2）が、
 * 資料の章立てがはっきりしない場合などにモデルは null を返す。
 * CLAUDE.md 最重要の前提3は「出典のない抽出はUIで『未確認』として扱う」と定めており、
 * 出典が無いこと自体は想定内の状態なので、ここで弾かない（弾くと抽出結果を丸ごと捨てる）。
 */
export const evidenceShape = {
  quote: maybe(z.string()),
  source: maybe(z.string()),
};

/** 「値・引用・出典」の3点セット。出典のない項目はUIで「未確認」として扱う（CLAUDE.md）。 */
export function evidencedField<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    value,
    ...evidenceShape,
  });
}

/**
 * AIが返す日時を、日本時間であることを明示した ISO 8601 に直す。
 *
 * 【なぜ必要か】
 * プロンプトは日時を `YYYY-MM-DDTHH:mm` で返させている（AI解析プロンプト集.md §全体ルール4）。
 * この形にはタイムゾーンが無い。tenders.submit_deadline 等は timestamptz なので、
 * そのまま渡すとPostgresがUTCとして解釈し、**表示が9時間あとにずれる**。
 *
 *   AIの抽出：2026-09-25T17:00（17時、日本時間のつもり）
 *   DBの保存：2026-09-25 17:00 UTC
 *   画面の表示：2026-09-26 02:00 JST   ← 実際の締切より9時間あと
 *
 * ずれる方向が最悪で、間に合うと思って落とす事故になる。
 * 「期限の誤りは失格に直結する」（CLAUDE.md 最重要の前提5）ため、ここで必ず日本時間に固定する。
 *
 * 【推測しないこと】
 * 読めない形式（和暦が残っている等）は null にする。もっともらしい日時をでっち上げない。
 * 時刻の無い日付は、その日の 00:00 として扱う。実際の締切より早い側に倒すことで、
 * 「まだ間に合う」と誤解させない。
 */
export function toJstTimestamp(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;

  // すでにタイムゾーンが付いていれば、そのまま信じる（Z でも ±HH:MM でも）
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(trimmed)) {
    return Number.isNaN(new Date(trimmed).getTime()) ? null : trimmed;
  }

  const dateTime = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (dateTime) {
    const [, y, mo, d, h, mi, sec] = dateTime;
    if (!isRealDate(Number(y), Number(mo), Number(d))) return null;
    if (!isRealTime(Number(h), Number(mi), Number(sec ?? "0"))) return null;
    return `${y}-${mo}-${d}T${h}:${mi}:${sec ?? "00"}+09:00`;
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    if (!isRealDate(Number(y), Number(mo), Number(d))) return null;
    return `${y}-${mo}-${d}T00:00:00+09:00`;
  }

  return null;
}

/**
 * 実在する日付か。
 * new Date("2026-02-30") は3月2日へ繰り上がってしまい、不正だと気づけないため自分で数える。
 */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  // 月を1つ進めて0日目＝その月の末日
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= lastDay;
}

function isRealTime(hour: number, minute: number, second: number): boolean {
  return hour <= 23 && minute <= 59 && second <= 59;
}
