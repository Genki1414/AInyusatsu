import { describe, expect, it } from "vitest";
import {
  buildDeadlineNoticeEmail,
  buildQuoteReplyNoticeEmail,
  deadlineDedupeKey,
  digestDedupeKey,
  dueDeadlineNotices,
  formatJstDateTime,
  quoteReplyDedupeKey,
  type DeadlineCandidate,
} from "./instant_notice";

// 2026-08-25 09:00 JST
const NOW = new Date("2026-08-25T00:00:00Z");
const APP_URL = "https://a-inyusatsu-web.vercel.app";

function candidate(over: Partial<DeadlineCandidate> = {}): DeadlineCandidate {
  return {
    tenderId: "t1",
    tenderName: "庁舎清掃業務",
    kind: "提出期限",
    at: "2026-08-26T17:00:00+09:00",
    collectStatus: "公開中",
    ...over,
  };
}

describe("dueDeadlineNotices", () => {
  it("48時間を切ったものを返す", () => {
    const due = dueDeadlineNotices([candidate()], NOW);
    expect(due).toHaveLength(1);
    expect(due[0].hoursLeft).toBe(32);
  });

  it("48時間より先のものは送らない", () => {
    expect(dueDeadlineNotices([candidate({ at: "2026-08-28T17:00:00+09:00" })], NOW)).toEqual([]);
  });

  it("ちょうど48時間なら送る（境界を含む）", () => {
    const at = new Date(NOW.getTime() + 48 * 60 * 60 * 1000).toISOString();
    expect(dueDeadlineNotices([candidate({ at })], NOW)).toHaveLength(1);
  });

  it("過ぎた期限は送らない（今から間に合わない）", () => {
    expect(dueDeadlineNotices([candidate({ at: "2026-08-24T17:00:00+09:00" })], NOW)).toEqual([]);
  });

  it("期限が取れていない案件は送らない（推測しない）", () => {
    expect(dueDeadlineNotices([candidate({ at: null })], NOW)).toEqual([]);
  });

  it("終了した案件には送らない", () => {
    expect(dueDeadlineNotices([candidate({ collectStatus: "終了" })], NOW)).toEqual([]);
  });

  it("近い順に並べる", () => {
    const due = dueDeadlineNotices(
      [
        candidate({ tenderId: "a", at: "2026-08-26T17:00:00+09:00" }),
        candidate({ tenderId: "b", kind: "質問期限", at: "2026-08-25T18:00:00+09:00" }),
      ],
      NOW,
    );
    expect(due.map((d) => d.tenderId)).toEqual(["b", "a"]);
  });
});

describe("dedupeKey", () => {
  it("種類と対象で1つに決まる", () => {
    expect(deadlineDedupeKey("提出期限", "t1")).toBe("提出期限48h:t1");
    expect(deadlineDedupeKey("質問期限", "t1")).toBe("質問期限48h:t1");
    expect(quoteReplyDedupeKey("m1")).toBe("見積の返信:m1");
    expect(digestDedupeKey("2026-08-25")).toBe("daily_digest:2026-08-25");
  });

  it("種類が違えば別の鍵になる（同じ案件で両方送れる）", () => {
    expect(deadlineDedupeKey("提出期限", "t1")).not.toBe(deadlineDedupeKey("質問期限", "t1"));
  });
});

describe("formatJstDateTime", () => {
  it("JSTの時刻で返す", () => {
    expect(formatJstDateTime("2026-08-26T17:00:00+09:00")).toBe("8/26 17:00");
  });

  it("UTC表記でもJSTに直して返す", () => {
    expect(formatJstDateTime("2026-08-26T08:00:00Z")).toBe("8/26 17:00");
  });

  it("読めなければ null", () => {
    expect(formatJstDateTime(null)).toBeNull();
    expect(formatJstDateTime("令和8年9月1日")).toBeNull();
  });
});

describe("buildDeadlineNoticeEmail", () => {
  it("提出期限は提出書類の画面へ導く", () => {
    const [notice] = dueDeadlineNotices([candidate()], NOW);
    const { subject, text } = buildDeadlineNoticeEmail(notice, { orgName: "東北三上機材株式会社", appUrl: APP_URL });
    expect(subject).toBe("【AI入札部】提出期限まで48時間を切りました：庁舎清掃業務");
    expect(text).toContain("  提出書類をそろえる");
    expect(text).toContain(`${APP_URL}/tenders/t1?tab=forms`);
    expect(text).toContain("提出期限：8/26 17:00（あと32時間）");
  });

  it("質問期限は公告の中身の画面へ導く", () => {
    const [notice] = dueDeadlineNotices([candidate({ kind: "質問期限" })], NOW);
    const { text } = buildDeadlineNoticeEmail(notice, { orgName: "A", appUrl: APP_URL });
    expect(text).toContain("  質問の要否を決める");
    expect(text).toContain(`${APP_URL}/tenders/t1?tab=analysis`);
  });

  it("次にやることは1つだけ書く", () => {
    const [notice] = dueDeadlineNotices([candidate()], NOW);
    const { text } = buildDeadlineNoticeEmail(notice, { orgName: "A", appUrl: APP_URL });
    expect(text.match(/■ 次にやること/g)).toHaveLength(1);
  });
});

describe("buildQuoteReplyNoticeEmail", () => {
  const base = {
    tenderId: "t9",
    tenderName: "庁舎清掃業務",
    trade: "清掃",
    partnerName: "◯◯商会",
    parsedAmount: null,
    attachmentNames: ["御見積書.pdf"],
  };

  it("見積・原価の画面へ導く", () => {
    const { subject, text } = buildQuoteReplyNoticeEmail(base, { orgName: "A", appUrl: APP_URL });
    expect(subject).toBe("【AI入札部】◯◯商会から見積の返信が届きました");
    expect(text).toContain("  金額を確かめて取り込む");
    expect(text).toContain(`${APP_URL}/tenders/t9?tab=cost`);
    expect(text).toContain("見積書：御見積書.pdf");
  });

  it("金額は候補として書き、確定した金額のように書かない", () => {
    const { text } = buildQuoteReplyNoticeEmail({ ...base, parsedAmount: 500000 }, { orgName: "A", appUrl: APP_URL });
    expect(text).toContain("本文から読めた金額（候補）：500,000円");
    expect(text).toContain("金額は自動で入れていません。");
  });

  it("金額が読めなければ金額の行を出さない（推測で入れない）", () => {
    const { text } = buildQuoteReplyNoticeEmail(base, { orgName: "A", appUrl: APP_URL });
    expect(text).not.toContain("候補）：");
  });

  it("添付が無ければ見積書の行を出さない", () => {
    const { text } = buildQuoteReplyNoticeEmail({ ...base, attachmentNames: [] }, { orgName: "A", appUrl: APP_URL });
    expect(text).not.toContain("見積書：");
  });
});
