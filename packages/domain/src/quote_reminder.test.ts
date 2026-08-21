import { describe, expect, it } from "vitest";
import { buildQuoteReminderEmail, shouldRemind, type RemindableQuote } from "./quote_reminder";

const NOW = new Date("2026-08-21T00:00:00Z");

const base: RemindableQuote = {
  repliedAt: null,
  declined: false,
  remindedAt: null,
  dueAt: "2026-08-21T12:00:00Z", // 12時間後
  partnerEmail: "partner@example.co.jp",
};

describe("shouldRemind", () => {
  it("回答期限まで24時間を切っていて未回答なら催促する", () => {
    expect(shouldRemind(base, NOW)).toEqual({ remind: true });
  });

  it("回答期限のちょうど24時間前になった時点で催促する", () => {
    expect(shouldRemind({ ...base, dueAt: "2026-08-22T00:00:00Z" }, NOW)).toEqual({ remind: true });
  });

  it("24時間より前なら、まだ催促しない", () => {
    expect(shouldRemind({ ...base, dueAt: "2026-08-22T00:01:00Z" }, NOW)).toEqual({
      remind: false,
      reason: "回答期限まで24時間以上ある",
    });
  });

  it("回答済みなら催促しない", () => {
    expect(shouldRemind({ ...base, repliedAt: "2026-08-20T10:00:00Z" }, NOW)).toEqual({ remind: false, reason: "回答済み" });
  });

  it("見送り済みなら催促しない", () => {
    expect(shouldRemind({ ...base, declined: true }, NOW)).toEqual({ remind: false, reason: "見送り済み" });
  });

  it("催促は1回だけ（繰り返すと迷惑メール扱いになり本来の依頼まで届かなくなる）", () => {
    expect(shouldRemind({ ...base, remindedAt: "2026-08-20T23:00:00Z" }, NOW)).toEqual({ remind: false, reason: "催促済み" });
  });

  it("回答期限を過ぎていたら催促しない（今から間に合わない）", () => {
    expect(shouldRemind({ ...base, dueAt: "2026-08-20T23:59:00Z" }, NOW)).toEqual({
      remind: false,
      reason: "回答期限を過ぎている",
    });
  });

  it("回答期限ちょうどは過ぎたものとして扱う", () => {
    expect(shouldRemind({ ...base, dueAt: "2026-08-21T00:00:00Z" }, NOW).remind).toBe(false);
  });

  it("回答期限が未設定・不正な日付なら催促しない（推測しない）", () => {
    expect(shouldRemind({ ...base, dueAt: null }, NOW)).toEqual({ remind: false, reason: "回答期限が未設定" });
    expect(shouldRemind({ ...base, dueAt: "いつか" }, NOW)).toEqual({ remind: false, reason: "回答期限が未設定" });
  });

  it("メールアドレスが未登録なら催促しない", () => {
    expect(shouldRemind({ ...base, partnerEmail: null }, NOW)).toEqual({
      remind: false,
      reason: "メールアドレスが未登録",
    });
  });
});

describe("buildQuoteReminderEmail", () => {
  const input = {
    partnerName: "東北三上機材株式会社",
    senderOrgName: "東葉総合サービス株式会社",
    senderContactEmail: "yamada@example.co.jp",
    tenderName: "須崎庁舎浄化槽排水ポンプ修繕",
    trade: "設備保守",
    dueAtLabel: "2026/8/22 11:17",
    responseUrl: "https://example.com/q/abc123",
  };

  it("件名で催促だと分かる", () => {
    expect(buildQuoteReminderEmail(input).subject).toBe("【再送】お見積りのご依頼（須崎庁舎浄化槽排水ポンプ修繕）");
  });

  it("宛名・案件名・業種・回答期限・回答ページのURLが入る", () => {
    const { body } = buildQuoteReminderEmail(input);
    expect(body).toContain("東北三上機材株式会社 様");
    expect(body).toContain("「須崎庁舎浄化槽排水ポンプ修繕」（設備保守）");
    expect(body).toContain("回答期限が2026/8/22 11:17に迫っております。");
    expect(body).toContain("https://example.com/q/abc123");
  });

  it("見送りも同じフォームから返せることを書く（返事をしにくくしない）", () => {
    const { body } = buildQuoteReminderEmail(input);
    expect(body).toContain("下記の専用フォームから、資料のご請求または見送りのご連絡をお願いいたします。");
    expect(body).toContain("「今回は見送る」をお選びください。");
  });

  it("行き違いへのお詫びを入れる", () => {
    expect(buildQuoteReminderEmail(input).body).toContain("行き違いで既にご対応いただいておりましたら");
  });

  it("末尾に送信元の署名が入る。連絡先が無ければ省く（空行を残さない）", () => {
    expect(buildQuoteReminderEmail(input).body.split("\n").slice(-3)).toEqual([
      "--",
      "東葉総合サービス株式会社",
      "yamada@example.co.jp",
    ]);
    expect(buildQuoteReminderEmail({ ...input, senderContactEmail: null }).body.split("\n").slice(-2)).toEqual([
      "--",
      "東葉総合サービス株式会社",
    ]);
  });
});
