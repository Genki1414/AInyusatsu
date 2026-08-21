// AI解析結果の保存（タスク2-4・2-5・2-3b）。
// 参照：docs/実装仕様書_v1.md §2（tenders/tender_analyses/tender_forms/tender_lots）, §4
//
// プロンプト1（基本情報と期限）・2（参加資格と参加条件）・3（数量表の構造化と業種割当）・
// 4（提出書類）・5（注意事項）を実行し、結果をDBへ保存する。あわせて期限の前後関係・
// 和暦変換ミスの検出（タスク2-3b、docs/AI解析プロンプト集.md §1）を行い、違反があれば
// tenders.needs_reviewを立てる。解析が完了したら tenders.collect_status を「解析完了」に
// 進める（docs/ai-nyusatsu-bu-prototype-v7.jsx の状態遷移：取得済→AI解析中→解析完了→公開中）。
// 「公開中」への遷移はユーザーによる公開操作（タスク3系の画面）で行うため、ここでは行わない。
//
// 【スコープ外・別タスク】
// - プロンプト6（質問案の生成）は org 単位の questions テーブル向け（1案件×1org）で、
//   全ユーザー共通のこの解析パイプラインには含まない。UI（タスク3系）からオンデマンドで
//   呼ぶ想定
// - tenders.name / agency は、GEPS/KKJの一次情報（コネクタ）を正としてAI解析では
//   上書きしない（agency_idの名寄せに影響するため）。空欄の項目（期限・予定価格・
//   資格区分など、コネクタでは埋まらない列）だけをAI解析で埋める
//   （packages/domain の mergeBasicInfoIntoTender 参照）
// - tender_lotsにはevidence/source列が無いため、行ごとの引用・出典は保持しない
//   （tender_analyses.raw.lotsに完全な出力を残しているので、必要ならそちらを参照する）

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import {
  dedupeLotsByLineNo,
  mergeBasicInfoIntoTender,
  validateTenderDates,
  type LotRow,
  type TenderBasicFields,
} from "@ai-nyusatsu-bu/domain";
import {
  analyzeBasicInfo,
  analyzeForms,
  analyzeLots,
  analyzeNotes,
  analyzeQualifications,
  callClaude,
  type PromptDocument,
  type OnInvalid,
} from "@ai-nyusatsu-bu/ai";

const MODEL_NAME = "claude-sonnet-5";

export type AnalyzeTenderResult = {
  tenderId: string;
  analysisVersion: number;
  tenderFieldsFilled: string[];
  formsCount: number;
  lotsCount: number;
  needsReview: boolean;
  reviewReasons: string[];
};

type TenderRow = TenderBasicFields & {
  notice_no: string | null;
  notice_date: string | null;
  procurement: string | null;
  agencies: { name: string | null } | { name: string | null }[] | null;
};

function resolveAgencyName(agencies: TenderRow["agencies"]): string {
  if (!agencies) return "";
  const row = Array.isArray(agencies) ? agencies[0] : agencies;
  return row?.name ?? "";
}

/** 1案件を解析し、tenders/tender_analyses/tender_formsへ保存する。 */
export async function analyzeTender(tenderId: string): Promise<AnalyzeTenderResult> {
  const client = createServiceClient();

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

  const documents: PromptDocument[] = docs.map((d) => ({ kind: d.kind, text: d.extracted_text }));
  const meta = {
    agencyName: resolveAgencyName(tender.agencies),
    noticeNo: tender.notice_no ?? "",
    procurement: tender.procurement ?? "",
  };

  // スキーマ不一致の理由を捨てない（CLAUDE.md「エラーは握りつぶさない」）。
  // 2回失敗するとParseInvalidErrorになるが、それだけでは「どの項目がなぜ弾かれたか」が
  // 分からず調査できないため、試行ごとに理由を標準エラー出力へ残す。
  const onInvalid: OnInvalid = ({ promptName, attempt, issue, raw }) => {
    // ErrorはJSON.stringifyすると{}になり原因が分からなくなるため、messageを取り出す。
    // JSONとして壊れている場合はissueだけでは判断できないので、生出力の末尾も添える
    // （末尾を見るのは、出力が長すぎて途中で切れたかを判別するため）。
    const detail = issue instanceof Error ? `${issue.name}: ${issue.message}` : JSON.stringify(issue, null, 2);
    console.error(`[analyze_tender] スキーマ不一致（prompt=${promptName}, attempt=${attempt}）: ${detail}`);
    console.error(`[analyze_tender] 生出力の末尾200文字: ${JSON.stringify(raw.slice(-200))}（全${raw.length}文字）`);
  };

  const [basicInfo, qualifications, lots, forms, notes] = await Promise.all([
    analyzeBasicInfo({ meta, documents, callModel: callClaude, onInvalid }),
    analyzeQualifications({ meta, documents, callModel: callClaude, onInvalid }),
    analyzeLots({ meta, documents, callModel: callClaude, onInvalid }),
    analyzeForms({ meta, documents, callModel: callClaude, onInvalid }),
    analyzeNotes({ meta, documents, callModel: callClaude, onInvalid }),
  ]);

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
  const extractedFields: Partial<TenderBasicFields> = {
    org_unit: basicInfo.org_unit.value,
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
  };
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
  const needsReview = dateIssues.length > 0;
  const reviewReasons = dateIssues.map((i) => i.message);

  const { error: updateError } = await client
    .from("tenders")
    .update({ ...patch, needs_review: needsReview, review_reasons: reviewReasons, collect_status: "解析完了" })
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
    qualifications: qualifications.qualifications,
    conditions: qualifications.conditions,
    trades: lots.trades_summary,
    notes: notes.notes,
    raw: { basicInfo, qualifications, lots, forms, notes },
  });
  if (analysisError) throw new Error(`tender_analysesの保存に失敗しました: ${analysisError.message}`);

  // tender_forms：最新の解析結果だけを残す（前回分は消してから入れ直す）。
  const { error: deleteFormsError } = await client.from("tender_forms").delete().eq("tender_id", tenderId);
  if (deleteFormsError) throw new Error(`tender_formsの削除に失敗しました: ${deleteFormsError.message}`);

  if (forms.forms.length > 0) {
    const { error: insertFormsError } = await client.from("tender_forms").insert(
      forms.forms.map((f) => ({
        tender_id: tenderId,
        name: f.name,
        source: f.form_no,
        required: f.required,
        note: f.note,
      })),
    );
    if (insertFormsError) throw new Error(`tender_formsの保存に失敗しました: ${insertFormsError.message}`);
  }

  // tender_lots：最新の解析結果だけを残す（前回分は消してから入れ直す）。
  const { error: deleteLotsError } = await client.from("tender_lots").delete().eq("tender_id", tenderId);
  if (deleteLotsError) throw new Error(`tender_lotsの削除に失敗しました: ${deleteLotsError.message}`);

  const lotRows: LotRow[] = dedupeLotsByLineNo(
    lots.lots.map((l) => ({
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
    tenderId,
    analysisVersion: version,
    tenderFieldsFilled: Object.keys(patch),
    formsCount: forms.forms.length,
    lotsCount: lotRows.length,
    needsReview,
    reviewReasons,
  };
}
