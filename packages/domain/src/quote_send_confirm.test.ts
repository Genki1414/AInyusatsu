import { describe, expect, it } from "vitest";
import { quoteSendConfirmMessage, quoteSendCount, type QuoteSendTarget } from "./quote_send_confirm";

const targets: QuoteSendTarget[] = [
  { trade: "清掃", partnerNames: ["東北A社", "東北B社"] },
  { trade: "設備保守", partnerNames: ["C社"] },
];

describe("quoteSendCount", () => {
  it("業種ごとに1通ずつ数える", () => {
    expect(quoteSendCount(targets)).toBe(3);
  });

  it("同じ会社を2業種で選べば2通", () => {
    expect(quoteSendCount([
      { trade: "清掃", partnerNames: ["A社"] },
      { trade: "設備保守", partnerNames: ["A社"] },
    ])).toBe(2);
  });

  it("選んでいない業種は数えない", () => {
    expect(quoteSendCount([{ trade: "清掃", partnerNames: [] }])).toBe(0);
    expect(quoteSendCount([])).toBe(0);
  });
});

describe("quoteSendConfirmMessage", () => {
  it("通数と、業種ごとの宛先を全部並べる", () => {
    expect(quoteSendConfirmMessage(targets)).toBe(
      [
        "次の3通のメールを送信します。",
        "",
        "【清掃】",
        "・東北A社",
        "・東北B社",
        "【設備保守】",
        "・C社",
        "",
        "送信したメールは取り消せません。よろしいですか？",
      ].join("\n"),
    );
  });

  it("選んでいない業種は見出しも出さない", () => {
    const message = quoteSendConfirmMessage([
      { trade: "清掃", partnerNames: ["A社"] },
      { trade: "塗装", partnerNames: [] },
    ]);
    expect(message).toContain("【清掃】");
    expect(message).not.toContain("【塗装】");
  });

  it("1社も選んでいなければ null（確認するものが無い）", () => {
    expect(quoteSendConfirmMessage([])).toBeNull();
    expect(quoteSendConfirmMessage([{ trade: "清掃", partnerNames: [] }])).toBeNull();
  });

  // 「ほかN社」で畳むと、畳んだ中に意図しない会社が入っていても気づけない
  it("社数が多くても省略しない", () => {
    const names = Array.from({ length: 30 }, (_, i) => `会社${i + 1}`);
    const message = quoteSendConfirmMessage([{ trade: "清掃", partnerNames: names }]);
    for (const name of names) expect(message).toContain(`・${name}`);
    expect(message).not.toContain("ほか");
  });
});
