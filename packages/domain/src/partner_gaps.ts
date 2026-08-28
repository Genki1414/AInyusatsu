// いま足りていない協力会社を出す（9月分：協力会社開拓）。
//
// 【なぜ必要か】
// 見積依頼は業種ごとに出す。提案された案件に必要な業種の協力会社が1社もいないと、
// その業種の見積が取れず、案件そのものを諦めることになる。
// いまの画面は「登録してある会社」しか見せていないので、
// 「何が足りないか」は案件を開くまで分からない。
//
// 【提案中の案件から逆算する】
// 業種の一覧を眺めても開拓の順番は決まらない。いま自社に提案されている案件で
// 実際に必要になっている業種を数え、多い順に出す。
//
// 【メールアドレスが無い会社は数えない】
// 見積依頼はメールで送る（回答ページのURLを本文に入れる）。
// 電話番号しか無い会社は、登録されていても依頼を出せない。
// 「登録はあるが依頼できない」は、いないのと同じくらい困るので分けて見せる。

/** 相見積を取るのに要る社数。1社だけだと言い値になる。 */
export const MIN_PARTNERS_FOR_QUOTES = 2;

export type PartnerForGap = {
  trades: string[];
  email: string | null;
  active: boolean;
};

/** 提案中の案件で必要になっている業種と、その業種を含む案件の件数。 */
export type TradeDemand = { trade: string; tenders: number };

export type TradeGap = {
  trade: string;
  /** その業種を含む、提案中の案件の件数 */
  tenders: number;
  /** いま依頼できる協力会社の数（稼働中・メール登録あり・対応業種） */
  ready: number;
  /** 対応業種は合うが、メールアドレスが無くて依頼できない会社の数 */
  noEmail: number;
};

export type PartnerGapResult = {
  /** 依頼先が1社もいない業種。案件の件数が多い順 */
  missing: TradeGap[];
  /** 1社しかいない業種。相見積が取れない */
  thin: TradeGap[];
  /** 足りている業種の数 */
  covered: number;
};

/**
 * その協力会社がその業種を引き受けられるか。
 *
 * 対応業種が未登録（空）の会社は、どの業種の候補にもする。
 * 見積依頼のおすすめ（apps/web/app/tenders/[id]/recommend.ts）と同じ扱いにする。
 * ここだけ厳しくすると、画面では「いない」と出るのに依頼画面には出てくる。
 */
function canTake(partner: PartnerForGap, trade: string): boolean {
  return partner.active && (partner.trades.length === 0 || partner.trades.includes(trade));
}

/** 業種ごとの過不足を出す。 */
export function findPartnerGaps(demands: TradeDemand[], partners: PartnerForGap[]): PartnerGapResult {
  const rows: TradeGap[] = demands.map((demand) => {
    const able = partners.filter((partner) => canTake(partner, demand.trade));
    const ready = able.filter((partner) => (partner.email ?? "").trim() !== "").length;
    return { trade: demand.trade, tenders: demand.tenders, ready, noEmail: able.length - ready };
  });

  // 案件の件数が多い順。同数なら業種名で並べて、実行のたびに順番が変わらないようにする
  const byPriority = (a: TradeGap, b: TradeGap) =>
    b.tenders - a.tenders || a.trade.localeCompare(b.trade, "ja");

  return {
    missing: rows.filter((row) => row.ready === 0).sort(byPriority),
    thin: rows.filter((row) => row.ready > 0 && row.ready < MIN_PARTNERS_FOR_QUOTES).sort(byPriority),
    covered: rows.filter((row) => row.ready >= MIN_PARTNERS_FOR_QUOTES).length,
  };
}

/**
 * 案件ごとの業種一覧から、業種の需要を数える。
 * 同じ案件に同じ業種が何行あっても1件と数える（数量表の行数ではなく案件数を見たい）。
 */
export function countTradeDemand(tenderTrades: { tenderId: string; trade: string | null }[]): TradeDemand[] {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const row of tenderTrades) {
    const trade = row.trade?.trim();
    if (!trade) continue;
    const key = `${row.tenderId} ${trade}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts.set(trade, (counts.get(trade) ?? 0) + 1);
  }
  return [...counts.entries()].map(([trade, tenders]) => ({ trade, tenders }));
}
