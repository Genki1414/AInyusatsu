import { describe, expect, it } from "vitest";
import {
  matchAwardsByName,
  normalizeAwardName,
  stripFiscalYear,
  type NameMatchableAward,
} from "./award_match";

function award(over: Partial<NameMatchableAward> = {}): NameMatchableAward {
  return { name: "令和７年度大阪空港庁舎等消防用設備点検業務", amount: 1_200_000, openedAt: "2025-04-01", winnerName: "◯◯設備", ...over };
}

describe("stripFiscalYear", () => {
  it("令和・平成・昭和の年度表記を外す", () => {
    expect(stripFiscalYear("令和８年度消防用設備点検業務")).toBe("消防用設備点検業務");
    expect(stripFiscalYear("平成30年度消防用設備点検業務")).toBe("消防用設備点検業務");
    expect(stripFiscalYear("令和元年度消防用設備点検業務")).toBe("消防用設備点検業務");
  });

  it("R8年度・2026年度の表記も外す", () => {
    expect(stripFiscalYear("R8年度消防用設備点検業務")).toBe("消防用設備点検業務");
    expect(stripFiscalYear("2026年度消防用設備点検業務")).toBe("消防用設備点検業務");
  });

  it("年度が文中にあっても外す", () => {
    expect(stripFiscalYear("大阪空港令和８年度消防用設備点検")).toBe("大阪空港消防用設備点検");
  });

  it("年度と関係ない数字は残す", () => {
    expect(stripFiscalYear("第3庁舎消防用設備点検業務")).toBe("第3庁舎消防用設備点検業務");
  });
});

describe("normalizeAwardName", () => {
  it("空白と区切り記号を落とす", () => {
    expect(normalizeAwardName("令和８年度　消防用設備点検業務（単価契約）")).toBe("消防用設備点検業務単価契約");
  });

  it("全角英数字を半角にそろえる", () => {
    expect(normalizeAwardName("ＡＢＣ棟清掃業務")).toBe("ABC棟清掃業務");
  });
});

describe("matchAwardsByName", () => {
  const tender = "令和８年度大阪空港庁舎等消防用設備点検業務";

  it("年度違いの同じ案件を完全一致で拾う", () => {
    const results = matchAwardsByName([award()], tender);
    expect(results).toHaveLength(1);
    expect(results[0].match).toBe("完全一致");
  });

  it("表記が揺れていても完全一致にする（空白・括弧・全角）", () => {
    const results = matchAwardsByName([award({ name: "令和７年度　大阪空港庁舎等　消防用設備点検業務" })], tender);
    expect(results[0]?.match).toBe("完全一致");
  });

  it("名称に補足が付いただけのものは部分一致にする", () => {
    const results = matchAwardsByName([award({ name: "令和６年度大阪空港庁舎等消防用設備点検業務（単価契約）" })], tender);
    expect(results[0]?.match).toBe("部分一致");
  });

  it("完全一致を部分一致より先に並べる", () => {
    const results = matchAwardsByName(
      [award({ name: "令和６年度大阪空港庁舎等消防用設備点検業務ほか" }), award({ name: "令和７年度大阪空港庁舎等消防用設備点検業務" })],
      tender,
    );
    expect(results.map((r) => r.match)).toEqual(["完全一致", "部分一致"]);
  });

  it("新しい落札から並べる", () => {
    const results = matchAwardsByName(
      [
        award({ openedAt: "2024-04-01", amount: 100 }),
        award({ openedAt: "2026-04-01", amount: 300 }),
        award({ openedAt: "2025-04-01", amount: 200 }),
      ],
      tender,
    );
    expect(results.map((r) => r.amount)).toEqual([300, 200, 100]);
  });

  it("完全一致でも部分一致でもない候補は「類似」として残す", () => {
    // trigram検索が候補として返した時点で近い。実際の名称を見せて利用者に判断してもらう
    const results = matchAwardsByName([award({ name: "令和７年度大阪空港庁舎外消防用設備等点検業務", similarity: 0.7 })], tender);
    expect(results[0]?.match).toBe("類似");
  });

  it("近さが分からない候補は「類似」に入れない（名称で引いていないため）", () => {
    expect(matchAwardsByName([award({ name: "令和７年度庁舎清掃業務" })], tender)).toEqual([]);
  });

  it("完全一致 → 部分一致 → 類似 の順に並べる", () => {
    const results = matchAwardsByName(
      [
        award({ name: "令和５年度大阪空港庁舎外消防用設備等点検業務", similarity: 0.6 }),
        award({ name: "令和６年度大阪空港庁舎等消防用設備点検業務ほか" }),
        award({ name: "令和７年度大阪空港庁舎等消防用設備点検業務" }),
      ],
      tender,
    );
    expect(results.map((r) => r.match)).toEqual(["完全一致", "部分一致", "類似"]);
  });

  it("類似は近い順に並べる（新しさより名称の近さを優先する）", () => {
    const results = matchAwardsByName(
      [
        award({ name: "令和７年度大阪空港消防設備業務", openedAt: "2026-04-01", similarity: 0.4, amount: 100 }),
        award({ name: "令和５年度大阪空港庁舎外消防用設備等点検業務", openedAt: "2024-04-01", similarity: 0.8, amount: 200 }),
      ],
      tender,
    );
    expect(results.map((r) => r.amount)).toEqual([200, 100]);
  });

  it("名称が短すぎるときは部分一致で探さない（関係ない案件まで拾うため）", () => {
    // 「清掃」だけで部分一致を許すと、あらゆる清掃案件が該当してしまう
    expect(matchAwardsByName([award({ name: "令和７年度本庁舎清掃業務" })], "令和８年度清掃")).toEqual([]);
  });

  it("名称が無い実績は無視する", () => {
    expect(matchAwardsByName([award({ name: null })], tender)).toEqual([]);
  });

  it("空の一覧・空の案件名でも落ちない", () => {
    expect(matchAwardsByName([], tender)).toEqual([]);
    expect(matchAwardsByName([award()], "令和８年度")).toEqual([]);
  });
});
