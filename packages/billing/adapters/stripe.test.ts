import { afterEach, describe, expect, it } from "vitest";
import { isBillingConfigured, monthlyPriceId } from "./stripe";

const KEYS = ["STRIPE_SECRET_KEY", "STRIPE_PRICE_STD_MONTHLY"] as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe("isBillingConfigured", () => {
  it("鍵と価格idがそろって初めて申し込みを受け付ける", () => {
    expect(isBillingConfigured()).toBe(false);

    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    // 価格idが無いと金額が決まらない。片方だけでは受け付けない
    expect(isBillingConfigured()).toBe(false);

    process.env.STRIPE_PRICE_STD_MONTHLY = "price_x";
    expect(isBillingConfigured()).toBe(true);
  });
});

describe("monthlyPriceId", () => {
  it("設定されていれば返す", () => {
    process.env.STRIPE_PRICE_STD_MONTHLY = "price_abc";
    expect(monthlyPriceId()).toBe("price_abc");
  });

  it("未設定なら、何をすればよいかが分かる形で止まる", () => {
    expect(() => monthlyPriceId()).toThrow(/STRIPE_PRICE_STD_MONTHLY/);
    expect(() => monthlyPriceId()).toThrow(/price_ から始まる/);
  });
});
