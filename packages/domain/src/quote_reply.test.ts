import { describe, expect, it } from "vitest";
import {
  extractAmounts,
  inboundAddress,
  parseInboundAddress,
  parseQuoteReply,
  replyToList,
  stripQuotedReply,
} from "./quote_reply";

const TOKEN = "345a4fbe-4b5f-49da-a1a7-4094fcae3bdb";

describe("inboundAddress / parseInboundAddress", () => {
  it("見積ごとの受信アドレスを組み立てる", () => {
    expect(inboundAddress(TOKEN, "ai-nyusatsu.jp")).toBe(`q.${TOKEN}@ai-nyusatsu.jp`);
  });

  it("受信アドレスからトークンを取り出す", () => {
    expect(parseInboundAddress(`q.${TOKEN}@ai-nyusatsu.jp`)).toBe(TOKEN);
  });

  it("大文字や前後の空白があっても読める", () => {
    expect(parseInboundAddress(`  Q.${TOKEN.toUpperCase()}@AI-NYUSATSU.JP  `)).toBe(TOKEN);
  });

  it("形が違うアドレスは受け付けない（別の見積に結びつけない）", () => {
    expect(parseInboundAddress("info@ai-nyusatsu.jp")).toBeNull();
    expect(parseInboundAddress("q.notauuid@ai-nyusatsu.jp")).toBeNull();
    expect(parseInboundAddress("q.@ai-nyusatsu.jp")).toBeNull();
    expect(parseInboundAddress("")).toBeNull();
  });
});

describe("replyToList", () => {
  it("顧客企業の返信先と、見積ごとの受信アドレスを並べる", () => {
    expect(replyToList("info@toyo.co.jp", TOKEN, "ai-nyusatsu.jp")).toEqual([
      "info@toyo.co.jp",
      `q.${TOKEN}@ai-nyusatsu.jp`,
    ]);
  });

  it("受信ドメインが未設定なら、受信アドレスを入れない（不達のエラーを返させない）", () => {
    expect(replyToList("info@toyo.co.jp", TOKEN, null)).toEqual(["info@toyo.co.jp"]);
  });

  it("顧客企業の返信先が未設定でも、受信アドレスは入れる", () => {
    expect(replyToList(null, TOKEN, "ai-nyusatsu.jp")).toEqual([`q.${TOKEN}@ai-nyusatsu.jp`]);
  });

  it("どちらも無ければnull（Reply-Toを付けない）", () => {
    expect(replyToList(null, TOKEN, null)).toBeNull();
  });
});

describe("stripQuotedReply", () => {
  it("行頭の引用記号が付いた行を落とす", () => {
    expect(stripQuotedReply("お見積りです。\n> 元の依頼文\n> 続き")).toBe("お見積りです。");
  });

  it("Original Message より下を落とす", () => {
    const body = "1,200,000円でお願いします。\n\n-----Original Message-----\nFrom: 東北三上機材\n案件名：…";
    expect(stripQuotedReply(body)).toBe("1,200,000円でお願いします。");
  });

  it("日本語のメールソフトの引用開始行にも対応する", () => {
    const body = "承知しました。\n2026年8月25日(火) 13:51 東北三上機材株式会社:\n> 案件名：…";
    expect(stripQuotedReply(body)).toBe("承知しました。");
  });

  it("引用が無ければそのまま返す", () => {
    expect(stripQuotedReply("  お世話になります。  ")).toBe("お世話になります。");
  });
});

describe("extractAmounts", () => {
  it("3桁区切りの金額を読む", () => {
    expect(extractAmounts("お見積り 1,200,000円 でお願いします")).toEqual([1_200_000]);
  });

  it("区切りの無い金額も読む", () => {
    expect(extractAmounts("1200000円")).toEqual([1_200_000]);
  });

  it("¥ や \\ の表記も読む", () => {
    expect(extractAmounts("¥1,200,000")).toEqual([1_200_000]);
    expect(extractAmounts("\\980000")).toEqual([980_000]);
  });

  it("全角で書かれていても読む", () => {
    expect(extractAmounts("１，２００，０００円")).toEqual([1_200_000]);
  });

  it("万・億の表記を読む", () => {
    expect(extractAmounts("120万円")).toEqual([1_200_000]);
    expect(extractAmounts("1億2000万円")).toEqual([120_000_000]);
  });

  it("通貨の目印が無い数字は拾わない（日付・電話番号・数量を金額にしない）", () => {
    expect(extractAmounts("2026年9月22日までにご連絡ください。TEL 022-123-4567、数量は12です")).toEqual([]);
  });

  it("同じ金額が複数回出てきても1つにまとめる", () => {
    expect(extractAmounts("1,200,000円（税抜1,200,000円）")).toEqual([1_200_000]);
  });

  it("違う金額は出現順にすべて挙げる", () => {
    expect(extractAmounts("清掃 800,000円、警備 400,000円、合計 1,200,000円")).toEqual([800_000, 400_000, 1_200_000]);
  });
});

describe("parseQuoteReply", () => {
  it("金額が1つなら確定させる", () => {
    const r = parseQuoteReply("お世話になります。\n本件、1,200,000円（税抜）でお願いいたします。");
    expect(r.amount).toBe(1_200_000);
    expect(r.taxIncluded).toBe(false);
    expect(r.declined).toBe(false);
  });

  it("金額が複数あるときは確定させず、候補を並べる（合計を推定しない）", () => {
    // 実装仕様書 §4.4「複数金額（内訳）がある場合は合計を推定せず、人の確認へ回す」
    const r = parseQuoteReply("内訳です。\n床清掃 800,000円\n窓清掃 400,000円");
    expect(r.amount).toBeNull();
    expect(r.candidates).toEqual([800_000, 400_000]);
  });

  it("金額が見つからなければ null", () => {
    const r = parseQuoteReply("資料を拝見しました。改めてご連絡します。");
    expect(r.amount).toBeNull();
    expect(r.candidates).toEqual([]);
  });

  it("税込と書かれていれば拾う", () => {
    expect(parseQuoteReply("1,320,000円（税込）").taxIncluded).toBe(true);
  });

  it("税の記載が無ければ null（推測しない）", () => {
    expect(parseQuoteReply("1,200,000円でお願いします").taxIncluded).toBeNull();
  });

  it("見送りの意思を読み取る", () => {
    for (const body of ["今回は辞退させていただきます", "今回は見送らせてください", "お断りいたします"]) {
      expect(parseQuoteReply(body).declined, body).toBe(true);
    }
  });

  it("引用に含まれる金額は拾わない", () => {
    const body = "承知しました。\n\n-----Original Message-----\n前回は 999,999円 でした";
    expect(parseQuoteReply(body).candidates).toEqual([]);
  });

  it("画面に並べるための本文（引用を落としたもの）を返す", () => {
    const r = parseQuoteReply("1,200,000円です。\n> 引用");
    expect(r.text).toBe("1,200,000円です。");
  });
});
