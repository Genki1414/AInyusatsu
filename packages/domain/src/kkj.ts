// 官公需情報ポータル（KKJ）APIレスポンスの正規化。副作用を持たない純関数のみを置く。
// 参照：docs/reference/KKJ_api_guide.pdf（公式API仕様書。§4「検索結果の出力XMLの形式」）
//
// 【重要】仕様書に「SearchResultタグ内など、一つ上位のタグが同じであるタグの出現順序は、
// 不定です」と明記されているため、タグ名で読む実装にすること（位置ベースの抽出は誤り）。
// 実装はapps/worker/connectors/kkj.tsで行う（このファイルは正規化のみ）。

export type KkjAttachment = {
  name: string;
  uri: string;
};

/** api_guide.pdf §4.1・§4.2 のタグ名に対応する生データ（パース済みXMLから）。 */
export type KkjSearchResultItem = {
  resultId?: string; // 結果一連番号
  key?: string; // システム内で一意のキー
  externalDocumentUri?: string; // 公告を掲載していたURL
  projectName?: string; // 公告の件名
  date?: string; // システムが公告を取得した日時（ISO8601）
  fileType?: string; // pdf | html
  fileSize?: string;
  lgCode?: string; // 都道府県コード（JIS X0401）。国の機関・市区町村にも存在しうる
  prefectureName?: string;
  cityCode?: string; // 市区町村コード（JIS X0402）
  cityName?: string;
  organizationName?: string; // 機関名
  certification?: string; // 参加資格 A/B/C/D。複数存在する場合は空白区切り
  cftIssueDate?: string; // 公告日。存在しない場合はDateと同じ値が入る（仕様書記載）
  periodEndTime?: string; // 納入期限日（ISO8601）
  category?: string; // 物品 | 役務 | 工事
  procedureType?: string; // 一般競争入札 等
  location?: string; // 履行場所・納入場所
  /**
   * 【注意】タグ名は"Deadline"だが、仕様書の日本語説明は「入札開始日」（開始日、期限ではない）。
   * 名称と説明が食い違っているため、そのまま提出期限として扱わない（下記normalizeKkjItem参照）。
   */
  tenderSubmissionDeadline?: string;
  openingTendersEvent?: string; // 開札日（ISO8601）
  itemCode?: string; // 品目分類番号
  projectDescription?: string; // 公告文全文
  attachments?: KkjAttachment[];
};

// "(138.4KB)" "（850KB）" "(1.2MB)" のような、件名末尾に付くファイルサイズ表記を除去する。
// 仕様書のProjectNameの定義にはこの表記は含まれないが、観測された実データに含まれる
// ことがあるため、念のため除去する（無ければ何もしない）。
const FILE_SIZE_SUFFIX_RE = /[\s　]*[（(][\d.,]+\s?[KMGkmg]?[Bb][）)]\s*$/;

export function stripFileSizeSuffix(name: string): string {
  return name.replace(FILE_SIZE_SUFFIX_RE, "").trim();
}

export type NormalizedKkjTender = {
  sourceKey: string; // Key（システム内で一意）
  noticeUrl: string; // ExternalDocumentURI
  name: string; // ProjectName（ファイルサイズ表記があれば除去）
  fetchedAt: string | null; // Date（システムの取得日時）
  noticeDate: string | null; // CftIssueDate（公告日。無ければ取得日と同じ値）
  agencyName: string | null; // OrganizationName
  prefCode: string | null;
  prefName: string | null;
  cityCode: string | null;
  cityName: string | null;
  grade: string | null; // Certification（A/B/C/D）
  periodEndTime: string | null; // 納入期限日。term_toの手がかりにはなるがsubmit_deadlineではない
  procurement: string; // Category（物品/役務/工事）をそのまま保持。推測で正規化しない
  procedureType: string | null;
  place: string | null; // Location
  bidOpenAt: string | null; // OpeningTendersEvent（開札日。仕様書の説明が明確なため採用）
  itemCode: string | null;
  bodyText: string; // ProjectDescription
  attachments: KkjAttachment[];
};

