import { describe, expect, it } from "vitest";
import {
  buildInitialPassword,
  INITIAL_PASSWORD_ALPHABET,
  INITIAL_PASSWORD_LENGTH,
  isActive,
  suspendedMessage,
  validateIssueAccount,
} from "./org_access";

describe("isActive", () => {
  it("利用中だけが使える", () => {
    expect(isActive("利用中")).toBe(true);
    expect(isActive("停止")).toBe(false);
  });

  it("分からないときは使わせない（作り忘れで使えてしまうのを防ぐ）", () => {
    expect(isActive(null)).toBe(false);
    expect(isActive(undefined)).toBe(false);
    expect(isActive("")).toBe(false);
    expect(isActive("なにか別の値")).toBe(false);
  });
});

describe("suspendedMessage", () => {
  it("理由があれば見せる", () => {
    expect(suspendedMessage("お支払いの確認が取れていないため")).toContain("お支払いの確認が取れていないため");
  });

  it("理由が無ければ連絡先を案内する", () => {
    expect(suspendedMessage(null)).toContain("運営までご連絡ください");
    expect(suspendedMessage("  ")).toContain("運営までご連絡ください");
  });
});

describe("buildInitialPassword", () => {
  const picks = Array.from({ length: INITIAL_PASSWORD_LENGTH }, (_, i) => i);

  it("決めた長さになる", () => {
    expect(buildInitialPassword(picks)).toHaveLength(INITIAL_PASSWORD_LENGTH);
  });

  it("見間違えやすい文字を使わない（電話で伝えることがある）", () => {
    for (const ng of ["0", "O", "o", "1", "l", "I", "2", "Z", "5", "S", "8", "B"]) {
      expect(INITIAL_PASSWORD_ALPHABET).not.toContain(ng);
    }
  });

  it("使う文字は必ず文字種の中から選ばれる", () => {
    const password = buildInitialPassword([999, -3, 7, 12, 40, 55, 61, 2, 88, 14, 23, 31, 9, 45, 50, 6]);
    for (const char of password) expect(INITIAL_PASSWORD_ALPHABET).toContain(char);
  });

  it("乱数が足りなければ、黙って短くせずに止める", () => {
    expect(() => buildInitialPassword([1, 2, 3])).toThrow(/16/);
  });
});

describe("validateIssueAccount", () => {
  const valid = { orgName: "東北三上機材株式会社", userName: "中川", email: "Nakagawa@Example.co.jp" };

  it("通ったら前後の空白を落とし、アドレスは小文字にする", () => {
    const result = validateIssueAccount({ ...valid, orgName: "  東北三上機材株式会社  " });
    expect(result).toEqual({
      ok: true,
      value: { orgName: "東北三上機材株式会社", userName: "中川", email: "nakagawa@example.co.jp" },
    });
  });

  it("会社名は必須（協力会社へ送るメールの差出人名になる）", () => {
    expect(validateIssueAccount({ ...valid, orgName: "   " })).toEqual({ ok: false, error: "会社名を入力してください" });
  });

  it("担当者名は必須", () => {
    expect(validateIssueAccount({ ...valid, userName: "" }).ok).toBe(false);
  });

  it("メールアドレスの形を確かめる", () => {
    expect(validateIssueAccount({ ...valid, email: "" }).ok).toBe(false);
    expect(validateIssueAccount({ ...valid, email: "nakagawa" }).ok).toBe(false);
    expect(validateIssueAccount({ ...valid, email: "nakagawa@example" }).ok).toBe(false);
  });

  it("長すぎる名前は受け付けない", () => {
    expect(validateIssueAccount({ ...valid, orgName: "あ".repeat(101) }).ok).toBe(false);
  });
});
