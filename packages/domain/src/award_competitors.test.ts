import { describe, expect, it } from "vitest";
import { normalizeWinnerName, summarizeCompetitors } from "./award_competitors";
import type { MatchedAward } from "./award_match";

function award(winnerName: string | null, amount: number, openedAt: string | null = "2026-01-01"): MatchedAward {
  return { name: "庁舎清掃業務", amount, openedAt, winnerName, match: "完全一致" };
}

describe("normalizeWinnerName", () => {
  it("法人格の記号を語に直す", () => {
    expect(normalizeWinnerName("㈱東北三上機材")).toBe("株式会社東北三上機材");
    expect(normalizeWinnerName("(株) 東北三上機材")).toBe("株式会社東北三上機材");
    expect(normalizeWinnerName("（株）東北三上機材")).toBe("株式会社東北三上機材");
    expect(normalizeWinnerName("㈲山田商店")).toBe("有限会社山田商店");
  });

  it("空白と全角英数字を揃える", () => {
    expect(normalizeWinnerName("ＡＢＣ　商事")).toBe("ABC商事");
  });

  it("似た社名は別の会社のまま（勝手にまとめない）", () => {
    // 「東北」と「東北電機」を同じ会社にすると、別会社を1社に潰してしまう
    expect(normalizeWinnerName("株式会社東北")).not.toBe(normalizeWinnerName("株式会社東北電機"));
  });
});

describe("summarizeCompetitors", () => {
  it("落札者ごとに件数と中央値をまとめ、件数の多い順に並べる", () => {
    const result = summarizeCompetitors([
      award("A社", 100),
      award("B社", 300),
      award("A社", 200),
      award("A社", 900),
    ]);
    expect(result.competitors[0]).toEqual({
      name: "A社",
      wins: 3,
      medianAmount: 200,
      latestOpenedAt: "2026-01-01",
    });
    expect(result.competitors[1].name).toBe("B社");
  });

  it("表記が違うだけの同じ会社はまとめ、表示は最初の表記を使う", () => {
    const result = summarizeCompetitors([award("㈱山田", 100), award("株式会社山田", 200)]);
    expect(result.competitors).toHaveLength(1);
    expect(result.competitors[0].name).toBe("㈱山田");
    expect(result.competitors[0].wins).toBe(2);
  });

  it("落札者が分からない件数を隠さない（分母からは外す）", () => {
    const result = summarizeCompetitors([award("A社", 100), award(null, 200), award("  ", 300)]);
    expect(result.known).toBe(1);
    expect(result.unknown).toBe(2);
    expect(result.competitors).toHaveLength(1);
  });

  it("過半を取っている会社を「繰り返し取っている」とする", () => {
    const result = summarizeCompetitors([award("A社", 100), award("A社", 200), award("B社", 300)]);
    expect(result.repeatWinner?.name).toBe("A社");
  });

  it("過半に届かなければ繰り返しとは言わない", () => {
    const result = summarizeCompetitors([award("A社", 100), award("B社", 200), award("C社", 300)]);
    expect(result.repeatWinner).toBeNull();
  });

  it("1件しか実績が無い会社を「繰り返し」と呼ばない", () => {
    const result = summarizeCompetitors([award("A社", 100)]);
    expect(result.repeatWinner).toBeNull();
    expect(result.competitors[0].wins).toBe(1);
  });

  it("落札者が分からない行があっても、分かっている分だけで過半を判定する", () => {
    // 3件中2件が落札者不明。分かっている1件を「全部A社」と見せない
    const result = summarizeCompetitors([award("A社", 100), award(null, 200), award(null, 300)]);
    expect(result.known).toBe(1);
    expect(result.repeatWinner).toBeNull();
  });

  it("中央値は偶数個のとき丸める（金額は円単位の整数）", () => {
    const result = summarizeCompetitors([award("A社", 100), award("A社", 201)]);
    expect(result.competitors[0].medianAmount).toBe(151);
    expect(Number.isInteger(result.competitors[0].medianAmount)).toBe(true);
  });

  it("落札実績が無ければ何も返さない", () => {
    expect(summarizeCompetitors([])).toEqual({ competitors: [], known: 0, unknown: 0, repeatWinner: null });
  });

  it("同数なら落札日の新しい順", () => {
    const result = summarizeCompetitors([award("A社", 100, "2024-01-01"), award("B社", 100, "2026-05-01")]);
    expect(result.competitors.map((c) => c.name)).toEqual(["B社", "A社"]);
  });
});
