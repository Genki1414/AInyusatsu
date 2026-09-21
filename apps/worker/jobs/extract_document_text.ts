// 資料のテキスト抽出ジョブ（タスク2-2）。
// 参照：docs/実装仕様書_v1.md §4.1, §5（parseジョブの前段）
//
// fetched=trueかつ未抽出（extracted_text/extract_errorともnull）の対応資料を対象に、
// テキスト抽出（必要ならOCR）を行い、結果をtender_documentsへ書き戻す。
// AI解析（タスク2-3）はこのジョブが埋めるextracted_textを入力として使う。
//
// 対象はPDF、Office Open XML（Word/Excel）、ZIP。旧Office形式（.doc/.xls）は対象外。
// - 失敗した資料（extract_errorが埋まった行）は自動では再試行しない。原因を直してから
//   extract_errorをnullに戻せば次回の実行で拾われる

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { extractDocumentText, isSupportedDocumentName } from "../documents/extract_text";

const BUCKET = process.env.TENDER_DOCUMENTS_BUCKET || "tender-documents";

export type ExtractDocumentTextSummary = {
  processed: number;
  succeeded: number;
  ocrUsed: number;
  failed: number;
};

type PendingDocument = { id: string; storage_key: string };

/** 未抽出の対応資料を最大limit件処理する。 */
export async function runExtractPendingDocuments(limit = 50): Promise<ExtractDocumentTextSummary> {
  const client = createServiceClient();

  const { data: docs, error } = await client
    .from("tender_documents")
    .select("id, storage_key")
    .eq("fetched", true)
    .is("extracted_text", null)
    .is("extract_error", null)
    .not("storage_key", "is", null)
    .or([
      "storage_key.ilike.%.pdf",
      "storage_key.ilike.%.docx",
      "storage_key.ilike.%.docm",
      "storage_key.ilike.%.xlsx",
      "storage_key.ilike.%.xlsm",
      "storage_key.ilike.%.xltx",
      "storage_key.ilike.%.zip",
    ].join(","))
    .limit(limit)
    .returns<PendingDocument[]>();
  if (error) throw new Error(`未抽出の資料一覧の取得に失敗しました: ${error.message}`);

  let succeeded = 0;
  let ocrUsed = 0;
  let failed = 0;

  const pending = (docs ?? []).filter((doc) => isSupportedDocumentName(doc.storage_key)).slice(0, limit);

  for (const doc of pending) {
    try {
      const { data: file, error: downloadError } = await client.storage.from(BUCKET).download(doc.storage_key);
      if (downloadError) throw new Error(downloadError.message);

      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await extractDocumentText(buffer, doc.storage_key);

      const { error: updateError } = await client
        .from("tender_documents")
        .update({
          extracted_text: result.text,
          page_count: result.pageCount,
          ocr_used: result.ocrUsed,
        })
        .eq("id", doc.id);
      if (updateError) throw new Error(updateError.message);

      succeeded++;
      if (result.ocrUsed) ocrUsed++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`テキスト抽出に失敗しました（tender_document=${doc.id}）`, err);
      await client
        .from("tender_documents")
        .update({ extract_error: message.slice(0, 500) })
        .eq("id", doc.id);
    }
  }

  return { processed: pending.length, succeeded, ocrUsed, failed };
}
