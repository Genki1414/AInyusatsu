import { describe, expect, it } from "vitest";
import {
  buildFromHeader,
  looksLikeEmail,
  resolveReplyTo,
  resolveSenderIdentity,
  sanitizeDisplayName,
} from "./sender_identity";

const SERVICE = "mail@ai-nyusatsu.jp";

describe("buildFromHeader", () => {
  it("表示名は依頼元の顧客企業、実アドレスはサービスのもの", () => {
    expect(buildFromHeader("東葉総合サービス株式会社", SERVICE)).toBe(
      "東葉総合サービス株式会社 <mail@ai-nyusatsu.jp>",
    );
  });

  it("表示名が空ならアドレスだけを返す", () => {
    expect(buildFromHeader("", SERVICE)).toBe(SERVICE);
    expect(buildFromHeader("   ", SERVICE)).toBe(SERVICE);
  });

  it("会社名に引用符や改行が混ざってもヘッダが壊れない", () => {
    // 改行が通るとヘッダを差し込まれる余地になる
    expect(buildFromHeader('東葉"総合"\nサービス', SERVICE)).toBe("東葉総合 サービス <mail@ai-nyusatsu.jp>");
  });
});

describe("sanitizeDisplayName", () => {
  it("改行を空白に、引用符と山かっこを取り除く", () => {
    expect(sanitizeDisplayName('a"b\\c<d>e\nf')).toBe("abcde f");
  });

  it("長すぎる名前は100文字で切る", () => {
    expect(sanitizeDisplayName("あ".repeat(200))).toHaveLength(100);
  });
});

describe("resolveReplyTo", () => {
  it("顧客が設定していればそれを使う", () => {
    expect(resolveReplyTo("yamada@toyo-sogo.co.jp", "owner@toyo-sogo.co.jp")).toBe("yamada@toyo-sogo.co.jp");
  });

  it("未設定なら登録者のアドレスに落とす（返信先を空にしない）", () => {
    expect(resolveReplyTo(null, "owner@toyo-sogo.co.jp")).toBe("owner@toyo-sogo.co.jp");
    expect(resolveReplyTo("   ", "owner@toyo-sogo.co.jp")).toBe("owner@toyo-sogo.co.jp");
  });

  it("どちらも無ければnull（Reply-Toを付けない）", () => {
    expect(resolveReplyTo(null, null)).toBeNull();
  });

  it("メールアドレスの形をしていなければ使わない", () => {
    expect(resolveReplyTo("担当者まで", "owner@toyo-sogo.co.jp")).toBeNull();
  });

  it("前後の空白は取り除く", () => {
    expect(resolveReplyTo("  yamada@toyo-sogo.co.jp  ", null)).toBe("yamada@toyo-sogo.co.jp");
  });
});

describe("looksLikeEmail", () => {
  it("最低限の形を判定する", () => {
    expect(looksLikeEmail("a@b.co.jp")).toBe(true);
    expect(looksLikeEmail("a@b")).toBe(false);
    expect(looksLikeEmail("ab.co.jp")).toBe(false);
    expect(looksLikeEmail("a b@c.jp")).toBe(false);
    expect(looksLikeEmail("")).toBe(false);
  });
});

describe("resolveSenderIdentity", () => {
  it("差出人と返信先をまとめて決める", () => {
    expect(
      resolveSenderIdentity({
        orgName: "東葉総合サービス株式会社",
        serviceAddress: SERVICE,
        configuredReplyTo: "nyusatsu@toyo-sogo.co.jp",
        ownerEmail: "owner@toyo-sogo.co.jp",
      }),
    ).toEqual({
      from: "東葉総合サービス株式会社 <mail@ai-nyusatsu.jp>",
      replyTo: "nyusatsu@toyo-sogo.co.jp",
    });
  });

  it("返信先が未設定でも、登録者のアドレスへ向く", () => {
    expect(
      resolveSenderIdentity({
        orgName: "東葉総合サービス株式会社",
        serviceAddress: SERVICE,
        configuredReplyTo: null,
        ownerEmail: "owner@toyo-sogo.co.jp",
      }).replyTo,
    ).toBe("owner@toyo-sogo.co.jp");
  });
});
