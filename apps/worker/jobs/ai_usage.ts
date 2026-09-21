// AI API の原価台帳と予算停止。
// 日付の境界は日本時間で計算し、Railway が UTC で動いていても日次集計をずらさない。

import { estimateCostYen, type UsageSummary } from "@ai-nyusatsu-bu/ai";
import {
  aiBudgetFromValues,
  budgetExceeded,
  jstBudgetWindows,
  parseYenBudget,
  DEFAULT_AI_DAILY_BUDGET_YEN,
  DEFAULT_AI_MONTHLY_BUDGET_YEN,
  type AiBudget,
  type AiSpend,
} from "@ai-nyusatsu-bu/domain";
import type { Supabase } from "./analysis_shared";

export {
  budgetExceeded,
  jstBudgetWindows,
  parseYenBudget,
  DEFAULT_AI_DAILY_BUDGET_YEN,
  DEFAULT_AI_MONTHLY_BUDGET_YEN,
  type AiBudget,
  type AiSpend,
};

export type AiUsageEventInput = {
  tenderId?: string | null;
  orgId?: string | null;
  operation: string;
  executionMode?: "synchronous" | "batch";
  model: string;
  status: "succeeded" | "failed";
  usage: UsageSummary;
  /** Batch API の50%引きなど、通常料金に対する倍率。 */
  priceMultiplier?: number;
  detail?: Record<string, unknown>;
};

export function aiBudgetFromEnv(env: NodeJS.ProcessEnv = process.env): AiBudget {
  return aiBudgetFromValues(env);
}

async function spendBetween(client: Supabase, from: string, to: string): Promise<number> {
  const { data, error } = await client.rpc("ai_spend_between", { p_from: from, p_to: to });
  if (error) throw new Error(`AI原価の集計に失敗しました: ${error.message}`);
  const value = Number(data ?? 0);
  if (!Number.isFinite(value) || value < 0) throw new Error("AI原価の集計結果が不正です");
  return value;
}

export async function loadAiSpend(client: Supabase, now: Date): Promise<AiSpend> {
  const window = jstBudgetWindows(now);
  const [dailyYen, monthlyYen] = await Promise.all([
    spendBetween(client, window.dayFrom, window.dayTo),
    spendBetween(client, window.monthFrom, window.monthTo),
  ]);
  return { dailyYen, monthlyYen };
}

/** 台帳の失敗で解析を再実行すると二重課金になるため、記録失敗はログに残して解析結果は維持する。 */
export async function recordAiUsageEvent(client: Supabase, input: AiUsageEventInput): Promise<void> {
  const multiplier = input.priceMultiplier ?? 1;
  const estimatedCostYen = Math.round(estimateCostYen(input.usage) * multiplier);
  const { error } = await client.from("ai_usage_events").insert({
    tender_id: input.tenderId ?? null,
    org_id: input.orgId ?? null,
    operation: input.operation,
    execution_mode: input.executionMode ?? "synchronous",
    model: input.model,
    status: input.status,
    calls: input.usage.calls,
    input_tokens: input.usage.inputTokens,
    cache_creation_tokens: input.usage.cacheCreationTokens,
    cache_read_tokens: input.usage.cacheReadTokens,
    output_tokens: input.usage.outputTokens,
    billable_input_equivalent: input.usage.billableInputEquivalent,
    input_saving_rate: input.usage.inputSavingRate,
    estimated_cost_yen: estimatedCostYen,
    detail: input.detail ?? {},
  });
  if (error) {
    console.error(`[ai_usage] 原価台帳への記録に失敗しました（operation=${input.operation}）: ${error.message}`);
  }
}
