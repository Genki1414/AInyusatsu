// 協力会社。docs/ai-nyusatsu-bu-prototype-v7.jsx の PartnersView 相当。
//
// プロトタイプの採用率・平均回答速度・過去見積件数は見積依頼の履歴（quote_requests/quotes、
// タスク4系）から算出する値で、まだ実データが無いため表示しない。評価（rating）は
// 自由入力の列としてそのまま使う。AIのおすすめ度（recommendScore）も見積の実績データが
// 前提のため、このタスク（3-5）では省略する。
import { Phone, Star } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
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
  searchParams: Promise<{ partner?: string; q?: string; trade?: string }>;
}) {
  const { partner: partnerId, q, trade } = await searchParams;
  const { supabase, orgName } = await requireOrgContext();

  const [{ data: partners }, { data: lotRows }] = await Promise.all([
    supabase
      .from("partners")
      .select("id, name, person, tel, email, base, trades, areas, rating, memo, active")
      .order("name")
      .returns<PartnerRow[]>(),
    supabase
      .from("tenders")
      .select("id, tender_lots(trade)")
      .eq("collect_status", "公開中")
      .returns<{ id: string; tender_lots: { trade: string | null }[] }[]>(),
  ]);

  const allTrades = Array.from(new Set((partners ?? []).flatMap((p) => p.trades ?? []))).sort();
  const rows = (partners ?? []).filter((p) => {
    if (trade && trade !== "すべて" && !p.trades.includes(trade)) return false;
    if (q && !p.name.includes(q) && !(p.base ?? "").includes(q)) return false;
    return true;
  });

  const requiredTrades = Array.from(
    new Set((lotRows ?? []).flatMap((t) => t.tender_lots.map((l) => l.trade).filter((t): t is string => !!t))),
  );
  const activeTrades = new Set((partners ?? []).filter((p) => p.active).flatMap((p) => p.trades ?? []));
  const missingTrades = requiredTrades.filter((t) => !activeTrades.has(t));

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

  return (
    <AppShell active="partners" orgName={orgName}>
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
                      <Link href={`/partners?partner=${p.id}`} className="font-medium hover:underline">
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

      {missingTrades.length > 0 && (
        <Panel title="登録が不足している業種">
          <p className="text-xs text-slate-600">
            {missingTrades.join("・")}（この業種が必要な案件では適合率が下がります）
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
