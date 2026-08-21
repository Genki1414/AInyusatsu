// AI解析プロンプト集.md §3「数量表の構造化と業種割当」の出力スキーマ。
import { z } from "zod";
import { maybe } from "./common";

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

/**
 * 業種割当の確からしさ（0〜1）。§3の基準では 0.3 未満は trade を null にする。
 * 判定そのものが付かない行では null が返るため、値の有無と値の低さを区別できるようにする。
 */
const confidence = maybe(z.number().min(0).max(1));

export const lotsSchema = z.object({
  lots: z
    .array(
      z.object({
        line_no: z.number(),
        item: z.string(),
        spec: maybe(z.string()),
        // 「一式」など数量が数値で書かれていない行・記載が無い行があるため null を許容する。
        // 「分からない項目は null にする」（AI解析プロンプト集.md §全体ルール1）と
        // tender_lots.qty が nullable であることに合わせる。
        qty: maybe(z.number()),
        unit: maybe(z.string()),
        trade: maybe(z.enum(TRADES)),
        confidence,
        // 引用・出典は §全体ルール2で必ず付けるよう指示しているが、資料の章立てが
        // はっきりしない場合は null が返る。tender_lots には列が無く raw にだけ残るため、
        // ここで弾いても得るものが無い（弾くと数量表を丸ごと捨てることになる）。
        evidence: maybe(z.string()),
        source: maybe(z.string()),
      }),
    )
    .default([]),
  trades_summary: z
    .array(
      z.object({
        // 辞書に当てはまらない業種は null。業種名が無いまとめ行は見積依頼に使えないため、
        // 保存時に取り除く（元の出力は tender_analyses.raw に残す）。
        trade: maybe(z.enum(TRADES)),
        confidence,
        evidence: maybe(z.string()),
        source: maybe(z.string()),
        excluded: z.boolean().default(false),
        excluded_reason: maybe(z.string()),
      }),
    )
    .default([]),
  no_quantity_table: z.boolean().default(false),
  unknown_reason: maybe(z.string()),
});

export type Lots = z.infer<typeof lotsSchema>;
