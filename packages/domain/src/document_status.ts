// 資料の取得状況を判定する純ロジック（CLAUDE.md 最重要の前提7）。
//
// docs/資料取得方針_v3.md「資料が無い理由を2つに分ける」より：
//   機関が出していない（正常）… 数量表が存在しない役務案件など。アラートしない。
//                               UIは「この案件には数量表がありません」
//   取得に失敗した（要対応）  … リンク切れ、ICカードが必要、OCR失敗など。
//                               UIは「取得できていません」
//
// 「ありません」と「取れていません」は意味が違う。混同すると失敗アラートがノイズだらけになり、
// 本当に手当てが要る案件が埋もれる。

/** 揃えたい資料の5種類（docs/資料取得方針_v3.md §0-2）。表示順でもある。 */
export const REQUIRED_DOC_KINDS = ["公告", "入札説明書", "仕様書", "数量表", "様式"] as const;

export type RequiredDocKind = (typeof REQUIRED_DOC_KINDS)[number];

export type DocumentAvailabilityStatus =
  /** 取得できている */
  | "取得済"
  /** 取得はできたが本文を読めていない（OCR失敗など）。解析に使えないため要対応 */
  | "本文なし"
  /** 機関がそもそも出していない。正常な状態でアラートしない */
  | "未公開"
  /** 取得に失敗した。手動取得の対象 */
  | "取得失敗"
  /** まだ資料一覧を確認していない（巡回前・巡回が途中で落ちた） */
  | "未確認";

/** tender_documents の1行（判定に必要な列だけ）。 */
export type FetchedDocument = {
  kind: string;
  fetched: boolean;
  /** テキスト抽出の失敗理由。埋まっていれば本文を読めていない */
  extract_error?: string | null;
};

/** 案件単位の「資料一覧をいつ・どこまで確認できたか」。tenders の列に対応する。 */
export type DocumentCheck = {
  /** 資料一覧を確認できた日時。null なら未確認 */
  checkedAt: string | null;
  /** 機関が実際に出していた資料種別。確認できた場合のみ意味を持つ */
  publishedKinds: string[];
  /** 資料の取得そのものに失敗したときの理由コード（AUTH_REQUIRED など） */
  failureCode: string | null;
};

export type DocumentAvailability = {
  kind: RequiredDocKind;
  status: DocumentAvailabilityStatus;
  /** 人手での対応が必要か。「未公開」は正常なので false */
  needsAction: boolean;
};

/** 1種別の取得状況を判定する。 */
export function documentAvailability(
  kind: RequiredDocKind,
  documents: FetchedDocument[],
  check: DocumentCheck,
): DocumentAvailability {
  const fetched = documents.find((d) => d.kind === kind && d.fetched);
  if (fetched) {
    // 取得はできている。本文を読めていない場合だけ要対応（AI解析の入力にならないため）。
    return fetched.extract_error
      ? { kind, status: "本文なし", needsAction: true }
      : { kind, status: "取得済", needsAction: false };
  }

  // 取得そのものに失敗している場合は、機関が出しているかどうかを判断できない。
  if (check.failureCode) return { kind, status: "取得失敗", needsAction: true };
  if (!check.checkedAt) return { kind, status: "未確認", needsAction: false };

  // 資料一覧は確認できている。一覧に無かった種別は「機関が出していない」（正常）。
  // 一覧にあったのに行が無い＝ダウンロードか保存で落ちた（要対応）。
  return check.publishedKinds.includes(kind)
    ? { kind, status: "取得失敗", needsAction: true }
    : { kind, status: "未公開", needsAction: false };
}

/** 5種類ぶんの取得状況を、表示順（公告→入札説明書→仕様書→数量表→様式）で返す。 */
export function documentAvailabilities(documents: FetchedDocument[], check: DocumentCheck): DocumentAvailability[] {
  return REQUIRED_DOC_KINDS.map((kind) => documentAvailability(kind, documents, check));
}

export type DocumentSummary = {
  fetched: number;
  /** 機関が出していない（正常）。件数は出すがアラートにはしない */
  notPublished: number;
  /** 手当てが必要な件数（取得失敗・本文なし） */
  needsAction: number;
  unchecked: number;
};

/** 一覧・バッジ用の集計。 */
export function summarizeDocuments(availabilities: DocumentAvailability[]): DocumentSummary {
  return {
    fetched: availabilities.filter((a) => a.status === "取得済").length,
    notPublished: availabilities.filter((a) => a.status === "未公開").length,
    needsAction: availabilities.filter((a) => a.needsAction).length,
    unchecked: availabilities.filter((a) => a.status === "未確認").length,
  };
}
