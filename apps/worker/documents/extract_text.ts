// 資料のテキスト抽出（タスク2-2）。テキストPDFはそのまま抽出し、抽出できなかった
// ページ（画像PDF＝スキャン）だけをOCRする。参照：docs/実装仕様書_v1.md §4.1
//
// 【重要・未検証】tesseract.jsは初回実行時に言語データ（日本語=jpn）をネットワーク経由で
// 取得する（既定のCDN。ローカルキャッシュ後は再取得しない）。本セッションのネットワーク
// ポリシーでは到達性を確認できていない。ローカル実行時にタイムアウトする場合は、
// docs/reference/資料テキスト抽出_確認事項.md を参照し、事前にダウンロードした
// 言語データファイルを使う設定（createWorkerのlangPath）に切り替える。
//
// 対象は現時点でPDFのみ。GEPSの資料にはWord/Excel（.docx/.xlsx等）も含まれるが、
// 本タスクのスコープ外（別タスクで対応）。

import { PDFParse } from "pdf-parse";
import { createWorker } from "tesseract.js";
import { needsOcr } from "@ai-nyusatsu-bu/domain";

export type ExtractPdfTextResult = {
  text: string;
  pageCount: number;
  ocrUsed: boolean;
};

/** PDFのバッファからテキストを抽出する。テキストが取れなかったページはOCRで補う。 */
export async function extractPdfText(buffer: Buffer): Promise<ExtractPdfTextResult> {
  const parser = new PDFParse({ data: buffer });
  try {
    const textResult = await parser.getText();
    const pageTexts = textResult.pages.map((p) => p.text);
    const ocrPageNumbers = textResult.pages.filter((p) => needsOcr(p.text)).map((p) => p.num);

    let ocrUsed = false;
    if (ocrPageNumbers.length > 0) {
      ocrUsed = true;
      const ocrTextByPage = await ocrPages(parser, ocrPageNumbers);
      for (const [pageNum, ocrText] of ocrTextByPage) {
        const index = textResult.pages.findIndex((p) => p.num === pageNum);
        if (index >= 0) pageTexts[index] = ocrText;
      }
    }

    return { text: pageTexts.join("\n\n"), pageCount: textResult.total, ocrUsed };
  } finally {
    await parser.destroy();
  }
}

/** 指定したページ番号だけをPNGとしてレンダリングし、OCRでテキスト化する。 */
async function ocrPages(parser: PDFParse, pageNumbers: number[]): Promise<Map<number, string>> {
  const screenshot = await parser.getScreenshot({ partial: pageNumbers, scale: 2 });
  const worker = await createWorker("jpn");
  const result = new Map<number, string>();
  try {
    for (const page of screenshot.pages) {
      const { data } = await worker.recognize(Buffer.from(page.data));
      result.set(page.pageNumber, data.text);
    }
  } finally {
    await worker.terminate();
  }
  return result;
}
