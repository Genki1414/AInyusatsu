// AI解析プロンプト集.md §1「基本情報と期限」の出力スキーマ。
import { z } from "zod";
import { evidencedField, evidenceShape, maybe, toJstTimestamp } from "./common";

export const QUAL_CATEGORIES = ["役務の提供等", "物品の販売", "物品の製造"] as const;

/**
 * 予定価格。円単位の整数で保存する（CLAUDE.md「金額は円単位の integer。小数を使わない」、
 * tenders.budget は bigint）。モデルが小数付きで返しても保存できるよう、ここで丸める。
 */
const budgetValue = maybe(z.number()).transform((v) => (v === null ? null : Math.round(v)));

/**
 * 期限（timestamptz の列に入る3項目）。日本時間であることを明示してから保存する。
 * これをやらないとPostgresがUTCとして解釈し、表示が9時間あとにずれる（toJstTimestamp参照）。
 */
const deadlineValue = maybe(z.string()).transform(toJstTimestamp);

export const basicInfoSchema = z.object({
  name: evidencedField(maybe(z.string())),
  agency: evidencedField(maybe(z.string())),
  org_unit: evidencedField(maybe(z.string())),
  notice_no: evidencedField(maybe(z.string())),
  notice_date: evidencedField(maybe(z.string())),
  submit_deadline: evidencedField(deadlineValue),
  qa_deadline: evidencedField(deadlineValue),
  bid_open_at: evidencedField(deadlineValue),
  term_from: evidencedField(maybe(z.string())),
  term_to: evidencedField(maybe(z.string())),
  place: evidencedField(maybe(z.string())),
  qual_category: evidencedField(maybe(z.enum(QUAL_CATEGORIES))),
  item: evidencedField(maybe(z.string())),
  grade: evidencedField(maybe(z.string())),
  // 競争参加地域の記載が無い資料ではnullが返る（AI解析プロンプト集.md §全体ルール1）。
  // 「判定できない（null）」と「地域の指定が無い（空配列）」は意味が違うので区別する
  // （fit.tsは空配列を『地域の指定はありません』として満点にするため、混同すると誤判定になる）。
  areas: evidencedField(maybe(z.array(z.string()))),
  budget: z.object({
    value: budgetValue,
    // 予定価格に一切触れていない資料では、公表・非公表の別も判断できないためnullが返る
    // （「分からない項目は null にする」AI解析プロンプト集.md §全体ルール1）。
    // 「非公表」「事後公表」と明記されている場合はfalseが返る。
    disclosed: maybe(z.boolean()),
    ...evidenceShape,
  }),
  jv_allowed: evidencedField(maybe(z.boolean())),
  electronic_bidding: evidencedField(maybe(z.boolean())),
  // AIが判定できなかった項目の一覧。省略されることがあるため空配列を既定にする
  // （この一覧が無いこと自体は、抽出結果を捨てる理由にならない）。
  unknown_fields: z.array(z.string()).default([]),
});

export type BasicInfo = z.infer<typeof basicInfoSchema>;
