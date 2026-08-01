// 落札実績オープンデータの正規化・集計。副作用を持たない純関数のみを置く。
// 参照：docs/落札実績オープンデータ_取り込み設計.md、docs/reference/落札実績オープンデータ_列定義（推定）.md
//
// 【重要】列名マッピング（COLUMN_MAP）は、仕様書PDF未取得のため推定です。
// 実データで検証したら docs/reference/落札実績オープンデータ_列定義（推定）.md とあわせて更新してください。

import { parse } from "csv-parse/sync";

// ---------------------------------------------------------------------------
// CSV読み込み（BOM除去・パース）
// ---------------------------------------------------------------------------

const BOM = "﻿";

/** UTF-8 BOM（﻿）を先頭から取り除く。BOMが無ければそのまま返す。 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff || text.startsWith(BOM) ? text.slice(1) : text;
}

/** BOM除去込みでCSVテキストをパースし、ヘッダ行をキーとする行オブジェクトの配列を返す。 */
export function parseAwardsCsv(text: string): Record<string, string>[] {
  const body = stripBom(text);
  if (body.trim().length === 0) return [];
  return parse(body, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: false, // 上でstripBom済み
  }) as Record<string, string>[];
}

// ---------------------------------------------------------------------------
// 列名マッピング（推定・要検証）
// ---------------------------------------------------------------------------

/**
 * CSVヘッダ名 → 内部フィールド名。
 * 実データ未取得のため、政府調達オープンデータで一般的な項目名から推定した値。
 * 実データ取得後、ここと docs/reference/ を必ず更新すること。
 */
export const COLUMN_MAP = {
  procurementNo: "調達案件番号",
  agencyName: "調達機関名称",
  itemName: "品目分類名称",
  budget: "予定価格",
  budgetTaxIncluded: "予定価格税区分", // "税込" | "税抜" 等を想定
  amount: "落札金額",
  amountTaxIncluded: "落札金額税区分",
  contractType: "契約方式",
  bidders: "入札者数",
  openedAt: "落札日",
} as const;

export type ColumnMap = typeof COLUMN_MAP;

/** rowに COLUMN_MAP の列がひとつも見つからない場合に真を返す（ヘッダ構造の食い違い検知用）。 */
export function hasNoMappedColumns(row: Record<string, string>): boolean {
  return Object.values(COLUMN_MAP).every((header) => !(header in row));
}

// ---------------------------------------------------------------------------
// 正規化
// ---------------------------------------------------------------------------

export type NormalizedAward = {
  procurementNo: string | null;
  item: string | null; // 自社の営業品目辞書に分類できた場合のみ入る
  agencyClass: string | null; // 本省 / 地方支分部局 / 独立行政法人等
  contractType: string | null; // 総額 / 単価 / 複数年度
  budget: number | null;
  amount: number | null;
  bidders: number | null;
  openedAt: string | null; // ISO日付 (YYYY-MM-DD)
  rate: number | null; // amount / budget。計算不能なら null
  disclosed: boolean; // 予定価格が公表されているか
  taxIncluded: boolean | null; // 税込ならtrue、税抜ならfalse、不明ならnull
  taxUnknown: boolean; // 税区分が判別できないか（taxIncluded===nullと等価）
  outlier: boolean; // rate が 0.5未満 または 1.0超
};

export type NormalizeResult = {
  award: NormalizedAward;
  skipped: boolean; // 落札金額が取れない等、保存に値しない行
  skipReason: string | null;
};

const AMOUNT_CLEAN_RE = /[,，円\s]/g;

function toNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(AMOUNT_CLEAN_RE, "").trim();
  if (cleaned === "" || cleaned === "-" || cleaned === "非公表") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeTaxFlag(raw: string | undefined): { included: boolean | null; unknown: boolean } {
  if (raw == null || raw.trim() === "") return { included: null, unknown: true };
  const v = raw.trim();
  if (v.includes("税込")) return { included: true, unknown: false };
  if (v.includes("税抜")) return { included: false, unknown: false };
  return { included: null, unknown: true };
}

