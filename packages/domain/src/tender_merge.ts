// AI解析（プロンプト1：基本情報と期限）の結果を、既存のtendersの値へ安全にマージする
// 純ロジック（タスク2-4）。参照：docs/実装仕様書_v1.md §2（tenders）
//
// コネクタ（GEPS/KKJ）が既に確定値を持っている列は、AI解析結果で上書きしない
// （一次情報源のコネクタを優先する）。空欄（null・空配列・qual_categoryは"未判定"）だけを
// AI解析の値で埋める。

export type TenderBasicFields = {
  org_unit: string | null;
  submit_deadline: string | null;
  qa_deadline: string | null;
  bid_open_at: string | null;
  term_from: string | null;
  term_to: string | null;
  place: string | null;
  qual_category: string | null;
  item: string | null;
  grade: string | null;
  areas: string[];
  budget: number | null;
};

/**
 * AI解析から渡ってくる値。areasは「判定できない」場合にnullになるため、
 * tendersの現在値（必ず配列）とは型が異なる。
 */
export type ExtractedTenderBasicFields = Omit<TenderBasicFields, "areas"> & { areas: string[] | null };

const UNDETERMINED_QUAL_CATEGORY = "未判定";

/**
 * 現在のtendersの値（current）に対し、AI解析で抽出した値（extracted）のうち
 * 「今は空欄の項目」だけをパッチとして返す。抽出値がnullの項目、既に値がある項目は
 * パッチに含めない。
 */
export function mergeBasicInfoIntoTender(
  current: TenderBasicFields,
  extracted: Partial<ExtractedTenderBasicFields>,
): Partial<TenderBasicFields> {
  const patch: Partial<TenderBasicFields> = {};

  const scalarKeys: Exclude<keyof TenderBasicFields, "areas">[] = [
    "org_unit",
    "submit_deadline",
    "qa_deadline",
    "bid_open_at",
    "term_from",
    "term_to",
    "place",
    "item",
    "grade",
    "budget",
  ];

  for (const key of scalarKeys) {
    const extractedValue = extracted[key];
    if (extractedValue == null) continue;
    if (current[key] != null) continue;
    (patch as Record<string, unknown>)[key] = extractedValue;
  }

  // qual_categoryは「未判定」も空欄扱いにする（GEPS/KKJの既定値のため）。
  if (
    extracted.qual_category != null &&
    (current.qual_category == null || current.qual_category === UNDETERMINED_QUAL_CATEGORY)
  ) {
    patch.qual_category = extracted.qual_category;
  }

  // areasは配列なので「空配列」を空欄扱いにする。
  if (extracted.areas != null && extracted.areas.length > 0 && current.areas.length === 0) {
    patch.areas = extracted.areas;
  }

  return patch;
}
