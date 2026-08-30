import { describe, expect, it } from "vitest";
import {
  acceptsAmount,
  amountLabel,
  buildRoadmap,
  canEnterResult,
  isBidResult,
  isRoadmapStepKey,
  isWon,
  SELECTABLE_BID_RESULTS,
  currentStep,
  isActiveStance,
  isTenderStance,
  SELECTABLE_STANCES,
  STANCE_ORDER,
  type RoadmapInput,
} from "./tender_stance";

const NOW = new Date("2026-08-29T10:00:00+09:00");

const 未着手: RoadmapInput = {
  checkedSteps: [],
  officialStatus: "未取得",
  quoteRequested: false,
  quoteReceived: false,
  bidPriceDecided: false,
  formsReady: false,
  submitted: false,
  qaDeadline: "2026-09-05T17:00:00+09:00",
  submitDeadline: "2026-09-12T17:00:00+09:00",
  bidOpenAt: "2026-09-15T10:00:00+09:00",
};

describe("stance", () => {
  it("選べるのは4つ（未定は初期値なので選ばせない）", () => {
    expect(SELECTABLE_STANCES).toEqual(["検討", "保留", "参加", "見送り"]);
  });

  it("知らない値は受け付けない", () => {
    expect(isTenderStance("参加")).toBe(true);
    expect(isTenderStance("やる")).toBe(false);
    expect(isTenderStance(null)).toBe(false);
  });

  it("参加と検討を進行中として扱う", () => {
    expect(isActiveStance("参加")).toBe(true);
    expect(isActiveStance("検討")).toBe(true);
    expect(isActiveStance("保留")).toBe(false);
    expect(isActiveStance("見送り")).toBe(false);
  });

  it("手を動かすものが先に並ぶ", () => {
    expect(STANCE_ORDER["参加"]).toBeLessThan(STANCE_ORDER["検討"]);
    expect(STANCE_ORDER["検討"]).toBeLessThan(STANCE_ORDER["見送り"]);
  });
});

describe("buildRoadmap", () => {
  it("何も進んでいなければ、最初の段取りが「いま」", () => {
    const steps = buildRoadmap(未着手, NOW);
    expect(steps[0].state).toBe("いま");
    expect(steps[0].label).toContain("御社の名義で取得");
  });

  it("「いま」は1つだけ（どれから手を付けるか分かるように）", () => {
    const steps = buildRoadmap(未着手, NOW);
    expect(steps.filter((s) => s.state === "いま")).toHaveLength(1);
  });

  it("済んだ段取りは消さずに印を変える", () => {
    const steps = buildRoadmap({ ...未着手, officialStatus: "取得済" }, NOW);
    expect(steps[0].state).toBe("済");
    // 質問したかどうかは本サービスでは分からない。したことにしない
    expect(steps[1].state).toBe("これから");
    expect(steps[2].state).toBe("いま"); // 見積依頼
    expect(steps).toHaveLength(7);
  });

  it("質問は、やらなくても次の段取りへ進める（任意）", () => {
    const steps = buildRoadmap({ ...未着手, officialStatus: "取得済" }, NOW);
    expect(steps[1].optional).toBe(true);
    // 質問が終わっていなくても「いま」はその先へ行く
    expect(currentStep(steps)?.label).toBe("協力会社へ見積を依頼する");
  });

  it("進むにつれて「いま」が下がる", () => {
    const steps = buildRoadmap(
      { ...未着手, officialStatus: "取得済", quoteRequested: true, bidPriceDecided: true },
      NOW,
    );
    expect(currentStep(steps)?.label).toBe("提出書類をそろえる");
  });

  it("提出まで済んでいれば、残るのは開札だけ", () => {
    const steps = buildRoadmap(
      {
        ...未着手,
        officialStatus: "取得済",
        quoteRequested: true,
        bidPriceDecided: true,
        formsReady: true,
        submitted: true,
      },
      NOW,
    );
    expect(currentStep(steps)?.label).toBe("開札");
  });

  it("期限が取れていない段取りは日付を出さない（推測しない）", () => {
    const steps = buildRoadmap({ ...未着手, qaDeadline: null, submitDeadline: null, bidOpenAt: null }, NOW);
    expect(steps.every((s) => s.deadline === null && s.daysLeft === null)).toBe(true);
  });

  it("質問期限が無ければ、資料取得の期限は提出期限にする", () => {
    const steps = buildRoadmap({ ...未着手, qaDeadline: null }, NOW);
    expect(steps[0].deadline).toBe("2026-09-12T17:00:00+09:00");
  });
});

