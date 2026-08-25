import { describe, expect, it } from "vitest";
import {
  adminEmails,
  billingAttention,
  billingSummary,
  daysUntil,
  failureAction,
  groupCollectionIssues,
  isAdminEmail,
  stalledIssues,
  type BillingRow,
  type CollectionIssue,
} from "./admin_console";

// 2026-08-25 09:00 JST
const NOW = new Date("2026-08-25T00:00:00Z");

function issue(over: Partial<CollectionIssue> = {}): CollectionIssue {
  return {
    tenderId: "t1",
    tenderName: "庁舎清掃業務",
    agencyName: "関東地方整備局",
    failureCode: "LAYOUT_CHANGED",
    failureReason: null,
    at: "2026-08-25T00:00:00Z",
    ...over,
  };
}

describe("failureAction", () => {
  it("復旧の方法まで示す", () => {
    expect(failureAction("LAYOUT_CHANGED").priority).toBe(1);
    expect(failureAction("AUTH_REQUIRED").action).toContain("収集端末");
  });

  it("自動で直るものは人の対応を求めない", () => {
    expect(failureAction("RATE_LIMITED").needsHuman).toBe(false);
    expect(failureAction("OUT_OF_SCOPE").needsHuman).toBe(false);
  });

  it("知らないコードでも黙って捨てず、最優先で人に見せる", () => {
    const action = failureAction("SOMETHING_NEW");
    expect(action.needsHuman).toBe(true);
    expect(action.priority).toBe(1);
    expect(action.label).toContain("SOMETHING_NEW");
  });
});

describe("groupCollectionIssues", () => {
  it("対応が要るものから並べる", () => {
    const groups = groupCollectionIssues([
      issue({ failureCode: "OUT_OF_SCOPE" }),
      issue({ failureCode: "AUTH_REQUIRED" }),
      issue({ failureCode: "LAYOUT_CHANGED" }),
    ]);
    expect(groups.map((g) => g.code)).toEqual(["LAYOUT_CHANGED", "AUTH_REQUIRED", "OUT_OF_SCOPE"]);
  });

  it("同じコードはまとめる", () => {
    const groups = groupCollectionIssues([issue(), issue({ tenderId: "t2" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].issues).toHaveLength(2);
  });

  it("何も無ければ空", () => {
    expect(groupCollectionIssues([])).toEqual([]);
  });
});

describe("stalledIssues", () => {
  it("48時間直っていないものを拾う", () => {
    const groups = groupCollectionIssues([
      issue({ tenderId: "old", at: "2026-08-22T00:00:00Z" }),
      issue({ tenderId: "new", at: "2026-08-24T18:00:00Z" }),
    ]);
    expect(stalledIssues(groups, NOW).map((i) => i.tenderId)).toEqual(["old"]);
  });

  it("自動で直るものは放置と数えない", () => {
    const groups = groupCollectionIssues([issue({ failureCode: "RATE_LIMITED", at: "2026-08-01T00:00:00Z" })]);
    expect(stalledIssues(groups, NOW)).toEqual([]);
  });

  it("日時が取れないものは数えない（推測しない）", () => {
    const groups = groupCollectionIssues([issue({ at: null })]);
    expect(stalledIssues(groups, NOW)).toEqual([]);
  });
});

function billing(over: Partial<BillingRow> = {}): BillingRow {
  return {
    orgId: "o1",
    orgName: "東北三上機材株式会社",
    status: "有効",
    paymentMethod: "カード",
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    ...over,
  };
}

describe("billingAttention", () => {
  it("支払い遅延を、支払い方法つきで出す", () => {
    const [row] = billingAttention([billing({ status: "支払い遅延", paymentMethod: "銀行振込" })], NOW);
    expect(row.reason).toContain("銀行振込の入金を確認する");
  });

  it("解約の予約を出す", () => {
    const [row] = billingAttention([billing({ cancelAtPeriodEnd: true })], NOW);
    expect(row.reason).toBe("解約が予約されている");
  });

  it("トライアルの終わりが近いものを出す", () => {
    const [row] = billingAttention(
      [billing({ status: "トライアル中", trialEndsAt: "2026-08-28T00:00:00Z" })],
      NOW,
    );
    expect(row.reason).toBe("お試し期間があと3日で終わる");
  });

  it("まだ先のトライアルは出さない", () => {
    expect(billingAttention([billing({ status: "トライアル中", trialEndsAt: "2026-09-20T00:00:00Z" })], NOW)).toEqual([]);
  });

  it("問題のない契約は出さない", () => {
    expect(billingAttention([billing()], NOW)).toEqual([]);
  });
});

describe("billingSummary", () => {
  it("状態ごとの件数を返す", () => {
    const counts = billingSummary([billing(), billing({ status: "トライアル中" }), billing()]);
    expect(counts).toEqual({ 有効: 2, トライアル中: 1 });
  });
});

describe("daysUntil", () => {
  it("JSTの日付で数える", () => {
    expect(daysUntil("2026-08-27T10:00:00+09:00", NOW)).toBe(2);
    expect(daysUntil("2026-08-25T23:00:00+09:00", NOW)).toBe(0);
  });

  it("読めなければ null", () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil("令和8年", NOW)).toBeNull();
  });
});

describe("isAdminEmail", () => {
  it("設定を忘れたときは誰も入れない", () => {
    expect(isAdminEmail("a@example.com", undefined)).toBe(false);
    expect(isAdminEmail("a@example.com", "")).toBe(false);
  });

  it("一覧にあるアドレスだけ通す", () => {
    expect(isAdminEmail("a@example.com", "a@example.com,b@example.com")).toBe(true);
    expect(isAdminEmail("c@example.com", "a@example.com,b@example.com")).toBe(false);
  });

  it("大文字小文字と前後の空白は無視する", () => {
    expect(isAdminEmail(" A@Example.com ", "a@example.com")).toBe(true);
  });

  it("ログインしていなければ通さない", () => {
    expect(isAdminEmail(null, "a@example.com")).toBe(false);
    expect(isAdminEmail(undefined, "a@example.com")).toBe(false);
  });
});

describe("adminEmails", () => {
  it("カンマ区切りを読む", () => {
    expect(adminEmails("a@example.com, b@example.com")).toEqual(["a@example.com", "b@example.com"]);
    expect(adminEmails(undefined)).toEqual([]);
  });
});
