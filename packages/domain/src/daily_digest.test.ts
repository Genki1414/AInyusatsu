import { describe, expect, it } from "vitest";
import {
  buildDailyDigest,
  buildDigestEmail,
  buildDigestSubject,
  daysLeftJst,
  formatJstDate,
  urgentDeadlines,
  type DigestInput,
} from "./daily_digest";

// 2026-08-25 09:00 JST
const NOW = new Date("2026-08-25T00:00:00Z");
const APP_URL = "https://a-inyusatsu-web.vercel.app";

function input(over: Partial<DigestInput> = {}): DigestInput {
  return {
    orgName: "東北三上機材株式会社",
    newProposals: [],
    deadlines: [],
    waitingQuotes: [],
    appUrl: APP_URL,
    ...over,
  };
}

describe("daysLeftJst", () => {
  it("JSTの日付で数える", () => {
    expect(daysLeftJst("2026-08-25T10:00:00+09:00", NOW)).toBe(0);
    expect(daysLeftJst("2026-08-27T10:00:00+09:00", NOW)).toBe(2);
    expect(daysLeftJst("2026-08-24T10:00:00+09:00", NOW)).toBe(-1);
  });

  it("JSTの深夜をUTCの前日と取り違えない", () => {
    // 2026-08-26 01:00 JST は UTCでは 08-25 16:00。JSTで数えれば明日
    expect(daysLeftJst("2026-08-26T01:00:00+09:00", NOW)).toBe(1);
  });

  it("読めない値は null（推測しない）", () => {
    expect(daysLeftJst(null, NOW)).toBeNull();
    expect(daysLeftJst("令和8年9月1日", NOW)).toBeNull();
  });
});

describe("formatJstDate", () => {
  it("M/D で返す", () => {
    expect(formatJstDate("2026-09-05T17:00:00+09:00")).toBe("9/5");
  });

  it("読めなければ null", () => {
    expect(formatJstDate(null)).toBeNull();
  });
});

describe("urgentDeadlines", () => {
  const base = { tenderId: "t1", tenderName: "清掃業務" };

  it("3日以内のものだけを、近い順に返す", () => {
    const result = urgentDeadlines(
      [
        { ...base, kind: "提出期限", at: "2026-08-28T17:00:00+09:00" },
        { ...base, tenderId: "t2", tenderName: "設備保守", kind: "質問期限", at: "2026-08-26T17:00:00+09:00" },
        { ...base, tenderId: "t3", tenderName: "遠い案件", kind: "提出期限", at: "2026-09-30T17:00:00+09:00" },
      ],
      NOW,
    );
    expect(result.map((d) => d.tenderName)).toEqual(["設備保守", "清掃業務"]);
    expect(result[0].daysLeft).toBe(1);
  });

  it("過ぎた期限は載せない", () => {
    expect(urgentDeadlines([{ ...base, kind: "提出期限", at: "2026-08-24T17:00:00+09:00" }], NOW)).toEqual([]);
  });

  it("期限が取れていない案件は載せない（推測しない）", () => {
    expect(urgentDeadlines([{ ...base, kind: "提出期限", at: null }], NOW)).toEqual([]);
  });
});

