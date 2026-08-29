// 協力会社。docs/ai-nyusatsu-bu-prototype-v7.jsx の PartnersView 相当。
//
// 【開拓したい業種】（9月分）
// 見積依頼は業種ごとに出す。必要な業種の協力会社が1社もいないと、その業種の見積が
// 取れず、案件そのものを諦めることになる。「何が足りないか」を案件を開く前に見せる。
//
// 前は「公開中の全案件で使われている業種のうち、登録の無いもの」を出していたが、
// 自社が出られない案件の業種まで並んでどれから当たるべきか分からなかった。
// いま自社に提案されている案件から逆算し、案件の多い順に出す。
// あわせて、メールアドレスの無い会社（依頼を送れない）と、1社しかいない業種
// （相見積が取れない）も分けて見せる。判定は packages/domain/src/partner_gaps.ts。
//
// プロトタイプの採用率・平均回答速度・過去見積件数は見積依頼の履歴（quote_requests/quotes、
// タスク4系）から算出する値で、まだ実データが無いため表示しない。評価（rating）は
// 自由入力の列としてそのまま使う。AIのおすすめ度（recommendScore）も見積の実績データが
// 前提のため、このタスク（3-5）では省略する。
import { CheckCircle2, Phone, Star } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { countTradeDemand, findPartnerGaps, MIN_PARTNERS_FOR_QUOTES } from "@ai-nyusatsu-bu/domain";
import { Field, Panel, Pill } from "@/components/ui";
import { requireOrgContext } from "@/lib/auth";
import { Modal } from "@/components/Modal";
import { PartnerForm, type PartnerFormValues } from "./partner-form";

type PartnerRow = {
  id: string;
  name: string;
  person: string | null;
  tel: string | null;
  email: string | null;
  base: string | null;
  trades: string[];
  areas: string[];
  rating: number | null;
  memo: string | null;
  active: boolean;
};

/** 開拓の対象にする提案の状態。対象外にした案件は数えない。 */
const ACTIVE_PROPOSAL_STATUSES = ["提案対象", "配信済", "既読", "検討中"];

type ProposedTenderRow = {
  tender_id: string;
  tenders: { collect_status: string; tender_lots: { trade: string | null }[] } | { collect_status: string; tender_lots: { trade: string | null }[] }[] | null;
};

