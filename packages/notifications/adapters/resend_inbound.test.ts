import { describe, expect, it } from "vitest";
import { parseAttachmentList } from "./resend_inbound";

describe("parseAttachmentList", () => {
  it("添付の一覧を読む", () => {
    const payload = {
      object: "list",
      has_more: false,
      data: [
        {
          id: "fab522e9-d882-4d7e-a54e-906307d83d62",
          filename: "御見積書　テスト.pdf",
          size: 123456,
          content_type: "application/pdf",
          content_disposition: "attachment",
          download_url: "https://example.com/signed",
          expires_at: "2026-08-25T08:30:00.000Z",
        },
      ],
    };

    expect(parseAttachmentList(payload)).toEqual([
      {
        id: "fab522e9-d882-4d7e-a54e-906307d83d62",
        filename: "御見積書　テスト.pdf",
        contentType: "application/pdf",
        size: 123456,
        downloadUrl: "https://example.com/signed",
        expiresAt: "2026-08-25T08:30:00.000Z",
      },
    ]);
  });

  it("取得先URLが無いものは写せないので落とす", () => {
    const payload = { data: [{ id: "a", filename: "空.pdf", size: 1 }] };
    expect(parseAttachmentList(payload)).toEqual([]);
  });

  it("ファイル名が無くても取得先があれば残す（名前は呼び出し側で補う）", () => {
    const payload = { data: [{ id: "a", download_url: "https://example.com/x" }] };
    expect(parseAttachmentList(payload)[0]).toMatchObject({ filename: null, contentType: null, size: null });
  });

  it("形が違っても落ちない", () => {
    expect(parseAttachmentList({ data: "なし" })).toEqual([]);
    expect(parseAttachmentList({})).toEqual([]);
    expect(parseAttachmentList(null)).toEqual([]);
  });
});
