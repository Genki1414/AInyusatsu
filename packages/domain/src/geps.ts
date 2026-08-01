// 調達ポータル（GEPS）のレスポンス正規化。副作用を持たない純関数のみを置く。
// 参照：docs/調達ポータルコネクタ設計.md §0, §2-5

import { agencyIdFromName } from "./agency";
import { dedupeKey } from "./dedupe";

export type DocKind = "公告" | "入札説明書" | "仕様書" | "数量表" | "様式" | "その他";

/**
 * 調達ポータルの「資料種別」とファイル名から、こちらの5分類（+その他）に変換する。
 * 参照：docs/調達ポータルコネクタ設計.md §2-5「資料種別のマッピング」
 *   調達案件情報関連 → 公告
 *   調達説明書関連   → 入札説明書／様式（ファイル名で判別）
 *   仕様書関連       → 仕様書／数量表（「数量」「内訳」を含めば数量表）
 *   契約書関連       → その他
 *   その他           → その他
 */
export function classifyDocumentKind(portalCategory: string, filename: string): DocKind {
  const category = portalCategory.trim();
  const name = filename.trim();

  if (category === "調達案件情報関連") return "公告";
  if (category === "契約書関連") return "その他";
  if (category === "調達説明書関連") {
    return /様式|提出/.test(name) ? "様式" : "入札説明書";
  }
  if (category === "仕様書関連") {
    return /数量|内訳/.test(name) ? "数量表" : "仕様書";
  }
  return "その他";
}

/**
 * 検索結果件数が500件ちょうどの場合、表示上限による打ち切りを疑う。
 * 参照：docs/調達ポータルコネクタ設計.md §0「検索結果は最大500件までしか表示されない」
 */
export function isSearchTruncated(count: number): boolean {
  return count >= 500;
}

export type GepsCategory = "物品" | "役務";

export type GepsDetail = {
  procurementNo: string; // 調達案件番号（19桁）
  category: GepsCategory; // 分類
  name: string; // 調達案件名称
  publicFrom: string | null; // 公開開始日 YYYY-MM-DD
  agencyName: string; // 調達機関
  place: string | null; // 所在地
  /** 「公告内容」が外部サイトへのリンクの場合のURL。ポータル内で完結する場合はnull。 */
  announcementUrl: string | null;
};

export type NormalizedGepsTender = {
  procurementNo: string;
  code: string;
  agencyId: string;
  agencyName: string;
  name: string;
  procurement: GepsCategory;
  /**
   * 資格区分（役務の提供等 等）。GEPSの検索結果・詳細画面からは確定できないため、
   * 推測せず "未判定" とする（資料取得方針_v3.md の「判定できない項目は推測せず
   * 『未判定』と明示する」方針に合わせる）。AI解析（公告PDF）で確定させる。
   */
  qualCategory: string;
  place: string | null;
  noticeDate: string | null;
  /** 公告内容の外部リンクがあればそれを、無ければポータルの詳細ページURLを使う。 */
  sourceUrl: string;
  dedupeKey: string;
};

/**
 * 提出期限は検索結果・公示本文のいずれからも確定できない（「入札」ボタンの先はICカード
 * ログインが必要でGEPS側にあり自動化しない）。そのためdedupe_keyの日付部分は
 * "unknown" になる（dedupeKeyの既定の挙動）。期限はAI解析で公告PDFから取り直す。
 */
export function normalizeGepsTender(detail: GepsDetail, portalDetailUrl: string): NormalizedGepsTender {
  const agencyId = agencyIdFromName(detail.agencyName);
  const key = dedupeKey({
    agencyId,
    noticeNo: detail.procurementNo,
    name: detail.name,
    submitDeadline: null,
  });

  return {
    procurementNo: detail.procurementNo,
    code: detail.procurementNo,
    agencyId,
    agencyName: detail.agencyName,
    name: detail.name,
    procurement: detail.category,
    qualCategory: "未判定",
    place: detail.place,
    noticeDate: detail.publicFrom,
    sourceUrl: detail.announcementUrl ?? portalDetailUrl,
    dedupeKey: key,
  };
}
