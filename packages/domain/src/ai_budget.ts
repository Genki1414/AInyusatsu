// AI原価の予算値と日本時間の集計窓。ワーカーの停止判定と管理画面で共用する。

export const DEFAULT_AI_DAILY_BUDGET_YEN = 7_500;
export const DEFAULT_AI_MONTHLY_BUDGET_YEN = 200_000;

export type AiBudget = { dailyYen: number; monthlyYen: number };
export type AiSpend = { dailyYen: number; monthlyYen: number };

/** 0は上限なし。未設定・不正値は安全な既定値に戻す。 */
export function parseYenBudget(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function aiBudgetFromValues(values: Record<string, string | undefined>): AiBudget {
  return {
    dailyYen: parseYenBudget(values.AI_DAILY_BUDGET_YEN, DEFAULT_AI_DAILY_BUDGET_YEN),
    monthlyYen: parseYenBudget(values.AI_MONTHLY_BUDGET_YEN, DEFAULT_AI_MONTHLY_BUDGET_YEN),
  };
}

/** 日本時間の日初・翌日初・月初・翌月初をUTCのISO文字列で返す。 */
export function jstBudgetWindows(now: Date): {
  dayFrom: string;
  dayTo: string;
  monthFrom: string;
  monthTo: string;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d) - JST_OFFSET_MS).toISOString();
  return {
    dayFrom: utc(year, month, day),
    dayTo: utc(year, month, day + 1),
    monthFrom: utc(year, month, 1),
    monthTo: utc(year, month + 1, 1),
  };
}

export function budgetExceeded(budget: AiBudget, spend: AiSpend): "daily" | "monthly" | null {
  if (budget.dailyYen > 0 && spend.dailyYen >= budget.dailyYen) return "daily";
  if (budget.monthlyYen > 0 && spend.monthlyYen >= budget.monthlyYen) return "monthly";
  return null;
}
