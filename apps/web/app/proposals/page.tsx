// 提案された案件。docs/ai-nyusatsu-bu-prototype-v7.jsx の ProposalsView 相当。
//
// プロトタイプは各案件の「進め方」の完了ステップ数もここに表示するが、進め方タブ
// （guide.ts）は原価集計・見積依頼に依存し未実装のため、このタスク（3-3）では省略する。
import { Download, ListChecks } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Bar, Panel, Pill, ProposePill, ReasonIcon, Verdict, btnClass, verdictBarTone } from "@/components/ui";
import { requireOrgContext } from "@/lib/auth";
import { setProposalStatus } from "./actions";

type ProposalRow = {
  id: string;
  status: string;
  score: number;
  reasons_ok: string[];
  reasons_ng: string[];
  excluded_reason: string | null;
  tenders: {
    id: string;
    name: string;
    item: string | null;
    grade: string | null;
    submit_deadline: string | null;
    collect_status: string;
    agencies: { name: string } | { name: string }[] | null;
  } | null;
};

type Agencies = { name: string } | { name: string }[] | null;

function agencyName(agencies: Agencies) {
  if (!agencies) return "";
  return Array.isArray(agencies) ? (agencies[0]?.name ?? "") : agencies.name;
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - Date.now()) / 86_400_000);
}

export default async function ProposalsPage() {
  const { supabase, orgId, orgName, userName } = await requireOrgContext();

  const [{ data: profile }, { data: proposals }] = await Promise.all([
    supabase
      .from("company_profiles")
      .select("qual_categories, grades, items, areas")
      .eq("org_id", orgId)
      .maybeSingle<{ qual_categories: string[]; grades: Record<string, string>; items: string[]; areas: string[] }>(),
    supabase
      .from("proposals")
      .select(
        "id, status, score, reasons_ok, reasons_ng, excluded_reason, tenders(id, name, item, grade, submit_deadline, collect_status, agencies(name))",
      )
      .order("score", { ascending: false })
      .returns<ProposalRow[]>(),
  ]);

  // 提出期限を過ぎた案件（終了）はここに出さない。参加できないものを並べても判断の邪魔になる。
  // 提案そのものは残っているので、「すべての案件」からは履歴として辿れる。
  const live = (proposals ?? []).filter((p) => p.tenders && p.tenders.collect_status !== "終了");
  const closedCount = (proposals ?? []).filter((p) => p.tenders && p.tenders.collect_status === "終了").length;

  const rows = live.filter((p) => p.status !== "対象外");
  const excluded = live.filter((p) => p.status === "対象外");

  return (
    <AppShell active="proposals" orgName={orgName} userName={userName}>
      <Panel
        title="照合条件"
        right={
          <Link href="/tenders" className="text-xs text-blue-800 underline">
            すべての案件を見る
          </Link>
        }
      >
        <p className="text-xs leading-relaxed text-slate-600">
          {orgName}／全省庁統一資格 {profile?.qual_categories?.length ? profile.qual_categories.join("・") : "未登録"}／等級{" "}
          {profile?.grades && Object.keys(profile.grades).length > 0
            ? Object.entries(profile.grades)
                .map(([k, v]) => `${k} ${v}`)
                .join("・")
            : "未登録"}
          ／営業品目 {profile?.items?.length ? profile.items.join("・") : "未登録"}／競争参加地域{" "}
          {profile?.areas?.length ? profile.areas.join("・") : "未登録"}
        </p>
      </Panel>

      {closedCount > 0 && (
        <Panel dense>
          <p className="px-3 py-2 text-xs text-slate-500">
            提出期限を過ぎた案件を{closedCount.toLocaleString("ja-JP")}件、この一覧から外しています。
          </p>
        </Panel>
      )}

      {rows.length === 0 && (
        <Panel>
          <p className="text-xs leading-relaxed text-slate-500">
            まだ提案された案件がありません。ここには提案条件に合う案件だけが出ます。
            <Link href="/tenders" className="text-blue-800 underline">
              すべての案件
            </Link>
            から、条件に合わないものも含めて見られます。
          </p>
        </Panel>
      )}

      {rows.map((p) => {
        const t = p.tenders!;
        const eligible = p.excluded_reason === null;
        const dl = daysLeft(t.submit_deadline);
        return (
          <Panel key={p.id}>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <Link prefetch={false} href={`/tenders/${t.id}`} className="text-sm font-semibold leading-snug hover:underline">
                  {t.name}
                </Link>
                <div className="mt-0.5 text-xs text-slate-500">{agencyName(t.agencies)}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Verdict eligible={eligible} score={p.score} />
                  <ProposePill s={p.status} />
                  {t.item && <Pill>{t.item}</Pill>}
                  {t.grade && <Pill>{t.grade}</Pill>}
                  {dl != null && <Pill tone="blue">提出まで残{dl}日</Pill>}
                </div>
              </div>
              <div className="w-full max-w-[220px] sm:w-56">
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-semibold tabular-nums">{p.score}</span>
                  <span className="text-xs text-slate-500">/ 100 適合</span>
                </div>
                <Bar value={p.score} tone={verdictBarTone(eligible, p.score)} />
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs font-semibold text-slate-700">参加できる理由</div>
                <ul className="mt-1 space-y-1">
                  {p.reasons_ok.map((r) => (
                    <li key={r} className="flex gap-1.5 text-xs text-slate-700">
                      <ReasonIcon kind="ok" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-700">確認が必要な点</div>
                {p.reasons_ng.length === 0 ? (
                  <p className="mt-1 text-xs text-slate-400">なし</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {p.reasons_ng.map((r) => (
                      <li key={r} className="flex gap-1.5 text-xs text-slate-700">
                        <ReasonIcon kind="ng" />
                        {r}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Link prefetch={false} href={`/tenders/${t.id}`} className={btnClass("primary")}>
                <ListChecks size={12} />
                案件を見る
              </Link>
              {p.status !== "検討中" && (
                <form action={setProposalStatus.bind(null, p.id, "検討中")}>
                  <button type="submit" className={btnClass()}>
                    <Download size={12} />
                    参加を検討する
                  </button>
                </form>
              )}
              <form action={setProposalStatus.bind(null, p.id, "対象外")}>
                <button type="submit" className={btnClass()}>
                  今回は見送る
                </button>
              </form>
            </div>
          </Panel>
        );
      })}

      {excluded.length > 0 && (
        <Panel title={`対象外（${excluded.length}）`}>
          <ul className="space-y-1.5">
            {excluded.map((p) => (
              <li key={p.id} className="flex flex-wrap gap-2 text-xs">
                <Link prefetch={false} href={`/tenders/${p.tenders!.id}`} className="font-medium hover:underline">
                  {p.tenders!.name}
                </Link>
                <span className="text-slate-500">{p.excluded_reason ?? "手動で見送り"}</span>
                <form action={setProposalStatus.bind(null, p.id, "提案対象")} className="ml-auto">
                  <button type="submit" className="text-blue-800 underline">
                    戻す
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </AppShell>
  );
}
