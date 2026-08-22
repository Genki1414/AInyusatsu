// すべての案件（タスク3-5）。
//
// 「提案された案件」は提案条件で絞った結果しか出ないため、収集・解析まで終わっている
// 案件が画面に出てこない。実際には集まっているのに「案件が少ない」と見えてしまうので、
// 条件で絞らない一覧をここに置く（ユーザー判断 2026-08-22）。
//
// 提案条件に合わない案件も隠さずに出し、合わない理由を添える。合っているかどうかは
// 提案（proposals）があればそれを使い、無ければ「未判定」と出す（推測しない）。
import { ListChecks, Search } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { CollectPill, Panel, Pill, ProposePill, btnClass } from "@/components/ui";
import { requireOrgContext } from "@/lib/auth";
import {
  BROWSABLE_COLLECT_STATUSES,
  PENDING_COLLECT_STATUSES,
  proposalsByTender,
  tenderVerdict,
  type BrowseProposal,
} from "@ai-nyusatsu-bu/domain";

/** 1ページに出す件数。200件/日で集まるので、全部を1画面には出さない。 */
const PAGE_SIZE = 50;

type TenderRow = {
  id: string;
  name: string;
  item: string | null;
  grade: string | null;
  areas: string[] | null;
  budget: number | null;
  submit_deadline: string | null;
  collect_status: string;
  agencies: { name: string } | { name: string }[] | null;
};

type ProposalRow = { tender_id: string; status: string; score: number; excluded_reason: string | null };

type Agencies = TenderRow["agencies"];

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

/** 金額は円単位のintegerで持っている（CLAUDE.md）。表示は万円に丸めず、そのまま3桁区切りで出す。 */
function yen(value: number | null): string | null {
  return value === null ? null : `${value.toLocaleString("ja-JP")}円`;
}

/** ページ番号を読む。1未満・数値でない場合は1ページ目に落とす。 */
function pageFrom(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/** 検索・ページ送りのリンクを作る。 */
function hrefWith(params: { q?: string; page?: number }): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const query = search.toString();
  return query === "" ? "/tenders" : `/tenders?${query}`;
}

