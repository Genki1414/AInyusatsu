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
  type ExtractedTenderBasicFields,
} from "@ai-nyusatsu-bu/domain";
import {
  analyzeBasicInfo,
  analyzeForms,
  analyzeLots,
  analyzeNotes,
  analyzeQualifications,
  callClaude,
  formatUsageSummary,
  summarizeUsage,
  type ModelUsage,
  type PromptDocument,
  type OnInvalid,
  type OnUsage,
  type UsageSummary,
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
  /** 失敗したプロンプト名。空なら5本すべて成功している */
  failedPrompts: string[];
  /** トークン消費とプロンプトキャッシュの効き具合 */
  usage: UsageSummary;
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

type PromptFailure = { promptName: string; message: string };

/** 1本だけ先に走らせるときに、allSettledと同じ形の結果に揃える。 */
async function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  try {
    return { status: "fulfilled", value: await promise };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

/** 成功した結果だけを取り出す。失敗した抽出は null（推測で埋めない）。 */
function valueOr<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

/** 失敗したプロンプトの名前と理由を集める。理由はそのまま画面の「要確認」に出す。 */
function collectPromptFailures(entries: [string, PromiseSettledResult<unknown>][]): PromptFailure[] {
  const failures: PromptFailure[] = [];
  for (const [promptName, result] of entries) {
    if (result.status !== "rejected") continue;
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    console.error(`[analyze_tender] ${promptName}の抽出に失敗しました: ${reason}`);
    failures.push({ promptName, message: `${promptName}の抽出に失敗しました（${reason}）` });
  }
  return failures;
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

  // 実際のトークン消費を集めて、プロンプトキャッシュが効いているかを残す。
  // キャッシュは外れても失敗としては現れず、請求額に静かに出るだけなので計測する。
  const usages: ModelUsage[] = [];
  const onUsage: OnUsage = (usage) => usages.push(usage);
  const run = { meta, documents, callModel: callClaude, onInvalid, onUsage };

  // 5本のうち1本が失敗しても、成功した分は保存する（CLAUDE.md 最重要の前提7
  // 「資料は揃わなくても、提案できる内容があれば提案する」）。Promise.allでは、たとえば
  // 注意事項の抽出が1回スキーマ不一致になっただけで、期限も数量表も丸ごと捨てていた。
  // 失敗は握りつぶさず、失敗したプロンプト名を tenders.failure_reason と要確認フラグに残す。
  //
  // 【実行の順序】5本のプロンプトは前半（案件の既知情報＋資料）が完全に同じで、そこを
  // プロンプトキャッシュの対象にしている。5本を同時に投げると、1本目の書き込みが終わる前に
  // 残りが走ってしまい、全部がキャッシュミス＝満額になる。そのため基本情報を先に1本走らせて
  // キャッシュを作り、残り4本はそれを読む形にする。
  // 待ち時間は1本分（数十秒）増えるが、入力コストが約2/3下がる。
  const basicInfoR = await settle(analyzeBasicInfo(run));
  const [qualificationsR, lotsR, formsR, notesR] = await Promise.allSettled([
    analyzeQualifications(run),
    analyzeLots(run),
    analyzeForms(run),
    analyzeNotes(run),
  ]);
  const settled = [basicInfoR, qualificationsR, lotsR, formsR, notesR];
  const failures = collectPromptFailures([
    ["基本情報と期限", basicInfoR],
    ["参加資格と参加条件", qualificationsR],
    ["数量表の構造化と業種割当", lotsR],
    ["提出書類", formsR],
    ["注意事項", notesR],
  ]);
  if (failures.length === settled.length) {
    // 1本も成功していないなら保存できるものが無い。理由を添えて失敗として扱う。
    throw new Error(`AI解析がすべて失敗しました: ${failures.map((f) => f.message).join(" / ")}`);
  }

  // 失敗した分は「抽出できなかった」として空で進める（推測で埋めない）。
  const basicInfo = valueOr(basicInfoR);
  const qualifications = valueOr(qualificationsR);
  const lots = valueOr(lotsR);
  const forms = valueOr(formsR);
  const notes = valueOr(notesR);

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

  const usage = summarizeUsage(usages);
  console.log(`[analyze_tender] トークン消費（tender=${tenderId}）: ${formatUsageSummary(usage)}`);
  if (usage.cacheReadTokens === 0 && usage.calls > 1) {
    // 2本目以降が1つもキャッシュに当たっていない＝前半の文字列がぶれているか、
    // 有効期間を過ぎている。放置すると入力コストが3倍のままになるので気づけるようにする。
    console.warn("[analyze_tender] プロンプトキャッシュが1度も効いていません。共通部分の組み立てを確認してください");
  }

  return {
    tenderId,
    analysisVersion: version,
    tenderFieldsFilled: Object.keys(patch),
    formsCount: formRows.length,
    lotsCount: lotRows.length,
    needsReview,
    reviewReasons,
    failedPrompts: failures.map((f) => f.promptName),
    usage,
  };
}
