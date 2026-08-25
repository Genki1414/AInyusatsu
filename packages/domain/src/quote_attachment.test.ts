import { describe, expect, it } from "vitest";
import { attachmentStorageKey, extractAttachments, fileExtension, safeFilename } from "./quote_attachment";

describe("safeFilename", () => {
  it("日本語のファイル名はそのまま残す", () => {
    expect(safeFilename("御見積書.pdf")).toBe("御見積書.pdf");
  });

  it("保存先のキーを壊す文字を落とす", () => {
    expect(safeFilename("見積書 2026/08/25.pdf")).toBe("見積書_2026_08_25.pdf");
    expect(safeFilename('a"b<c>d|e.pdf')).toBe("a_b_c_d_e.pdf");
  });

  it("空になる名前は既定値にする", () => {
    expect(safeFilename("   ")).toBe("attachment");
    expect(safeFilename("///")).toBe("attachment");
  });

  it("長すぎる名前は切る", () => {
    expect(safeFilename("あ".repeat(300))).toHaveLength(200);
  });
});

describe("fileExtension", () => {
  it("拡張子を小文字で返す", () => {
    expect(fileExtension("見積書.PDF")).toBe("pdf");
    expect(fileExtension("内訳.xlsx")).toBe("xlsx");
  });

  it("拡張子が無ければnull", () => {
    expect(fileExtension("見積書")).toBeNull();
  });
});

describe("extractAttachments", () => {
  it("中身がbase64で入っている添付を読む", () => {
    const payload = {
      data: { attachments: [{ filename: "見積書.pdf", content_type: "application/pdf", content: "JVBERi0=" }] },
    };
    expect(extractAttachments(payload)).toEqual([
      { filename: "見積書.pdf", contentType: "application/pdf", base64: "JVBERi0=", url: null },
    ]);
  });

  it("取得先がURLで渡される形にも対応する", () => {
    const payload = { data: { attachments: [{ name: "quote.xlsx", url: "https://example.com/a.xlsx" }] } };
    expect(extractAttachments(payload)[0]).toMatchObject({ filename: "quote.xlsx", url: "https://example.com/a.xlsx" });
  });

  it("中身も取得先も無いものは保存できないので落とす", () => {
    expect(extractAttachments({ data: { attachments: [{ filename: "空.pdf" }] } })).toEqual([]);
  });

  it("添付が無い・形が違う場合は空を返す（落ちない）", () => {
    expect(extractAttachments({ data: {} })).toEqual([]);
    expect(extractAttachments({ data: { attachments: "なし" } })).toEqual([]);
    expect(extractAttachments({})).toEqual([]);
    expect(extractAttachments(null)).toEqual([]);
  });

  it("ファイル名が無ければ既定の名前を付ける", () => {
    expect(extractAttachments({ data: { attachments: [{ content: "AAA" }] } })[0].filename).toBe("attachment");
  });
});

describe("attachmentStorageKey", () => {
  it("見積が分かっていれば見積ごとの場所に置く", () => {
    const key = attachmentStorageKey({ quoteId: "q1", messageId: "msg_2abc" }, 0, "見積書.pdf");
    expect(key).toBe("quotes/q1/msg_2abc_0.pdf");
  });

  it("見積が分からない返信も捨てず、受信メッセージ単位で置く", () => {
    const key = attachmentStorageKey({ quoteId: null, messageId: "msg_2abc" }, 1, "quote.xlsx");
    expect(key).toBe("unmatched/msg_2abc/msg_2abc_1.xlsx");
  });

  it("同じ見積に複数の返信が来ても衝突しない", () => {
    const a = attachmentStorageKey({ quoteId: "q1", messageId: "msg_a" }, 0, "見積.pdf");
    const b = attachmentStorageKey({ quoteId: "q1", messageId: "msg_b" }, 0, "見積.pdf");
    expect(a).not.toBe(b);
  });

  it("拡張子が無くても組み立てられる", () => {
    expect(attachmentStorageKey({ quoteId: "q1", messageId: "m" }, 0, "見積書")).toBe("quotes/q1/m_0");
  });
});
