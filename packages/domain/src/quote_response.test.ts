import { describe, expect, it } from "vitest";
import {
  buildDocumentsEmail,
  buildResponseNotificationEmail,
  choiceLabel,
  documentFilenames,
  signedUrlTtlSeconds,
  sortDocumentsByKind,
} from "./quote_response";

const DAY = 60 * 60 * 24;

describe("choiceLabel", () => {
  it("回答の種類を日本語のラベルにする", () => {
    expect(choiceLabel("request_documents")).toBe("資料請求");
    expect(choiceLabel("decline")).toBe("今回は見送る");
  });
});

describe("signedUrlTtlSeconds", () => {
  const now = new Date("2026-08-21T00:00:00Z");

  it("回答期限が未設定なら7日", () => {
    expect(signedUrlTtlSeconds(null, now)).toBe(7 * DAY);
  });

  it("回答期限までの日数に7日を足す（期限後もしばらく使える）", () => {
    const dueAt = new Date("2026-08-31T00:00:00Z"); // 10日後
    expect(signedUrlTtlSeconds(dueAt, now)).toBe(17 * DAY);
  });

  it("回答期限が近い・過去でも下限の7日を確保する", () => {
    expect(signedUrlTtlSeconds(new Date("2026-08-22T00:00:00Z"), now)).toBe(8 * DAY);
    expect(signedUrlTtlSeconds(new Date("2026-08-01T00:00:00Z"), now)).toBe(7 * DAY);
  });

  it("極端に先の期限でも上限の90日に収める", () => {
    expect(signedUrlTtlSeconds(new Date("2027-08-21T00:00:00Z"), now)).toBe(90 * DAY);
  });

  it("不正な日付は7日として扱う", () => {
    expect(signedUrlTtlSeconds(new Date("invalid"), now)).toBe(7 * DAY);
  });
});

describe("sortDocumentsByKind", () => {
  it("公告→入札説明書→仕様書→数量表→様式→その他の順に並べる", () => {
    const sorted = sortDocumentsByKind([
      { kind: "様式", storage_key: "d.docx" },
      { kind: "公告", storage_key: "a.pdf" },
      { kind: "数量表", storage_key: "c.pdf" },
      { kind: "入札説明書", storage_key: "b.pdf" },
    ]);
    expect(sorted.map((d) => d.kind)).toEqual(["公告", "入札説明書", "数量表", "様式"]);
  });

  it("一覧に無い種別は末尾に回す", () => {
    const sorted = sortDocumentsByKind([
      { kind: "契約書案", storage_key: "z.pdf" },
      { kind: "公告", storage_key: "a.pdf" },
    ]);
    expect(sorted.map((d) => d.kind)).toEqual(["公告", "契約書案"]);
  });

  it("元の配列を変更しない", () => {
    const input = [
      { kind: "様式", storage_key: "d.docx" },
      { kind: "公告", storage_key: "a.pdf" },
    ];
    sortDocumentsByKind(input);
    expect(input.map((d) => d.kind)).toEqual(["様式", "公告"]);
  });
});

describe("documentFilenames", () => {
  it("種別＋拡張子のファイル名にする", () => {
    const result = documentFilenames([{ kind: "仕様書", storage_key: "tenders/abc/spec_9f8e.pdf" }]);
    expect(result[0].filename).toBe("仕様書.pdf");
  });

  it("同じ種別が複数あれば連番を付ける", () => {
    const result = documentFilenames([
      { kind: "仕様書", storage_key: "tenders/abc/spec_1.pdf" },
      { kind: "仕様書", storage_key: "tenders/abc/spec_2.pdf" },
      { kind: "様式", storage_key: "tenders/abc/form_1.docx" },
    ]);
    expect(result.map((r) => r.filename)).toEqual(["仕様書.pdf", "仕様書_2.pdf", "様式.docx"]);
  });

  it("拡張子が無ければ種別だけにする（パス中のドットを拡張子と誤認しない）", () => {
    const result = documentFilenames([{ kind: "公告", storage_key: "tenders/a.b/notice" }]);
    expect(result[0].filename).toBe("公告");
  });
});

