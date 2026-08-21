import { describe, expect, it } from "vitest";
import {
  buildDocumentsEmail,
  documentFilenames,
  signedUrlTtlSeconds,
  sortDocumentsByKind,
} from "./quote_response";

const DAY = 60 * 60 * 24;

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
  it("元のファイル名があればそれを表示名にする", () => {
    const result = documentFilenames([
      { kind: "その他", storage_key: "tenders/abc/other_9f8e.pdf", filename: "06_数量総括表.pdf" },
    ]);
    expect(result[0].label).toBe("06_数量総括表.pdf");
  });

  it("元のファイル名が無ければ種別＋拡張子で代替する", () => {
    const result = documentFilenames([{ kind: "仕様書", storage_key: "tenders/abc/spec_9f8e.pdf" }]);
    expect(result[0].label).toBe("仕様書.pdf");
  });

  it("空文字のファイル名は無いものとして扱う", () => {
    const result = documentFilenames([{ kind: "仕様書", storage_key: "tenders/abc/spec_9f8e.pdf", filename: "   " }]);
    expect(result[0].label).toBe("仕様書.pdf");
  });

  it("種別で代替するとき、同じ種別が複数あれば連番を付ける", () => {
    const result = documentFilenames([
      { kind: "仕様書", storage_key: "tenders/abc/spec_1.pdf" },
      { kind: "仕様書", storage_key: "tenders/abc/spec_2.pdf" },
      { kind: "様式", storage_key: "tenders/abc/form_1.docx" },
    ]);
    expect(result.map((r) => r.label)).toEqual(["仕様書.pdf", "仕様書_2.pdf", "様式.docx"]);
  });

  it("元のファイル名がある行は連番の対象にしない", () => {
    const result = documentFilenames([
      { kind: "その他", storage_key: "tenders/abc/a.pdf", filename: "02_入札公告.pdf" },
      { kind: "その他", storage_key: "tenders/abc/b.pdf" },
    ]);
    expect(result.map((r) => r.label)).toEqual(["02_入札公告.pdf", "その他.pdf"]);
  });

  it("拡張子が無ければ種別だけにする（パス中のドットを拡張子と誤認しない）", () => {
    const result = documentFilenames([{ kind: "公告", storage_key: "tenders/a.b/notice" }]);
    expect(result[0].label).toBe("公告");
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
      { kind: "公告", label: "02_入札公告.pdf", url: "https://example.com/a" },
      { kind: "仕様書", label: "05_特記仕様書.pdf", url: "https://example.com/b" },
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
    expect(body).toContain("【公告】02_入札公告.pdf");
    expect(body).toContain("https://example.com/a");
    expect(body).toContain("【仕様書】05_特記仕様書.pdf");
    expect(body).toContain("https://example.com/b");
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
