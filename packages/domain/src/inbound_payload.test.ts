import { describe, expect, it } from "vitest";
import { describePayload, emailAddresses, findAttachments, findMessageBody, findRecipients, htmlToText } from "./inbound_payload";

describe("findMessageBody", () => {
  it("data.text にある本文を読む", () => {
    const hit = findMessageBody({ data: { text: "お見積書を添付いたします" } });
    expect(hit).toEqual({ text: "お見積書を添付いたします", path: "$.data.text", format: "text" });
  });

  it("項目名が違っても探す（決め打ちにしない）", () => {
    expect(findMessageBody({ email: { plain_body: "本文です" } }).text).toBe("本文です");
    expect(findMessageBody({ message: { stripped_text: "本文です" } }).text).toBe("本文です");
    expect(findMessageBody({ text: "一番上にある場合" }).text).toBe("一番上にある場合");
  });

  it("テキストが無ければHTMLから起こす", () => {
    const hit = findMessageBody({ data: { text: "  ", html: "<p>お見積<br>500,000円</p>" } });
    expect(hit.format).toBe("html");
    expect(hit.text).toBe("お見積\n500,000円");
  });

  it("添付の中身を本文と取り違えない", () => {
    const payload = { data: { attachments: [{ filename: "a.pdf", content: "JVBERi0=", text: "添付の中の文字" }] } };
    expect(findMessageBody(payload)).toEqual({ text: "", path: null, format: null });
  });

  it("ヘッダの中を本文と取り違えない", () => {
    const payload = { data: { headers: [{ name: "Subject", value: "Re: 見積", text: "ヘッダの値" }] } };
    expect(findMessageBody(payload).text).toBe("");
  });

  it("浅い階層を優先する", () => {
    const payload = { data: { text: "浅い方", nested: { text: "深い方" } } };
    expect(findMessageBody(payload).text).toBe("浅い方");
  });

  it("形が違っても落ちない", () => {
    expect(findMessageBody(null).text).toBe("");
    expect(findMessageBody("文字列").text).toBe("");
    expect(findMessageBody({ data: { text: 123 } }).text).toBe("");
  });

  it("循環参照でも止まる", () => {
    const payload: Record<string, unknown> = { data: {} };
    (payload.data as Record<string, unknown>).self = payload;
    expect(() => findMessageBody(payload)).not.toThrow();
  });
});

describe("findAttachments", () => {
  it("どの階層にあっても添付の一覧を見つける", () => {
    expect(findAttachments({ data: { attachments: [{ filename: "a.pdf" }] } }).path).toBe("$.data.attachments");
    expect(findAttachments({ email: { message: { files: [{ name: "b.xlsx" }] } } }).path).toBe("$.email.message.files");
    expect(findAttachments({ attachments: [] }).entries).toEqual([]);
  });

  it("配列でなければ拾わない", () => {
    expect(findAttachments({ data: { attachments: "なし" } })).toEqual({ entries: [], path: null });
    expect(findAttachments(null)).toEqual({ entries: [], path: null });
  });
});

describe("findRecipients", () => {
  it("宛先をアドレスだけにして返す", () => {
    const payload = { data: { to: ["協力会社 <q.abc@ai-nyusatsu.jp>"], cc: [] } };
    expect(findRecipients(payload)).toEqual(["q.abc@ai-nyusatsu.jp"]);
  });

  it("項目名や形が違っても拾う", () => {
    expect(findRecipients({ data: { recipient: "q.abc@ai-nyusatsu.jp" } })).toEqual(["q.abc@ai-nyusatsu.jp"]);
    expect(findRecipients({ envelope_to: "q.abc@ai-nyusatsu.jp" })).toEqual(["q.abc@ai-nyusatsu.jp"]);
    expect(findRecipients({ data: { to: [{ address: "q.abc@ai-nyusatsu.jp", name: "協力会社" }] } })).toEqual([
      "q.abc@ai-nyusatsu.jp",
    ]);
  });

  it("複数の宛先を重複なく返す", () => {
    const payload = { data: { to: ["a@example.com, b@example.com"], delivered_to: ["a@example.com"] } };
    expect(findRecipients(payload)).toEqual(["a@example.com", "b@example.com"]);
  });

  it("宛先が無ければ空", () => {
    expect(findRecipients({ data: {} })).toEqual([]);
  });
});

describe("emailAddresses", () => {
  it("名前付きの表記からアドレスを取り出す", () => {
    expect(emailAddresses("東北ミカミ機材 <info@example.co.jp>")).toEqual(["info@example.co.jp"]);
    expect(emailAddresses("a@example.com; b@example.com")).toEqual(["a@example.com", "b@example.com"]);
    expect(emailAddresses("アドレスなし")).toEqual([]);
  });
});

describe("htmlToText", () => {
  it("スクリプトやスタイルを落とす", () => {
    expect(htmlToText("<style>p{color:red}</style><p>本文</p>")).toBe("本文");
  });

  it("改行を残す", () => {
    expect(htmlToText("<div>1行目</div><div>2行目</div>")).toBe("1行目\n2行目");
  });

  it("文字参照を戻す", () => {
    expect(htmlToText("<p>A&amp;B&nbsp;C</p>")).toBe("A&B C");
  });
});

describe("describePayload", () => {
  it("項目名と型が分かる形で返す", () => {
    const lines = describePayload({ data: { to: ["a@example.com"], subject: "Re: 見積" } });
    expect(lines).toContain("$.data.subject : 文字列(6文字) \"Re: 見積\"");
    expect(lines).toContain("$.data.to : 配列(1件)");
  });

  it("長い文字列は中身を出さない（base64を吐き出さないため）", () => {
    const lines = describePayload({ content: "A".repeat(500) });
    expect(lines).toEqual(["$ : オブジェクト(1項目)", "$.content : 文字列(500文字)"]);
  });

  it("配列は先頭だけ見せて残りは件数で示す", () => {
    const lines = describePayload({ items: [1, 2, 3, 4, 5] }, { maxItems: 2 });
    expect(lines).toContain("$.items[…] : 残り3件は省略");
  });

  it("nullや数値も型が分かる", () => {
    const lines = describePayload({ amount: null, count: 3 });
    expect(lines).toContain("$.amount : null");
    expect(lines).toContain("$.count : number 3");
  });
});
