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
  evaluateCoverage,
  groupCollectionIssues,
  LAYOUT_CHANGED_ALERT_HOURS,
  stalledIssues,
  suspendedOrgs,
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

export default async function AdminPage() {
  const { email, admin } = await requireAdmin();
  const now = new Date();

  const [issues, access, coverage] = await Promise.all([
    loadIssues(admin),
    loadAccess(admin),
    loadCoverage(admin),
  ]);

  const groups = groupCollectionIssues(issues);
  const stalled = stalledIssues(groups, now);
  const summary = accessSummary(access);
  const suspended = suspendedOrgs(access);
  const coverageResult = evaluateCoverage(coverage, now);

  return (
    <div className="mx-auto max-w-5xl space-y-3 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-sm font-semibold text-slate-800">運営</h1>
        <Link href="/admin/accounts" className="text-xs text-slate-500 underline hover:text-slate-700">
          アカウント
        </Link>
        <span className="ml-auto text-xs text-slate-400">{email}</span>
      </header>

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
