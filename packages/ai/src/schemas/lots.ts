// AI解析プロンプト集.md §3「数量表の構造化と業種割当」の出力スキーマ。
import { z } from "zod";

export const TRADES = [
  "清掃",
  "貯水槽清掃",
  "害虫防除",
  "廃棄物処理",
  "警備",
  "設備保守",
  "電気",
  "空調",
  "植栽",
  "什器納入",
  "事務用品",
  "印刷",
  "運送",
  "給食",
  "情報処理",
  "その他",
] as const;

export const lotsSchema = z.object({
  lots: z.array(
    z.object({
      line_no: z.number(),
      item: z.string(),
      spec: z.string().nullable(),
      qty: z.number(),
      unit: z.string().nullable(),
      trade: z.enum(TRADES).nullable(),
      confidence: z.number().min(0).max(1),
      evidence: z.string(),
      source: z.string(),
    }),
  ),
  trades_summary: z.array(
    z.object({
      trade: z.enum(TRADES),
      confidence: z.number().min(0).max(1),
      evidence: z.string(),
      source: z.string(),
      excluded: z.boolean(),
      excluded_reason: z.string().nullable(),
    }),
  ),
  no_quantity_table: z.boolean(),
  unknown_reason: z.string().nullable(),
});

export type Lots = z.infer<typeof lotsSchema>;
