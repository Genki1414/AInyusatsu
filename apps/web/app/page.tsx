// 今日やること（ホーム）。docs/ai-nyusatsu-bu-prototype-v7.jsx の HomeView 相当。
//
// プロトタイプのHomeViewは「承認待ち」「協力会社からの返信」「AIの稼働ログ」も持つが、
// これらは見積依頼の下書き作成・返信受信・活動ログ（タスク4系）が無いと実データが無いため、
// 初期設定チェックリストと期限ボードから実装した（タスク3-3）。
//
// 【2026-10-17】「今日やること」が件数3つだけで、何をすればよいか書いていなかった
// （ユーザー要望）。案件ごとの段取り（buildRoadmap）が出している「いま」を並べる形に変えた。
// 件数は数えられても手は動かないので、作業名・期限・飛び先を1行ずつ出す。
import { ChevronRight, Compass } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Panel, Pill, ProposePill, StancePill } from "@/components/ui";
import { requireOrgContext } from "@/lib/auth";
import {
  buildChecklist,
  checklistProgress,
  daysUntilDeadline,
  deadlineDate,
  evaluateCoverage,
  isTenderStance,
  remainingText,
  todayTasks,
  type ChecklistForm,
  type CoverageAgency,
  type FormState,
  type TodayTask,
  type TodayTaskSource,
} from "@ai-nyusatsu-bu/domain";

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