/** PostgRESTの埋め込みは1対1でも配列で返ることがある。 */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const BLANK: PartnerFormValues = {
  id: null,
  name: "",
  person: null,
  tel: null,
  email: null,
  base: null,
  trades: [],
  areas: [],
  rating: null,
  memo: null,
  active: true,
};

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ partner?: string; q?: string; trade?: string; saved?: string }>;
}) {
  const { partner: partnerId, q, trade, saved } = await searchParams;
  const { supabase, orgName, userName } = await requireOrgContext();

  const [{ data: partners }, { data: lotRows }] = await Promise.all([
    supabase
      .from("partners")
      .select("id, name, person, tel, email, base, trades, areas, rating, memo, active")
      .order("name")
      .returns<PartnerRow[]>(),
    // 開拓の順番は「いま自社に提案されている案件」で決める。公開中の全案件を見ても、
    // 自社が出られない案件の業種まで並んでしまい、どれから当たるべきかが分からない
    supabase
      .from("proposals")
      .select("tender_id, tenders!inner(collect_status, tender_lots(trade))")
      .in("status", ACTIVE_PROPOSAL_STATUSES)
      .neq("tenders.collect_status", "終了")
      .returns<ProposedTenderRow[]>(),
  ]);

  const allTrades = Array.from(new Set((partners ?? []).flatMap((p) => p.trades ?? []))).sort();
  const rows = (partners ?? []).filter((p) => {
    if (trade && trade !== "すべて" && !p.trades.includes(trade)) return false;
    if (q && !p.name.includes(q) && !(p.base ?? "").includes(q)) return false;
    return true;
  });

  // 判定は packages/domain（テスト済み）。ここはDBの読み書きと詰め替えだけ
  const demands = countTradeDemand(
    (lotRows ?? []).flatMap((row) =>
      one(row.tenders)
        ?.tender_lots.map((lot) => ({ tenderId: row.tender_id, trade: lot.trade })) ?? [],
    ),
  );
  const gaps = findPartnerGaps(
    demands,
    (partners ?? []).map((p) => ({ trades: p.trades ?? [], email: p.email, active: p.active })),
  );

  const selected = (partners ?? []).find((p) => p.id === partnerId) ?? null;
  const values: PartnerFormValues = selected
    ? {
        id: selected.id,
        name: selected.name,
        person: selected.person,
        tel: selected.tel,
        email: selected.email,
        base: selected.base,
        trades: selected.trades ?? [],
        areas: selected.areas ?? [],
        rating: selected.rating,
        memo: selected.memo,
        active: selected.active,
      }
    : BLANK;
  const showForm = partnerId !== undefined;

  // 保存できたことを知らせる。小窓が閉じるだけだと、保存されたのか閉じただけなのかが分からない。
  const savedMessage = saved === "created" ? "協力会社を追加しました。" : saved === "updated" ? "協力会社を更新しました。" : null;

  return (
    <AppShell active="partners" orgName={orgName} userName={userName}>
      {savedMessage && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
          <CheckCircle2 size={14} className="shrink-0 text-emerald-700" />
          <p className="text-xs text-emerald-900">{savedMessage}</p>
          <Link href="/partners" className="ml-auto text-xs text-emerald-800 underline">
            閉じる
          </Link>
        </div>
      )}

      <Panel
        dense
        title={`協力会社（${rows.length}）`}
        right={
          <Link href="/partners?partner=" className="text-xs text-blue-800 underline">
            会社を追加
          </Link>
        }
      >
        <form method="get" className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="会社名・所在地で検索"
            className="w-48 rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          <button type="submit" className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
            検索
          </button>
          <div className="flex flex-wrap gap-1">
            <Link
              href="/partners"
              className={`rounded border px-2 py-1 text-xs ${!trade || trade === "すべて" ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-600"}`}
            >
              すべて
            </Link>
            {allTrades.map((t) => (
              <Link
                key={t}
                prefetch={false}
                href={`/partners?trade=${encodeURIComponent(t)}`}
                className={`rounded border px-2 py-1 text-xs ${trade === t ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-600"}`}
              >
                {t}
              </Link>
            ))}
          </div>
        </form>
        {rows.length === 0 ? (
          <p className="px-3 py-3 text-xs text-slate-500">登録されている協力会社がありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">会社／担当者</th>
                  <th className="px-2 py-2 font-medium">業種</th>
                  <th className="px-2 py-2 font-medium">エリア</th>
                  <th className="px-2 py-2 text-right font-medium">評価</th>
                  <th className="px-2 py-2 font-medium">状態</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <Link prefetch={false} href={`/partners?partner=${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <div className="text-slate-500">
                        {p.person}
                        {p.base && `／${p.base}`}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        {p.trades.map((t) => (
                          <Pill key={t}>{t}</Pill>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-slate-600">{p.areas.join("・")}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{p.rating ?? "—"}</td>
                    <td className="px-2 py-2">{p.active ? <Pill tone="green">有効</Pill> : <Pill>停止中</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* いま提案されている案件から逆算して、開拓すべき業種を出す。
          業種の一覧を眺めても順番は決まらないので、案件の件数が多い順に並べる */}
      {(gaps.missing.length > 0 || gaps.thin.length > 0) && (
        <Panel title="開拓したい業種">
          {gaps.missing.length > 0 && (
            <div>
              <p className="text-xs font-medium text-rose-800">依頼先がいません</p>
              <ul className="mt-1 space-y-1">
                {gaps.missing.map((gap) => (
                  <li key={gap.trade} className="text-xs text-slate-700">
                    ・{gap.trade}
                    <span className="ml-1 text-slate-500">提案中の案件{gap.tenders}件で必要</span>
                    {/* 登録はあるが依頼できない、は「いない」と分けて見せる */}
                    {gap.noEmail > 0 && (
                      <span className="ml-1 text-amber-700">
                        （{gap.noEmail}社は登録済みですがメールアドレスが未登録）
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {gaps.thin.length > 0 && (
            <div className={gaps.missing.length > 0 ? "mt-3" : ""}>
              <p className="text-xs font-medium text-amber-800">1社しかいません（相見積が取れません）</p>
              <ul className="mt-1 space-y-1">
                {gaps.thin.map((gap) => (
                  <li key={gap.trade} className="text-xs text-slate-700">
                    ・{gap.trade}
                    <span className="ml-1 text-slate-500">提案中の案件{gap.tenders}件で必要</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            いま提案されている案件で必要な業種を数え、案件の多い順に並べています。
            相見積を取るには{MIN_PARTNERS_FOR_QUOTES}社以上が要ります。
            メールアドレスの無い会社には見積依頼を送れません（回答ページのURLをメールで送るため）。
            足りている業種：{gaps.covered}
          </p>
        </Panel>
      )}

      {selected && (
        <Panel title={selected.name}>
          <div className="grid gap-3 sm:grid-cols-2">
            <dl>
              <Field label="担当者">{selected.person ?? "—"}</Field>
              <Field label="所在地">{selected.base ?? "—"}</Field>
              <Field label="業種">{selected.trades.length ? selected.trades.join("・") : "—"}</Field>
              <Field label="対応エリア">{selected.areas.length ? selected.areas.join("・") : "—"}</Field>
              <Field label="電話">
                {selected.tel ? (
                  <span className="inline-flex items-center gap-1">
                    <Phone size={11} />
                    {selected.tel}
                  </span>
                ) : (
                  "—"
                )}
              </Field>
            </dl>
            <dl>
              <Field label="メール">{selected.email ?? "—"}</Field>
              <Field label="評価">
                {selected.rating != null ? (
                  <span className="inline-flex items-center gap-1">
                    <Star size={11} className="text-amber-500" />
                    {selected.rating}
                  </span>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="メモ">{selected.memo ?? "—"}</Field>
            </dl>
          </div>
        </Panel>
      )}

      {showForm && (
        <Modal title={values.id ? "会社を編集" : "会社を追加"} closeHref="/partners">
          <PartnerForm key={values.id ?? "new"} values={values} />
        </Modal>
      )}
    </AppShell>
  );
}
