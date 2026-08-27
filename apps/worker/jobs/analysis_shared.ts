// AI解析の共通部分（同期実行とバッチ実行の両方が使う）。
// 参照：docs/実装仕様書_v1.md §2（tenders/tender_analyses/tender_forms/tender_lots）
//
// 解析には2つの入口がある。
//   apps/worker/jobs/analyze_tender.ts        1案件をその場で解析する（結果がすぐ要るとき）
//   apps/worker/jobs/analyze_tenders_batch.ts 多数の案件をBatch APIでまとめて解析する（夜間・半額）
// どちらも「資料を読み込む」「結果をDBへ書き戻す」は同じなので、ここに置く。

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import {
  dedupeLotsByLineNo,
  mergeBasicInfoIntoTender,
  validateTenderDates,
  type LotRow,
  type TenderBasicFields,
  type ExtractedTenderBasicFields,
} from "@ai-nyusatsu-bu/domain";
import type { BasicInfo, Forms, Lots, Notes, PromptDocument, Qualifications, TenderMeta } from "@ai-nyusatsu-bu/ai";

export const MODEL_NAME = "claude-sonnet-5";

export type Supabase = ReturnType<typeof createServiceClient>;

export type TenderRow = TenderBasicFields & {
  notice_no: string | null;
  notice_date: string | null;
  procurement: string | null;
  agencies: { name: string | null } | { name: string | null }[] | null;
};

export type TenderAnalysisInput = {
  tenderId: string;
  tender: TenderRow;
  meta: TenderMeta;
  documents: PromptDocument[];
};

/** 抽出結果。失敗したプロンプトの分は null（推測で埋めない）。 */
export type AnalysisOutputs = {
  basicInfo: BasicInfo | null;
  qualifications: Qualifications | null;
  lots: Lots | null;
  forms: Forms | null;
  notes: Notes | null;
};

export type PromptFailure = { promptName: string; message: string };

function resolveAgencyName(agencies: TenderRow["agencies"]): string {
  if (!agencies) return "";
  const row = Array.isArray(agencies) ? agencies[0] : agencies;
  return row?.name ?? "";
}

