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
  isWon,
  proposalsByTender,
  SELECTABLE_BID_RESULTS,
  SELECTABLE_STANCES,
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
  stance?: string;
  result?: string;
  sort?: string;
  page?: string;
};

/** 参加中の案件を先頭に出すときの上限。多すぎると一覧が見えなくなる */
const JOINED_LIMIT = 20;

type JoinedRow = TenderRow & { company_tenders: { stance: string }[] | { stance: string } | null };

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

/** 判断（参加 / 検討 / 保留 / 見送り）の色。案件ページの表示と揃える。 */
const STANCE_TONE: Record<string, "green" | "amber" | "slate" | "rose"> = {
  参加: "green",
  検討: "amber",
  保留: "slate",
  見送り: "rose",
};

/** 未定（＝まだ決めていない）は出さない。決めたものだけ見せる */
function StancePill({ stance }: { stance: string | undefined }) {
  if (!stance || stance === "未定") return null;
  return <Pill tone={STANCE_TONE[stance] ?? "slate"}>{stance}</Pill>;
}

/** 入札の結果。未入力は出さない（決まっていないものを見せない） */
function ResultPill({ result }: { result: string | undefined }) {
  if (!result || result === "未入力") return null;
  return <Pill tone={isWon(result) ? "green" : "slate"}>結果：{result}</Pill>;
}

const inputClass =
  "rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300";