export default async function TendersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page: pageParam } = await searchParams;
  const { supabase, orgName } = await requireOrgContext();

  const keyword = (q ?? "").trim();
  const page = pageFrom(pageParam);
  const from = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from("tenders")
    .select("id, name, item, grade, areas, budget, submit_deadline, collect_status, agencies(name)", {
      count: "exact",
    })
    .in("collect_status", [...BROWSABLE_COLLECT_STATUSES])
    // 提出期限が近いものから。期限が取れていない案件は末尾へ
    .order("submit_deadline", { ascending: true, nullsFirst: false })
    .range(from, from + PAGE_SIZE - 1);
  if (keyword !== "") {
    // PostgRESTのilikeはパターン中の % と , を特別扱いするので、そのまま渡さない
    query = query.ilike("name", `%${keyword.replace(/[%,]/g, " ")}%`);
  }

  const [{ data: tenders, count, error }, { count: pendingCount }] = await Promise.all([
    query.returns<TenderRow[]>(),
    supabase
      .from("tenders")
      .select("id", { count: "exact", head: true })
      .in("collect_status", [...PENDING_COLLECT_STATUSES]),
  ]);
  if (error) throw new Error(`案件の取得に失敗しました: ${error.message}`);

  const rows = tenders ?? [];
  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 自組織のproposalsだけがRLSで返る。1案件に複数の条件セットぶんがぶら下がりうる
  const { data: proposalRows } = rows.length
    ? await supabase
        .from("proposals")
        .select("tender_id, status, score, excluded_reason")
        .in(
          "tender_id",
          rows.map((t) => t.id),
        )
        .returns<ProposalRow[]>()
    : { data: [] as ProposalRow[] };

  const verdicts = proposalsByTender(
    (proposalRows ?? []).map(
      (p): BrowseProposal => ({
        tenderId: p.tender_id,
        status: p.status,
        score: p.score,
        excludedReason: p.excluded_reason,
      }),
    ),
  );

  return (
    <AppShell active="tenders" orgName={orgName}>
      <Panel dense title={`すべての案件（${total.toLocaleString("ja-JP")}）`}>
        <form method="get" className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
          <input
            type="text"
            name="q"
            defaultValue={keyword}
            placeholder="案件名で検索"
            className="w-56 rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          <button type="submit" className={btnClass("default", "sm")}>
            <Search size={12} />
            検索
          </button>
          {keyword !== "" && (
            <Link href="/tenders" className="text-xs text-blue-800 underline">
              検索を解除
            </Link>
          )}
        </form>
        <p className="px-3 py-2 text-xs leading-relaxed text-slate-600">
          公告の取得・資料の取得・AI解析まで終わった案件をすべて出しています。
          {orgName}の提案条件に合わない案件も、合わない理由を添えて表示します。
          {pendingCount ? `ほかに解析待ちが${pendingCount.toLocaleString("ja-JP")}件あります。` : ""}
        </p>
      </Panel>

      {rows.length === 0 && (
        <Panel>
          <p className="text-xs text-slate-500">
            {keyword === ""
              ? "解析まで終わった案件がまだありません。"
              : `「${keyword}」に一致する案件がありません。`}
          </p>
        </Panel>
      )}

      {rows.map((t) => {
        const verdict = tenderVerdict(verdicts.get(t.id) ?? null);
        const dl = daysLeft(t.submit_deadline);
        const budget = yen(t.budget);
        return (
          <Panel key={t.id}>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <Link href={`/tenders/${t.id}`} className="text-sm font-semibold leading-snug hover:underline">
                  {t.name}
                </Link>
                <div className="mt-0.5 text-xs text-slate-500">{agencyName(t.agencies)}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <CollectPill s={t.collect_status} />
                  {verdict.kind === "提案対象" && <ProposePill s={verdict.status} />}
                  {verdict.kind === "対象外" && <Pill tone="rose">提案条件に合いません</Pill>}
                  {verdict.kind === "未判定" && <Pill>未判定</Pill>}
                  {t.item && <Pill>{t.item}</Pill>}
                  {t.grade && <Pill>{t.grade}</Pill>}
                  {t.areas?.map((area) => <Pill key={area}>{area}</Pill>)}
                  {budget && <Pill>予定価格 {budget}</Pill>}
                  {dl != null && <Pill tone="blue">提出まで残{dl}日</Pill>}
                </div>
                {verdict.kind === "対象外" && (
                  <p className="mt-2 text-xs text-slate-600">{verdict.excludedReason ?? "手動で見送り"}</p>
                )}
                {verdict.kind === "未判定" && (
                  <p className="mt-2 text-xs text-slate-500">
                    まだ採点していません。
                    <Link href="/criteria" className="text-blue-800 underline">
                      提案条件
                    </Link>
                    を登録すると、参加できるかどうかを判定します。
                  </p>
                )}
              </div>
              {verdict.kind !== "未判定" && (
                <div className="w-full max-w-[220px] sm:w-40">
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-semibold tabular-nums">{verdict.score}</span>
                    <span className="text-xs text-slate-500">/ 100 適合</span>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-3">
              <Link href={`/tenders/${t.id}`} className={btnClass("primary")}>
                <ListChecks size={12} />
                案件を見る
              </Link>
            </div>
          </Panel>
        );
      })}

      {lastPage > 1 && (
        <Panel dense>
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
            {page > 1 ? (
              <Link href={hrefWith({ q: keyword, page: page - 1 })} className="text-blue-800 underline">
                前の{PAGE_SIZE}件
              </Link>
            ) : (
              <span className="text-slate-300">前の{PAGE_SIZE}件</span>
            )}
            <span className="text-slate-500 tabular-nums">
              {page} / {lastPage}
            </span>
            {page < lastPage ? (
              <Link href={hrefWith({ q: keyword, page: page + 1 })} className="text-blue-800 underline">
                次の{PAGE_SIZE}件
              </Link>
            ) : (
              <span className="text-slate-300">次の{PAGE_SIZE}件</span>
            )}
          </div>
        </Panel>
      )}
    </AppShell>
  );
}