describe("buildDailyDigest", () => {
  it("知らせることが無ければ送らない", () => {
    const digest = buildDailyDigest(input(), NOW);
    expect(digest.send).toBe(false);
    expect(digest.skipReason).toBe("知らせることがありません");
  });

  it("提出期限が近ければ、それを次にやることにする", () => {
    const digest = buildDailyDigest(
      input({
        newProposals: [{ tenderId: "p1", tenderName: "新着案件", score: 90, submitDeadline: "2026-09-30T17:00:00+09:00" }],
        deadlines: [{ tenderId: "t1", tenderName: "清掃業務", kind: "提出期限", at: "2026-08-26T17:00:00+09:00" }],
      }),
      NOW,
    );
    expect(digest.send).toBe(true);
    expect(digest.nextAction).toEqual({
      label: "提出書類をそろえる",
      tenderName: "清掃業務",
      url: `${APP_URL}/tenders/t1?tab=forms`,
    });
  });

  it("提出期限が無ければ質問期限を優先する", () => {
    const digest = buildDailyDigest(
      input({
        newProposals: [{ tenderId: "p1", tenderName: "新着案件", score: 90, submitDeadline: null }],
        deadlines: [{ tenderId: "t2", tenderName: "設備保守", kind: "質問期限", at: "2026-08-27T17:00:00+09:00" }],
      }),
      NOW,
    );
    expect(digest.nextAction?.label).toBe("質問の要否を決める");
    expect(digest.nextAction?.url).toBe(`${APP_URL}/tenders/t2?tab=analysis`);
  });

  it("期限が近いものが無ければ、点数の高い提案を次にやることにする", () => {
    const digest = buildDailyDigest(
      input({
        newProposals: [
          { tenderId: "p1", tenderName: "点数が低い", score: 62, submitDeadline: null },
          { tenderId: "p2", tenderName: "点数が高い", score: 88, submitDeadline: null },
        ],
      }),
      NOW,
    );
    expect(digest.nextAction).toEqual({
      label: "参加するか決める",
      tenderName: "点数が高い",
      url: `${APP_URL}/tenders/p2?tab=fit`,
    });
    expect(digest.newProposals.map((p) => p.tenderName)).toEqual(["点数が高い", "点数が低い"]);
  });

  it("提案も期限も無く、未回答の見積だけなら、そちらへ誘導する", () => {
    const digest = buildDailyDigest(
      input({ waitingQuotes: [{ tenderId: "t9", tenderName: "害虫防除", trade: "清掃", partnerName: "◯◯商会", dueAt: null }] }),
      NOW,
    );
    expect(digest.send).toBe(true);
    expect(digest.nextAction?.url).toBe(`${APP_URL}/tenders/t9?tab=sent`);
  });
});

describe("buildDigestSubject", () => {
  it("件数が分かる件名にする", () => {
    const digest = buildDailyDigest(
      input({
        newProposals: [{ tenderId: "p1", tenderName: "新着", score: 80, submitDeadline: null }],
        deadlines: [{ tenderId: "t1", tenderName: "清掃業務", kind: "提出期限", at: "2026-08-26T17:00:00+09:00" }],
      }),
      NOW,
    );
    expect(buildDigestSubject(digest)).toBe("【AI入札部】新着の提案1件／3日以内の期限1件");
  });
});

describe("buildDigestEmail", () => {
  const digest = buildDailyDigest(
    input({
      newProposals: [{ tenderId: "p1", tenderName: "庁舎清掃業務", score: 82, submitDeadline: "2026-09-25T17:00:00+09:00" }],
      deadlines: [{ tenderId: "t1", tenderName: "設備保守業務", kind: "提出期限", at: "2026-08-26T17:00:00+09:00" }],
      waitingQuotes: [
        { tenderId: "t1", tenderName: "設備保守業務", trade: "清掃", partnerName: "◯◯商会", dueAt: "2026-08-26T12:00:00+09:00" },
      ],
    }),
    NOW,
  );

  it("次にやることを先頭に1つだけ書く", () => {
    const { text } = buildDigestEmail(digest, { orgName: "東北三上機材株式会社", appUrl: APP_URL });
    const body = text.split("\n");
    const index = body.indexOf("■ 次にやること");
    expect(index).toBeGreaterThan(-1);
    expect(body[index + 1]).toBe("  提出書類をそろえる");
    // 行動の指示は1か所だけ
    expect(text.match(/■ 次にやること/g)).toHaveLength(1);
  });

  it("新着提案・期限・未回答の見積を載せる", () => {
    const { text } = buildDigestEmail(digest, { orgName: "東北三上機材株式会社", appUrl: APP_URL });
    expect(text).toContain("庁舎清掃業務（提出期限 9/25） 適合度82");
    expect(text).toContain("設備保守業務 提出期限 8/26（あと1日）");
    expect(text).toContain("設備保守業務 清掃 ◯◯商会（回答期限 8/26）");
  });

  it("送る内容が無いダイジェストからは作らない", () => {
    const empty = buildDailyDigest(input(), NOW);
    expect(() => buildDigestEmail(empty, { orgName: "A", appUrl: APP_URL })).toThrow();
  });

  it("一覧が長いときは件数だけ示す", () => {
    const many = buildDailyDigest(
      input({
        newProposals: Array.from({ length: 8 }, (_, i) => ({
          tenderId: `p${i}`,
          tenderName: `案件${i}`,
          score: 80 - i,
          submitDeadline: null,
        })),
      }),
      NOW,
    );
    const { text } = buildDigestEmail(many, { orgName: "A", appUrl: APP_URL });
    expect(text).toContain("ほか3件");
  });
});