/** "2026年7月31日" "2026/07/31" "20260731" などをISO日付(YYYY-MM-DD)に正規化する。変換できなければnull。 */
export function normalizeDate(raw: string | undefined): string | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === "") return null;

  const jp = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(s);
  if (jp) return isoFrom(jp[1], jp[2], jp[3]);

  const slashOrDash = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/.exec(s);
  if (slashOrDash) return isoFrom(slashOrDash[1], slashOrDash[2], slashOrDash[3]);

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (compact) return isoFrom(compact[1], compact[2], compact[3]);

  return null;
}

function isoFrom(y: string, m: string, d: string): string {
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** 品目分類名称 → 自社の営業品目辞書。当てはまらなければnull（要ではなく可能な限り抽出する方針）。 */
export function classifyItem(rawItemName: string | undefined): string | null {
  if (!rawItemName) return null;
  const s = rawItemName.trim();
  const dict: [RegExp, string][] = [
    [/清掃|環境衛生|建物管理/, "建物管理等"],
    [/警備/, "警備"],
    [/植栽|緑地/, "植栽等管理"],
    [/什器|備品|机|椅子/, "什器類"],
    [/情報処理|システム|ソフトウェア/, "情報処理"],
    [/理化学|実験用機器/, "理化学機器"],
  ];
  for (const [re, item] of dict) if (re.test(s)) return item;
  return null;
}

/** 調達機関名称 → 機関区分（本省/地方支分部局/独立行政法人等）。ヒューリスティックで、当てはまらなければnull。 */
export function classifyAgencyClass(rawAgencyName: string | undefined): string | null {
  if (!rawAgencyName) return null;
  const s = rawAgencyName.trim();
  if (/(独立行政法人|国立大学法人|特殊法人|機構)/.test(s)) return "独立行政法人等";
  if (/(財務局|地方整備局|防衛局|厚生局|森林管理局|labor|労働局|地方支分部局|事務所|出張所)/.test(s)) {
    return "地方支分部局";
  }
  if (/(省|庁)$/.test(s)) return "本省";
  return null;
}

export type NormalizeContext = {
  sourceBatch: string; // 取り込んだファイル名
};

/** 1行を正規化する。落札金額（amount）が取れない行は skipped:true とする。 */
export function normalizeAwardRow(row: Record<string, string>, ctx: NormalizeContext): NormalizeResult {
  const procurementNo = row[COLUMN_MAP.procurementNo]?.trim() || null;
  const amount = toNumber(row[COLUMN_MAP.amount]);
  const budget = toNumber(row[COLUMN_MAP.budget]);
  const bidders = toNumber(row[COLUMN_MAP.bidders]);
  const openedAt = normalizeDate(row[COLUMN_MAP.openedAt]);
  const item = classifyItem(row[COLUMN_MAP.itemName]);
  const agencyClass = classifyAgencyClass(row[COLUMN_MAP.agencyName]);
  const contractType = row[COLUMN_MAP.contractType]?.trim() || null;

  const tax = normalizeTaxFlag(row[COLUMN_MAP.amountTaxIncluded] ?? row[COLUMN_MAP.budgetTaxIncluded]);
  const disclosed = budget != null;
  const rate = disclosed && amount != null && budget! > 0 ? round4(amount / budget!) : null;
  const outlier = rate != null && (rate < 0.5 || rate > 1.0);

  const award: NormalizedAward = {
    procurementNo,
    item,
    agencyClass,
    contractType,
    budget,
    amount,
    bidders,
    openedAt,
    rate,
    disclosed,
    taxIncluded: tax.included,
    taxUnknown: tax.unknown,
    outlier,
  };

  if (amount == null) {
    return { award, skipped: true, skipReason: "amount_missing" };
  }
  // procurementNo + openedAt が awards テーブルの冪等キー（同一ファイル再取込で件数が
  // 変わらないことの前提）。procurementNo が取れない行はupsertで重複しうるため保存しない。
  if (procurementNo == null) {
    return { award, skipped: true, skipReason: "procurement_no_missing" };
  }
  return { award, skipped: false, skipReason: null };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// 再度公告・不調対応：procurementNoごとに最新のopenedAtだけを採用する
// ---------------------------------------------------------------------------

export function dedupeLatestByProcurementNo<T extends { procurementNo: string | null; openedAt: string | null }>(
  awards: T[],
): T[] {
  const latest = new Map<string, T>();
  const withoutNo: T[] = [];
  for (const a of awards) {
    if (!a.procurementNo) {
      withoutNo.push(a);
      continue;
    }
    const current = latest.get(a.procurementNo);
    if (!current || (a.openedAt ?? "") > (current.openedAt ?? "")) {
      latest.set(a.procurementNo, a);
    }
  }
  return [...withoutNo, ...latest.values()];
}

// ---------------------------------------------------------------------------
// 金額帯
// ---------------------------------------------------------------------------

export const AMOUNT_BANDS = ["〜500万", "500万〜2000万", "2000万〜1億", "1億〜"] as const;
export type AmountBand = (typeof AMOUNT_BANDS)[number];

export function amountBand(budget: number): AmountBand {
  if (budget < 5_000_000) return "〜500万";
  if (budget < 20_000_000) return "500万〜2000万";
  if (budget < 100_000_000) return "2000万〜1億";
  return "1億〜";
}

// ---------------------------------------------------------------------------
// market_rates 集計
// ---------------------------------------------------------------------------

export type MarketRateRow = {
  item: string;
  agencyClass: string;
  amountBand: AmountBand;
  periodMonths: number;
  n: number;
  rateMedian: number;
  rateAvg: number;
  rateP25: number;
  rateP75: number;
};

export type ComputeMarketRatesOptions = {
  periodMonths?: number;
  /** 期間フィルタの基準日。省略時は絞り込みを行わない（呼び出し側で事前に絞ってもよい） */
  asOfDate?: string; // ISO日付
};

/** 線形補間による分位点（PostgreSQLのpercentile_contと同じ方式）。sortedは昇順ソート済みであること。 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/**
 * 品目×機関区分×金額帯で落札率の中央値・平均・25%点・75%点を集計する。
 * 除外対象：outlier / disclosed=false（rateがnull） / taxUnknown / item未分類 / agencyClass未分類。
 * 同一procurementNoは最新opened_atの行のみ採用する（再度公告・不調対応）。
 * 件数の少なさによる表示抑制（5件未満など）はここでは行わない（画面側の責務）。
 */
export function computeMarketRates(
  awards: NormalizedAward[],
  options: ComputeMarketRatesOptions = {},
): MarketRateRow[] {
  const periodMonths = options.periodMonths ?? 24;

  const filtered = awards.filter((a) => {
    if (a.outlier || a.taxUnknown || !a.disclosed || a.rate == null) return false;
    if (!a.item || !a.agencyClass) return false;
    if (a.budget == null) return false;
    if (options.asOfDate && a.openedAt) {
      const cutoff = monthsBefore(options.asOfDate, periodMonths);
      if (a.openedAt < cutoff) return false;
    }
    return true;
  });

  const deduped = dedupeLatestByProcurementNo(filtered);

  const groups = new Map<string, { item: string; agencyClass: string; band: AmountBand; rates: number[] }>();
  for (const a of deduped) {
    const band = amountBand(a.budget!);
    const key = `${a.item}${a.agencyClass}${band}`;
    const g = groups.get(key) ?? { item: a.item!, agencyClass: a.agencyClass!, band, rates: [] };
    g.rates.push(a.rate!);
    groups.set(key, g);
  }

  const rows: MarketRateRow[] = [];
  for (const g of groups.values()) {
    const sorted = [...g.rates].sort((x, y) => x - y);
    const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    rows.push({
      item: g.item,
      agencyClass: g.agencyClass,
      amountBand: g.band,
      periodMonths,
      n: sorted.length,
      rateMedian: round4(percentile(sorted, 0.5)),
      rateAvg: round4(avg),
      rateP25: round4(percentile(sorted, 0.25)),
      rateP75: round4(percentile(sorted, 0.75)),
    });
  }
  return rows;
}

function monthsBefore(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}
