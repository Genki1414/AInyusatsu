// 協力会社から届いた添付（見積書）の扱い（タスク4-3）。
// 参照：docs/実装仕様書_v1.md §4.4「入力：メール本文/LINEテキスト＋添付」
//
// 【なぜ添付が本命か】
// 見積書はPDFやExcelで添付されるのが普通で、本文には「お見積書を添付いたします」しか
// 書かれないことが多い（ユーザー指摘 2026-08-25）。本文から金額を読むより、
// 見積書そのものをアプリから開けるほうが実務の役に立つ。
//
// 【本部が取得した資料とは別物】
// tender-documents（本部が取得した公告・仕様書）は顧客企業に配らない方針だが
// （CLAUDE.md 最重要の前提4）、ここで扱うのは協力会社が顧客企業へ送った見積書。
// 顧客企業自身の商談の書類なので、顧客企業に見せてよい。
// 取り違えないよう、保存先のバケットを分ける。

import { findAttachments } from "./inbound_payload";

/** 1件あたりの上限。これを超える添付は保存しない（受信口が詰まるのを防ぐ）。 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type InboundAttachment = {
  filename: string;
  contentType: string | null;
  /** base64の中身。URLで渡された場合は null */
  base64: string | null;
  /** 取得先のURL。中身が直接入っていた場合は null */
  url: string | null;
};

/** 保存先のキーやファイル名に使えない文字を落とす。 */
export function safeFilename(name: string): string {
  const trimmed = name
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return trimmed === "" ? "attachment" : trimmed.slice(0, 200);
}

/** ファイル名から拡張子を取り出す。無ければ null。 */
export function fileExtension(name: string): string | null {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(name.trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * 受信したJSONから添付を取り出す。
 *
 * 添付がJSONのどこに入っているかはproviderによって違う（data.attachments とは限らない）。
 * 一覧の場所は findAttachments() がJSON全体をたどって探す。ここでは1件ずつの項目名のゆれを吸収する。
 * 解釈を誤っても元データ（inbound_messages.raw）から直せるようにしてある。
 */
export function extractAttachments(payload: unknown): InboundAttachment[] {
  const { entries } = findAttachments(payload);

  const attachments: InboundAttachment[] = [];
  for (const entry of entries) {
    // 取得先URLの文字列だけが並ぶ形にも耐える
    if (typeof entry === "string") {
      if (!/^https?:\/\//i.test(entry.trim())) continue;
      attachments.push({ filename: filenameFromUrl(entry), contentType: null, base64: null, url: entry.trim() });
      continue;
    }
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;

    // "type": "attachment" のように種別が入っていることがあるので、MIMEの形をしたものだけ採る
    const contentTypeRaw = pickString(item, ["content_type", "contenttype", "mime_type", "mimetype", "type"]);
    const contentType = contentTypeRaw !== null && contentTypeRaw.includes("/") ? contentTypeRaw : null;
    const base64 = pickString(item, ["content", "content_base64", "contentbase64", "base64", "data"]);
    const url = pickString(item, ["url", "download_url", "downloadurl", "href", "link", "content_url"]);
    // 中身も取得先も無いものは保存できない
    if (base64 === null && url === null) continue;

    const filename =
      pickString(item, ["filename", "file_name", "name", "title"]) ?? (url !== null ? filenameFromUrl(url) : "attachment");

    attachments.push({ filename: safeFilename(filename), contentType, base64, url });
  }
  return attachments;
}

/** 項目名の大文字小文字・区切りのゆれを無視して文字列を取り出す。 */
function pickString(item: Record<string, unknown>, keys: string[]): string | null {
  const normalized = new Map<string, unknown>();
  for (const [key, value] of Object.entries(item)) {
    const lower = key.toLowerCase();
    if (!normalized.has(lower)) normalized.set(lower, value);
  }
  for (const key of keys) {
    const value = normalized.get(key.toLowerCase());
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

/** URLしか無いときのファイル名。取れなければ既定値。 */
function filenameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter((part) => part !== "").pop();
    return last ? decodeURIComponent(last) : "attachment";
  } catch {
    return "attachment";
  }
}

/**
 * 保存先のキーを組み立てる。
 *
 * 見積が特定できない返信も捨てないため、その場合は受信メッセージ単位で置く。
 * 同じ見積に複数の返信が来ても衝突しないよう、メッセージidと順番を含める。
 */
export function attachmentStorageKey(
  scope: { quoteId: string | null; messageId: string },
  index: number,
  filename: string,
): string {
  const folder = scope.quoteId ? `quotes/${scope.quoteId}` : `unmatched/${safeFilename(scope.messageId)}`;
  const ext = fileExtension(filename);
  return `${folder}/${safeFilename(scope.messageId)}_${index}${ext ? `.${ext}` : ""}`;
}
