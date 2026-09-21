// 運営（本部）用の管理画面（タスク4-8）。利用状況・収集キュー。
//
// 【なぜ必要か】
// 収集が止まったことに気づけないのが最大のリスク（docs/本番環境_推奨構成.md）。
// 「どの案件の資料が取れていないか」「どの機関で空振りしているか」を見る場所を作る。
//
// 【顧客の画面ではない】
// 組織をまたいで見るため service_role で読む。requireAdmin が運営であることを
// 確かめたうえでクライアントを渡す（apps/web/lib/admin.ts）。
//
// 【取れていないことを隠さない】
// CLAUDE.md 最重要の前提7。対応が要るものを先に、対応不要なものは件数だけ出す。

import Link from "next/link";
import {
  accessSummary,
  aiBudgetFromValues,
  elapsedLabel,
  evaluateCoverage,
  groupCollectionIssues,
  jstBudgetWindows,
  LAYOUT_CHANGED_ALERT_HOURS,
  stalledIssues,
  suspendedOrgs,
  workerHealth,
  type CollectionIssue,
  type CoverageAgency,
  type OrgAccessRow,
} from "@ai-nyusatsu-bu/domain";
import { Panel, Pill } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";

/** 一覧に出す件数の上限。全部出すと本当に直すべきものが埋もれる。 */
const LIST_LIMIT = 20;

type TenderRow = {
  id: string;
  name: string;
  documents_failure_code: string | null;
  documents_failure_reason: string | null;
  documents_checked_at: string | null;
  failure_code: string | null;
  failure_reason: string | null;
  updated_at: string | null;
  agencies: { name: string } | { name: string }[] | null;
};

type AgencyRow = {
  id: string;
  name: string;
  expected_freq: string | null;
  last_success_at: string | null;
  sources: { connector?: string }[] | null;
};

type AccessRow = {
  org_id: string;
  status: string;
  suspended_at: string | null;
  suspended_reason: string | null;
  organizations: { name: string } | { name: string }[] | null;
};

type AiUsageSummaryRow = {
  execution_mode: string;
  status: string;
  event_count: number | string;
  calls: number | string;
  estimated_cost_yen: number | string;
  input_tokens: number | string;
  cache_read_tokens: number | string;
  output_tokens: number | string;
};

type RecentAiUsageRow = {
  id: string;
  tender_id: string | null;
  operation: string;
  execution_mode: string;
  status: string;
  calls: number;
  estimated_cost_yen: number;
  occurred_at: string;
  tenders: { name: string } | { name: string }[] | null;
};

