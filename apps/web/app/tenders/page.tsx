// すべての案件（タスク3-5）。
//
// 「提案された案件」は提案条件で絞った結果しか出ないため、収集・解析まで終わっている
// 案件が画面に出てこない。実際には集まっているのに「案件が少ない」と見えてしまうので、
// 条件で絞らない一覧をここに置く（ユーザー判断 2026-08-22）。
//
// 提案条件に合わない案件も隠さずに出し、合わない理由を添える。合っているかどうかは
// 提案（proposals）があればそれを使い、無ければ「未判定」と出す（推測しない）。
//
// 絞り込みはURLのクエリで持つ（GETフォーム）。条件をそのまま共有・ブックマークできる。
import { ListChecks, Search } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { CollectPill, Panel, Pill, ProposePill, btnClass } from "@/components/ui";
import { requireOrgContext } from "@/lib/auth";
import { AREA_OPTIONS, ITEM_OPTIONS, PREFECTURE_OPTIONS, QUAL_CATEGORIES, REGION_PREFECTURES } from "@/lib/catalog";
import {
  BROWSABLE_COLLECT_STATUSES,
  DEADLINE_WITHIN_OPTIONS,
  deadlineCutoff,
  expandAreaFilter,
  hasActiveFilter,
  parseDeadlineWithin,
  PENDING_COLLECT_STATUSES,
  proposalsByTender,
  tenderVerdict,
  type BrowseProposal,
} from "@ai-nyusatsu-bu/domain";

/** 1ページに出す件数。200件/日で集まるので、全部を1画面には出さない。 */
const PAGE_SIZE = 50;

/**
 * キーワードで拾う発注機関の上限。機関IDをURLのクエリに並べて案件を絞るため、
 * 多すぎるとリクエストURLが長くなりすぎる。ここに達したら打ち切って画面に断る。
 */
const AGENCY_MATCH_LIMIT = 100;

/** 等級は全省庁統一資格のA〜D。案件側に入っていないこともある。 */
const GRADE_OPTIONS = ["A", "B", "C", "D"] as const;

const SORTS = {
  deadline: { label: "提出期限が近い順", column: "submit_deadline", ascending: true },
  newest: { label: "公告が新しい順", column: "notice_date", ascending: false },
} as const;
type SortKey = keyof typeof SORTS;

type SearchParams = {
  q?: string;
  item?: string;
  area?: string;
  qual?: string;
  grade?: string;
  within?: string;
  sort?: string;
  page?: string;
};

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

/** 金額は円単位のintegerで持っている（CLAUDE.md）。3桁区切りでそのまま出す。 */
function yen(value: number | null): string | null {
  return value === null ? null : `${value.toLocaleString("ja-JP")}円`;
}

