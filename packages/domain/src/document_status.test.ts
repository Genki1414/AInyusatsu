import { describe, expect, it } from "vitest";
import {
  documentAvailabilities,
  documentAvailability,
  summarizeDocuments,
  type DocumentCheck,
  type FetchedDocument,
} from "./document_status";

const CHECKED: DocumentCheck = {
  checkedAt: "2026-08-20T02:00:00Z",
  publishedKinds: ["公告", "入札説明書", "仕様書", "様式"],
  failureCode: null,
};

describe("documentAvailability", () => {
  it("取得できていれば「取得済」で、対応は不要", () => {
    const docs: FetchedDocument[] = [{ kind: "公告", fetched: true, extract_error: null }];
    expect(documentAvailability("公告", docs, CHECKED)).toEqual({ kind: "公告", status: "取得済", needsAction: false });
  });

  it("機関が出していない種別は「未公開」で、対応は不要（正常な状態）", () => {
    // 数量表が存在しない役務案件。ここをアラートにすると本当に要対応の案件が埋もれる
    expect(documentAvailability("数量表", [], CHECKED)).toEqual({ kind: "数量表", status: "未公開", needsAction: false });
  });

  it("機関は出しているのに行が無ければ「取得失敗」で、要対応", () => {
    expect(documentAvailability("仕様書", [], CHECKED)).toEqual({ kind: "仕様書", status: "取得失敗", needsAction: true });
  });

  it("取得はできたが本文を読めていなければ「本文なし」で、要対応（AI解析の入力にならない）", () => {
    const docs: FetchedDocument[] = [{ kind: "仕様書", fetched: true, extract_error: "OCRに失敗しました" }];
    expect(documentAvailability("仕様書", docs, CHECKED)).toEqual({ kind: "仕様書", status: "本文なし", needsAction: true });
  });

  it("資料の取得自体が失敗した案件は、出しているかどうかを判断せず全種別「取得失敗」", () => {
    const check: DocumentCheck = { checkedAt: null, publishedKinds: [], failureCode: "AUTH_REQUIRED" };
    expect(documentAvailability("数量表", [], check).status).toBe("取得失敗");
    expect(documentAvailability("数量表", [], check).needsAction).toBe(true);
  });

  it("まだ資料一覧を確認していなければ「未確認」で、対応は不要（失敗ではない）", () => {
    const check: DocumentCheck = { checkedAt: null, publishedKinds: [], failureCode: null };
    expect(documentAvailability("数量表", [], check)).toEqual({ kind: "数量表", status: "未確認", needsAction: false });
  });

  it("fetched=false の行は取得済とみなさない", () => {
    const docs: FetchedDocument[] = [{ kind: "仕様書", fetched: false, extract_error: null }];
    expect(documentAvailability("仕様書", docs, CHECKED).status).toBe("取得失敗");
  });

  it("extract_error が未指定（列を読んでいない画面）でも取得済として扱う", () => {
    expect(documentAvailability("公告", [{ kind: "公告", fetched: true }], CHECKED).status).toBe("取得済");
  });
});

describe("documentAvailabilities", () => {
  it("公告→入札説明書→仕様書→数量表→様式 の順に5件返す", () => {
    const result = documentAvailabilities([], CHECKED);
    expect(result.map((r) => r.kind)).toEqual(["公告", "入札説明書", "仕様書", "数量表", "様式"]);
  });
});

describe("summarizeDocuments", () => {
  it("取得済・未公開・要対応・未確認をそれぞれ数える", () => {
    const docs: FetchedDocument[] = [
      { kind: "公告", fetched: true, extract_error: null },
      { kind: "入札説明書", fetched: true, extract_error: null },
      { kind: "様式", fetched: true, extract_error: "OCRに失敗しました" },
    ];
    // 仕様書は機関が出しているのに取れていない（要対応）、数量表は未公開（正常）
    expect(summarizeDocuments(documentAvailabilities(docs, CHECKED))).toEqual({
      fetched: 2,
      notPublished: 1,
      needsAction: 2,
      unchecked: 0,
    });
  });

  it("未確認の案件は要対応に数えない", () => {
    const check: DocumentCheck = { checkedAt: null, publishedKinds: [], failureCode: null };
    expect(summarizeDocuments(documentAvailabilities([], check))).toEqual({
      fetched: 0,
      notPublished: 0,
      needsAction: 0,
      unchecked: 5,
    });
  });
});
