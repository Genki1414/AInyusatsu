// 入札資料のテキスト抽出。PDFに加え、Office Open XMLと、それらを含むZIPを扱う。
// 参照：docs/実装仕様書_v1.md §4.1

import path from "node:path";
import AdmZip from "adm-zip";
import { PDFParse } from "pdf-parse";
import { createWorker } from "tesseract.js";
import { needsOcr } from "@ai-nyusatsu-bu/domain";

export type ExtractDocumentTextResult = {
  text: string;
  pageCount: number | null;
  ocrUsed: boolean;
  format: "pdf" | "word" | "excel" | "zip";
};

export type ExtractPdfTextResult = Omit<ExtractDocumentTextResult, "format">;

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx", ".docm", ".xlsx", ".xlsm", ".xltx", ".zip"]);
const MAX_ARCHIVE_ENTRIES = 100;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_ARCHIVE_DEPTH = 2;

export function isSupportedDocumentName(name: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/** ファイル名の拡張子に従って資料本文を抽出する。 */
export async function extractDocumentText(buffer: Buffer, filename: string): Promise<ExtractDocumentTextResult> {
  const extension = path.extname(filename).toLowerCase();
  switch (extension) {
    case ".pdf": {
      const result = await extractPdfText(buffer);
      return { ...result, format: "pdf" };
    }
    case ".docx":
    case ".docm":
      return { text: extractWordText(buffer), pageCount: null, ocrUsed: false, format: "word" };
    case ".xlsx":
    case ".xlsm":
    case ".xltx":
      return { text: extractExcelText(buffer), pageCount: null, ocrUsed: false, format: "excel" };
    case ".zip":
      return extractArchiveText(buffer, filename, 0);
    case ".doc":
    case ".xls":
      throw new Error(`旧Office形式（${extension}）は未対応です。docx/xlsx形式で取得してください`);
    default:
      throw new Error(`未対応の資料形式です: ${extension || "拡張子なし"}`);
  }
}

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

/** DOCX/DOCMの本文・表・ヘッダー・フッターを読み取り順に近い形で抽出する。 */
export function extractWordText(buffer: Buffer): string {
  const zip = openZip(buffer, "Word");
  const names = zip.getEntries().map((entry) => entry.entryName)
    .filter((name) => /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(name))
    .sort(wordPartOrder);
  if (!names.includes("word/document.xml")) throw new Error("Word本文（word/document.xml）がありません");
  return names.map((name) => xmlToWordText(readZipEntry(zip, name))).filter(Boolean).join("\n\n").trim();
}

/** XLSX/XLSM/XLTXの各シートについて、セル番地と表示値を抽出する。 */
export function extractExcelText(buffer: Buffer): string {
  const zip = openZip(buffer, "Excel");
  const workbookXml = readZipEntry(zip, "xl/workbook.xml");
  const relationshipsXml = readZipEntry(zip, "xl/_rels/workbook.xml.rels");
  const sharedStringsXml = readOptionalZipEntry(zip, "xl/sharedStrings.xml");
  const sharedStrings = sharedStringsXml ? extractSharedStrings(sharedStringsXml) : [];
  const relationships = new Map<string, string>();
  for (const attrs of matchTags(relationshipsXml, "Relationship")) {
    const id = getXmlAttribute(attrs, "Id");
    const target = getXmlAttribute(attrs, "Target");
    if (id && target) relationships.set(id, normalizeWorkbookTarget(target));
  }

  const sheets: string[] = [];
  for (const attrs of matchTags(workbookXml, "sheet")) {
    const name = getXmlAttribute(attrs, "name") || "名称不明";
    const relationshipId = getXmlAttribute(attrs, "r:id");
    const target = relationshipId ? relationships.get(relationshipId) : undefined;
    if (!target) continue;
    const sheetXml = readOptionalZipEntry(zip, target);
    if (!sheetXml) continue;
    const rows = extractWorksheetRows(sheetXml, sharedStrings);
    sheets.push(`【シート: ${name}】${rows.length ? `\n${rows.join("\n")}` : "\n（値なし）"}`);
  }
  if (sheets.length === 0) throw new Error("Excelのワークシートを読み取れませんでした");
  return sheets.join("\n\n");
}

async function extractArchiveText(buffer: Buffer, filename: string, depth: number): Promise<ExtractDocumentTextResult> {
  if (depth >= MAX_ARCHIVE_DEPTH) throw new Error(`ZIPの入れ子が上限（${MAX_ARCHIVE_DEPTH}階層）を超えました`);
  const zip = openZip(buffer, "ZIP");
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory && !isJunkArchiveEntry(entry.entryName));
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error(`ZIP内のファイル数が上限（${MAX_ARCHIVE_ENTRIES}件）を超えました`);
  const totalBytes = entries.reduce((sum, entry) => sum + entry.header.size, 0);
  if (totalBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) throw new Error("ZIPの展開後サイズが上限（50MB）を超えました");

  const sections: string[] = [];
  let pageCount = 0;
  let hasPageCount = false;
  let ocrUsed = false;
  for (const entry of entries) {
    if (!isSupportedDocumentName(entry.entryName)) continue;
    if (entry.header.size > MAX_ARCHIVE_ENTRY_BYTES) {
      sections.push(`【${entry.entryName}】\n（20MBを超えるため抽出を省略）`);
      continue;
    }
    try {
      const result = path.extname(entry.entryName).toLowerCase() === ".zip"
        ? await extractArchiveText(entry.getData(), entry.entryName, depth + 1)
        : await extractDocumentText(entry.getData(), entry.entryName);
      sections.push(`【${entry.entryName}】\n${result.text}`);
      if (result.pageCount !== null) {
        pageCount += result.pageCount;
        hasPageCount = true;
      }
      ocrUsed ||= result.ocrUsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sections.push(`【${entry.entryName}】\n（抽出失敗: ${message}）`);
    }
  }
  if (sections.length === 0) throw new Error(`${filename}に対応形式の資料がありません`);
  return { text: sections.join("\n\n"), pageCount: hasPageCount ? pageCount : null, ocrUsed, format: "zip" };
}

