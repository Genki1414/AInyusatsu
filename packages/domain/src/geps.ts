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
  // ポータルが明示的に「その他」と分類している資料は、その判断を尊重してファイル名で
  // 上書きしない（例：「電子調達システムによる入札説明書等資料交付について.pdf」は
  // 入札説明書そのものではない）。資料種別が取れなかった場合だけファイル名で補う。
  if (category === "その他") return "その他";
  return classifyDocumentKindByFilename(name);
}

/**
 * 資料種別が取れなかった場合に、ファイル名だけで分類する。
 * 添付一覧のスクレイピングに失敗すると資料種別が空になり、全ての資料が「その他」に
 * 落ちてしまうため（実機で確認：高田河川国道事務所縁石等修繕作業）、ファイル名からの
 * 判定を併用する。参照：docs/資料取得方針_v3.md §0-1「ファイル名からの判定と併用すれば精度が上がる」
 * 判断できない場合は推測せず「その他」のままにする。
 */
export function classifyDocumentKindByFilename(filename: string): DocKind {
  const name = filename.trim();
  // 数量表は仕様書より先に判定する（「数量総括表」は仕様書関連の資料でもあるため）
  if (/数量|内訳/.test(name)) return "数量表";
  if (/様式|提出書類/.test(name)) return "様式";
  if (/入札説明書|入札説明|説明書/.test(name)) return "入札説明書";
  if (/公告|公示/.test(name)) return "公告";
  if (/仕様書|仕様/.test(name)) return "仕様書";
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
  /**
   * 公開開始日。詳細画面に表示されている文字列そのまま（生の表記）を渡す。
   * 実データ確認済み（2026-08-01）：「令和08年07月31日」のような和暦表記。
   * ISO日付への変換はnormalizeGepsTender側（normalizeNoticeDate）で行う。
   */
  publicFrom: string | null;
  agencyName: string; // 調達機関
  place: string | null; // 所在地
  /** 「公告内容」が外部サイトへのリンクの場合のURL。ポータル内で完結する場合はnull。 */
  announcementUrl: string | null;
};

// 令和1年 = 2019年。dedupe.tsのREIWA_OFFSETと同じ考え方（GEPSは案件名ではなく日付表示に使う）。
const REIWA_OFFSET = 2018;

/**
 * GEPS詳細画面の「公開開始日」表記をISO日付(YYYY-MM-DD)に正規化する。
 * 実データ確認済み（2026-08-01）：「令和08年07月31日」のような和暦・ゼロ埋め表記で、
 * 末尾に空白が付くことがある。変換できない表記は推測せずnullにする。
 */
export function normalizeGepsNoticeDate(raw: string | null): string | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === "") return null;

  const reiwa = /^令和(元|\d+)年(\d{1,2})月(\d{1,2})日$/.exec(s);
  if (reiwa) {
    const reiwaYear = reiwa[1] === "元" ? 1 : Number(reiwa[1]);
    const year = reiwaYear + REIWA_OFFSET;
    return `${year}-${reiwa[2].padStart(2, "0")}-${reiwa[3].padStart(2, "0")}`;
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return s;

  return null;
}

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
    noticeDate: normalizeGepsNoticeDate(detail.publicFrom),
    sourceUrl: detail.announcementUrl ?? portalDetailUrl,
    dedupeKey: key,
  };
}

/**
 * ZIP内のファイル名をデコードする。
 * 調達ポータルの資料zipはファイル名がShift_JIS(CP932)で入っており、UTF-8として読むと
 * 文字化けする（実機で確認：協力会社へ送った資料名が「3.�d�l��.pdf」になった）。
 * ZIPのgeneral purpose bit 11（0x800）が立っていればUTF-8、立っていなければCP932として読む。
 *
 * @param rawName ZIPヘッダに入っている生のファイル名（バイト列）
 * @param utf8Flag general purpose bit 11 が立っているか
 * @param fallback デコードに失敗した場合に使う名前（AdmZipがUTF-8として解釈した文字列）
 */
export function decodeZipEntryName(rawName: Uint8Array, utf8Flag: boolean, fallback: string): string {
  if (utf8Flag) return fallback;
  try {
    // Node.jsのTextDecoderはICU同梱ビルドでshift_jisを扱える。
    // 扱えない環境では例外になるので、その場合はUTF-8解釈のまま使う（推測で壊さない）。
    const decoded = new TextDecoder("shift_jis", { fatal: true }).decode(rawName);
    return decoded;
  } catch {
    return fallback;
  }
}
