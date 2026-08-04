// AI解析結果の保存（タスク2-4）。
// 参照：docs/実装仕様書_v1.md §2（tenders/tender_analyses/tender_forms）, §4
//
// プロンプト1（基本情報と期限）・2（参加資格と参加条件）・4（提出書類）・5（注意事項）を実行し、
// 結果をDBへ保存する。
//
// 【スコープ外・別タスク】
// - プロンプト3（数量表の構造化と業種割当）→ tender_lots への書き込みはタスク2-5
// - プロンプト6（質問案の生成）は org 単位の questions テーブル向け（1案件×1org）で、
//   全ユーザー共通のこの解析パイプラインには含まない。UI（タスク3系）からオンデマンドで
//   呼ぶ想定
// - tenders.name / agency は、GEPS/KKJの一次情報（コネクタ）を正としてAI解析では
//   上書きしない（agency_idの名寄せに影響するため）。空欄の項目（期限・予定価格・
//   資格区分など、コネクタでは埋まらない列）だけをAI解析で埋める
//   （packages/domain の mergeBasicInfoIntoTender 参照）

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { mergeBasicInfoIntoTender, type TenderBasicFields } from "@ai-nyusatsu-bu/domain";
import {
  analyzeBasicInfo,
  analyzeForms,
  analyzeNotes,
  analyzeQualifications,
  callClaude,
  type PromptDocument,
} from "@ai-nyusatsu-bu/ai";

const MODEL_NAME = "claude-sonnet-5";

export type AnalyzeTenderResult = {
  tenderId: string;
  analysisVersion: number;
  tenderFieldsFilled: string[];
  formsCount: number;
};

type TenderRow = TenderBasicFields & {
  notice_no: string | null;
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
      "org_unit, submit_deadline, qa_deadline, bid_open_at, term_from, term_to, place, qual_category, item, grade, areas, budget, notice_no, procurement, agencies(name)",
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

  const [basicInfo, qualifications, forms, notes] = await Promise.all([
    analyzeBasicInfo({ meta, documents, callModel: callClaude }),
    analyzeQualifications({ meta, documents, callModel: callClaude }),
    analyzeForms({ meta, documents, callModel: callClaude }),
    analyzeNotes({ meta, documents, callModel: callClaude }),
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
  if (Object.keys(patch).length > 0) {
    const { error: updateError } = await client.from("tenders").update(patch).eq("id", tenderId);
    if (updateError) throw new Error(`tendersの更新に失敗しました: ${updateError.message}`);
  }

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
    notes: notes.notes,
    raw: { basicInfo, qualifications, forms, notes },
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

  return { tenderId, analysisVersion: version, tenderFieldsFilled: Object.keys(patch), formsCount: forms.forms.length };
}
