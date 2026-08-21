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
