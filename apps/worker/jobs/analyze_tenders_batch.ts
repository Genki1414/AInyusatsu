// Batch API での案件解析（コスト対策③の骨格）。
//
// 全トークンが50%引きになる代わりに、投入してから結果が出るまでたいてい1時間・最大24時間かかる。
// 解析は夜間に回せばよく即時性が要らないので、この待ち時間は許容できる。
//
// 【2段階に分ける理由】
// プロンプトキャッシュは「先に書き込んだものを後から読む」前提だが、Batch API では
// 処理の順番も間隔も制御できない。5本を1つのバッチに混ぜると、1本目の書き込みを待たずに
// 残りが走り、キャッシュが効かない。そのため
//   第1段：基本情報だけを全案件ぶん投入する（資料をキャッシュへ書き込む）
//   第2段：第1段の完了後に、残り4本を全案件ぶん投入する（キャッシュから読む）
// の2回に分ける。有効期間は1時間を指定している（packages/ai/adapters/claude_batch.ts）。
//
// 【未検証】バッチでキャッシュが実際にどれだけ効くかは測っていない。第1段が完了してから
// 第2段が処理されるまでの間隔が読めないためで、外れれば入力は満額に戻る（失敗にはならない）。
// 削減率を見込む前に、applyBatch が記録する usage で必ず実測すること。
//
// 【この骨格に無いもの】
// - 定期実行（pg-boss / Railway 常駐）。いまはCLIから submit → apply を手で叩く
// - 投入対象の選び方。呼び出し側が案件IDを渡す

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import {
  buildBatchRequests,
  cancelBatch,
  collectBatchResults,
  formatUsageSummary,
  groupResultsByTender,
  promptsForStage,
  retrieveBatchStatus,
  safeJsonParse,
  submitBatch,
  summarizeUsage,
  ANALYSIS_PROMPTS,
  CACHE_WRITE_MULTIPLIER_1H,
  type AnalysisPromptName,
  type BatchStage,
  type BatchTenderInput,
  type TenderBatchResults,
} from "@ai-nyusatsu-bu/ai";
import {
  loadTenderForAnalysis,
  persistAnalysis,
  type AnalysisOutputs,
  type PromptFailure,
  type Supabase,
  type TenderAnalysisInput,
} from "./analysis_shared";

export type SubmitBatchResult = {
  batchId: string | null;
  stage: BatchStage;
  requestCount: number;
  /** 資料が無いなどで投入できなかった案件と、その理由 */
  skipped: { tenderId: string; reason: string }[];
};

/**
 * 指定した案件を、その段のバッチとして投入する。
 * 1件でも読み込みに失敗したら止める、ということはしない（その案件だけ飛ばして続ける）。
 */
export async function submitAnalysisBatch(tenderIds: string[], stage: BatchStage): Promise<SubmitBatchResult> {
  const client = createServiceClient();
  const inputs: BatchTenderInput[] = [];
  const skipped: SubmitBatchResult["skipped"] = [];

  for (const tenderId of tenderIds) {
    try {
      const loaded = await loadTenderForAnalysis(client, tenderId);
      inputs.push({ tenderId, meta: loaded.meta, documents: loaded.documents });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[analyze_batch] 投入をスキップしました（tender=${tenderId}）: ${reason}`);
      skipped.push({ tenderId, reason });
    }
  }

  const requests = buildBatchRequests(inputs, stage);
  const submitted = await submitBatch(requests);
  if (!submitted) {
    return { batchId: null, stage, requestCount: 0, skipped };
  }

  const { error } = await client.from("analysis_batches").insert({
    batch_id: submitted.batchId,
    stage,
    status: "in_progress",
    tender_ids: inputs.map((i) => i.tenderId),
    request_count: submitted.requestCount,
  });
  if (error) {
    // 記録できないと結果を回収できなくなる（29日で消える）。バッチIDを添えて必ず気づける形で失敗させる。
    throw new Error(
      `バッチは投入できましたが記録に失敗しました。手動で回収してください（batch_id=${submitted.batchId}）: ${error.message}`,
    );
  }

  console.log(`[analyze_batch] 第${stage}段を投入しました（batch=${submitted.batchId}, ${submitted.requestCount}件）`);
  return { batchId: submitted.batchId, stage, requestCount: submitted.requestCount, skipped };
}

/** バッチの状態を確認する。終了していれば analysis_batches にも反映する。 */
export async function checkAnalysisBatch(batchId: string) {
  const client = createServiceClient();
  const status = await retrieveBatchStatus(batchId);

  if (status.ended) {
    await client
      .from("analysis_batches")
      .update({
        status: "ended",
        ended_at: new Date().toISOString(),
        succeeded: status.counts.succeeded,
        errored: status.counts.errored,
      })
      .eq("batch_id", batchId);
  }
  return status;
}

export type ApplyBatchResult = {
  batchId: string;
  /** DBへ反映できた案件数 */
  applied: number;
  /** 反映できなかった案件と理由 */
  failed: { tenderId: string; reason: string }[];
  /** custom_id を読めなかった結果の件数 */
  unmatched: number;
  /** 入力コストの削減率（バッチでキャッシュが効いたかの実測） */
  inputSavingRate: number;
};

/**
 * 終了したバッチの結果を回収し、DBへ反映する。
 * 第1段（基本情報だけ）の結果も保存する。5本のうち1本だけの状態で保存されるが、
 * 揃っていない項目は「要確認」として残るため、第2段の反映で上書きされる。
 */
export async function applyAnalysisBatch(batchId: string): Promise<ApplyBatchResult> {
  const client = createServiceClient();
  const { entries, usages } = await collectBatchResults(batchId);
  const { byTender, unmatched } = groupResultsByTender(entries);

  for (const entry of unmatched) {
    // 読めなかったIDは黙って捨てない。投入側の組み立てが壊れている合図になる。
    console.error(`[analyze_batch] custom_idを解釈できませんでした: ${entry.customId}`);
  }

  let applied = 0;
  const failed: ApplyBatchResult["failed"] = [];
  for (const result of byTender) {
    try {
      await applyTenderResults(client, result);
      applied++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[analyze_batch] 反映に失敗しました（tender=${result.tenderId}）: ${reason}`);
      failed.push({ tenderId: result.tenderId, reason });
    }
  }

  // バッチのキャッシュ書き込みは有効期間1時間ぶん（2倍）で課金される。
  const usage = summarizeUsage(usages, CACHE_WRITE_MULTIPLIER_1H);
  console.log(`[analyze_batch] トークン消費（batch=${batchId}）: ${formatUsageSummary(usage)}`);

  await client
    .from("analysis_batches")
    .update({ status: "applied", applied, applied_at: new Date().toISOString(), usage })
    .eq("batch_id", batchId);

  return { batchId, applied, failed, unmatched: unmatched.length, inputSavingRate: usage.inputSavingRate };
}

