import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import {
  extractDocumentText,
  extractExcelText,
  extractWordText,
  isSupportedDocumentName,
} from "./extract_text";

function makeWord(): Buffer {
  const zip = new AdmZip();
  zip.addFile("word/document.xml", Buffer.from(`
    <w:document xmlns:w="word"><w:body>
      <w:p><w:r><w:t>入札公告&amp;仕様</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>納期</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>令和8年10月1日</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>
  `));
  return zip.toBuffer();
}

function makeExcel(): Buffer {
  const zip = new AdmZip();
  zip.addFile("xl/workbook.xml", Buffer.from(`
    <workbook xmlns:r="relationships"><sheets><sheet name="案件一覧" r:id="rId1"/></sheets></workbook>
  `));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(`
    <Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>
  `));
  zip.addFile("xl/sharedStrings.xml", Buffer.from(`
    <sst><si><t>参加資格</t></si><si><r><t>全省庁</t></r><r><t>統一資格</t></r></si></sst>
  `));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(`
    <worksheet><sheetData><row r="1">
      <c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>
      <c r="C1" t="inlineStr"><is><t>役務の提供等</t></is></c>
    </row><row r="2"><c r="A2"><v>1500000</v></c><c r="B2" t="b"><v>1</v></c></row></sheetData></worksheet>
  `));
  return zip.toBuffer();
}

describe("document text extraction", () => {
  it("対応する拡張子を大文字小文字を問わず判定する", () => {
    expect(isSupportedDocumentName("仕様書.DOCX")).toBe(true);
    expect(isSupportedDocumentName("内訳.XLSX")).toBe(true);
    expect(isSupportedDocumentName("旧様式.xls")).toBe(false);
  });

  it("Wordの段落と表から日本語テキストを抽出する", () => {
    const text = extractWordText(makeWord());
    expect(text).toContain("入札公告&仕様");
    expect(text).toContain("納期");
    expect(text).toContain("令和8年10月1日");
  });

  it("Excelの共有文字列、リッチテキスト、インライン文字列、数値、真偽値を抽出する", () => {
    const text = extractExcelText(makeExcel());
    expect(text).toContain("【シート: 案件一覧】");
    expect(text).toContain("A1: 参加資格");
    expect(text).toContain("B1: 全省庁統一資格");
    expect(text).toContain("C1: 役務の提供等");
    expect(text).toContain("A2: 1500000");
    expect(text).toContain("B2: TRUE");
  });

  it("ZIP内の対応資料をまとめ、非対応ファイルは無視する", async () => {
    const zip = new AdmZip();
    zip.addFile("docs/公告.docx", makeWord());
    zip.addFile("docs/内訳.xlsx", makeExcel());
    zip.addFile("docs/readme.txt", Buffer.from("対象外"));

    const result = await extractDocumentText(zip.toBuffer(), "一式.zip");
    expect(result.format).toBe("zip");
    expect(result.text).toContain("【docs/公告.docx】");
    expect(result.text).toContain("【docs/内訳.xlsx】");
    expect(result.text).not.toContain("対象外");
    expect(result.pageCount).toBeNull();
  });

  it("旧Office形式を誤って解析しない", async () => {
    await expect(extractDocumentText(Buffer.from("legacy"), "仕様書.doc"))
      .rejects.toThrow("旧Office形式");
  });
});