export default async function TendersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { supabase, orgName, userName } = await requireOrgContext();

  const now = new Date();
  const keyword = (params.q ?? "").trim();
  const item = pickOption(params.item, ITEM_OPTIONS);
  const area = pickOption(params.area, [...AREA_OPTIONS, ...PREFECTURE_OPTIONS]);
  const qual = pickOption(params.qual, QUAL_CATEGORIES);
  const grade = pickOption(params.grade, GRADE_OPTIONS);
  const within = parseDeadlineWithin(params.within);
  // 「未定」は company_tenders の行が無い案件も含むので、絞り込みには出さない
  // （行が無いものは内部結合で落ちる。出せない選択肢は置かない）
  const stance = pickOption(params.stance, [...SELECTABLE_STANCES]);
  // 落札した案件をここから見る（「落札案件へ移す」の受け皿）
  const result = pickOption(params.result, [...SELECTABLE_BID_RESULTS]);
  const sortKey: SortKey = params.sort === "newest" ? "newest" : "deadline";
  const sort = SORTS[sortKey];
  const page = pageFrom(params.page);
  const from = (page - 1) * PAGE_SIZE;

  const filtered = hasActiveFilter([keyword, item, area, qual, grade, within, stance, result]);

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

  // 判断で絞るときだけ company_tenders を内部結合する。
  // 常に結合すると、まだ何も決めていない案件（行が無い）が一覧から消える
  const columns = "id, name, item, grade, areas, budget, submit_deadline, collect_status, agencies(name)";
  let query = supabase
    .from("tenders")
    .select(stance === "" && result === "" ? columns : `${columns}, company_tenders!inner(stance, bid_result)`, {
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
  if (stance !== "") query = query.eq("company_tenders.stance", stance);
  if (result !== "") query = query.eq("company_tenders.bid_result", result);
  // 【提出期限の切れた案件は既定で出さない】（ユーザー決定 2026-08-29）
  // 出しても参加できないので、一覧を埋めるだけになる。探しているときだけ出す。
  // 期限が取れていない案件は消さない（「無い」と「過ぎた」は別。CLAUDE.md 最重要の前提5）。
  // 参加を決めた案件は、期限が過ぎても上の「参加中の案件」に出る（結果を記録するため）。
  if (!filtered) {
    query = query.or(`submit_deadline.is.null,submit_deadline.gte.${now.toISOString()}`);
  }

  const [{ data: tenders, count, error }, { count: pendingCount }, { count: totalCount }, { data: joinedRows }] =
    await Promise.all([
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
    // 参加を決めた案件。**提出期限が過ぎていても出す**（結果を記録するため）。
    // 絞り込み中は一覧のほうに出るので、二重に見せない
    filtered
      ? Promise.resolve({ data: [] as JoinedRow[] })
      : supabase
          .from("tenders")
          .select(`${columns}, company_tenders!inner(stance)`)
          .eq("company_tenders.stance", "参加")
          .order("submit_deadline", { ascending: true, nullsFirst: false })
          .limit(JOINED_LIMIT)
          .returns<JoinedRow[]>(),
  ]);
  if (error) throw new Error(`案件の取得に失敗しました: ${error.message}`);

  const rows = tenders ?? [];
  const joined = joinedRows ?? [];
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

  // 案件ごとの判断（参加 / 検討 / 保留 / 見送り）。一覧でも一目で分かるようにする
  const { data: stanceRows } = rows.length
    ? await supabase
        .from("company_tenders")
        .select("tender_id, stance, bid_result")
        .in(
          "tender_id",
          rows.map((t) => t.id),
        )
        .returns<{ tender_id: string; stance: string; bid_result: string }[]>()
    : { data: [] as { tender_id: string; stance: string; bid_result: string }[] };
  const stanceByTender = new Map((stanceRows ?? []).map((r) => [r.tender_id, r.stance]));
  const resultByTender = new Map((stanceRows ?? []).map((r) => [r.tender_id, r.bid_result]));

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
    if (stance !== "") search.set("stance", stance);
    if (result !== "") search.set("result", result);
    if (sortKey !== "deadline") search.set("sort", sortKey);
    if (target > 1) search.set("page", String(target));
    const query = search.toString();
    return query === "" ? "/tenders" : `/tenders?${query}`;
  }

  return (
    <AppShell active="tenders" orgName={orgName} userName={userName}>
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
            {/* 進行中・検討中の案件をここから見る。「未定」は行が無い案件も含むため出さない */}
            <select name="stance" defaultValue={stance} className={inputClass} aria-label="この案件をどうするか">
              <option value="">判断：すべて</option>
              {SELECTABLE_STANCES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <select name="result" defaultValue={result} className={inputClass} aria-label="入札の結果">
              <option value="">結果：すべて</option>
              {SELECTABLE_BID_RESULTS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
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

      {/* 【参加中の案件を先頭に出す】（ユーザー決定 2026-08-29）
          提出期限が過ぎても消さない。結果を記録するまでが1件だから。
          絞り込み中は下の一覧に出るので、二重に見せない */}
      {joined.length > 0 && (
        <Panel title={`参加中の案件（${joined.length}）`}>
          <ul className="space-y-1">
            {joined.map((t) => {
              const dl = daysLeft(t.submit_deadline);
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-1 last:border-0">
                  <Pill tone="green">参加</Pill>
                  <Link prefetch={false} href={`/tenders/${t.id}`} className="text-xs font-medium hover:underline">
                    {t.name}
                  </Link>
                  <span className="text-xs text-slate-500">{agencyName(t.agencies)}</span>
                  {/* 過ぎたことを隠さない。結果を入れる段階だと分かるように */}
                  {dl != null && dl < 0 && <span className="text-xs text-slate-500">提出期限を過ぎています</span>}
                  {dl != null && dl >= 0 && (
                    <span className={`text-xs ${dl <= 3 ? "font-medium text-rose-700" : "text-slate-500"}`}>
                      提出まで残{dl}日
                    </span>
                  )}
                  {t.submit_deadline === null && <span className="text-xs text-slate-400">提出期限は未確認</span>}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

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
                <Link prefetch={false} href={`/tenders/${t.id}`} className="text-sm font-semibold leading-snug hover:underline">
                  {t.name}
                </Link>
                <div className="mt-0.5 text-xs text-slate-500">{agencyName(t.agencies)}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <StancePill stance={stanceByTender.get(t.id)} />
                  <ResultPill result={resultByTender.get(t.id)} />
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
              <Link prefetch={false} href={`/tenders/${t.id}`} className={btnClass("primary")}>
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
