// 資料のテキスト抽出ジョブ（タスク2-2）。
// 参照：docs/実装仕様書_v1.md §4.1, §5（parseジョブの前段）
//
// fetched=trueかつ未抽出（extracted_text/extract_errorともnull）のPDF資料を対象に、
// テキスト抽出（必要ならOCR）を行い、結果をtender_documentsへ書き戻す。
// AI解析（タスク2-3）はこのジョブが埋めるextracted_textを入力として使う。
//
// 【現状の制約】
// - 対象は.pdfのみ（storage_keyの拡張子で判定）。Word/Excel等は未対応（別タスク）
// - 失敗した資料（extract_errorが埋まった行）は自動では再試行しない。原因を直してから
//   extract_errorをnullに戻せば次回の実行で拾われる

import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { extractPdfText } from "../documents/extract_text";

const BUCKET = process.env.TENDER_DOCUMENTS_BUCKET || "tender-documents";

export type ExtractDocumentTextSummary = {
  processed: number;
  succeeded: number;
  ocrUsed: number;
  failed: number;
};

type PendingDocument = { id: string; storage_key: string };

/** 未抽出のPDF資料を最大limit件処理する。 */
export async function runExtractPendingDocuments(limit = 50): Promise<ExtractDocumentTextSummary> {
  const client = createServiceClient();

  const { data: docs, error } = await client
    .from("tender_documents")
    .select("id, storage_key")
    .eq("fetched", true)
    .is("extracted_text", null)
    .is("extract_error", null)
    .not("storage_key", "is", null)
    .ilike("storage_key", "%.pdf")
    .limit(limit)
    .returns<PendingDocument[]>();
  if (error) throw new Error(`未抽出の資料一覧の取得に失敗しました: ${error.message}`);

  let succeeded = 0;
  let ocrUsed = 0;
  let failed = 0;

  for (const doc of docs ?? []) {
    try {
      const { data: file, error: downloadError } = await client.storage.from(BUCKET).download(doc.storage_key);
      if (downloadError) throw new Error(downloadError.message);

      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await extractPdfText(buffer);

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

  return { processed: (docs ?? []).length, succeeded, ocrUsed, failed };
}
