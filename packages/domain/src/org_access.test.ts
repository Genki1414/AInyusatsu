import { describe, expect, it } from "vitest";
import {
  accessSummary,
  buildInitialPassword,
  suspendedOrgs,
  SUSPEND_REASONS,
  type OrgAccessRow,
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

describe("SUSPEND_REASONS", () => {
  it("未入金がいちばん上（ほとんどがこれ）", () => {
    expect(SUSPEND_REASONS[0]).toContain("お支払い");
  });

  it("どれも「理由：」に続けて読める文になっている", () => {
    for (const reason of SUSPEND_REASONS) {
      expect(suspendedMessage(reason)).toBe(`ご利用を停止しています。理由：${reason}`);
      expect(reason.endsWith("ため")).toBe(true);
    }
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

describe("accessSummary / suspendedOrgs", () => {
  const row = (orgId: string, status: string, suspendedAt: string | null = null): OrgAccessRow => ({
    orgId,
    orgName: `${orgId}社`,
    status,
    suspendedAt,
    suspendedReason: null,
  });

  it("利用中と停止を数える", () => {
    expect(accessSummary([row("a", "利用中"), row("b", "停止"), row("c", "利用中")])).toEqual({
      active: 2,
      suspended: 1,
    });
  });

  it("知らない状態は停止に数える（分からないなら使わせない）", () => {
    expect(accessSummary([row("a", "なにか別の値")])).toEqual({ active: 0, suspended: 1 });
  });

  it("止めた日の新しい順に並べる", () => {
    const list = suspendedOrgs([
      row("a", "停止", "2026-08-01T00:00:00Z"),
      row("b", "利用中"),
      row("c", "停止", "2026-08-20T00:00:00Z"),
    ]);
    expect(list.map((r) => r.orgId)).toEqual(["c", "a"]);
  });

  it("止めた日が分からないものは最後に回す", () => {
    const list = suspendedOrgs([row("a", "停止", null), row("b", "停止", "2026-08-01T00:00:00Z")]);
    expect(list.map((r) => r.orgId)).toEqual(["b", "a"]);
  });
});
