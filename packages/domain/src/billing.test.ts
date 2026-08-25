import { describe, expect, it } from "vitest";
import {
  formatJstDay,
  isHandledStripeEvent,
  isUsable,
  mapStripeStatus,
  parsePaymentMethods,
  paymentMethodLabel,
  statusMessage,
  stripePaymentMethodTypes,
  TRIAL_DAYS,
} from "./billing";

describe("mapStripeStatus", () => {
  it("Stripeの状態を自分たちの言葉に直す", () => {
    expect(mapStripeStatus("trialing")).toBe("トライアル中");
    expect(mapStripeStatus("active")).toBe("有効");
    expect(mapStripeStatus("past_due")).toBe("支払い遅延");
    expect(mapStripeStatus("unpaid")).toBe("支払い遅延");
    expect(mapStripeStatus("canceled")).toBe("解約済");
    expect(mapStripeStatus("incomplete")).toBe("未契約");
  });

  it("知らない状態が来ても解約済にはしない（黙って止めない）", () => {
    expect(mapStripeStatus("some_new_status")).toBe("支払い遅延");
    expect(isUsable(mapStripeStatus("some_new_status"))).toBe(true);
  });
});

describe("isUsable", () => {
  it("支払い遅延でも使える（締切直前に締め出さない）", () => {
    expect(isUsable("支払い遅延")).toBe(true);
    expect(isUsable("トライアル中")).toBe(true);
    expect(isUsable("有効")).toBe(true);
  });

  it("解約済と未契約は使えない", () => {
    expect(isUsable("解約済")).toBe(false);
    expect(isUsable("未契約")).toBe(false);
  });
});

describe("statusMessage", () => {
  it("未契約にはお試し期間の日数を出す", () => {
    expect(statusMessage("未契約")).toContain(`${TRIAL_DAYS}日間`);
  });

  it("トライアル中は期限を出す", () => {
    expect(statusMessage("トライアル中", { trialEndsAt: "2026-09-24T15:00:00Z" })).toContain("2026年9月25日");
  });

  it("期限が取れなければ日付を出さない（推測しない）", () => {
    expect(statusMessage("トライアル中", { trialEndsAt: null })).toBe("お試し期間中です。");
  });

  it("支払い遅延でも「使える」と伝える", () => {
    expect(statusMessage("支払い遅延")).toContain("ご利用は続けられます");
  });
});

describe("formatJstDay", () => {
  it("JSTの日付で返す", () => {
    expect(formatJstDay("2026-09-24T15:00:00Z")).toBe("2026年9月25日");
  });

  it("読めなければ null", () => {
    expect(formatJstDay("令和8年9月")).toBeNull();
  });
});

describe("parsePaymentMethods / stripePaymentMethodTypes", () => {
  it("未設定ならカードと銀行振込の両方", () => {
    expect(parsePaymentMethods(undefined)).toEqual(["カード", "銀行振込"]);
    expect(parsePaymentMethods("")).toEqual(["カード", "銀行振込"]);
  });

  it("指定された方法だけを使う", () => {
    expect(parsePaymentMethods("card")).toEqual(["カード"]);
    expect(parsePaymentMethods("card,customer_balance")).toEqual(["カード", "銀行振込"]);
  });

  it("打ち間違いで決済ができなくならないよう、読めなければカードに落とす", () => {
    expect(parsePaymentMethods("visa,paypay")).toEqual(["カード"]);
  });

  it("Stripeに渡す値へ直す", () => {
    expect(stripePaymentMethodTypes(["カード", "銀行振込"])).toEqual(["card", "customer_balance"]);
    expect(stripePaymentMethodTypes([])).toEqual(["card"]);
  });
});

describe("paymentMethodLabel", () => {
  it("画面に出す言葉に直す", () => {
    expect(paymentMethodLabel("card")).toBe("カード");
    expect(paymentMethodLabel("customer_balance")).toBe("銀行振込");
    expect(paymentMethodLabel(null)).toBeNull();
    expect(paymentMethodLabel("konbini")).toBeNull();
  });
});

describe("isHandledStripeEvent", () => {
  it("受け取る3種だけを処理する", () => {
    expect(isHandledStripeEvent("checkout.session.completed")).toBe(true);
    expect(isHandledStripeEvent("customer.subscription.updated")).toBe(true);
    expect(isHandledStripeEvent("customer.subscription.deleted")).toBe(true);
    expect(isHandledStripeEvent("invoice.paid")).toBe(false);
  });
});