describe("入札の結果", () => {
  it("選べるのは4つ（未入力は初期値なので選ばせない）", () => {
    expect(SELECTABLE_BID_RESULTS).toEqual(["落札", "落札できず", "辞退", "中止"]);
  });

  it("知らない値は受け付けない", () => {
    expect(isBidResult("落札")).toBe(true);
    expect(isBidResult("勝ち")).toBe(false);
  });

  it("金額のラベルは、誰の金額かで書き分ける", () => {
    expect(amountLabel("落札")).toContain("御社");
    expect(amountLabel("落札できず")).toContain("他社");
  });

  it("辞退・中止では金額を入れさせない（決まった金額が無い）", () => {
    expect(acceptsAmount("辞退")).toBe(false);
    expect(acceptsAmount("中止")).toBe(false);
    expect(acceptsAmount("落札")).toBe(true);
    expect(acceptsAmount("落札できず")).toBe(true);
  });

  it("開札の日を過ぎてから入れられる", () => {
    expect(canEnterResult({ bidOpenAt: "2026-08-28T10:00:00+09:00", submitDeadline: null }, NOW)).toBe(true);
    expect(canEnterResult({ bidOpenAt: "2026-09-15T10:00:00+09:00", submitDeadline: null }, NOW)).toBe(false);
  });

  it("開札が分からなければ提出期限で代える", () => {
    expect(canEnterResult({ bidOpenAt: null, submitDeadline: "2026-08-20T17:00:00+09:00" }, NOW)).toBe(true);
    expect(canEnterResult({ bidOpenAt: null, submitDeadline: "2026-09-12T17:00:00+09:00" }, NOW)).toBe(false);
  });

  it("どちらも取れていなければ、いつでも入れられる（推測で止めない）", () => {
    expect(canEnterResult({ bidOpenAt: null, submitDeadline: null }, NOW)).toBe(true);
  });

  it("落札かどうかを判定できる", () => {
    expect(isWon("落札")).toBe(true);
    expect(isWon("落札できず")).toBe(false);
    expect(isWon(null)).toBe(false);
  });
});

describe("段取りのチェック", () => {
  it("キーは画面の文言と別に持つ（文言を直しても記録が消えない）", () => {
    const steps = buildRoadmap(未着手, NOW);
    expect(steps.map((s) => s.key)).toEqual(["docs", "qa", "quote", "price", "forms", "submit", "open"]);
  });

  it("知らないキーは受け付けない", () => {
    expect(isRoadmapStepKey("docs")).toBe(true);
    expect(isRoadmapStepKey("しりょう")).toBe(false);
    expect(isRoadmapStepKey(null)).toBe(false);
  });

  it("手でチェックすれば済になる（本サービスに記録が無くても）", () => {
    const steps = buildRoadmap({ ...未着手, checkedSteps: ["docs"] }, NOW);
    expect(steps[0].state).toBe("済");
    expect(currentStep(steps)?.label).toBe("協力会社へ見積を依頼する");
  });

  it("質問だけをチェックしても、資料取得は済にならない", () => {
    const steps = buildRoadmap({ ...未着手, checkedSteps: ["qa"] }, NOW);
    expect(steps[1].state).toBe("済");
    expect(steps[0].state).toBe("いま");
  });

  it("本サービスの記録で分かる段取りは、理由を持たせて外させない", () => {
    const steps = buildRoadmap({ ...未着手, quoteRequested: true }, NOW);
    const quote = steps.find((s) => s.key === "quote");
    expect(quote?.state).toBe("済");
    expect(quote?.lockedReason).toContain("見積依頼");
  });

  it("記録が無い段取りは、外せる（理由を持たない）", () => {
    const steps = buildRoadmap({ ...未着手, checkedSteps: ["qa", "open"] }, NOW);
    expect(steps.find((s) => s.key === "qa")?.lockedReason).toBeNull();
    expect(steps.find((s) => s.key === "open")?.lockedReason).toBeNull();
  });

  it("質問と開札は本サービスでは分からないので、記録で済にしない", () => {
    const 提出済 = {
      ...未着手,
      officialStatus: "取得済",
      quoteRequested: true,
      bidPriceDecided: true,
      formsReady: true,
      submitted: true,
    };
    const steps = buildRoadmap(提出済, NOW);
    expect(steps.find((s) => s.key === "qa")?.state).toBe("これから");
    expect(steps.find((s) => s.key === "open")?.state).toBe("いま");
  });

  it("開札をチェックすれば、やることが無くなる", () => {
    const steps = buildRoadmap(
      {
        ...未着手,
        officialStatus: "取得済",
        quoteRequested: true,
        bidPriceDecided: true,
        formsReady: true,
        submitted: true,
        checkedSteps: ["open"],
      },
      NOW,
    );
    expect(currentStep(steps)).toBeNull();
  });

  it("知らないキーが記録に混ざっていても、段取りは壊れない", () => {
    const steps = buildRoadmap({ ...未着手, checkedSteps: ["むかしのキー"] }, NOW);
    expect(steps).toHaveLength(7);
    expect(steps[0].state).toBe("いま");
  });
});
