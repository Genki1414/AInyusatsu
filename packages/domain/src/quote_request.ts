// 見積依頼（タスク4-1）：数量表を業種ごとに切り出し、依頼メールの件名・本文を組み立てる。
// 参照：docs/ai-nyusatsu-bu-prototype-v7.jsx の RequestTab（文面のスタイルを踏襲）
//
// 実際の送信は packages/notifications/adapters が担当する。ここでは副作用の無い純ロジックのみ。

export type QuoteRequestLot = {
  line_no: number;
  item: string;
  spec: string | null;
  qty: number | string | null;
  unit: string | null;
  trade: string | null;
};

export type TradeLots<T extends QuoteRequestLot = QuoteRequestLot> = { trade: string; lots: T[] };

/**
 * 数量表（tender_lots）を業種ごとにグループ化する。業種が未判定（trade=null）の行は対象外。
 * ジェネリクスにしているのは、呼び出し側がid等の追加フィールドを持つ行を渡しても
 * グループ化後にそのフィールドを保持できるようにするため（例：DB保存時に必要なlot.id）。
 */
export function groupLotsByTrade<T extends QuoteRequestLot>(lots: T[]): TradeLots<T>[] {
  const order: string[] = [];
  const map = new Map<string, T[]>();
  for (const lot of lots) {
    if (!lot.trade) continue;
    const list = map.get(lot.trade);
    if (list) {
      list.push(lot);
    } else {
      map.set(lot.trade, [lot]);
      order.push(lot.trade);
    }
  }
  return order.map((trade) => ({ trade, lots: map.get(trade)! }));
}

export type QuoteRequestEmailInput = {
  senderOrgName: string; // 送信元（自社）の名称。挨拶文・署名に使う
  senderContactName: string; // 送信元の担当者名（署名に使う）
  senderContactEmail: string; // 送信元の連絡先メールアドレス（署名に使う）
  tenderName: string;
  agencyName: string;
  place: string | null;
  termFrom: string | null;
  termTo: string | null;
  dueAtLabel: string; // 表示用に整形済みの文字列（timezone変換は呼び出し側の責務）
  trade: string;
  lots: QuoteRequestLot[];
};

function formatLotLine(lot: QuoteRequestLot): string {
  const spec = lot.spec ? `（${lot.spec}）` : "";
  const qty = lot.qty != null ? `${lot.qty}${lot.unit ?? ""}` : "";
  return `${lot.line_no}. ${lot.item}${spec} ${qty}`.trimEnd();
}

/** 依頼メールの件名・本文を組み立てる（編集前のひな形。呼び出し側で編集可能にする想定）。 */
export function buildQuoteRequestEmail(input: QuoteRequestEmailInput): { subject: string; body: string } {
  const subject = `【見積依頼】${input.tenderName}`;
  const lines: string[] = [
    "お世話になっております。",
    `${input.senderOrgName}でございます。`,
    "",
    `${input.agencyName} 発注の下記案件について、${input.trade}のお見積りをお願いできますでしょうか。`,
    "",
    `案件名：${input.tenderName}`,
    `履行場所：${input.place ?? "未確認"}`,
    `履行期間：${input.termFrom ?? "未確認"} 〜 ${input.termTo ?? "未確認"}`,
    `回答期限：${input.dueAtLabel}`,
    "",
    "【対象範囲】",
    ...input.lots.map(formatLotLine),
    "",
    "お忙しいところ恐れ入りますが、ご都合が合わない場合もその旨をご返信いただけますと幸いです。",
    "どうぞよろしくお願いいたします。",
    "",
    "--",
    input.senderOrgName,
    input.senderContactName,
    input.senderContactEmail,
  ];
  return { subject, body: lines.join("\n") };
}