/**
 * KKJの1件を正規化する。空欄・欠損はnullにする（推測で埋めない）。
 *
 * 【意図的に取り込まないフィールド】TenderSubmissionDeadlineは、タグ名は
 * "Deadline"だが仕様書の説明は「入札開始日」であり、意味が確定できない。
 * CLAUDE.mdの方針（期限は推測せず、取れなければnullにする）に従い、この値は
 * NormalizedKkjTenderに含めない（tenders.submit_deadline等には一切マッピングしない）。
 * 期限はAI解析（実資料からの再取得）で確定させる。
 */
export function normalizeKkjItem(item: KkjSearchResultItem): NormalizedKkjTender {
  const rawName = item.projectName?.trim() ?? "";

  return {
    sourceKey: item.key?.trim() ?? "",
    noticeUrl: item.externalDocumentUri?.trim() ?? "",
    name: stripFileSizeSuffix(rawName),
    fetchedAt: item.date?.trim() || null,
    noticeDate: item.cftIssueDate?.trim() || null,
    agencyName: item.organizationName?.trim() || null,
    prefCode: item.lgCode?.trim() || null,
    prefName: item.prefectureName?.trim() || null,
    cityCode: item.cityCode?.trim() || null,
    cityName: item.cityName?.trim() || null,
    grade: item.certification?.trim() || null,
    periodEndTime: item.periodEndTime?.trim() || null,
    procurement: item.category?.trim() || "不明",
    procedureType: item.procedureType?.trim() || null,
    place: item.location?.trim() || null,
    bidOpenAt: item.openingTendersEvent?.trim() || null,
    itemCode: item.itemCode?.trim() || null,
    bodyText: item.projectDescription ?? "",
    attachments: item.attachments ?? [],
  };
}

/**
 * KKJの「公告日」（CftIssueDate）が対象日と一致するかを判定する。
 * 毎朝の差分取得（CFT_Issue_Dateパラメータでの絞り込み）と組み合わせて使う想定。
 */
export function isOnDate(tender: NormalizedKkjTender, targetDateIso: string): boolean {
  return tender.noticeDate === targetDateIso;
}

// --- 検索パラメータ（api_guide.pdf §3） -------------------------------------

export type KkjCategory = "物品" | "工事" | "役務";

const CATEGORY_CODE: Record<KkjCategory, number> = { 物品: 1, 工事: 2, 役務: 3 };

/** 全47都道府県のJIS X0401コード（01〜47）。LG_Codeパラメータに全指定して全国横断にする。 */
export const ALL_PREFECTURE_CODES: string[] = Array.from({ length: 47 }, (_, i) =>
  String(i + 1).padStart(2, "0"),
);

export type KkjSearchParams = {
  /** 公告日（またはデータ取得日）での絞り込み。YYYY-MM-DD（1日分の場合は開始終了日形式）。 */
  cftIssueDate: string;
  category?: KkjCategory;
  count?: number; // 既定10、最大1000（api_guide.pdf §3）
};

/**
 * 検索APIのクエリパラメータを組み立てる。
 * Query/Project_Name/Organization_Name/LG_Codeのいずれか1つが必須（api_guide.pdf §3）のため、
 * 全国横断で日付だけを条件にしたい場合はLG_Codeに全都道府県コードを指定する。
 */
export function buildKkjQuery(params: KkjSearchParams): Record<string, string> {
  const query: Record<string, string> = {
    LG_Code: ALL_PREFECTURE_CODES.join(","),
    CFT_Issue_Date: params.cftIssueDate,
    Count: String(params.count ?? 1000),
  };
  if (params.category) {
    query.Category = String(CATEGORY_CODE[params.category]);
  }
  return query;
}