type AiUsageDashboard = {
  available: boolean;
  dailyYen: number;
  monthlyYen: number;
  dailyBudgetYen: number;
  monthlyBudgetYen: number;
  summary: AiUsageSummaryRow[];
  recent: RecentAiUsageRow[];
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function jst(at: string | null): string {
  if (at === null) return "—";
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function yen(value: number): string {
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

function budgetPercent(spend: number, budget: number): number | null {
  if (budget <= 0) return null;
  return Math.round((spend / budget) * 100);
}

function budgetTone(percent: number | null): "green" | "amber" | "rose" | "slate" {
  if (percent === null) return "slate";
  if (percent >= 100) return "rose";
  if (percent >= 80) return "amber";
  return "green";
}

export default async function AdminPage() {
  const { admin } = await requireAdmin();
  const now = new Date();

  const [issues, access, coverage, heartbeat, aiUsage] = await Promise.all([
    loadIssues(admin),
    loadAccess(admin),
    loadCoverage(admin),
    loadHeartbeat(admin),
    loadAiUsage(admin, now),
  ]);

  // 【いちばん上に出す】
  // 2026-09-03 にワーカーが落ち、6日間だれも気づかなかった。
  // 収集キューが空でも、それは「問題が無い」ではなく「何も動いていない」かもしれない。
  // 下の数字を読む前に、そもそも動いているかが分かる場所に置く。
  const worker = workerHealth(heartbeat?.beat_at ?? null, now);

  const groups = groupCollectionIssues(issues);
  const stalled = stalledIssues(groups, now);
  const summary = accessSummary(access);
  const suspended = suspendedOrgs(access);
  const coverageResult = evaluateCoverage(coverage, now);

  return (
    <>

      <Panel
        title="ワーカーの稼働"
        right={
          <Pill tone={worker.state === "正常" ? "green" : worker.state === "遅れています" ? "amber" : "rose"}>
            {worker.state}
          </Pill>
        }
      >
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xs text-slate-700">
            最終稼働：<span className="font-medium">{elapsedLabel(worker.minutesAgo)}</span>
          </span>
          {heartbeat?.jobs != null && <span className="text-xs text-slate-500">登録ジョブ {heartbeat.jobs}件</span>}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">{worker.detail}</p>
        {/* 【収集キューが空でも安心しない】
            ワーカーが止まっていれば、失敗も記録されない。空に見えるだけ */}
        {worker.state !== "正常" && (
          <p className="mt-1 text-xs leading-relaxed text-rose-800">
            この状態では、下の「収集キュー」が空でも安心できません。失敗そのものが記録されないためです。
          </p>
        )}
      </Panel>

      <Panel
        title="AI解析原価"
        right={
          aiUsage.available ? (
            <Pill tone={budgetTone(budgetPercent(aiUsage.monthlyYen, aiUsage.monthlyBudgetYen))}>
              {budgetPercent(aiUsage.monthlyYen, aiUsage.monthlyBudgetYen) === null
                ? "今月 上限なし"
                : `今月 ${budgetPercent(aiUsage.monthlyYen, aiUsage.monthlyBudgetYen)}%`}
            </Pill>
          ) : <Pill tone="slate">未計測</Pill>
        }
      >
        {!aiUsage.available ? (
          <p className="text-xs text-slate-500">
            AI原価台帳をまだ読めません。DBマイグレーション適用後に、日次・月次の費用が表示されます。
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <BudgetCard label="本日（日本時間）" spend={aiUsage.dailyYen} budget={aiUsage.dailyBudgetYen} />
              <BudgetCard label="今月（日本時間）" spend={aiUsage.monthlyYen} budget={aiUsage.monthlyBudgetYen} />
            </div>

            <div>
              <p className="text-xs font-medium text-slate-700">今月の内訳</p>
              {aiUsage.summary.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">今月のAI解析実績はありません。</p>
              ) : (
                <div className="mt-1 overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="py-1 pr-3 font-medium">方式</th>
                        <th className="py-1 pr-3 font-medium">結果</th>
                        <th className="py-1 pr-3 text-right font-medium">処理</th>
                        <th className="py-1 pr-3 text-right font-medium">API呼出</th>
                        <th className="py-1 pr-3 text-right font-medium">キャッシュ読取</th>
                        <th className="py-1 text-right font-medium">概算原価</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {aiUsage.summary.map((row) => (
                        <tr key={`${row.execution_mode}:${row.status}`}>
                          <td className="py-1.5 pr-3">{row.execution_mode === "batch" ? "バッチ" : "即時"}</td>
                          <td className="py-1.5 pr-3">{row.status === "succeeded" ? "成功" : "失敗"}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{Number(row.event_count).toLocaleString("ja-JP")}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{Number(row.calls).toLocaleString("ja-JP")}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{Number(row.cache_read_tokens).toLocaleString("ja-JP")}</td>
                          <td className="py-1.5 text-right font-medium tabular-nums">{yen(Number(row.estimated_cost_yen))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {aiUsage.recent.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-700">今月の高原価処理</p>
                <ul className="mt-1 space-y-1">
                  {aiUsage.recent.map((row) => (
                    <li key={row.id} className="text-xs text-slate-600">
                      ・{row.tender_id ? (
                        <Link href={`/tenders/${row.tender_id}`} className="underline">
                          {one(row.tenders)?.name ?? "案件を開く"}
                        </Link>
                      ) : "案件外処理"}
                      <span className="ml-1 text-slate-400">{row.operation}／{row.execution_mode === "batch" ? "バッチ" : "即時"}</span>
                      <span className="ml-1 font-medium tabular-nums text-slate-700">{yen(row.estimated_cost_yen)}</span>
                      <span className="ml-1 text-slate-400">{jst(row.occurred_at)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-slate-400">
              円換算はAPI応答時点の概算。上限値はWebとワーカーの環境変数を同じ値に設定してください。
            </p>
          </div>
        )}
      </Panel>

      {stalled.length > 0 && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2">
          <p className="text-xs text-rose-900">
            {LAYOUT_CHANGED_ALERT_HOURS}時間以上直っていない失敗が{stalled.length}件あります。
            該当する機関は「取得できていない」状態が続いています。
          </p>
        </div>
      )}

      <Panel title="収集キュー（対応が必要なもの）">
        {groups.length === 0 ? (
          <p className="text-xs text-slate-500">対応が必要な失敗はありません。</p>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group.code}>
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={group.priority === 1 ? "rose" : group.needsHuman ? "amber" : "slate"}>{group.code}</Pill>
                  <span className="text-xs font-medium text-slate-700">{group.label}</span>
                  <span className="text-xs text-slate-500">{group.issues.length}件</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{group.action}</p>
                {group.needsHuman && (
                  <ul className="mt-1.5 space-y-1">
                    {group.issues.slice(0, LIST_LIMIT).map((issue) => (
                      <li key={`${issue.tenderId}:${issue.failureCode}`} className="text-xs text-slate-600">
                        ・{issue.agencyName}／{issue.tenderName}
                        {issue.failureReason && <span className="text-slate-400">（{issue.failureReason}）</span>}
                        <span className="ml-1 text-slate-400">{jst(issue.at)}</span>
                      </li>
                    ))}
                    {group.issues.length > LIST_LIMIT && (
                      <li className="text-xs text-slate-400">ほか{group.issues.length - LIST_LIMIT}件</li>
                    )}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="発注機関のカバレッジ">
        <div className="flex flex-wrap gap-3 text-xs text-slate-600">
          <span>
            正常 <span className="font-semibold tabular-nums">{coverageResult.healthy}</span> / {coverageResult.checked}
          </span>
          <span>
            欠測・未取得 <span className="font-semibold tabular-nums">{coverageResult.missing.length}</span>
          </span>
          <span>
            遅延 <span className="font-semibold tabular-nums">{coverageResult.delayed.length}</span>
          </span>
          <span className="text-slate-400">
            巡回未実装 <span className="font-semibold tabular-nums">{coverageResult.notImplemented.length}</span>
          </span>
        </div>

        {/* 取れていないことを隠さない（CLAUDE.md 最重要の前提7）。対応が要るものから並べる */}
        {[...coverageResult.missing, ...coverageResult.delayed].length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">対応が必要な機関はありません。</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {[...coverageResult.missing, ...coverageResult.delayed].slice(0, LIST_LIMIT).map((r) => (
              <li key={r.id} className="text-xs text-slate-600">
                ・{r.name}
                <span className="ml-1 text-amber-700">{r.status}</span>
                <span className="ml-1 text-slate-400">最後の取得 {jst(r.lastSuccessAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="利用状況">
        {/* 支払いは請求書払いのみ。実際に使えるかを決めているのは org_access だけで、
            subscriptions（Stripe）はいま何も止めていない。混乱を避けるため、ここでは
            org_access だけを見る（apps/web/app/billing/page.tsx と同じ根拠） */}
        <div className="flex flex-wrap gap-3 text-xs text-slate-600">
          <span>
            利用中 <span className="font-semibold tabular-nums">{summary.active}</span>
          </span>
          <span>
            停止 <span className="font-semibold tabular-nums">{summary.suspended}</span>
          </span>
          <span className="text-slate-400">お支払いは請求書払い（銀行振込）のみ</span>
        </div>

        {suspended.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">停止中の組織はありません。</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {suspended.slice(0, LIST_LIMIT).map((row) => (
              <li key={row.orgId} className="text-xs text-slate-700">
                ・{row.orgName}
                {row.suspendedReason && <span className="ml-1 text-amber-700">{row.suspendedReason}</span>}
                {row.suspendedAt && <span className="ml-1 text-slate-400">{jst(row.suspendedAt)}</span>}
              </li>
            ))}
            {suspended.length > LIST_LIMIT && (
              <li className="text-xs text-slate-400">ほか{suspended.length - LIST_LIMIT}件</li>
            )}
          </ul>
        )}

        <p className="mt-2 text-xs text-slate-400">
          発行・停止・再開は <Link href="/admin/accounts" className="underline">アカウント</Link> から行う。
        </p>
      </Panel>
    </>
  );
}

function BudgetCard({ label, spend, budget }: { label: string; spend: number; budget: number }) {
  const percent = budgetPercent(spend, budget);
  const width = percent === null ? 0 : Math.min(percent, 100);
  const color = percent !== null && percent >= 100 ? "bg-rose-500" : percent !== null && percent >= 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="rounded border border-slate-200 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-slate-500">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-slate-800">{yen(spend)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100">
        <div className={`h-full rounded ${color}`} style={{ width: `${width}%` }} />
      </div>
      <p className="mt-1 text-right text-xs text-slate-400">
        {budget === 0 ? "上限なし" : `上限 ${yen(budget)}（${percent}%）`}
      </p>
    </div>
  );
}

/**
 * 資料の取得とAI解析の失敗を集める。
 * どちらも別の軸（documents_failure_code / failure_code）なので両方を見る。
 */
type Admin = Awaited<ReturnType<typeof requireAdmin>>["admin"];

async function loadIssues(admin: Admin): Promise<CollectionIssue[]> {
  const { data, error } = await admin
    .from("tenders")
    .select(
      "id, name, documents_failure_code, documents_failure_reason, documents_checked_at, failure_code, failure_reason, updated_at, agencies(name)",
    )
    .or("documents_failure_code.not.is.null,failure_code.not.is.null")
    .neq("collect_status", "終了")
    .order("updated_at", { ascending: false })
    .limit(500)
    .returns<TenderRow[]>();
  if (error) {
    // 画面は出す。握りつぶさずログに残す
    console.error(`[admin] 収集キューの取得に失敗しました: ${error.message}`);
    return [];
  }

  const issues: CollectionIssue[] = [];
  for (const row of data ?? []) {
    const agencyName = one(row.agencies)?.name ?? "（機関不明）";
    if (row.documents_failure_code) {
      issues.push({
        tenderId: row.id,
        tenderName: row.name,
        agencyName,
        failureCode: row.documents_failure_code,
        failureReason: row.documents_failure_reason,
        at: row.documents_checked_at ?? row.updated_at,
      });
    }
    if (row.failure_code) {
      issues.push({
        tenderId: row.id,
        tenderName: row.name,
        agencyName,
        failureCode: row.failure_code,
        failureReason: row.failure_reason,
        at: row.updated_at,
      });
    }
  }
  return issues;
}

async function loadAccess(admin: Admin): Promise<OrgAccessRow[]> {
  const { data, error } = await admin
    .from("org_access")
    .select("org_id, status, suspended_at, suspended_reason, organizations(name)")
    .returns<AccessRow[]>();
  if (error) {
    console.error(`[admin] 利用状況の取得に失敗しました: ${error.message}`);
    return [];
  }
  return (data ?? []).map((row) => ({
    orgId: row.org_id,
    orgName: one(row.organizations)?.name ?? "（組織名不明）",
    status: row.status,
    suspendedAt: row.suspended_at,
    suspendedReason: row.suspended_reason,
  }));
}

async function loadCoverage(admin: Admin): Promise<CoverageAgency[]> {
  const { data, error } = await admin
    .from("agencies")
    .select("id, name, expected_freq, last_success_at, sources")
    .eq("active", true)
    .returns<AgencyRow[]>();
  if (error) {
    console.error(`[admin] 発注機関の取得に失敗しました: ${error.message}`);
    return [];
  }
  // DBは snake_case、ドメインは camelCase。ここで詰め替える
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    expectedFreq: row.expected_freq,
    lastSuccessAt: row.last_success_at,
    connectors: (row.sources ?? [])
      .map((src) => src.connector)
      .filter((connector): connector is string => typeof connector === "string"),
  }));
}

/**
 * ワーカーが生きている合図。1行しかない。
 *
 * 読めなくても運営画面は開けるようにする（握りつぶさずログには残す）。
 * ここで例外を投げると、ワーカーが止まっているときに限って
 * 運営画面まで開けなくなる。いちばん見たいときに見られなくなる。
 */
async function loadHeartbeat(
  admin: Awaited<ReturnType<typeof requireAdmin>>["admin"],
): Promise<{ beat_at: string; jobs: number } | null> {
  const { data, error } = await admin
    .from("worker_heartbeats")
    .select("beat_at, jobs")
    .eq("id", "worker")
    .maybeSingle<{ beat_at: string; jobs: number }>();
  if (error) {
    console.error("[admin] ワーカーの稼働を読めませんでした", error);
    return null;
  }
  return data ?? null;
}

async function loadAiUsage(admin: Admin, now: Date): Promise<AiUsageDashboard> {
  const window = jstBudgetWindows(now);
  const budget = aiBudgetFromValues(process.env);
  const [daily, monthly, summary, recent] = await Promise.all([
    admin.rpc("ai_spend_between", { p_from: window.dayFrom, p_to: window.dayTo }),
    admin.rpc("ai_spend_between", { p_from: window.monthFrom, p_to: window.monthTo }),
    admin.rpc("ai_usage_summary_between", { p_from: window.monthFrom, p_to: window.monthTo }),
    admin
      .from("ai_usage_events")
      .select("id, tender_id, operation, execution_mode, status, calls, estimated_cost_yen, occurred_at, tenders(name)")
      .gte("occurred_at", window.monthFrom)
      .lt("occurred_at", window.monthTo)
      .order("estimated_cost_yen", { ascending: false })
      .limit(5)
      .returns<RecentAiUsageRow[]>(),
  ]);
  const error = daily.error ?? monthly.error ?? summary.error;
  if (error) {
    console.error(`[admin] AI原価台帳を読めませんでした: ${error.message}`);
    return {
      available: false,
      dailyYen: 0,
      monthlyYen: 0,
      dailyBudgetYen: budget.dailyYen,
      monthlyBudgetYen: budget.monthlyYen,
      summary: [],
      recent: [],
    };
  }
  if (recent.error) console.error(`[admin] AI原価の高額処理を読めませんでした: ${recent.error.message}`);
  return {
    available: true,
    dailyYen: Number(daily.data ?? 0),
    monthlyYen: Number(monthly.data ?? 0),
    dailyBudgetYen: budget.dailyYen,
    monthlyBudgetYen: budget.monthlyYen,
    summary: (summary.data ?? []) as AiUsageSummaryRow[],
    recent: recent.error ? [] : (recent.data ?? []),
  };
}
