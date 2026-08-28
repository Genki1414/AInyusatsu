import { describe, expect, it } from "vitest";
import { buildOutreachMessage, type OutreachInput } from "./partner_outreach";

const base: OutreachInput = {
  senderOrgName: "東北三上機材株式会社",
  senderContactName: "中川",
  senderContactEmail: "nakagawa@tohoku-mikamikizai.co.jp",
  trade: "電気",
  tenderName: "令和８年度庁舎電気設備保守業務",
  agencyName: "東北地方整備局",
  place: "宮城県仙台市",
  termFrom: "2026-10-01",
  termTo: "2027-03-31",
  replyByLabel: "2026年9月10日",
  sourceUrl: "https://www.p-portal.go.jp/example",
};

describe("buildOutreachMessage", () => {
  it("件名に業種と自社名を入れる", () => {
    const { subject } = buildOutreachMessage(base);
    expect(subject).toContain("電気");
    expect(subject).toContain("東北三上機材株式会社");
  });

  it("案件の事実と公告のURLを載せる", () => {
    const { body } = buildOutreachMessage(base);
    expect(body).toContain("令和８年度庁舎電気設備保守業務");
    expect(body).toContain("東北地方整備局");
    expect(body).toContain("宮城県仙台市");
    expect(body).toContain("履行期間：2026-10-01 〜 2027-03-31");
    expect(body).toContain("https://www.p-portal.go.jp/example");
  });

  it("差出人と返信先を載せる", () => {
    const { body } = buildOutreachMessage(base);
    expect(body).toContain("東北三上機材株式会社の中川と申します");
    expect(body).toContain("nakagawa@tohoku-mikamikizai.co.jp");
  });

  it("返信の期日があれば書き、無ければ書かない", () => {
    expect(buildOutreachMessage(base).body).toContain("2026年9月10日までにご返信");
    const { body } = buildOutreachMessage({ ...base, replyByLabel: null });
    expect(body).toContain("ご返信をお待ちしております");
    expect(body).not.toContain("までにご返信");
  });

  it("値の無い項目は行ごと省く（「不明」と書かない）", () => {
    const { body } = buildOutreachMessage({
      ...base,
      agencyName: null,
      place: null,
      termFrom: null,
      termTo: null,
      sourceUrl: null,
      senderContactEmail: null,
    });
    expect(body).not.toContain("発注機関");
    expect(body).not.toContain("履行場所");
    expect(body).not.toContain("履行期間");
    expect(body).not.toContain("公告：");
    expect(body).not.toContain("不明");
    // 案件名と業種は必ず残る
    expect(body).toContain("案件名：令和８年度庁舎電気設備保守業務");
    expect(body).toContain("お願いしたい業種：電気");
  });

  it("履行期間は片方だけでも書く", () => {
    expect(buildOutreachMessage({ ...base, termTo: null }).body).toContain("履行期間：2026-10-01 から");
    expect(buildOutreachMessage({ ...base, termFrom: null }).body).toContain("履行期間：2027-03-31 まで");
  });

  it("回答ページのURLを入れない（面識の無い会社に配るものではない）", () => {
    const { body, subject } = buildOutreachMessage(base);
    for (const text of [body, subject]) {
      expect(text).not.toContain("/q/");
      expect(text).not.toMatch(/token/i);
    }
  });

  it("数量表の中身を入れない（本部が取得した資料の解析結果を配らない）", () => {
    const { body } = buildOutreachMessage(base);
    expect(body).not.toContain("数量表");
    expect(body).not.toContain("数量");
  });
});
