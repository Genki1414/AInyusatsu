// 落札実績オープンデータの正規化・集計。副作用を持たない純関数のみを置く。
// 参照：docs/落札実績オープンデータ_取り込み設計.md、docs/reference/落札実績オープンデータ_列定義（推定）.md
//
// 【実データで確認済み・2026-08-01】このCSVには見出し行が無く、1行目から全件データ。
// 列は次の8列の並びで固定（ユーザーが実際にダウンロードして確認）：
//   調達案件番号, 案件名称, 落札日, 落札金額, 不明な2文字コード, 機関コード, 落札者名称, 法人番号
// このうち「予定価格」「品目分類」に相当する列は存在しないため、落札率・相場（market_rates）の
// 算出は現状のこのデータソースだけでは不可能。取得できる項目のみ取り込む方針にした
// （docs/reference/落札実績オープンデータ_列定義（推定）.md 参照）。

import { parse } from "csv-parse/sync";

// ---------------------------------------------------------------------------
// CSV読み込み（BOM除去・パース）
// ---------------------------------------------------------------------------

const BOM = "﻿";

/** UTF-8 BOM（﻿）を先頭から取り除く。BOMが無ければそのまま返す。 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff || text.startsWith(BOM) ? text.slice(1) : text;
}

// 実データ確認済みの列順（見出し行が無いため、位置で名前を割り当てる）。
// taxCode・agencyCode は意味が確定できない／機関マスタとの対応表が無いため、
// 現状はparseAwardsCsvの出力には含めるが、normalizeAwardRowでは取り込まない。
const CSV_COLUMNS = [
  "procurementNo",
  "name",
  "openedAtRaw",
  "amountRaw",
  "taxCode",
  "agencyCode",
  "winnerName",
  "corporateNumber",
] as const;

/** BOM除去込みでCSVテキストをパースし、列位置ベースのキーを持つ行オブジェクトの配列を返す。 */
export function parseAwardsCsv(text: string): Record<string, string>[] {
  const body = stripBom(text);
  if (body.trim().length === 0) return [];
  return parse(body, {
    columns: [...CSV_COLUMNS],
    skip_empty_lines: true,
    trim: true,
    bom: false, // 上でstripBom済み
  }) as Record<string, string>[];
}

// ---------------------------------------------------------------------------
// 構造チェック（列順が変わっていないかの検知）
// ---------------------------------------------------------------------------

const CORPORATE_NUMBER_RE = /^\d{13}$/;

/**
 * 実データの列構造が想定と食い違っていないかを検知する。
 * 法人番号（13桁の数字。国税庁の仕様で固定）を手がかりにする。ヘッダが無いCSVのため、
 * 列がずれていても構文的にはパースが通ってしまう点に注意（ここで弾かないと誤った列に
 * 別の意味のデータを取り込んでしまう）。
 */
export function hasUnexpectedShape(row: Record<string, string>): boolean {
  return !CORPORATE_NUMBER_RE.test(row.corporateNumber?.trim() ?? "");
}

// ---------------------------------------------------------------------------
// 正規化
// ---------------------------------------------------------------------------

export type NormalizedAward = {
  procurementNo: string | null;
  name: string | null; // 案件名称
  item: string | null; // 自社の営業品目辞書に分類できた場合のみ入る。このCSVには品目列が無いため常にnull
  agencyClass: string | null; // 本省 / 地方支分部局 / 独立行政法人等。このCSVには機関名列が無いため常にnull
  contractType: string | null; // 総額 / 単価 / 複数年度。このCSVには列が無いため常にnull
  budget: number | null; // 予定価格。このCSVには列が無いため常にnull
  amount: number | null;
  bidders: number | null; // 入札者数。このCSVには列が無いため常にnull
  openedAt: string | null; // ISO日付 (YYYY-MM-DD)
  rate: number | null; // amount / budget。budgetが取れないため常にnull
  disclosed: boolean; // 予定価格が公表されているか。常にfalse
  taxIncluded: boolean | null; // 税込ならtrue、税抜ならfalse、不明ならnull。常にnull
  taxUnknown: boolean; // 税区分が判別できないか。常にtrue
  outlier: boolean; // rate が 0.5未満 または 1.0超。rateが常にnullのため常にfalse
  winnerName: string | null; // 落札者名称
  corporateNumber: string | null; // 法人番号（13桁）
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

/**
 * 円単位のintegerにする（CLAUDE.mdの方針：金額は円単位のinteger、小数を使わない）。
 * 実データには "37.2" のように小数を含む金額が存在する（awards.amountはbigintで小数を
 * 受け付けないため、四捨五入で丸める）。
 */
function toYenAmount(raw: string | undefined): number | null {
  const n = toNumber(raw);
  return n == null ? null : Math.round(n);
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

// 【現在未使用】このCSVには品目分類名称・調達機関名称の列が無いため、normalizeAwardRowからは
// 呼んでいない。品目・機関名を取得できる別のデータソースと突き合わせる設計ができたら再度使う想定
// のため、辞書自体は残してある（docs/reference/落札実績オープンデータ_列定義（推定）.md 参照）。

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

/**
 * 1行を正規化する。落札金額（amount）が取れない行は skipped:true とする。
 *
 * 【取得できない項目】このCSVには予定価格・品目分類・調達機関名称・契約方式・入札者数の列が
 * 無いため、item/agencyClass/contractType/budget/bidders/rate/taxIncluded は常にnullになる
 * （推測しない。CLAUDE.mdの方針どおり）。落札率（相場・market_rates）はこのデータソースだけでは
 * 算出できないため、当面は保留する（docs/reference/落札実績オープンデータ_列定義（推定）.md 参照）。
 */
export function normalizeAwardRow(row: Record<string, string>, ctx: NormalizeContext): NormalizeResult {
  const procurementNo = row.procurementNo?.trim() || null;
  const name = row.name?.trim() || null;
  const amount = toYenAmount(row.amountRaw);
  const openedAt = normalizeDate(row.openedAtRaw);
  const winnerName = row.winnerName?.trim() || null;
  const corporateNumber = row.corporateNumber?.trim() || null;

  const award: NormalizedAward = {
    procurementNo,
    name,
    item: null,
    agencyClass: null,
    contractType: null,
    budget: null,
    amount,
    bidders: null,
    openedAt,
    rate: null,
    disclosed: false,
    taxIncluded: null,
    taxUnknown: true,
    outlier: false,
    winnerName,
    corporateNumber,
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
