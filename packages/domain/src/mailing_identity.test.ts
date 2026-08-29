import { describe, expect, it } from "vitest";
import { combineAddress, mailingIdentityLooksComplete, normalizeMailingIdentity } from "./mailing_identity";

describe("normalizeMailingIdentity", () => {
  it("入力された項目をtrimする", () => {
    const result = normalizeMailingIdentity({ lastName: " 山田 ", phone: " 03-1234-5678 " });
    expect(result.lastName).toBe("山田");
    expect(result.phone).toBe("03-1234-5678");
  });

  it("未入力の項目は空文字列になる(nullにしない)", () => {
    const result = normalizeMailingIdentity({ lastName: "山田" });
    expect(result.firstName).toBe("");
    expect(result.postalCode).toBe("");
    expect(result.building).toBe("");
  });
});

describe("combineAddress", () => {
  it("都道府県・市区町村・丁目番地・建物名をつなげる", () => {
    expect(combineAddress({ prefecture: "東京都", city: "千代田区千代田", block: "1-1", building: "皇居ビル3F" })).toBe(
      "東京都千代田区千代田1-1皇居ビル3F",
    );
  });

  it("空欄は飛ばす", () => {
    expect(combineAddress({ prefecture: "東京都", city: "", block: "1-1", building: "" })).toBe("東京都1-1");
  });

  it("全部空なら空文字列", () => {
    expect(combineAddress({})).toBe("");
  });
});

describe("mailingIdentityLooksComplete", () => {
  it("郵便番号・都道府県・市区町村・電話番号が揃っていればtrue", () => {
    const identity = normalizeMailingIdentity({
      postalCode: "100-0001",
      prefecture: "東京都",
      city: "千代田区",
      phone: "03-1234-5678",
    });
    expect(mailingIdentityLooksComplete(identity)).toBe(true);
  });

  it("1つでも欠けていればfalse", () => {
    const identity = normalizeMailingIdentity({ postalCode: "100-0001", prefecture: "東京都" });
    expect(mailingIdentityLooksComplete(identity)).toBe(false);
  });
});
