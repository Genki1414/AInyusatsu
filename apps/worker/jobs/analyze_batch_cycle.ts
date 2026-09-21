// 2段階バッチ解析の自動運転。
// 第1段（基本情報）→期限が近い案件は同期で全解析／それ以外は第2段バッチ、を1時間ごとに進める。

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { judgeQualificationScope, noticeDateCutoff, shouldAnalyze, toDateIso } from "@ai-nyusatsu-bu/domain";
import { analyzeTender } from "./analyze_tender";
import { applyAnalysisBatch, checkAnalysisBatch, submitAnalysisBatch } from "./analyze_tenders_batch";
import { aiBudgetFromEnv, budgetExceeded, loadAiSpend } from "./ai_usage";
import { includeIncorporatedFromEnv } from "./classify_agencies";
import { maxNoticeAgeFromEnv } from "./analyze_pending";

export const DEFAULT_BATCH_TENDER_LIMIT = 100;
export const DEFAULT_URGENT_HOURS = 72;

type BatchRow = {
  id: string;
  batch_id: string;
  stage: 1 | 2;
  status: string;
  tender_ids: string[];
  followup_completed_at: string | null;
};

type CandidateRow = {
  id: string;
  name: string;
  submit_deadline: string | null;
  procurement: string;
  failure_code: string | null;
  collect_status: string;
  agencies: { gov_scope: string | null } | { gov_scope: string | null }[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function positiveIntegerFromEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function splitUrgentCandidates<T extends { submit_deadline: string | null }>(
  rows: T[],
  now: Date,
  urgentHours: number,
): { urgent: T[]; normal: T[] } {
  const limit = now.getTime() + urgentHours * 60 * 60 * 1000;
  const urgent: T[] = [];
  const normal: T[] = [];
  for (const row of rows) {
    if (row.submit_deadline) {
      const at = new Date(row.submit_deadline).getTime();
      if (Number.isFinite(at) && at >= now.getTime() && at <= limit) {
        urgent.push(row);
        continue;
      }
    }
    normal.push(row);
  }
  return { urgent, normal };
}

async function loadCandidates(limit: number, now: Date): Promise<CandidateRow[]> {
  const client = createServiceClient();
  const includeIncorporated = includeIncorporatedFromEnv();
  const allowedScopes = includeIncorporated ? ["国", "独立行政法人等"] : ["国"];
  const maxAge = maxNoticeAgeFromEnv();
  const noticeDateFrom = maxAge === null ? null : toDateIso(noticeDateCutoff(maxAge, now));

  let query = client
    .from("tenders")
    .select("id, name, submit_deadline, procurement, failure_code, collect_status, agencies!inner(gov_scope), tender_documents!inner(id)")
    .eq("collect_status", "取得済")
    .in("agencies.gov_scope", allowedScopes)
    .neq("procurement", "工事")
    .not("tender_documents.extracted_text", "is", null)
    .or(`submit_deadline.is.null,submit_deadline.gte.${now.toISOString()}`)
    .order("submit_deadline", { ascending: true, nullsFirst: false })
    .limit(limit * 5);
  if (noticeDateFrom) query = query.gte("notice_date", noticeDateFrom);

  const { data, error } = await query.returns<CandidateRow[]>();
  if (error) throw new Error(`バッチ解析候補の取得に失敗しました: ${error.message}`);

  const deduped = [...new Map((data ?? []).map((row) => [row.id, row])).values()];
  return deduped
    .filter((row) => {
      const decision = judgeQualificationScope(
        { govScope: (one(row.agencies)?.gov_scope ?? "不明") as never, procurement: row.procurement },
        { includeIncorporated },
      );
      return shouldAnalyze(decision);
    })
    .slice(0, limit);
}

async function budgetIsExceeded(now: Date): Promise<"daily" | "monthly" | null> {
  const budget = aiBudgetFromEnv();
  if (budget.dailyYen === 0 && budget.monthlyYen === 0) return null;
  return budgetExceeded(budget, await loadAiSpend(createServiceClient(), now));
}

async function processUrgent(rows: CandidateRow[], now: Date): Promise<{ analyzed: number; failed: number; stopped: boolean }> {
  let analyzed = 0;
  let failed = 0;
  for (const row of rows) {
    if (await budgetIsExceeded(now)) return { analyzed, failed, stopped: true };
    try {
      await analyzeTender(row.id);
      analyzed++;
    } catch (err) {
      failed++;
      console.error(`[analyze_batch_cycle] 緊急案件の同期解析に失敗しました（${row.id} ${row.name}）`, err);
    }
  }
  return { analyzed, failed, stopped: false };
}

async function advanceExistingBatches(): Promise<number> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("analysis_batches")
    .select("id, batch_id, stage, status, tender_ids, followup_completed_at")
    .in("status", ["in_progress", "ended"])
    .order("submitted_at", { ascending: true })
    .limit(10)
    .returns<BatchRow[]>();
  if (error) throw new Error(`処理中バッチの取得に失敗しました: ${error.message}`);

  let applied = 0;
  for (const row of data ?? []) {
    try {
      if (row.status === "in_progress") {
        const status = await checkAnalysisBatch(row.batch_id);
        if (!status.ended) continue;
      }
      await applyAnalysisBatch(row.batch_id);
      applied++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[analyze_batch_cycle] バッチの確認・反映に失敗しました（${row.batch_id}）: ${reason}`);
      await client.from("analysis_batches").update({ failure_reason: reason.slice(0, 2000) }).eq("id", row.id);
    }
  }
  return applied;
}

async function followUpStageOne(now: Date, urgentHours: number): Promise<{ urgent: number; stage2: number }> {
  const client = createServiceClient();
  const { data: parents, error } = await client
    .from("analysis_batches")
    .select("id, batch_id, stage, status, tender_ids, followup_completed_at")
    .eq("stage", 1)
    .eq("status", "applied")
    .is("followup_completed_at", null)
    .order("applied_at", { ascending: true })
    .limit(5)
    .returns<BatchRow[]>();
  if (error) throw new Error(`第1段の引継ぎ対象を取得できません: ${error.message}`);

  let urgentCount = 0;
  let stage2Count = 0;
  for (const parent of parents ?? []) {
    if (await budgetIsExceeded(now)) break;

    const { data: tenders, error: tenderError } = await client
      .from("tenders")
      .select("id, name, submit_deadline, procurement, failure_code, collect_status, agencies(gov_scope)")
      .in("id", parent.tender_ids)
      .returns<CandidateRow[]>();
    if (tenderError) throw new Error(`第1段の案件を取得できません: ${tenderError.message}`);

    const pending = (tenders ?? []).filter((row) => row.collect_status === "取得済");
    const expired = pending.filter(
      (row) => row.submit_deadline !== null && new Date(row.submit_deadline).getTime() < now.getTime(),
    );
    if (expired.length > 0) {
      const { error: closeError } = await client
        .from("tenders")
        .update({ collect_status: "終了" })
        .in("id", expired.map((row) => row.id));
      if (closeError) throw new Error(`期限切れ案件を終了にできません: ${closeError.message}`);
    }
    const eligible = pending.filter((row) => !expired.some((closed) => closed.id === row.id));
    const { urgent, normal } = splitUrgentCandidates(eligible, now, urgentHours);

    // すでに第2段が作られていれば、再起動後も二重投入しない。
    const { data: existingChild } = await client
      .from("analysis_batches")
      .select("id")
      .eq("parent_batch_id", parent.id)
      .maybeSingle<{ id: string }>();
    if (normal.length > 0 && !existingChild) {
      const submitted = await submitAnalysisBatch(normal.map((row) => row.id), 2, { parentBatchDbId: parent.id });
      stage2Count += submitted.requestCount;
    }

    // 同期解析に失敗済みの案件を毎時再課金しない。失敗理由は案件側に残っている。
    const urgentToRun = urgent.filter((row) => row.failure_code === null);
    const urgentResult = await processUrgent(urgentToRun, now);
    urgentCount += urgentResult.analyzed;
    if (urgentResult.stopped) break;

    const { error: markError } = await client
      .from("analysis_batches")
      .update({ followup_completed_at: new Date().toISOString() })
      .eq("id", parent.id);
    if (markError) throw new Error(`第1段の引継ぎ完了を記録できません: ${markError.message}`);
  }
  return { urgent: urgentCount, stage2: stage2Count };
}

export type AnalysisBatchCycleSummary = {
  appliedBatches: number;
  urgentAnalyzed: number;
  stage1Requests: number;
  stage2Requests: number;
  waiting: boolean;
  budgetStopped: "daily" | "monthly" | null;
};

/** 1回ぶんだけ状態を進める。待ち合わせはせず、次の毎時実行が続きを拾う。 */
export async function runAnalysisBatchCycle(now: Date = new Date()): Promise<AnalysisBatchCycleSummary> {
  const urgentHours = positiveIntegerFromEnv(process.env.ANALYZE_URGENT_HOURS, DEFAULT_URGENT_HOURS);
  const batchLimit = positiveIntegerFromEnv(process.env.ANALYZE_BATCH_TENDER_LIMIT, DEFAULT_BATCH_TENDER_LIMIT);
  const appliedBatches = await advanceExistingBatches();
  const followup = await followUpStageOne(now, urgentHours);

  const budgetStopped = await budgetIsExceeded(now);
  if (budgetStopped) {
    return { appliedBatches, urgentAnalyzed: followup.urgent, stage1Requests: 0, stage2Requests: followup.stage2, waiting: false, budgetStopped };
  }

  const client = createServiceClient();
  const { count: active, error: activeError } = await client
    .from("analysis_batches")
    .select("id", { count: "exact", head: true })
    .in("status", ["in_progress", "ended"]);
  if (activeError) throw new Error(`稼働中バッチの件数を取得できません: ${activeError.message}`);
  const { count: awaiting, error: awaitingError } = await client
    .from("analysis_batches")
    .select("id", { count: "exact", head: true })
    .eq("stage", 1)
    .eq("status", "applied")
    .is("followup_completed_at", null);
  if (awaitingError) throw new Error(`引継ぎ待ちバッチの件数を取得できません: ${awaitingError.message}`);
  if ((active ?? 0) > 0 || (awaiting ?? 0) > 0) {
    return { appliedBatches, urgentAnalyzed: followup.urgent, stage1Requests: 0, stage2Requests: followup.stage2, waiting: true, budgetStopped: null };
  }

  const candidates = await loadCandidates(batchLimit, now);
  const { urgent, normal } = splitUrgentCandidates(candidates, now, urgentHours);
  const urgentResult = await processUrgent(urgent.filter((row) => row.failure_code === null), now);
  if (urgentResult.stopped) {
    return {
      appliedBatches,
      urgentAnalyzed: followup.urgent + urgentResult.analyzed,
      stage1Requests: 0,
      stage2Requests: followup.stage2,
      waiting: false,
      budgetStopped: await budgetIsExceeded(now),
    };
  }

  const budgetAfterUrgent = await budgetIsExceeded(now);
  if (budgetAfterUrgent) {
    return {
      appliedBatches,
      urgentAnalyzed: followup.urgent + urgentResult.analyzed,
      stage1Requests: 0,
      stage2Requests: followup.stage2,
      waiting: false,
      budgetStopped: budgetAfterUrgent,
    };
  }

  const submitted = await submitAnalysisBatch(normal.map((row) => row.id), 1);
  return {
    appliedBatches,
    urgentAnalyzed: followup.urgent + urgentResult.analyzed,
    stage1Requests: submitted.requestCount,
    stage2Requests: followup.stage2,
    waiting: submitted.requestCount > 0,
    budgetStopped: null,
  };
}