function extractWorksheetRows(xml: string, sharedStrings: string[]): string[] {
  const rows: string[] = [];
  for (const rowMatch of xml.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/gi)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/gi)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = getXmlAttribute(attrs, "r") || "?";
      const type = getXmlAttribute(attrs, "t");
      const raw = firstTagText(body, "v");
      let value = "";
      if (type === "s" && raw !== null) value = sharedStrings[Number(raw)] ?? raw;
      else if (type === "inlineStr") value = extractXmlTextRuns(body).join("");
      else if (type === "b" && raw !== null) value = raw === "1" ? "TRUE" : "FALSE";
      else value = raw ?? extractXmlTextRuns(body).join("");
      const formula = firstTagText(body, "f");
      if (formula && !value) value = `=${decodeXml(formula)}`;
      if (value.trim()) cells.push(`${ref}: ${decodeXml(value).trim()}`);
    }
    if (cells.length) rows.push(cells.join("\t"));
  }
  return rows;
}

function xmlToWordText(xml: string): string {
  return xml.replace(/<(?:\w+:)?tab\b[^>]*\/?\s*>/gi, "\t")
    .replace(/<(?:\w+:)?br\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<\/(?:\w+:)?tc>/gi, "\t")
    .replace(/<\/(?:\w+:)?tr>/gi, "\n")
    .replace(/<\/(?:\w+:)?p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .split("\n").map((line) => decodeXml(line).replace(/[ \t]+$/g, "")).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
}

function extractSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/gi)]
    .map((match) => extractXmlTextRuns(match[1]).join(""));
}

function extractXmlTextRuns(xml: string): string[] {
  return [...xml.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gi)].map((match) => decodeXml(match[1]));
}

function matchTags(xml: string, localName: string): string[] {
  const expression = new RegExp(`<(?:\\w+:)?${localName}\\b([^>]*)\\/?\\s*>`, "gi");
  return [...xml.matchAll(expression)].map((match) => match[1]);
}

function firstTagText(xml: string, localName: string): string | null {
  const expression = new RegExp(`<(?:\\w+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${localName}>`, "i");
  return expression.exec(xml)?.[1] ?? null;
}

function getXmlAttribute(attributes: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(attributes);
  return match ? decodeXml(match[2]) : null;
}

function decodeXml(value: string): string {
  return value.replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function normalizeWorkbookTarget(target: string): string {
  const withoutRoot = target.replace(/^\//, "");
  const normalized = path.posix.normalize(withoutRoot.startsWith("xl/") ? withoutRoot : path.posix.join("xl", withoutRoot));
  if (!normalized.startsWith("xl/")) throw new Error("Excel内の不正な参照先を検出しました");
  return normalized;
}

function openZip(buffer: Buffer, label: string): AdmZip {
  try {
    return new AdmZip(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}ファイルを開けませんでした: ${message}`);
  }
}

function readZipEntry(zip: AdmZip, name: string): string {
  const entry = zip.getEntry(name);
  if (!entry) throw new Error(`${name}がありません`);
  if (entry.header.size > MAX_ARCHIVE_ENTRY_BYTES) throw new Error(`${name}が20MBを超えています`);
  return entry.getData().toString("utf8");
}

function readOptionalZipEntry(zip: AdmZip, name: string): string | null {
  const entry = zip.getEntry(name);
  if (!entry) return null;
  if (entry.header.size > MAX_ARCHIVE_ENTRY_BYTES) throw new Error(`${name}が20MBを超えています`);
  return entry.getData().toString("utf8");
}

function wordPartOrder(left: string, right: string): number {
  const priority = (name: string) => name === "word/document.xml" ? 0 : name.includes("header") ? 1 : name.includes("footer") ? 3 : 2;
  return priority(left) - priority(right) || left.localeCompare(right);
}

function isJunkArchiveEntry(name: string): boolean {
  return name.startsWith("__MACOSX/") || path.posix.basename(name).startsWith(".");
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