/** 1件だけ先に走らせるときに、allSettledと同じ形の結果に揃える。 */
export async function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  try {
    return { status: "fulfilled", value: await promise };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

/** 成功した結果だけを取り出す。失敗した抽出は null（推測で埋めない）。 */
export function valueOr<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

/** 失敗したプロンプトの名前と理由を集める。理由はそのまま画面の「要確認」に出す。 */
export function collectPromptFailures(entries: [string, PromiseSettledResult<unknown>][]): PromptFailure[] {
  const failures: PromptFailure[] = [];
  for (const [promptName, result] of entries) {
    if (result.status !== "rejected") continue;
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    console.error(`[analysis] ${promptName}の抽出に失敗しました: ${reason}`);
    failures.push({ promptName, message: `${promptName}の抽出に失敗しました（${reason}）` });
  }
  return failures;
}

/**
 * 解析に必要な案件情報と資料テキストを読み込む。
 * 資料が1件も無ければ解析できないため、理由を添えて失敗させる。
 */
export async function loadTenderForAnalysis(client: Supabase, tenderId: string): Promise<TenderAnalysisInput> {
  const { data: tender, error: tenderError } = await client
    .from("tenders")
    .select(
      "org_unit, submit_deadline, qa_deadline, bid_open_at, term_from, term_to, place, qual_category, item, grade, areas, budget, notice_no, notice_date, procurement, agencies(name)",
    )
    .eq("id", tenderId)
    .single<TenderRow>();
  if (tenderError || !tender) {
    throw new Error(`案件が見つかりません（${tenderId}）: ${tenderError?.message}`);
  }

  const { data: docs, error: docsError } = await client
    .from("tender_documents")
    .select("kind, extracted_text")
    .eq("tender_id", tenderId)
    .not("extracted_text", "is", null)
    .returns<{ kind: string; extracted_text: string }[]>();
  if (docsError) throw new Error(`資料の取得に失敗しました: ${docsError.message}`);
  if (!docs || docs.length === 0) {
    throw new Error(
      "解析対象の資料がありません（タスク2-2のテキスト抽出が未完了か、資料がまだ取得できていない可能性があります）",
    );
  }

  return {
    tenderId,
    tender,
    meta: {
      agencyName: resolveAgencyName(tender.agencies),
      noticeNo: tender.notice_no ?? "",
      procurement: tender.procurement ?? "",
    },
    documents: docs.map((d) => ({ kind: d.kind, text: d.extracted_text })),
  };
}

/**
 * 1本も成功しなかった案件の失敗理由を記録する。
 *
 * これまでは例外を投げるだけで、DBには何も残らなかった。手で流している間は画面で
 * 気づけるが、自動で回すと「解析されないまま静かに溜まる」ことになる。
 * 解析結果は保存できないので collect_status は進めず、理由だけを残す。
 */
export async function recordAnalysisFailure(
  client: Supabase,
  tenderId: string,
  failures: PromptFailure[],
): Promise<void> {
  const reasons = failures.map((f) => f.message);
  const { error } = await client
    .from("tenders")
    .update({
      needs_review: true,
      review_reasons: reasons,
      failure_code: "PARSE_INVALID",
      failure_reason: reasons.join(" / ").slice(0, 2000),
    })
    .eq("id", tenderId);
  if (error) {
    console.error(`[analysis] 失敗理由の記録に失敗しました（tender=${tenderId}）: ${error.message}`);
  }
}

export type PersistAnalysisResult = {
  analysisVersion: number;
  tenderFieldsFilled: string[];
  formsCount: number;
  lotsCount: number;
  needsReview: boolean;
  reviewReasons: string[];
};

/**
 * 抽出結果を tenders / tender_analyses / tender_forms / tender_lots へ書き戻す。
 *
 * 一部のプロンプトが失敗していても、成功した分は保存する（CLAUDE.md 最重要の前提7
 * 「資料は揃わなくても、提案できる内容があれば提案する」）。
 * 失敗は握りつぶさず、tenders.failure_code / failure_reason と「要確認」に残す。
 */
export async function persistAnalysis(
  client: Supabase,
  input: Pick<TenderAnalysisInput, "tenderId" | "tender">,
  outputs: AnalysisOutputs,
  failures: PromptFailure[],
): Promise<PersistAnalysisResult> {
  const { tenderId, tender } = input;
  const { basicInfo, qualifications, lots, forms, notes } = outputs;

  // tenders：空欄の項目だけをAI解析の値で埋める（コネクタの確定値は上書きしない）。
  const currentFields: TenderBasicFields = {
    org_unit: tender.org_unit,
    submit_deadline: tender.submit_deadline,
    qa_deadline: tender.qa_deadline,
    bid_open_at: tender.bid_open_at,
    term_from: tender.term_from,
    term_to: tender.term_to,
    place: tender.place,
    qual_category: tender.qual_category,
    item: tender.item,
    grade: tender.grade,
    areas: tender.areas ?? [],
    budget: tender.budget,
  };
  // 基本情報の抽出が失敗した場合は何も埋めない（他の抽出結果の保存は続ける）。
  const extractedFields: Partial<ExtractedTenderBasicFields> = basicInfo
    ? {
        org_unit: basicInfo.org_unit.value,
        // 期限は basicInfoSchema が日本時間に固定済み（toJstTimestamp）。ここでは触らない
        submit_deadline: basicInfo.submit_deadline.value,
        qa_deadline: basicInfo.qa_deadline.value,
        bid_open_at: basicInfo.bid_open_at.value,
        term_from: basicInfo.term_from.value,
        term_to: basicInfo.term_to.value,
        place: basicInfo.place.value,
        qual_category: basicInfo.qual_category.value,
        item: basicInfo.item.value,
        grade: basicInfo.grade.value,
        areas: basicInfo.areas.value,
        budget: basicInfo.budget.value,
      }
    : {};
  const patch = mergeBasicInfoIntoTender(currentFields, extractedFields);

  // タスク2-3b：期限の前後関係・和暦変換ミスの検出。コネクタの確定値とAI解析で新たに
  // 埋めた値の両方を含む「今の実際の状態」（currentFields + patch）に対して検証する。
  const effectiveDates = { ...currentFields, ...patch };
  const dateIssues = validateTenderDates({
    noticeDate: tender.notice_date,
    submitDeadline: effectiveDates.submit_deadline,
    qaDeadline: effectiveDates.qa_deadline,
    bidOpenAt: effectiveDates.bid_open_at,
  });
  // 一部のプロンプトが失敗した案件も「要確認」にする。画面から抜けている項目に気づけるようにするため。
  const reviewReasons = [...dateIssues.map((i) => i.message), ...failures.map((f) => f.message)];
  const needsReview = reviewReasons.length > 0;

  const { error: updateError } = await client
    .from("tenders")
    .update({
      ...patch,
      needs_review: needsReview,
      review_reasons: reviewReasons,
      collect_status: "解析完了",
      // 失敗を握りつぶさない（CLAUDE.md）。全部成功したときは前回の失敗記録を消す。
      failure_code: failures.length > 0 ? "PARSE_INVALID" : null,
      failure_reason: failures.length > 0 ? failures.map((f) => f.message).join(" / ") : null,
    })
    .eq("id", tenderId);
  if (updateError) throw new Error(`tendersの更新に失敗しました: ${updateError.message}`);

  // tender_analyses：バージョンを1つ進めて追加保存する（過去の解析結果を残す）。
  const { data: latest } = await client
    .from("tender_analyses")
    .select("version")
    .eq("tender_id", tenderId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number }>();
  const version = (latest?.version ?? 0) + 1;

  const { error: analysisError } = await client.from("tender_analyses").insert({
    tender_id: tenderId,
    version,
    model: MODEL_NAME,
    qualifications: qualifications?.qualifications ?? [],
    conditions: qualifications?.conditions ?? [],
    // 業種名の付かないまとめ行は見積依頼に使えないため除く（元の出力は raw に残る）。
    trades: (lots?.trades_summary ?? []).filter((t) => t.trade !== null),
    notes: notes?.notes ?? [],
    raw: { basicInfo, qualifications, lots, forms, notes, failures },
  });
  if (analysisError) throw new Error(`tender_analysesの保存に失敗しました: ${analysisError.message}`);

  // tender_forms：最新の解析結果だけを残す（前回分は消してから入れ直す）。
  const { error: deleteFormsError } = await client.from("tender_forms").delete().eq("tender_id", tenderId);
  if (deleteFormsError) throw new Error(`tender_formsの削除に失敗しました: ${deleteFormsError.message}`);

  const formRows = forms?.forms ?? [];
  if (formRows.length > 0) {
    const { error: insertFormsError } = await client.from("tender_forms").insert(
      formRows.map((f) => ({
        tender_id: tenderId,
        name: f.name,
        source: f.form_no,
        // 必須かどうかを判断できなかった書類は必須として残す。§4は再現率優先で
        // 「人が消す方が、漏れて失格になるより安全」としており、列も not null default true。
        required: f.required ?? true,
        note: f.note,
      })),
    );
    if (insertFormsError) throw new Error(`tender_formsの保存に失敗しました: ${insertFormsError.message}`);
  }

  // tender_lots：最新の解析結果だけを残す（前回分は消してから入れ直す）。
  const { error: deleteLotsError } = await client.from("tender_lots").delete().eq("tender_id", tenderId);
  if (deleteLotsError) throw new Error(`tender_lotsの削除に失敗しました: ${deleteLotsError.message}`);

  const lotRows: LotRow[] = dedupeLotsByLineNo(
    (lots?.lots ?? []).map((l) => ({
      line_no: l.line_no,
      item: l.item,
      spec: l.spec,
      qty: l.qty,
      unit: l.unit,
      trade: l.trade,
      confidence: l.confidence,
    })),
  );
  if (lotRows.length > 0) {
    const { error: insertLotsError } = await client
      .from("tender_lots")
      .insert(lotRows.map((l) => ({ tender_id: tenderId, ...l })));
    if (insertLotsError) throw new Error(`tender_lotsの保存に失敗しました: ${insertLotsError.message}`);
  }

  return {
    analysisVersion: version,
    tenderFieldsFilled: Object.keys(patch),
    formsCount: formRows.length,
    lotsCount: lotRows.length,
    needsReview,
    reviewReasons,
  };
}
