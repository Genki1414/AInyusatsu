// 原価集計と応札価格の検討（タスク4-5）の純ロジック。
// 参照：docs/ai-nyusatsu-bu-prototype-v7.jsx の costing() と CompareTab（計算式はそのまま）
//
// 【やらないこと】AI積算は行わない（CLAUDE.md「やらないこと」）。
// ここでやるのは、協力会社から集めた見積金額を業種ごとに1社ぶん選んで足し、
// 一般管理費と利益を乗せた「応札価格の案」を出すところまで。金額を作り出さない。

/** 集計に使う見積の1件。DBの列名に合わせている。 */
export type QuoteForCosting = {
  id: string;
  trade: string;
  partnerName: string;
  /** 見積金額（円・税抜）。未回答なら null */
  amount: number | null;
  /** この業種で採用する見積として選ばれている */
  adopted: boolean;
  /** 「今回は見送る」と回答した */
  declined: boolean;
};

export type TradeCostRow = {
  trade: string;
  /** 採用する見積。金額のある見積が1件も無ければ null */
  adopted: { id: string; partnerName: string; amount: number } | null;
  /** 採用が明示されておらず、最安を仮に採用している */
  autoSelected: boolean;
  /** 金額の回答があった件数 */
  answered: number;
  /** 依頼した件数（見送りを含む） */
  requested: number;
  /** まだ回答が無い件数（見送りは数えない。もう返事は来ないため） */
  waiting: number;
  /** 最安の金額。表示で「最安」を出すために使う */
  lowestAmount: number | null;
};

export type CostRates = {
  /** 一般管理費率（例：0.12） */
  overheadRate: number;
  /** 目標利益率（例：0.10） */
  profitRate: number;
};

export type CostEstimate = {
  rows: TradeCostRow[];
  /** 協力会社の原価 合計（円） */
  cost: number;
  /** 一般管理費（円） */
  overhead: number;
  /** 利益（円） */
  profit: number;
  /** 応札価格の案・税抜（円） */
  bid: number;
  /** まだ回答が無い件数の合計 */
  waiting: number;
  /** 金額の回答が1件も無い業種があるか。あれば原価は揃っていない */
  hasMissingTrade: boolean;
};

/**
 * 業種ごとに1社を選び、原価から応札価格の案を出す。
 *
 * 採用する見積は、明示的に選ばれていればそれ、無ければ最安を仮に採用する
 * （プロトタイプと同じ。利用者が何も操作しなくても数字が出るようにするため）。
 * 金額は円単位の整数に丸める（CLAUDE.md「金額は円単位の integer。小数を使わない」）。
 */
export function aggregateCost(quotes: QuoteForCosting[], rates: CostRates): CostEstimate {
  const order: string[] = [];
  const byTrade = new Map<string, QuoteForCosting[]>();
  for (const q of quotes) {
    const list = byTrade.get(q.trade);
    if (list) {
      list.push(q);
    } else {
      byTrade.set(q.trade, [q]);
      order.push(q.trade);
    }
  }

  const rows: TradeCostRow[] = order.map((trade) => {
    const all = byTrade.get(trade)!;
    const answered = all.filter((q) => q.amount !== null);
    const lowest = answered.reduce<QuoteForCosting | null>(
      (best, q) => (best === null || q.amount! < best.amount! ? q : best),
      null,
    );
    const explicit = answered.find((q) => q.adopted) ?? null;
    const picked = explicit ?? lowest;
    return {
      trade,
      adopted: picked ? { id: picked.id, partnerName: picked.partnerName, amount: picked.amount! } : null,
      autoSelected: explicit === null && picked !== null,
      answered: answered.length,
      requested: all.length,
      // 見送りは待っても返事が来ないので、未回答には数えない
      waiting: all.filter((q) => q.amount === null && !q.declined).length,
      lowestAmount: lowest?.amount ?? null,
    };
  });

  const cost = rows.reduce((sum, r) => sum + (r.adopted?.amount ?? 0), 0);
  const overhead = Math.round(cost * rates.overheadRate);
  const profit = Math.round((cost + overhead) * rates.profitRate);
  return {
    rows,
    cost,
    overhead,
    profit,
    bid: cost + overhead + profit,
    waiting: rows.reduce((sum, r) => sum + r.waiting, 0),
    hasMissingTrade: rows.some((r) => r.adopted === null),
  };
}

export type MarketRate = {
  /** 落札率の平均（例：0.95） */
  rate: number;
  /** 集計に使った件数 */
  n: number;
};

export type BidGuide = {
  /** 目安のライン（円）。予定価格が非公表なら null */
  target: number | null;
  /** 応札価格の案が目安ライン内か。目安が出せなければ null */
  withinTarget: boolean | null;
  /** 目安ラインとの差（円）。超過していれば正の値。目安が出せなければ null */
  overBy: number | null;
};

/**
 * 同種案件の落札率から「勝てそうかの目安」を出す。
 *
 * 予定価格が非公表（null）の案件では目安を出さない。落札率だけでは金額に換算できず、
 * 推測で埋めると誤った目安を出すことになる（CLAUDE.md「推測しない」）。
 */
export function bidGuide(bid: number, budget: number | null, marketRate: MarketRate | null): BidGuide {
  if (budget === null || marketRate === null) return { target: null, withinTarget: null, overBy: null };
  const target = Math.round(budget * marketRate.rate);
  return { target, withinTarget: bid <= target, overBy: bid - target };
}
