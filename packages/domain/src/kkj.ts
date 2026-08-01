// 官公需情報ポータル（KKJ）APIレスポンスの正規化。副作用を持たない純関数のみを置く。
// 参照：docs/案件収集戦略_v2.md §1-2, §8
//
// 【重要】KKJのXMLタグ名・日付絞り込みパラメータ・ページングの仕様は未確認（本セッションの
// ネットワークポリシーで www.kkj.go.jp に到達できないため）。ここでは案件収集戦略_v2.md に
// 記載された実例（実際にAPIを叩いて確認済みのフィールド内容）を元に、
// 「フィールドの並び順」を信頼して正規化ロジックを実装している。
// タグ名そのものへの依存を避けるため、XML→フィールド抽出は位置ベースで行う設計にすること
// （apps/worker/connectors/kkj.ts 側の責務）。
// 詳細：docs/reference/KKJ_API_確認事項.md

/** 案件収集戦略_v2.md §8 の実レスポンス分析に基づくフィールドの並び順（16項目）。 */
export type KkjRawFields = {
  idBase64: string; // 2. ID（Base64） 例: "fukushima/tamura_city/2026/20260731_01361" をbase64化
  noticeUrl: string; // 3. 公告PDFのURL
  nameWithSize: string; // 4. 件名（ファイルサイズ付き） 例: "○○業務委託 (138.4KB)"
  registeredAt: string; // 5. 日時（登録日時と思われる） 例: "2026-07-07T19:07:43+09:00"
  fileFormat: string; // 6. 形式 例: "pdf"
  fileSize: string; // 7. サイズ（バイト数）
  prefCode: string; // 8. 都道府県コード 例: "07"
  prefName: string; // 9. 都道府県名 例: "福島県"
  cityCode: string; // 10. 市区町村コード 例: "072117"
  cityName: string; // 11. 市区町村名 例: "田村市"
  areaName: string; // 12. 地域名 例: "福島県田村市"
  noticeDate: string; // 13. 日付（公告日と思われる） 例: "2026-07-31"
  procurementType: string; // 14. 調達種別 例: "役務" | "工事"
  nameRepeated: string; // 15. 件名（再掲）
  bodyText: string; // 16. 公告本文のテキスト全文
};

export type KkjDecodedId = {
  prefKey: string;
  agencyKey: string;
  year: string;
  dateSeq: string;
};

/**
 * Base64のIDを "都道府県/機関/年/日付_連番" にデコードする。
 * 想定と異なる形式（"/"区切りが4つでない）の場合は null（推測しない）。
 */
export function decodeKkjId(idBase64: string): KkjDecodedId | null {
  let decoded: string;
  try {
    decoded = Buffer.from(idBase64, "base64").toString("utf-8");
  } catch {
    return null;
  }
  const parts = decoded.split("/");
  if (parts.length !== 4) return null;
  const [prefKey, agencyKey, year, dateSeq] = parts;
  if (!prefKey || !agencyKey || !year || !dateSeq) return null;
  return { prefKey, agencyKey, year, dateSeq };
}

// "(138.4KB)" "（850KB）" "(1.2MB)" のような、件名末尾に付くファイルサイズ表記を除去する。
const FILE_SIZE_SUFFIX_RE = /[\s　]*[（(][\d.,]+\s?[KMGkmg]?[Bb][）)]\s*$/;

/** 件名末尾のファイルサイズ表記（例: " (138.4KB)"）を除去する。 */
export function stripFileSizeSuffix(name: string): string {
  return name.replace(FILE_SIZE_SUFFIX_RE, "").trim();
}

export type KkjTenderSeed = {
  sourceId: string; // 元のBase64 ID。重複排除の補助・調査用に保持する
  prefKey: string | null;
  agencyKey: string | null;
  year: string | null;
  noticeUrl: string;
  name: string; // ファイルサイズ表記を除去した件名
  registeredAt: string | null; // ISO8601（登録日時と思われる。要検証）
  noticeDate: string | null; // YYYY-MM-DD（公告日と思われる。要検証）
  areaName: string | null;
  prefCode: string | null;
  prefName: string | null;
  cityCode: string | null;
  cityName: string | null;
  procurement: string; // 役務 / 工事 / 物品 等。KKJの値をそのまま保持し、推測で正規化しない
  bodyText: string;
};

/**
 * KKJのフィールド（位置ベースで抽出済み）を正規化する。
 * 空欄・欠損は null にする（推測で埋めない）。件名は15(再掲)を優先し、無ければ4を使う。
 */
export function normalizeKkjItem(fields: Partial<KkjRawFields>): KkjTenderSeed {
  const decoded = fields.idBase64 ? decodeKkjId(fields.idBase64) : null;
  const rawName = (fields.nameRepeated?.trim() || fields.nameWithSize?.trim() || "").trim();

  return {
    sourceId: fields.idBase64 ?? "",
    prefKey: decoded?.prefKey ?? null,
    agencyKey: decoded?.agencyKey ?? null,
    year: decoded?.year ?? null,
    noticeUrl: fields.noticeUrl?.trim() ?? "",
    name: stripFileSizeSuffix(rawName),
    registeredAt: fields.registeredAt?.trim() || null,
    noticeDate: fields.noticeDate?.trim() || null,
    areaName: fields.areaName?.trim() || null,
    prefCode: fields.prefCode?.trim() || null,
    prefName: fields.prefName?.trim() || null,
    cityCode: fields.cityCode?.trim() || null,
    cityName: fields.cityName?.trim() || null,
    procurement: fields.procurementType?.trim() || "不明",
    bodyText: fields.bodyText ?? "",
  };
}

/**
 * KKJの「日付」（フィールド13。公告日と思われる。要検証）が対象日と一致するかを判定する。
 * 毎朝の差分取得（「登録日＝昨日」）のフィルタリングに使う想定。
 * どちらの日付フィールドが差分判定に適切かは docs/reference/KKJ_API_確認事項.md の
 * 未確認事項1（日時フィールドの意味）が解決してから確定させること。
 */
export function isOnDate(seed: KkjTenderSeed, targetDateIso: string): boolean {
  return seed.noticeDate === targetDateIso;
}
