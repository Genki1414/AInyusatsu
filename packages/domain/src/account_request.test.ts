import { describe, expect, it } from "vitest";
import {
  additionalLoginMonthlyYen,
  isAlreadyRegistered,
  NOTE_MAX_LENGTH,
  requestAcceptedMessage,
  validateAccountRequest,
} from "./account_request";

describe("additionalLoginMonthlyYen", () => {
  it("基本プランの1つは無料", () => {
    expect(additionalLoginMonthlyYen(1)).toBe(0);
  });

  it("超えたぶんだけ1つ5,000円", () => {
    expect(additionalLoginMonthlyYen(2)).toBe(5000);
    expect(additionalLoginMonthlyYen(4)).toBe(15000);
  });

  it("0人でも負の金額にしない", () => {
    expect(additionalLoginMonthlyYen(0)).toBe(0);
  });
});

describe("validateAccountRequest", () => {
  const valid = { name: "山田 太郎", email: "Yamada@Example.co.jp", note: "" };

  it("メールアドレスは小文字にそろえる（ログインIDになるため）", () => {
    const r = validateAccountRequest(valid);
    expect(r.ok && r.value.email).toBe("yamada@example.co.jp");
  });

  it("前後の空白を落とす", () => {
    const r = validateAccountRequest({ ...valid, name: "  山田 太郎  " });
    expect(r.ok && r.value.name).toBe("山田 太郎");
  });

  it("名前が無ければ止める", () => {
    expect(validateAccountRequest({ ...valid, name: "   " }).ok).toBe(false);
  });

  it("メールアドレスの形でなければ止める", () => {
    expect(validateAccountRequest({ ...valid, email: "yamada" }).ok).toBe(false);
    expect(validateAccountRequest({ ...valid, email: "" }).ok).toBe(false);
  });

  it("備考が無ければ null（空文字を入れない）", () => {
    const r = validateAccountRequest({ ...valid, note: "  " });
    expect(r.ok && r.value.note).toBeNull();
  });

  it("備考が長すぎると本部の一覧が読めなくなるので止める", () => {
    const r = validateAccountRequest({ ...valid, note: "あ".repeat(NOTE_MAX_LENGTH + 1) });
    expect(r.ok).toBe(false);
  });
});

describe("isAlreadyRegistered", () => {
  const logins = [{ email: "owner@example.co.jp" }, { email: "Sato@Example.co.jp" }];

  it("大文字小文字の違いは同じ人として扱う", () => {
    expect(isAlreadyRegistered(logins, "SATO@example.co.jp")).toBe(true);
  });

  it("前後の空白があっても見つける", () => {
    expect(isAlreadyRegistered(logins, "  owner@example.co.jp ")).toBe(true);
  });

  it("無ければ false", () => {
    expect(isAlreadyRegistered(logins, "new@example.co.jp")).toBe(false);
  });
});

describe("requestAcceptedMessage", () => {
  it("発行後にいくらになるかを必ず書く", () => {
    const m = requestAcceptedMessage("山田 太郎", 2);
    expect(m).toContain("山田 太郎");
    expect(m).toContain("5,000円");
    expect(m).toContain("ログイン 2つ");
  });

  it("3つ目なら10,000円", () => {
    expect(requestAcceptedMessage("佐藤", 3)).toContain("10,000円");
  });
});
