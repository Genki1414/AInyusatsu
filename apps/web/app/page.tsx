// 今日やること（ホーム）。docs/ai-nyusatsu-bu-prototype-v7.jsx の HomeView 相当。
//
// プロトタイプのHomeViewは「承認待ち」「協力会社からの返信」「AIの稼働ログ」も持つが、
// これらは見積依頼の下書き作成・返信受信・活動ログ（タスク4系）が無いと実データが無いため、
// このタスク（3-3）では初期設定チェックリストと期限ボードのみを実装する。
import { Compass } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Panel, Pill, ProposePill } from "@/components/ui";
import { requireOrgContext } from "@/lib/auth";
import { evaluateCoverage, type CoverageAgency } from "@ai-nyusatsu-bu/domain";

type ProposalDeadlineRow = {
  id: string;
  status: string;
  tenders: {
    id: string;
    name: string;
    qa_deadline: string | null;
    submit_deadline: string | null;
    bid_open_at: string | null;
    collect_status: string;
  } | null;
};

type AgencyRow = {
  id: string;
  name: string;
  expected_freq: string | null;
  last_success_at: string | null;
  parent_id: string | null;
};

function daysLeft(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
}

export default async function HomePage() {
  const { supabase, orgId, orgName } = await requireOrgContext();
  const now = new Date();

  const [
    { data: profile },
    { count: criteriaCount },
    { count: partnerCount },
    { count: consideringCount },
    { data: proposalRows },
    { data: agencyRows },
  ] =
    await Promise.all([
      supabase.from("company_profiles").select("qual_categories").eq("org_id", orgId).maybeSingle<{ qual_categories: string[] }>(),
      supabase.from("criteria_sets").select("id", { count: "exact", head: true }),
      supabase.from("partners").select("id", { count: "exact", head: true }),
      supabase.from("proposals").select("id", { count: "exact", head: true }).eq("status", "検討中"),
      supabase
        .from("proposals")
        .select("id, status, tenders(id, name, qa_deadline, submit_deadline, bid_open_at, collect_status)")
        .neq("status", "対象外")
        .returns<ProposalDeadlineRow[]>(),
      // 取れていないことを隠さない（CLAUDE.md 最重要の前提7）。機関ごとの収集状況を出す
      supabase
        .from("agencies")
        .select("id, name, expected_freq, last_success_at, parent_id")
        .eq("active", true)
        .returns<AgencyRow[]>(),
    ]);

  // 公告を出す単位（子を持たない機関）だけを数える（機関マスタ_v2.md §4「葉ノード基準」）
  const agencies = agencyRows ?? [];
  const hasChild = new Set(agencies.map((a) => a.parent_id).filter((id): id is string => id !== null));
  const coverage = evaluateCoverage(
    agencies
      .filter((a) => !hasChild.has(a.id))
      .map((a): CoverageAgency => ({
        id: a.id,
        name: a.name,
        expectedFreq: a.expected_freq,
        lastSuccessAt: a.last_success_at,
      })),
    now,
  );

  const setupSteps = [
    { label: "入札資格を確認する", done: (profile?.qual_categories?.length ?? 0) > 0 },
    { label: "ほしい案件の条件を決める", done: (criteriaCount ?? 0) > 0 },
    { label: "協力会社を登録する", done: (partnerCount ?? 0) > 0 },
    { label: "最初の案件を進めてみる", done: (consideringCount ?? 0) > 0 },
  ];
  const setupLeft = setupSteps.filter((s) => !s.done);

  // 提出期限を過ぎた案件（終了）は「今日やること」に出さない。もう手の打ちようがない。
  const livePropos = (proposalRows ?? []).filter((p) => p.tenders && p.tenders.collect_status !== "終了");

  const deadlines: { tenderId: string; name: string; kind: string; tone: "violet" | "blue" | "slate"; d: number }[] = [];
  for (const p of livePropos) {
    if (!p.tenders) continue;
    const t = p.tenders;
    const qa = daysLeft(t.qa_deadline, now);
    if (qa != null && qa >= 0) deadlines.push({ tenderId: t.id, name: t.name, kind: "質問期限", tone: "violet", d: qa });
    const submit = daysLeft(t.submit_deadline, now);
    if (submit != null && submit >= 0) deadlines.push({ tenderId: t.id, name: t.name, kind: "提出期限", tone: "blue", d: submit });
    const bidOpen = daysLeft(t.bid_open_at, now);
    if (bidOpen != null && bidOpen >= 0) deadlines.push({ tenderId: t.id, name: t.name, kind: "開札", tone: "slate", d: bidOpen });
  }
  deadlines.sort((a, b) => a.d - b.d);

  const activeCount = livePropos.length;
  const consideringRows = livePropos.filter((p) => p.status === "検討中");

  return (
    <AppShell active="home" orgName={orgName}>
      {setupLeft.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
          <Compass size={14} className="shrink-0 text-blue-800" />
          <p className="text-xs text-blue-900">
            初期設定があと {setupLeft.length}件 残っています（{setupLeft.map((x) => x.label).join("／")}）。
          </p>
        </div>
      )}

      <Panel title="今日やること">
        <p className="text-xs leading-relaxed text-slate-700">
          現在、参加を検討できる案件が<span className="font-semibold">{activeCount}件</span>あります。
        </p>
        <div className="mt-3 grid grid-cols-2 divide-x divide-slate-100 rounded border border-slate-200 sm:grid-cols-3">
          {[
            { l: "提案されている案件", v: activeCount },
            { l: "検討中の案件", v: consideringRows.length },
            { l: "3日以内の期限", v: deadlines.filter((x) => x.d <= 3).length },
          ].map((s) => (
            <div key={s.l} className="px-3 py-2 text-left">
              <div className="text-xs text-slate-500">{s.l}</div>
              <div className={`text-lg font-semibold tabular-nums ${s.v > 0 ? "text-slate-900" : "text-slate-300"}`}>{s.v}</div>
            </div>
          ))}
        </div>
      </Panel>

      {coverage.checked > 0 && (
        <Panel title={`案件の収集状況（${coverage.healthy}/${coverage.checked}機関）`}>
          {coverage.missing.length === 0 && coverage.delayed.length === 0 ? (
            <p className="text-xs text-slate-600">監視している発注機関はすべて、想定どおりの間隔で取得できています。</p>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-slate-600">
                下の機関は想定した間隔で取得できていません。これらの機関の案件は、
                <span className="font-semibold">出ていないのではなく、こちらで取れていない</span>可能性があります。
              </p>
              <ul className="mt-2 space-y-1">
                {[...coverage.missing, ...coverage.delayed].slice(0, 8).map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <Pill tone={a.status === "遅延" ? "amber" : "rose"}>{a.status}</Pill>
                    <span className="font-medium text-slate-800">{a.name}</span>
                    <span className="text-slate-500">
                      想定 {a.expectedFreq}
                      {a.daysSince === null ? "／一度も取得できていません" : `／最終取得から${Math.floor(a.daysSince)}日`}
                    </span>
                  </li>
                ))}
              </ul>
              {coverage.missing.length + coverage.delayed.length > 8 && (
                <p className="mt-2 text-xs text-slate-500">
                  ほか{coverage.missing.length + coverage.delayed.length - 8}機関
                </p>
              )}
            </>
          )}
        </Panel>
      )}

      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <Panel title="検討中の案件" dense right={<Link href="/proposals" className="text-xs text-blue-800 underline">すべて見る</Link>}>
          {consideringRows.length === 0 ? (
            <p className="p-3 text-xs text-slate-500">ありません。まずは提案された案件をご覧ください。</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {consideringRows.map((p) =>
                p.tenders ? (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 p-3">
                    <Link href={`/tenders/${p.tenders.id}`} className="text-xs font-semibold hover:underline">
                      {p.tenders.name}
                    </Link>
                    <ProposePill s={p.status} />
                  </li>
                ) : null,
              )}
            </ul>
          )}
        </Panel>

        <Panel title="期限ボード" right={<span className="text-xs text-slate-400">近い順</span>}>
          {deadlines.length === 0 ? (
            <p className="text-xs text-slate-500">近い期限はありません。</p>
          ) : (
            <ul className="space-y-2">
              {deadlines.slice(0, 8).map((x, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${x.d <= 2 ? "bg-rose-500" : x.d <= 5 ? "bg-amber-500" : "bg-slate-300"}`} />
                  <Pill tone={x.tone}>{x.kind}</Pill>
                  <Link href={`/tenders/${x.tenderId}`} className="truncate text-xs hover:underline">
                    {x.name}
                  </Link>
                  <span className={`ml-auto text-xs tabular-nums ${x.d <= 2 ? "font-semibold text-rose-700" : "text-slate-500"}`}>
                    残{x.d}日
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