/** 1案件ぶんの結果を、スキーマ検証したうえでDBへ書き戻す。 */
async function applyTenderResults(client: Supabase, result: TenderBatchResults): Promise<void> {
  const input: TenderAnalysisInput = await loadTenderForAnalysis(client, result.tenderId);
  const outputs: AnalysisOutputs = { basicInfo: null, qualifications: null, lots: null, forms: null, notes: null };
  const failures: PromptFailure[] = [];

  for (const promptName of Object.keys(ANALYSIS_PROMPTS) as AnalysisPromptName[]) {
    const error = result.errors[promptName];
    if (error) {
      failures.push({ promptName, message: `${promptName}の抽出に失敗しました（${error}）` });
      continue;
    }
    const text = result.outputs[promptName];
    // このバッチに含まれていないプロンプトは、失敗ではないので何も記録しない
    // （第1段なら基本情報だけ、第2段なら残り4本しか入っていない）。
    if (text === undefined) continue;

    // 同期実行では extract() がスキーマ検証と再試行を担っているが、バッチでは
    // 再試行ができない（もう一度投入し直すしかない）。ここでは検証だけを行い、
    // 通らなければ失敗として記録する。
    const parsed = ANALYSIS_PROMPTS[promptName].schema.safeParse(safeParseOrNull(text));
    if (!parsed.success) {
      const detail = parsed.error.issues[0]?.message ?? "スキーマに適合しませんでした";
      failures.push({ promptName, message: `${promptName}の抽出結果がスキーマに適合しませんでした（${detail}）` });
      continue;
    }
    assignOutput(outputs, promptName, parsed.data);
  }

  await persistAnalysis(client, input, outputs, failures);
}

function safeParseOrNull(text: string): unknown {
  try {
    return safeJsonParse(text);
  } catch {
    return null;
  }
}

/** プロンプト名に対応するフィールドへ結果を入れる。 */
function assignOutput(outputs: AnalysisOutputs, promptName: AnalysisPromptName, value: unknown): void {
  switch (promptName) {
    case "basic_info":
      outputs.basicInfo = value as AnalysisOutputs["basicInfo"];
      return;
    case "qualifications":
      outputs.qualifications = value as AnalysisOutputs["qualifications"];
      return;
    case "lots":
      outputs.lots = value as AnalysisOutputs["lots"];
      return;
    case "forms":
      outputs.forms = value as AnalysisOutputs["forms"];
      return;
    case "notes":
      outputs.notes = value as AnalysisOutputs["notes"];
      return;
  }
}

/** 投入したバッチを取り消す。 */
export async function cancelAnalysisBatch(batchId: string): Promise<string> {
  const client = createServiceClient();
  const status = await cancelBatch(batchId);
  await client.from("analysis_batches").update({ status: "canceled" }).eq("batch_id", batchId);
  return status;
}

/** その段に含まれるプロンプト名（CLIの表示用）。 */
export function stagePrompts(stage: BatchStage): AnalysisPromptName[] {
  return promptsForStage(stage);
}