/** 自分で「参加」「検討」と決めた案件。やることはここから出す */
type StanceRow = {
  tender_id: string;
  stance: string;
  official_status: string;
  work_status: string;
  bid_price: number | null;
  roadmap_done: string[] | null;
  tenders: {
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
  sources: { connector?: string }[] | null;
  parent_id: string | null;
};

/** 残り日数は全画面で共通の数え方（packages/domain/src/deadline.ts）。 */
function daysLeft(iso: string | null, now: Date): number | null {
  return daysUntilDeadline(iso, now);
}

export default async function HomePage() {
  const { supabase, orgId, orgName, userName } = await requireOrgContext();
  const now = new Date();

  const [
    { data: profile },
    { count: criteriaCount },
    { count: partnerCount },
    { count: consideringCount },
    { data: proposalRows },
    { data: agencyRows },
    { data: stanceRows },
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
        .select("id, name, expected_freq, last_success_at, sources, parent_id")
        .eq("active", true)
        .returns<AgencyRow[]>(),
      // 「今日やること」の素。利用者が自分で決めた案件だけを見る。
      // 保留・見送り・未定に「やること」は無いので引かない
      supabase
        .from("company_tenders")
        .select(
          "tender_id, stance, official_status, work_status, bid_price, roadmap_done, tenders(name, qa_deadline, submit_deadline, bid_open_at, collect_status)",
        )
        .eq("org_id", orgId)
        .in("stance", ["参加", "検討"])
        .returns<StanceRow[]>(),
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
        connectors: (a.sources ?? []).map((s) => s.connector).filter((c): c is string => typeof c === "string"),
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

  // ── 今日やること ──────────────────────────────────────────
  //
  // 件数だけでは何をすればよいか分からないので、案件ごとの段取り（buildRoadmap）が
  // 出している「いま」をそのまま並べる。**案件ページと同じ関数を通す。**
  // ここで別の計算をすると、ホームと案件ページが違うことを言い出す。
  //
  // 終了した案件は出さない。もう手の打ちようがない。
  const liveStances = (stanceRows ?? []).filter((r) => r.tenders && r.tenders.collect_status !== "終了");
  const stanceTenderIds = liveStances.map((r) => r.tender_id);

  // 段取りの判定に要る記録を、案件をまとめて1回で引く（案件ごとに引くと件数ぶん往復する）
  const [{ data: sentQuoteRows }, { data: formRows }, { data: formStateRows }] = stanceTenderIds.length
    ? await Promise.all([
        supabase.from("quote_requests").select("tender_id").in("tender_id", stanceTenderIds).not("sent_at", "is", null)
          .returns<{ tender_id: string }[]>(),
        supabase.from("tender_forms").select("id, tender_id, name, source, required, note").in("tender_id", stanceTenderIds)
          .returns<(ChecklistForm & { tender_id: string })[]>(),
        supabase.from("company_tender_forms").select("tender_id, form_id, state").in("tender_id", stanceTenderIds)
          .returns<{ tender_id: string; form_id: string; state: FormState }[]>(),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const quoteRequestedIds = new Set((sentQuoteRows ?? []).map((r) => r.tender_id));
  const formStatesByTender = new Map<string, Record<string, FormState>>();
  for (const row of formStateRows ?? []) {
    const states = formStatesByTender.get(row.tender_id) ?? {};
    states[row.form_id] = row.state;
    formStatesByTender.set(row.tender_id, states);
  }
  const formsByTender = new Map<string, ChecklistForm[]>();
  for (const row of formRows ?? []) {
    formsByTender.set(row.tender_id, [...(formsByTender.get(row.tender_id) ?? []), row]);
  }
  /** 提出書類がすべて用意できたか。案件ページ（FormsTab）と同じ判定を通す */
  function formsReady(tenderId: string): boolean {
    const forms = formsByTender.get(tenderId);
    if (!forms?.length) return false;
    return checklistProgress(buildChecklist(forms, formStatesByTender.get(tenderId) ?? {})).canSubmit;
  }

  const tasks = todayTasks(
    liveStances.flatMap((row): TodayTaskSource[] => {
      if (!row.tenders || !isTenderStance(row.stance)) return [];
      return [
        {
          tenderId: row.tender_id,
          tenderName: row.tenders.name,
          stance: row.stance,
          roadmap: {
            checkedSteps: row.roadmap_done ?? [],
            officialStatus: row.official_status,
            quoteRequested: quoteRequestedIds.has(row.tender_id),
            // 返信の有無は段取りの判定に使っていない（案件ページも false で渡している）
            quoteReceived: false,
            bidPriceDecided: row.bid_price !== null,
            formsReady: formsReady(row.tender_id),
            submitted: row.work_status === "提出済",
            qaDeadline: row.tenders.qa_deadline,
            submitDeadline: row.tenders.submit_deadline,
            bidOpenAt: row.tenders.bid_open_at,
          },
        },
      ];
    }),
    now,
  );

  return (
    <AppShell active="home" orgName={orgName} userName={userName}>
      {setupLeft.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
          <Compass size={14} className="shrink-0 text-blue-800" />
          <p className="text-xs text-blue-900">
            初期設定があと {setupLeft.length}件 残っています（{setupLeft.map((x) => x.label).join("／")}）。
          </p>
        </div>
      )}

      <Panel
        title={tasks.length > 0 ? `今日やること（${tasks.length}件）` : "今日やること"}
        dense
        right={tasks.length > 0 ? <span className="text-xs text-slate-400">急ぐ順</span> : undefined}
      >
        {tasks.length === 0 ? (
          <div className="space-y-2 p-3">
            <p className="text-xs leading-relaxed text-slate-600">
              {liveStances.length === 0
                ? "いま手を動かす案件はありません。提案された案件を見て、参加するか決めてください。"
                : "進めている案件の段取りは、いまのところすべて済んでいます。"}
            </p>
            <Link href="/proposals" className="inline-block text-xs text-blue-800 underline">
              提案された案件を見る（{activeCount}件）
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tasks.slice(0, 8).map((task) => (
              <TaskRow key={task.tenderId} task={task} />
            ))}
          </ul>
        )}
        {tasks.length > 8 && (
          <div className="border-t border-slate-100 px-3 py-2">
            {/* 一覧の絞り込みは判断を1つしか選べないので、参加と検討が混ざるここからは全体へ送る */}
            <Link href="/tenders" className="text-xs text-blue-800 underline">
              ほか{tasks.length - 8}件（案件一覧で見る）
            </Link>
          </div>
        )}
      </Panel>

      {coverage.checked > 0 && (
        <Panel title={`案件の収集状況（${coverage.healthy}/${coverage.checked}機関）`}>
          {coverage.missing.length === 0 && coverage.delayed.length === 0 ? (
            <p className="text-xs text-slate-600">巡回している発注機関はすべて、想定どおりの間隔で取得できています。</p>
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

          {coverage.notImplemented.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="text-xs leading-relaxed text-slate-600">
                次の{coverage.notImplemented.length}機関は、まだ巡回の仕組みを用意できていません（障害ではありません）。
                これらの機関の案件は、官公需情報ポータルや調達ポータルに載ったぶんだけが入っています。
              </p>
              <ul className="mt-2 flex flex-wrap gap-1">
                {coverage.notImplemented.map((a) => (
                  <li key={a.id}>
                    <Pill>{a.name}</Pill>
                  </li>
                ))}
              </ul>
            </div>
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
                    <Link prefetch={false} href={`/tenders/${p.tenders.id}`} className="text-xs font-semibold hover:underline">
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
                  <Link prefetch={false} href={`/tenders/${x.tenderId}`} className="truncate text-xs hover:underline">
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

/**
 * やること1件。**押す場所を1つにする。**
 *
 * 案件名とボタンを別々に置くと、どちらを押せばよいか迷う。行ごと1つのリンクにして、
 * その作業のタブ（task.tab）へ直接飛ばす。飛び先は段取りの定義が持っているので、
 * 文言を直してもリンクが消えない。
 */
function TaskRow({ task }: { task: TodayTask }) {
  const href = task.tab ? `/tenders/${task.tenderId}?tab=${task.tab}` : `/tenders/${task.tenderId}`;
  // 期限が取れていないものを「急がない」扱いにしない。色は付けず、文字で未確認と書く
  const overdue = task.daysLeft !== null && task.daysLeft < 0;
  const soon = task.daysLeft !== null && task.daysLeft >= 0 && task.daysLeft <= 2;
  const date = deadlineDate(task.deadline);

  return (
    <li>
      <Link prefetch={false} href={href} className="group flex items-start gap-2 px-3 py-2.5 hover:bg-slate-50">
        <span
          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
            overdue ? "bg-rose-600" : soon ? "bg-rose-500" : task.daysLeft !== null && task.daysLeft <= 5 ? "bg-amber-500" : "bg-slate-300"
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <StancePill stance={task.stance} />
            <span className="text-xs font-semibold text-slate-900 group-hover:underline">{task.label}</span>
            <span
              className={`ml-auto shrink-0 text-xs tabular-nums ${
                overdue || soon ? "font-semibold text-rose-700" : "text-slate-500"
              }`}
            >
              {date ? `${date}（${remainingText(task.daysLeft)}）` : remainingText(task.daysLeft)}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-slate-600">{task.tenderName}</p>
          {task.note && <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{task.note}</p>}
        </div>
        <ChevronRight size={14} className="mt-1 shrink-0 text-slate-300 group-hover:text-slate-500" />
      </Link>
    </li>
  );
}
