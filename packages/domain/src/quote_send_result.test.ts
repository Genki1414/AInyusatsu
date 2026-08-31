import { describe, expect, it } from "vitest";
import { quoteSendMessage } from "./quote_send_result";

const none = { sentCount: 0, skipped: [], failed: [] };

describe("quoteSendMessage", () => {
  it("何も選ばれていなければ、選ぶよう促す", () => {
    expect(quoteSendMessage(none).error).toBe("送信先の協力会社を1社以上選択してください");
    expect(quoteSendMessage(none).summary).toBeNull();
  });

  it("送れたら通数を出す", () => {
    const r = quoteSendMessage({ ...none, sentCount: 3 });
    expect(r.error).toBeNull();
    expect(r.summary).toContain("3社へ送信しました");
  });

  it("選んだ会社が全部依頼済みなら、送っていないことをはっきり出す", () => {
    const r = quoteSendMessage({ sentCount: 0, skipped: ["山田電機：すでに依頼済み"], failed: [] });
    expect(r.summary).toBeNull();
    expect(r.error).toContain("送信していません");
    expect(r.error).toContain("山田電機");
  });

  it("一部が依頼済みでも、送れた分は送れたと伝える", () => {
    const r = quoteSendMessage({ sentCount: 2, skipped: ["山田電機：すでに依頼済み"], failed: [] });
    expect(r.error).toBeNull();
    expect(r.summary).toContain("2社へ送信しました");
    expect(r.summary).toContain("すでに依頼済み");
    expect(r.summary).toContain("山田電機");
  });

  it("一部が失敗しても、送れた分は送れたと伝える（全部失敗にすると押し直されて二重送信になる）", () => {
    const r = quoteSendMessage({ sentCount: 2, skipped: [], failed: ["佐藤設備：送信に失敗しました"] });
    expect(r.error).toBeNull();
    expect(r.summary).toContain("2社へ送信しました");
    expect(r.summary).toContain("送れなかったもの");
  });

  it("1件も送れず失敗だけなら、赤で出す", () => {
    const r = quoteSendMessage({ sentCount: 0, skipped: [], failed: ["佐藤設備：送信に失敗しました"] });
    expect(r.summary).toBeNull();
    expect(r.error).toContain("送信できませんでした");
  });

  it("依頼済みと失敗が両方あって1件も送れていなければ、両方出す", () => {
    const r = quoteSendMessage({
      sentCount: 0,
      skipped: ["山田電機：すでに依頼済み"],
      failed: ["佐藤設備：送信に失敗しました"],
    });
    expect(r.error).toContain("山田電機");
    expect(r.error).toContain("佐藤設備");
  });
});