/** ページ番号を読む。1未満・数値でない場合は1ページ目に落とす。 */
function pageFrom(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/** 選択肢に無い値は「指定なし」に落とす（URLを書き換えられても落ちないように）。 */
function pickOption(raw: string | undefined, options: readonly string[]): string {
  const value = (raw ?? "").trim();
  return options.includes(value) ? value : "";
}

/** ilikeのパターンで特別な意味を持つ文字を落とす。 */
function likePattern(keyword: string): string {
  return `%${keyword.replace(/[%_,]/g, " ")}%`;
}

const inputClass =
  "rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300";

export default async function TendersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { supabase, orgName } = await requireOrgContext();

  const now = new Date();
  const keyword = (params.q ?? "").trim();
  const item = pickOption(params.item, ITEM_OPTIONS);
  const area = pickOption(params.area, [...AREA_OPTIONS, ...PREFECTURE_OPTIONS]);
  const qual = pickOption(params.qual, QUAL_CATEGORIES);
  const grade = pickOption(params.grade, GRADE_OPTIONS);
  const within = parseDeadlineWithin(params.within);
  const sortKey: SortKey = params.sort === "newest" ? "newest" : "deadline";
  const sort = SORTS[sortKey];
  const page = pageFrom(params.page);
  const from = (page - 1) * PAGE_SIZE;

  const filtered = hasActiveFilter([keyword, item, area, qual, grade, within]);

  // キーワードは案件名だけでなく発注機関名でも探せるようにする。
  // 機関は数百件なので、先に機関を引いてから案件を絞る。
  let agencyIds: string[] = [];
  if (keyword !== "") {
    const { data: agencies } = await supabase
      .from("agencies")
      .select("id")
      .ilike("name", likePattern(keyword))
      .limit(AGENCY_MATCH_LIMIT)
      .returns<{ id: string }[]>();
    agencyIds = (agencies ?? []).map((a) => a.id);
  }
  // 上限に達したら、拾いきれなかった機関がある。黙って絞らずに画面で断る。
  const agencyMatchTruncated = agencyIds.length === AGENCY_MATCH_LIMIT;

  let query = supabase
    .from("tenders")
    .select("id, name, item, grade, areas, budget, submit_deadline, collect_status, agencies(name)", {
      count: "exact",
    })
    .in("collect_status", [...BROWSABLE_COLLECT_STATUSES])
    // 並び順の値が無い案件（期限や公告日が取れていない）は末尾へ
    .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
    .range(from, from + PAGE_SIZE - 1);

  if (keyword !== "") {
    const nameMatch = `name.ilike.${likePattern(keyword)}`;
    query = query.or(agencyIds.length > 0 ? `${nameMatch},agency_id.in.(${agencyIds.join(",")})` : nameMatch);
  }
  if (item !== "") query = query.eq("item", item);
  if (qual !== "") query = query.eq("qual_category", qual);
  if (grade !== "") query = query.eq("grade", grade);
  if (area !== "") {
    // 「関東・甲信越」で絞ったときに「東京都」の案件が消えないよう、地方区分は都道府県まで広げる
    query = query.overlaps("areas", expandAreaFilter(area, REGION_PREFECTURES));
  }
  if (within !== null) query = query.lte("submit_deadline", deadlineCutoff(within, now).toISOString());

  const [{ data: tenders, count, error }, { count: pendingCount }, { count: totalCount }] = await Promise.all([
    query.returns<TenderRow[]>(),
    supabase
      .from("tenders")
      .select("id", { count: "exact", head: true })
      .in("collect_status", [...PENDING_COLLECT_STATUSES]),
    // 絞り込みに関係なく、いま見られる案件の総数。絞った結果だけを出すと
    // 「案件が少ない」と見えてしまうので、母数を必ず添える。
    supabase
      .from("tenders")
      .select("id", { count: "exact", head: true })
      .in("collect_status", [...BROWSABLE_COLLECT_STATUSES]),
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

  /** ページ送りのリンク。絞り込みをすべて引き継ぐ。 */
  function pageHref(target: number): string {
    const search = new URLSearchParams();
    if (keyword !== "") search.set("q", keyword);
    if (item !== "") search.set("item", item);
    if (area !== "") search.set("area", area);
    if (qual !== "") search.set("qual", qual);
    if (grade !== "") search.set("grade", grade);
    if (within !== null) search.set("within", String(within));
    if (sortKey !== "deadline") search.set("sort", sortKey);
    if (target > 1) search.set("page", String(target));
    const query = search.toString();
    return query === "" ? "/tenders" : `/tenders?${query}`;
  }

  return (
    <AppShell active="tenders" orgName={orgName}>
      <Panel
        dense
        title={
          filtered
            ? `すべての案件（${(totalCount ?? 0).toLocaleString("ja-JP")}件中 ${total.toLocaleString("ja-JP")}件）`
            : `すべての案件（${(totalCount ?? 0).toLocaleString("ja-JP")}件）`
        }
        right={
          filtered ? (
            <Link href="/tenders" className="text-xs text-blue-800 underline">
              絞り込みを解除
            </Link>
          ) : undefined
        }
      >
        <form method="get" className="space-y-2 border-b border-slate-200 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              name="q"
              defaultValue={keyword}
              placeholder="案件名・発注機関で検索"
              className={`${inputClass} w-56`}
            />
            <select name="item" defaultValue={item} className={inputClass} aria-label="営業品目">
              <option value="">営業品目：すべて</option>
              {ITEM_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <select name="area" defaultValue={area} className={inputClass} aria-label="地域">
              <option value="">地域：すべて</option>
              <optgroup label="地方">
                {AREA_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </optgroup>
              <optgroup label="都道府県">
                {PREFECTURE_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </optgroup>
            </select>
            <select name="qual" defaultValue={qual} className={inputClass} aria-label="資格区分">
              <option value="">資格区分：すべて</option>
              {QUAL_CATEGORIES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <select name="grade" defaultValue={grade} className={inputClass} aria-label="等級">
              <option value="">等級：すべて</option>
              {GRADE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select name="within" defaultValue={within ?? ""} className={inputClass} aria-label="提出期限">
              <option value="">提出期限：すべて</option>
              {DEADLINE_WITHIN_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  残り{d}日以内
                </option>
              ))}
            </select>
            <select name="sort" defaultValue={sortKey} className={inputClass} aria-label="並び順">
              {Object.entries(SORTS).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
            </select>
            <button type="submit" className={btnClass("primary", "sm")}>
              <Search size={12} />
              この条件で探す
            </button>
          </div>
        </form>

        <p className="px-3 py-2 text-xs leading-relaxed text-slate-600">
          公告の取得・資料の取得・AI解析まで終わった案件をすべて出しています。
          {orgName}の提案条件に合わない案件も、合わない理由を添えて表示します。
          {pendingCount ? `ほかに解析待ちが${pendingCount.toLocaleString("ja-JP")}件あります。` : ""}
          {agencyMatchTruncated
            ? `「${keyword}」に一致する発注機関が多すぎるため、${AGENCY_MATCH_LIMIT}機関までで打ち切っています。機関名をもう少し詳しく入れてください。`
            : ""}
        </p>
      </Panel>

      {rows.length === 0 && (
        <Panel>
          <p className="text-xs text-slate-500">
            {filtered ? "この条件に一致する案件がありません。" : "解析まで終わった案件がまだありません。"}
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
                  {t.areas?.map((a) => <Pill key={a}>{a}</Pill>)}
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
              <Link href={pageHref(page - 1)} className="text-blue-800 underline">
                前の{PAGE_SIZE}件
              </Link>
            ) : (
              <span className="text-slate-300">前の{PAGE_SIZE}件</span>
            )}
            <span className="tabular-nums text-slate-500">
              {page} / {lastPage}
            </span>
            {page < lastPage ? (
              <Link href={pageHref(page + 1)} className="text-blue-800 underline">
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
