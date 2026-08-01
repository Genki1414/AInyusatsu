// 落札実績オープンデータの取り込みジョブ（A-2〜A-4）。
// 参照：docs/落札実績オープンデータ_取り込み設計.md §2, §9
//
// runFullImport  : 全件データ（年度ごと）を取り込む。初回投入・月次の自己修復に使う。
// runDiffImport  : 差分データ（日ごと）を取り込む。対象日のファイルが無ければ no_data として正常終了する。
//
// 冪等性：awards は (procurement_no, opened_at) の一意インデックスに upsert するため、
// 同じファイルを2回流しても件数は変わらない（supabase/migrations/20260802000001_awards_open_data.sql）。

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { hasUnexpectedShape, normalizeAwardRow, parseAwardsCsv, type NormalizedAward } from "@ai-nyusatsu-bu/domain";
import { fetchDiffData, fetchFullData, type FetchResult } from "../connectors/p-portal-awards";

const UPSERT_BATCH_SIZE = 500;

export type ImportOutcome = {
  status: "succeeded" | "no_data" | "failed";
  rowsTotal: number;
  rowsUpserted: number;
  rowsSkipped: number;
  detail?: Record<string, unknown>;
};

async function recordImport(
  kind: "full" | "diff",
  targetDate: string | null,
  outcome: ImportOutcome,
): Promise<void> {
  const client = createServiceClient();
  const { error } = await client.from("award_imports").insert({
    kind,
    target_date: targetDate,
    rows_total: outcome.rowsTotal,
    rows_upserted: outcome.rowsUpserted,
    rows_skipped: outcome.rowsSkipped,
    status: outcome.status,
    detail: outcome.detail ?? null,
  });
  if (error) {
    throw new Error(`award_imports の記録に失敗しました: ${error.message}`);
  }
}

async function upsertAwards(rows: NormalizedAward[], sourceBatch: string): Promise<void> {
  if (rows.length === 0) return;
  const client = createServiceClient();
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_BATCH_SIZE).map((a) => ({
      procurement_no: a.procurementNo,
      name: a.name,
      item: a.item,
      agency_class: a.agencyClass,
      contract_type: a.contractType,
      budget: a.budget,
      amount: a.amount,
      bidders: a.bidders,
      opened_at: a.openedAt,
      rate: a.rate,
      tax_included: a.taxIncluded,
      outlier: a.outlier,
      winner_name: a.winnerName,
      corporate_number: a.corporateNumber,
      source: "crawler",
      source_batch: sourceBatch,
    }));
    const { error } = await client.from("awards").upsert(chunk, { onConflict: "procurement_no,opened_at" });
    if (error) {
      throw new Error(`awards の upsert に失敗しました（${chunk.length}件目のバッチ）: ${error.message}`);
    }
  }
}

async function processCsvText(text: string, sourceBatch: string): Promise<ImportOutcome> {
  const rows = parseAwardsCsv(text);
  if (rows.length === 0) {
    return { status: "no_data", rowsTotal: 0, rowsUpserted: 0, rowsSkipped: 0 };
  }

  if (hasUnexpectedShape(rows[0])) {
    // 実データの列順（法人番号が8列目に来る想定）と食い違っている。1行も取り込まず中断し、
    // 原因が分かるよう1行目の内容を残す（黙って誤った列にマッピングしない）。
    return {
      status: "failed",
      rowsTotal: rows.length,
      rowsUpserted: 0,
      rowsSkipped: rows.length,
      detail: { reason: "unexpected_row_shape", firstRow: rows[0] },
    };
  }

  const normalized: NormalizedAward[] = [];
  const skipReasons: Record<string, number> = {};
  for (const row of rows) {
    const { award, skipped, skipReason } = normalizeAwardRow(row, { sourceBatch });
    if (skipped) {
      if (skipReason) skipReasons[skipReason] = (skipReasons[skipReason] ?? 0) + 1;
      continue;
    }
    normalized.push(award);
  }

  await upsertAwards(normalized, sourceBatch);

  return {
    status: "succeeded",
    rowsTotal: rows.length,
    rowsUpserted: normalized.length,
    rowsSkipped: rows.length - normalized.length,
    detail: Object.keys(skipReasons).length > 0 ? { skipReasons } : undefined,
  };
}

async function handleFetchResult(
  kind: "full" | "diff",
  targetDate: string | null,
  result: FetchResult,
): Promise<ImportOutcome> {
  if (!result.found) {
    // 差分データは過去2か月分しか存在しない。存在しない日は正常系（no_data）として扱う。
    const outcome: ImportOutcome = {
      status: "no_data",
      rowsTotal: 0,
      rowsUpserted: 0,
      rowsSkipped: 0,
      detail: { reason: "file_not_found", sourceFile: result.sourceFile },
    };
    await recordImport(kind, targetDate, outcome);
    return outcome;
  }

  try {
    const outcome = await processCsvText(result.text, result.sourceFile);
    await recordImport(kind, targetDate, outcome);
    return outcome;
  } catch (err) {
    const outcome: ImportOutcome = {
      status: "failed",
      rowsTotal: 0,
      rowsUpserted: 0,
      rowsSkipped: 0,
      detail: { reason: "exception", message: err instanceof Error ? err.message : String(err) },
    };
    await recordImport(kind, targetDate, outcome);
    throw err;
  }
}

/** 全件データ（年度ごと）を取り込む。 */
export async function runFullImport(year: number): Promise<ImportOutcome> {
  const result = await fetchFullData(year);
  return handleFetchResult("full", null, result);
}

/** 差分データ（日ごと）を取り込む。 */
export async function runDiffImport(date: Date): Promise<ImportOutcome> {
  const result = await fetchDiffData(date);
  const targetDate = date.toISOString().slice(0, 10);
  return handleFetchResult("diff", targetDate, result);
}