describe("buildDocumentsEmail", () => {
  const base = {
    partnerName: "東北三上機材株式会社",
    senderOrgName: "東葉総合サービス株式会社",
    senderContactEmail: "yamada@example.co.jp",
    tenderName: "須崎庁舎浄化槽排水ポンプ修繕",
    trade: "設備保守",
    dueAtLabel: "2026/8/28 11:17",
    expiresAtLabel: "2026/9/4 11:17",
    links: [
      { kind: "公告", url: "https://example.com/a" },
      { kind: "仕様書", url: "https://example.com/b" },
    ],
  };

  it("件名は「【資料送付】案件名」になる", () => {
    expect(buildDocumentsEmail(base).subject).toBe("【資料送付】須崎庁舎浄化槽排水ポンプ修繕");
  });

  it("宛名・案件名・業種・全リンク・失効日時・回答期限が入る", () => {
    const { body } = buildDocumentsEmail(base);
    expect(body).toContain("東北三上機材株式会社 様");
    expect(body).toContain("「須崎庁舎浄化槽排水ポンプ修繕」（設備保守）の資料をお送りいたします。");
    expect(body).toContain("2026/9/4 11:17 まで有効です");
    expect(body).toContain("【公告】https://example.com/a");
    expect(body).toContain("【仕様書】https://example.com/b");
    expect(body).toContain("お見積りの回答期限：2026/8/28 11:17");
  });

  it("末尾に送信元の署名（組織名・連絡先）が入る", () => {
    const lines = buildDocumentsEmail(base).body.split("\n");
    expect(lines.slice(-3)).toEqual(["--", "東葉総合サービス株式会社", "yamada@example.co.jp"]);
  });

  it("連絡先が無ければ署名から省く（空行を残さない）", () => {
    const lines = buildDocumentsEmail({ ...base, senderContactEmail: null }).body.split("\n");
    expect(lines.slice(-2)).toEqual(["--", "東葉総合サービス株式会社"]);
  });

  it("回答期限が無ければその行を出さない", () => {
    const { body } = buildDocumentsEmail({ ...base, dueAtLabel: null });
    expect(body).not.toContain("お見積りの回答期限");
  });
});

describe("buildResponseNotificationEmail", () => {
  const base = {
    partnerName: "東北三上機材株式会社",
    tenderName: "須崎庁舎浄化槽排水ポンプ修繕",
    trade: "設備保守",
    choice: "request_documents" as const,
    memo: null,
    afterDue: false,
    warning: null,
    tenderUrl: "https://example.com/tenders/1?tab=quote-status",
  };

  it("件名に回答の種類と案件名が入る", () => {
    expect(buildResponseNotificationEmail(base).subject).toBe("【見積依頼への回答】資料請求／須崎庁舎浄化槽排水ポンプ修繕");
    expect(buildResponseNotificationEmail({ ...base, choice: "decline" }).subject).toContain("今回は見送る");
  });

  it("協力会社名・案件・業種・回答と、見積状況タブへのURLが入る", () => {
    const { body } = buildResponseNotificationEmail(base);
    expect(body).toContain("東北三上機材株式会社 から見積依頼への回答がありました。");
    expect(body).toContain("案件：須崎庁舎浄化槽排水ポンプ修繕");
    expect(body).toContain("業種：設備保守");
    expect(body).toContain("回答：資料請求");
    expect(body).toContain("https://example.com/tenders/1?tab=quote-status");
  });

  it("備考・期限後・警告は該当するときだけ入る", () => {
    const plain = buildResponseNotificationEmail(base).body;
    expect(plain).not.toContain("備考：");
    expect(plain).not.toContain("回答期限を過ぎて");
    expect(plain).not.toContain("※資料");

    const full = buildResponseNotificationEmail({
      ...base,
      memo: "対応可能です",
      afterDue: true,
      warning: "資料の自動送付に失敗しました",
    }).body;
    expect(full).toContain("備考：対応可能です");
    expect(full).toContain("※回答期限を過ぎてからの回答です");
    expect(full).toContain("※資料の自動送付に失敗しました");
  });
});
