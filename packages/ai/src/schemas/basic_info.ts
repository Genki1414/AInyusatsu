// AI解析プロンプト集.md §1「基本情報と期限」の出力スキーマ。
import { z } from "zod";
import { evidencedField } from "./common";

export const QUAL_CATEGORIES = ["役務の提供等", "物品の販売", "物品の製造"] as const;

export const basicInfoSchema = z.object({
  name: evidencedField(z.string().nullable()),
  agency: evidencedField(z.string().nullable()),
  org_unit: evidencedField(z.string().nullable()),
  notice_no: evidencedField(z.string().nullable()),
  notice_date: evidencedField(z.string().nullable()),
  submit_deadline: evidencedField(z.string().nullable()),
  qa_deadline: evidencedField(z.string().nullable()),
  bid_open_at: evidencedField(z.string().nullable()),
  term_from: evidencedField(z.string().nullable()),
  term_to: evidencedField(z.string().nullable()),
  place: evidencedField(z.string().nullable()),
  qual_category: evidencedField(z.enum(QUAL_CATEGORIES).nullable()),
  item: evidencedField(z.string().nullable()),
  grade: evidencedField(z.string().nullable()),
  areas: evidencedField(z.array(z.string())),
  budget: z.object({
    value: z.number().nullable(),
    // 予定価格に一切触れていない資料では、公表・非公表の別も判断できないためnullが返る
    // （「分からない項目は null にする」AI解析プロンプト集.md §全体ルール1）。
    // 「非公表」「事後公表」と明記されている場合はfalseが返る。
    disclosed: z.boolean().nullable(),
    quote: z.string().nullable(),
    source: z.string().nullable(),
  }),
  jv_allowed: evidencedField(z.boolean().nullable()),
  electronic_bidding: evidencedField(z.boolean().nullable()),
  unknown_fields: z.array(z.string()),
});

export type BasicInfo = z.infer<typeof basicInfoSchema>;
