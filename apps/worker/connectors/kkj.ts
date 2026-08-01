// 官公需情報ポータル（KKJ）APIクライアント。
// 参照：docs/reference/KKJ_api_guide.pdf（公式API仕様書 V1.1）、docs/reference/KKJ_API_確認事項.md
//
// 仕様書の明記どおり、SearchResult内の子タグの出現順序は不定なため、タグ名で読む
// （位置ベースの抽出はしない）。正規化ロジックはpackages/domain/src/kkj.tsに置く。

import { XMLParser } from "fast-xml-parser";
import {
  buildKkjQuery,
  normalizeKkjItem,
  type KkjCategory,
  type KkjSearchResultItem,
  type NormalizedKkjTender,
} from "@ai-nyusatsu-bu/domain";

// api_guide.pdf §2「検索APIのURL」。httpsではなくhttp。
const DEFAULT_API_URL = "http://www.kkj.go.jp/api/";

function apiUrl(): string {
  return process.env.KKJ_API_URL || DEFAULT_API_URL;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function toText(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "object") return undefined; // 想定外のネスト。空欄扱いにする（推測しない）
  return String(value);
}

type RawSearchResult = Record<string, unknown>;

function toSearchResultItem(raw: RawSearchResult): KkjSearchResultItem {
  const attachmentsNode = raw.Attachments as { Attachment?: unknown } | undefined;
  const attachments = toArray(attachmentsNode?.Attachment as RawSearchResult | RawSearchResult[] | undefined).map(
    (a) => ({
      name: toText(a.Name) ?? "",
      uri: toText(a.Uri) ?? "",
    }),
  );

  return {
    resultId: toText(raw.ResultId),
    key: toText(raw.Key),
    externalDocumentUri: toText(raw.ExternalDocumentURI),
    projectName: toText(raw.ProjectName),
    date: toText(raw.Date),
    fileType: toText(raw.FileType),
    fileSize: toText(raw.FileSize),
    lgCode: toText(raw.LgCode),
    prefectureName: toText(raw.PrefectureName),
    cityCode: toText(raw.CityCode),
    cityName: toText(raw.CityName),
    organizationName: toText(raw.OrganizationName),
    certification: toText(raw.Certification),
    cftIssueDate: toText(raw.CftIssueDate),
    periodEndTime: toText(raw.PeriodEndTime),
    category: toText(raw.Category),
    procedureType: toText(raw.ProcedureType),
    location: toText(raw.Location),
    tenderSubmissionDeadline: toText(raw.TenderSubmissionDeadline),
    openingTendersEvent: toText(raw.OpeningTendersEvent),
    itemCode: toText(raw.ItemCode),
    projectDescription: toText(raw.ProjectDescription),
    attachments,
  };
}

export type FetchItemsResult = {
  items: NormalizedKkjTender[];
  searchHits: number; // SearchHits（ヒット総件数。SearchResultの数とは限らない。§4.2参照）
};

/**
 * XML文字列をパースし、タグ名からNormalizedKkjTenderの配列に変換する。
 * エラーレスポンス（<Results><Error>...）の場合は例外を投げる（§5参照）。
 */
export function parseKkjResponse(xml: string): FetchItemsResult {
  // 全国横断・最大1000件の検索結果には、案件名や添付URL中の"&"（&amp;）等のエンティティが
  // fast-xml-parserの既定上限（1000件）を超えて出現しうる（実データで確認：1018件で例外）。
  // 信頼できる固定の政府APIエンドポイントのレスポンスであるため、上限を引き上げて対応する。
  const parser = new XMLParser({
    ignoreAttributes: true,
    trimValues: true,
    processEntities: { maxTotalExpansions: 50_000 },
  });
  const doc = parser.parse(xml) as { Results?: { Error?: unknown; SearchResults?: unknown } };
  const results = doc.Results;
  if (!results) {
    throw new Error("KKJ APIレスポンスにResultsタグがありません。XML構造が想定と異なる可能性があります。");
  }
  if (results.Error != null) {
    throw new Error(`KKJ APIがエラーを返しました: ${toText(results.Error) ?? "(詳細不明)"}`);
  }

  const searchResults = results.SearchResults as { SearchHits?: unknown; SearchResult?: unknown } | undefined;
  const searchHits = Number(toText(searchResults?.SearchHits) ?? "0") || 0;
  const rawItems = toArray(searchResults?.SearchResult as RawSearchResult | RawSearchResult[] | undefined);

  const items = rawItems.map((raw) => normalizeKkjItem(toSearchResultItem(raw)));
  return { items, searchHits };
}

/**
 * 指定日の公告日（CftIssueDate）で絞り込んで案件を取得する（全国・Count上限1000）。
 * api_guide.pdf §3の必須パラメーター制約（Query/Project_Name/Organization_Name/LG_Codeの
 * いずれか1つが必須）は、LG_Codeに全都道府県コードを指定することで満たす（buildKkjQuery参照）。
 */
export async function fetchItemsByDate(dateIso: string, category?: KkjCategory): Promise<FetchItemsResult> {
  const query = buildKkjQuery({ cftIssueDate: dateIso, category });
  const usp = new URLSearchParams(query);
  const url = `${apiUrl()}?${usp.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`KKJ APIの取得に失敗しました: HTTP ${res.status} ${url}`);
  }
  const xml = await res.text();
  return parseKkjResponse(xml);
}

export async function healthCheck(): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetch(apiUrl());
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
