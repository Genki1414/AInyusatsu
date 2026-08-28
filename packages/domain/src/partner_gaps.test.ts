import { describe, expect, it } from "vitest";
import { countTradeDemand, findPartnerGaps, type PartnerForGap } from "./partner_gaps";

const partner = (over: Partial<PartnerForGap> = {}): PartnerForGap => ({
  trades: ["清掃"],
  email: "a@example.co.jp",
  active: true,
  ...over,
});

describe("countTradeDemand", () => {
  it("案件の数を数える（数量表の行数ではない）", () => {
    const demands = countTradeDemand([
      { tenderId: "t1", trade: "清掃" },
      { tenderId: "t1", trade: "清掃" },
      { tenderId: "t2", trade: "清掃" },
      { tenderId: "t2", trade: "警備" },
    ]);
    expect(demands).toEqual(
      expect.arrayContaining([
        { trade: "清掃", tenders: 2 },
        { trade: "警備", tenders: 1 },
      ]),
    );
  });

  it("業種が割り当てられていない行は数えない", () => {
    expect(countTradeDemand([{ tenderId: "t1", trade: null }, { tenderId: "t1", trade: "  " }])).toEqual([]);
  });
});

describe("findPartnerGaps", () => {
  it("依頼先が1社もいない業種を出す", () => {
    const result = findPartnerGaps([{ trade: "警備", tenders: 3 }], [partner({ trades: ["清掃"] })]);
    expect(result.missing).toEqual([{ trade: "警備", tenders: 3, ready: 0, noEmail: 0 }]);
  });

  it("メールアドレスが無い会社は依頼できないものとして分ける", () => {
    // 見積依頼はメールで送る。電話番号しか無い会社には出せない
    const result = findPartnerGaps(
      [{ trade: "清掃", tenders: 1 }],
      [partner({ email: null }), partner({ email: "  " })],
    );
    expect(result.missing[0]).toEqual({ trade: "清掃", tenders: 1, ready: 0, noEmail: 2 });
  });

  it("1社しかいない業種は「相見積が取れない」として分ける", () => {
    const result = findPartnerGaps([{ trade: "清掃", tenders: 2 }], [partner()]);
    expect(result.missing).toEqual([]);
    expect(result.thin[0]).toMatchObject({ trade: "清掃", ready: 1 });
  });

  it("2社いれば足りているとする", () => {
    const result = findPartnerGaps(
      [{ trade: "清掃", tenders: 2 }],
      [partner(), partner({ email: "b@example.co.jp" })],
    );
    expect(result.missing).toEqual([]);
    expect(result.thin).toEqual([]);
    expect(result.covered).toBe(1);
  });

  it("対応業種が未登録の会社は、どの業種の候補にもする", () => {
    // 見積依頼のおすすめと同じ扱い。ここだけ厳しくすると画面と依頼先が食い違う
    const result = findPartnerGaps(
      [{ trade: "警備", tenders: 1 }],
      [partner({ trades: [] }), partner({ trades: [], email: "b@example.co.jp" })],
    );
    expect(result.covered).toBe(1);
  });

  it("休止中の会社は数えない", () => {
    const result = findPartnerGaps([{ trade: "清掃", tenders: 1 }], [partner({ active: false })]);
    expect(result.missing[0]).toMatchObject({ ready: 0, noEmail: 0 });
  });

  it("案件の多い業種を先に出す（開拓の順番）", () => {
    const result = findPartnerGaps(
      [
        { trade: "警備", tenders: 1 },
        { trade: "電気", tenders: 5 },
      ],
      [],
    );
    expect(result.missing.map((g) => g.trade)).toEqual(["電気", "警備"]);
  });

  it("同数なら業種名の順（実行のたびに順番が変わらない）", () => {
    const result = findPartnerGaps(
      [
        { trade: "電気", tenders: 2 },
        { trade: "清掃", tenders: 2 },
      ],
      [],
    );
    expect(result.missing.map((g) => g.trade)).toEqual(["清掃", "電気"]);
  });

  it("提案中の案件が無ければ何も出さない", () => {
    expect(findPartnerGaps([], [partner()])).toEqual({ missing: [], thin: [], covered: 0 });
  });
});
