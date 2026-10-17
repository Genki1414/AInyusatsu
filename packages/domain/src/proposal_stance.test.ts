import { describe, expect, it } from "vitest";
import {
  isSelectableProposalStatus,
  SELECTABLE_PROPOSAL_STATUSES,
  stanceForProposalStatus,
} from "./proposal_stance";
import { PROPOSAL_STATUSES } from "./proposal_status";
import { TENDER_STANCES, type TenderStance } from "./tender_stance";

describe("isSelectableProposalStatus", () => {
  it("提案一覧のボタンで選べるものだけを通す", () => {
    for (const status of SELECTABLE_PROPOSAL_STATUSES) expect(isSelectableProposalStatus(status)).toBe(true);
    // 配信済・既読は知らせた記録。人が選ぶものではない
    for (const bad of ["配信済", "既読", "", "検討", "参加", null, undefined]) {
      expect(isSelectableProposalStatus(bad)).toBe(false);
    }
  });
});

describe("stanceForProposalStatus", () => {
  it("「参加を検討する」で検討にする", () => {
    for (const current of ["未定", "保留", "見送り"] as const) {
      expect(stanceForProposalStatus("検討中", current)).toBe("検討");
    }
  });

  it("「今回は見送る」で見送りにする", () => {
    for (const current of ["未定", "検討", "保留"] as const) {
      expect(stanceForProposalStatus("対象外", current)).toBe("見送り");
    }
  });

  it("「戻す」は、見送りにしていたものだけ未定へ戻す", () => {
    expect(stanceForProposalStatus("提案対象", "見送り")).toBe("未定");
    // 机に戻しただけで、検討・保留という判断は変わっていない
    expect(stanceForProposalStatus("提案対象", "検討")).toBeNull();
    expect(stanceForProposalStatus("提案対象", "保留")).toBeNull();
    expect(stanceForProposalStatus("提案対象", "未定")).toBeNull();
  });

  it("配信済・既読は知らせた記録なので、判断を動かさない", () => {
    for (const current of TENDER_STANCES) {
      expect(stanceForProposalStatus("配信済", current)).toBeNull();
      expect(stanceForProposalStatus("既読", current)).toBeNull();
    }
  });

  // 資料を取り、見積を集めている途中の案件をボタン1つで落とさない
  it("参加を決めた案件は、どの操作でも動かさない", () => {
    for (const status of PROPOSAL_STATUSES) {
      expect(stanceForProposalStatus(status, "参加")).toBeNull();
    }
  });

  it("同じ判断になるときは動かさない（無駄な書き込みをしない）", () => {
    expect(stanceForProposalStatus("検討中", "検討")).toBeNull();
    expect(stanceForProposalStatus("対象外", "見送り")).toBeNull();
  });

  it("返すのは判断の値か null だけ", () => {
    for (const status of PROPOSAL_STATUSES) {
      for (const current of TENDER_STANCES) {
        const next: TenderStance | null = stanceForProposalStatus(status, current);
        expect(next === null || TENDER_STANCES.includes(next)).toBe(true);
      }
    }
  });
});
