// 官公需情報ポータル（KKJ）APIクライアント。
// 参照：docs/案件収集戦略_v2.md、docs/reference/KKJ_API_確認事項.md
//
// 【重要・未検証】本セッションのネットワークポリシーで www.kkj.go.jp に到達できず、
// 以下は実データで確認できていない。
//   - 実際のAPIエンドポイントのパス（ここでは案件収集戦略_v2.md記載の `https://www.kkj.go.jp/api/` を既定値とする）
//   - 日付絞り込みのパラメータ名（既定 "date"。KKJ_API_DATE_PARAM で上書き可能）
//   - ページングのパラメータ名・1回の上限件数
//   - レスポンスのXML構造・タグ名
//
// タグ名への依存を避けるため、XMLは「各レコード要素の子要素を出現順に読む」位置ベースで
// 抽出している（案件収集戦略_v2.md §8 に記載された16項目の並び順を信頼する設計）。
// 実データ取得後、docs/reference/KKJ_API_確認事項.md とあわせて必ず更新すること。

import { XMLParser } from "fast-xml-parser";
import { normalizeKkjItem, type KkjRawFields, type KkjTenderSeed } from "@ai-nyusatsu-bu/domain";

const DEFAULT_API_URL = "https://www.kkj.go.jp/api/";

// 案件収集戦略_v2.md §8 の並び順。先頭の「連番」は使わないため除いてある。
const FIELD_ORDER: (keyof KkjRawFields)[] = [
  "idBase64",
  "noticeUrl",
  "nameWithSize",
  "registeredAt",
  "fileFormat",
  "fileSize",
  "prefCode",
  "prefName",
  "cityCode",
  "cityName",
  "areaName",
  "noticeDate",
  "procurementType",
  "nameRepeated",
  "bodyText",
];

function apiUrl(): string {
  return process.env.KKJ_API_URL || DEFAULT_API_URL;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null) usp.set(key, String(value));
  }
  return usp.toString();
}

/** ネストしたオブジェクト/配列から、最初に見つかった配列（案件レコードの並びと想定）を探す。 */
function findRecordsArray(node: unknown): unknown[] | null {
  if (Array.isArray(node)) return node;
  if (node && typeof node === "object") {
    for (const value of Object.values(node as Record<string, unknown>)) {
      const found = findRecordsArray(value);
      if (found) return found;
    }
  }
  return null;
}

/** レコード要素の子要素を、出現順の値の配列として取り出す（タグ名には依存しない）。 */
function extractPositionalValues(record: unknown): string[] {
  if (record == null) return [];
  if (typeof record !== "object") return [String(record)];
  return Object.values(record as Record<string, unknown>).map((v) => {
    if (v == null) return "";
    if (typeof v === "object") return JSON.stringify(v); // 想定外のネスト。空にせず残す
    return String(v);
  });
}

/**
 * 位置ベースで取り出した値をKkjRawFieldsに割り当てる。
 * 先頭1個（連番）を除いてFIELD_ORDER件数と一致しなければnull（構造の食い違いとみなし推測しない）。
 */
function toRawFields(positionalValues: string[]): KkjRawFields | null {
  const values = positionalValues[0] != null ? positionalValues.slice(1) : positionalValues;
  if (values.length !== FIELD_ORDER.length) return null;
  const fields = {} as KkjRawFields;
  FIELD_ORDER.forEach((key, i) => {
    fields[key] = values[i];
  });
  return fields;
}

export type FetchItemsResult = {
  items: KkjTenderSeed[];
  parsedCount: number;
  unparsedCount: number; // フィールド数が想定と一致せず解析できなかった件数（0でなければ要確認）
};

/** XML文字列をパースし、位置ベースでKkjTenderSeedの配列に変換する。 */
export function parseKkjResponse(xml: string): FetchItemsResult {
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const doc = parser.parse(xml);
  const records = findRecordsArray(doc);
  if (!records) {
    throw new Error(
      "KKJ APIレスポンスから案件の配列を検出できませんでした。XML構造が想定と異なる可能性があります。" +
        "docs/reference/KKJ_API_確認事項.md を参照し、parseKkjResponseの実装を実データに合わせて修正してください。",
    );
  }

  const items: KkjTenderSeed[] = [];
  let unparsedCount = 0;
  for (const record of records) {
    const raw = toRawFields(extractPositionalValues(record));
    if (!raw) {
      unparsedCount++;
      continue;
    }
    items.push(normalizeKkjItem(raw));
  }

  return { items, parsedCount: items.length, unparsedCount };
}

/**
 * 指定日（登録日と思われる。§8参照）で絞り込んで案件を取得する。
 * 【未検証】パラメータ名・絞り込みの実際の挙動は要確認。
 */
export async function fetchItemsByDate(dateIso: string): Promise<FetchItemsResult> {
  const dateParam = process.env.KKJ_API_DATE_PARAM || "date";
  const query = buildQuery({ [dateParam]: dateIso });
  const res = await fetch(`${apiUrl()}?${query}`);
  if (!res.ok) {
    throw new Error(`KKJ APIの取得に失敗しました: HTTP ${res.status} ${apiUrl()}?${query}`);
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
