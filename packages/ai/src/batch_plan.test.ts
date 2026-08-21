import { describe, expect, it } from "vitest";
import {
  buildCustomId,
  groupResultsByTender,
  isAnalysisPromptName,
  parseCustomId,
  promptsForStage,
  type BatchResultEntry,
} from "./batch_plan";

const TENDER_A = "6bf6f2f8-6f9a-4a6b-9a1d-2b3c4d5e6f70";
const TENDER_B = "11111111-2222-3333-4444-555555555555";

describe("promptsForStage", () => {
  it("第1段は基本情報だけ（資料をキャッシュへ書き込む役目）", () => {
    expect(promptsForStage(1)).toEqual(["basic_info"]);
  });

  it("第2段は残り4本（キャッシュから読む）", () => {
    expect(promptsForStage(2)).toEqual(["qualifications", "lots", "forms", "notes"]);
  });

  it("2つの段を合わせると、案件解析の5本すべてになる", () => {
    expect([...promptsForStage(1), ...promptsForStage(2)].sort()).toEqual(
      ["basic_info", "forms", "lots", "notes", "qualifications"].sort(),
    );
  });

  it("返した配列を書き換えても、次の呼び出しに影響しない", () => {
    promptsForStage(2).push("basic_info");
    expect(promptsForStage(2)).toHaveLength(4);
  });
});

describe("buildCustomId / parseCustomId", () => {
  it("案件IDとプロンプト名を往復できる", () => {
    const id = buildCustomId(TENDER_A, "lots");
    expect(parseCustomId(id)).toEqual({ tenderId: TENDER_A, promptName: "lots" });
  });

  it("プロンプト名にアンダースコアが入っていても正しく分解する", () => {
    expect(parseCustomId(buildCustomId(TENDER_A, "basic_info"))?.promptName).toBe("basic_info");
  });

  it("知らないプロンプト名なら null（黙って別のプロンプトとして扱わない）", () => {
    expect(parseCustomId(`${TENDER_A}#questions`)).toBeNull();
    expect(parseCustomId(`${TENDER_A}#unknown`)).toBeNull();
  });

  it("区切りが無い・案件IDが空なら null", () => {
    expect(parseCustomId("区切りなし")).toBeNull();
    expect(parseCustomId("#lots")).toBeNull();
  });
});

describe("isAnalysisPromptName", () => {
  it("案件解析の5本だけを受け付ける（§6の質問案は含まない）", () => {
    expect(isAnalysisPromptName("notes")).toBe(true);
    expect(isAnalysisPromptName("questions")).toBe(false);
  });
});

describe("groupResultsByTender", () => {
  const results: BatchResultEntry[] = [
    // 結果は投入順に返らないので、わざと入り混じった順にしている
    { customId: buildCustomId(TENDER_B, "lots"), text: '{"lots":[]}', error: null },
    { customId: buildCustomId(TENDER_A, "qualifications"), text: '{"qualifications":[]}', error: null },
    { customId: buildCustomId(TENDER_B, "forms"), text: null, error: "invalid_request" },
    { customId: buildCustomId(TENDER_A, "lots"), text: '{"lots":[{"line_no":1}]}', error: null },
  ];

  it("案件ごとに、成功した出力と失敗した理由を分けてまとめる", () => {
    const { byTender } = groupResultsByTender(results);
    const a = byTender.find((t) => t.tenderId === TENDER_A)!;
    const b = byTender.find((t) => t.tenderId === TENDER_B)!;

    expect(Object.keys(a.outputs).sort()).toEqual(["lots", "qualifications"]);
    expect(a.errors).toEqual({});
    expect(b.outputs.lots).toBe('{"lots":[]}');
    expect(b.errors.forms).toBe("invalid_request");
  });

  it("案件の並びは、最初に出てきた順を保つ", () => {
    expect(groupResultsByTender(results).byTender.map((t) => t.tenderId)).toEqual([TENDER_B, TENDER_A]);
  });

  it("読めなかったcustom_idは捨てずにunmatchedへ回す", () => {
    const { byTender, unmatched } = groupResultsByTender([
      { customId: "壊れたID", text: "{}", error: null },
      { customId: buildCustomId(TENDER_A, "notes"), text: "{}", error: null },
    ]);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].customId).toBe("壊れたID");
    expect(byTender).toHaveLength(1);
  });

  it("理由の無い失敗は「理由不明」として残す（空にして見失わない）", () => {
    const { byTender } = groupResultsByTender([
      { customId: buildCustomId(TENDER_A, "notes"), text: null, error: null },
    ]);
    expect(byTender[0].errors.notes).toBe("理由不明");
  });

  it("結果が0件でも落ちない", () => {
    expect(groupResultsByTender([])).toEqual({ byTender: [], unmatched: [] });
  });
});
