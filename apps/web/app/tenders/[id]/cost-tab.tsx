"use client";

// 見積・原価。docs/ai-nyusatsu-bu-prototype-v7.jsx の CompareTab 相当。
// 文言と計算式はプロトタイプのものをそのまま使う（CLAUDE.md「表現を変えない」）。
//
// 積算そのものは行わない（CLAUDE.md「やらないこと」）。協力会社から届いた見積金額を
// 業種ごとに1社ぶん選んで足し、一般管理費と利益を乗せた「案」を出すところまで。
//
// 金額は担当者の手入力で記録する。回答ページ（/q/[token]）では金額を受け付けない方針のため
// （正式な見積書として弱い。ユーザー決定 2026-08-21）。

import { useActionState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { aggregateCost, bidGuide, type MarketRate, type QuoteForCosting } from "@ai-nyusatsu-bu/domain";
import { Panel, Pill, btnClass } from "@/components/ui";
import { adoptQuote, decideBidPrice, setQuoteAmount, type CostActionState } from "./cost-actions";

const initialState: CostActionState = { error: null, saved: false };
const numberInput =
  "w-28 rounded border border-slate-300 bg-white px-1.5 py-1 text-right text-xs tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300";

function yen(value: number): string {
  return `${value.toLocaleString("ja-JP")}円`;
}

function AmountForm({ tenderId, quoteId, amount }: { tenderId: string; quoteId: string; amount: number | null }) {
  const bound = setQuoteAmount.bind(null, tenderId, quoteId);
  const [state, formAction, pending] = useActionState(bound, initialState);
  return (
    <form action={formAction} className="flex items-center justify-end gap-1">
      <input name="amount" defaultValue={amount ?? ""} placeholder="未回答" inputMode="numeric" className={numberInput} />
      <button type="submit" disabled={pending} className={btnClass("default", "sm")}>
        {pending ? "…" : "保存"}
      </button>
      {state.error && <span className="text-xs text-rose-700">{state.error}</span>}
    </form>
  );
}

export type CostTabQuote = QuoteForCosting & { repliedAt: string | null; memo: string | null };

export function CostTab({
  tenderId,
  quotes,
  rates,
  budget,
  item,
  marketRate,
  decidedBidPrice,
}: {
  tenderId: string;
  quotes: CostTabQuote[];
  rates: { overheadRate: number; profitRate: number };
  budget: number | null;
  item: string | null;
  marketRate: MarketRate | null;
  decidedBidPrice: number | null;
}) {
  const [state, formAction, pending] = useActionState(decideBidPrice.bind(null, tenderId), initialState);

  if (quotes.length === 0) {
    return (
      <Panel title="見積・原価">
        <p className="text-xs text-slate-600">まだ見積依頼を送っていません。</p>
      </Panel>
    );
  }

  const estimate = aggregateCost(quotes, rates);
  const guide = bidGuide(estimate.bid, budget, marketRate);

  return (
    <div className="space-y-3">
      {estimate.rows.map((row) => {
        const rows = quotes.filter((q) => q.trade === row.trade);
        return (
          <Panel key={row.trade} title={`${row.trade}（${row.answered}/${row.requested}社 回答）`} dense>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">採用</th>
                    <th className="px-2 py-2 font-medium">会社</th>
                    <th className="px-2 py-2 text-right font-medium">金額（税抜）</th>
                    <th className="px-2 py-2 text-right font-medium">最安差</th>
                    <th className="px-2 py-2 font-medium">回答</th>
                    <th className="px-2 py-2 font-medium">メモ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((q) => {
                    const isAdopted = row.adopted?.id === q.id;
                    const isLowest = q.amount !== null && q.amount === row.lowestAmount;
                    return (
                      <tr key={q.id} className={`border-t border-slate-100 ${isAdopted ? "bg-emerald-50" : ""}`}>
                        <td className="px-3 py-2">
                          <form action={adoptQuote.bind(null, tenderId, row.trade, q.id)}>
                            <button
                              type="submit"
                              disabled={q.amount === null || (isAdopted && !row.autoSelected)}
                              className={btnClass(isAdopted ? "primary" : "default", "sm")}
                            >
                              {isAdopted ? (row.autoSelected ? "最安（仮）" : "採用中") : "採用"}
                            </button>
                          </form>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium">{q.partnerName}</span>
                            {isLowest && <Pill tone="green">最安</Pill>}
                            {q.declined && <Pill tone="slate">見送り</Pill>}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <AmountForm tenderId={tenderId} quoteId={q.id} amount={q.amount} />
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                          {q.amount !== null && row.lowestAmount !== null
                            ? q.amount === row.lowestAmount
                              ? "—"
                              : `+${(q.amount - row.lowestAmount).toLocaleString("ja-JP")}`
                            : "—"}
                        </td>
                        <td className="px-2 py-2 text-slate-600">
                          {q.repliedAt ? (
                            new Date(q.repliedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
                          ) : (
                            <span className="text-amber-700">未回答</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-slate-600">{q.memo || <span className="text-slate-300">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        );
      })}

      <Panel title="原価集計と応札価格の検討" right={<span className="text-xs text-slate-400">積算そのものは行いません</span>}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">業種</th>
                <th className="px-2 py-2 font-medium">採用する会社</th>
                <th className="px-2 py-2 text-right font-medium">金額</th>
                <th className="px-2 py-2 font-medium">状態</th>
              </tr>
            </thead>
            <tbody>
              {estimate.rows.map((r) => (
                <tr key={r.trade} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{r.trade}</td>
                  <td className="px-2 py-2">
                    {r.adopted ? r.adopted.partnerName : <span className="text-slate-400">未定</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.adopted ? yen(r.adopted.amount) : "—"}</td>
                  <td className="px-2 py-2">
                    {r.waiting > 0 ? <Pill tone="amber">未回答 {r.waiting}社</Pill> : <Pill tone="green">確定可</Pill>}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 bg-slate-50">
                <td className="px-3 py-2 font-semibold" colSpan={2}>
                  協力会社の原価 合計
                </td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">{yen(estimate.cost)}</td>
                <td />
              </tr>
              <tr className="border-t border-slate-100">
                <td className="px-3 py-2" colSpan={2}>
                  一般管理費（{Math.round(rates.overheadRate * 100)}%）
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{yen(estimate.overhead)}</td>
                <td />
              </tr>
              <tr className="border-t border-slate-100">
                <td className="px-3 py-2" colSpan={2}>
                  利益（{Math.round(rates.profitRate * 100)}%）
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{yen(estimate.profit)}</td>
                <td />
              </tr>
              <tr className="border-t-2 border-slate-300 bg-blue-50">
                <td className="px-3 py-2 font-semibold text-blue-900" colSpan={2}>
                  応札価格の案（税抜）
                </td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums text-blue-900">{yen(estimate.bid)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          一般管理費率・目標利益率は「自社情報」で変更できます。
        </p>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded border border-slate-200 p-2.5">
            <div className="text-xs font-semibold">勝てそうかの目安</div>
            {guide.target !== null && marketRate && budget !== null ? (
              <>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  同種案件（{item ?? "営業品目 未確認"}）の落札率は平均 {(marketRate.rate * 100).toFixed(1)}%（{marketRate.n}件）。
                  予定価格 {yen(budget)} に当てはめると、目安のラインは {yen(guide.target)} です。
                </p>
                <div className="mt-2">
                  {guide.withinTarget ? (
                    <Pill tone="green">
                      <CheckCircle2 size={12} /> 応札価格案は目安ライン内（差 {yen(Math.abs(guide.overBy ?? 0))}）
                    </Pill>
                  ) : (
                    <Pill tone="rose">
                      <AlertTriangle size={12} /> 目安ラインを {yen(guide.overBy ?? 0)} 超過。利益率か原価の見直しが必要
                    </Pill>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-1 text-xs text-slate-600">
                {budget === null
                  ? "予定価格が非公表のため、目安ラインは出せません。過去の類似案件を参考にしてください。"
                  : "同種案件の落札実績がまだ足りないため、目安ラインは出せません。"}
              </p>
            )}
          </div>

          <div className="rounded border border-slate-200 p-2.5">
            <div className="text-xs font-semibold">価格を決める</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {estimate.hasMissingTrade
                ? "金額が入っていない業種があります。原価は揃っていません。"
                : estimate.waiting > 0
                  ? `未回答が ${estimate.waiting}社あります。締め切ってから決めることもできます。`
                  : "すべての業種で見積が揃っています。"}
            </p>
            {state.error && <p className="mt-2 rounded bg-rose-50 px-2 py-1.5 text-xs text-rose-800">{state.error}</p>}
            <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
              <input name="bid_price" defaultValue={decidedBidPrice ?? estimate.bid} inputMode="numeric" className={numberInput} />
              <button type="submit" disabled={pending} className={btnClass("primary", "sm")}>
                {pending ? "記録しています…" : "この価格に決定する"}
              </button>
            </form>
            {decidedBidPrice !== null && <p className="mt-2 text-xs text-emerald-700">決定済み：{yen(decidedBidPrice)}</p>}
          </div>
        </div>
      </Panel>
    </div>
  );
}
