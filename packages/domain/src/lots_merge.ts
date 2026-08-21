// AI解析（プロンプト3：数量表の構造化と業種割当）の結果を、tender_lotsへの保存前に
// 整える純ロジック（タスク2-5）。参照：docs/AI解析プロンプト集.md §3「抽出後の検証」

export type LotRow = {
  line_no: number;
  item: string;
  spec: string | null;
  qty: number | null;
  unit: string | null;
  trade: string | null;
  // 業種割当の確からしさ。AIが判定できなかった行では null（tender_lots.confidence も nullable）
  confidence: number | null;
};

/**
 * line_noが重複している行を取り除く。
 * tender_lotsは unique(tender_id, line_no) 制約があるため、AI解析結果に重複が
 * 含まれたまま挿入すると、その1件のせいで全件挿入が失敗してしまう
 * （resultsの並び順で先に出てきた行を優先し、後続の重複は捨てる）。
 */
export function dedupeLotsByLineNo(lots: LotRow[]): LotRow[] {
  const seen = new Set<number>();
  const result: LotRow[] = [];
  for (const lot of lots) {
    if (seen.has(lot.line_no)) continue;
    seen.add(lot.line_no);
    result.push(lot);
  }
  return result;
}
