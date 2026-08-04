import { describe, expect, it } from "vitest";
import { buildUserPrompt } from "./user_template";

describe("buildUserPrompt", () => {
  it("AI解析プロンプト集.md §0-3のテンプレート構成（見出し・区切り）を保つ", () => {
    const prompt = buildUserPrompt(
      { agencyName: "関東地方整備局", noticeNo: "第123号", procurement: "役務" },
      [{ kind: "公告", text: "案件名：清掃業務委託" }],
      '{"name": "string|null"}',
    );

    expect(prompt).toContain("【案件の既知情報】");
    expect(prompt).toContain("発注機関: 関東地方整備局");
    expect(prompt).toContain("公告番号: 第123号");
    expect(prompt).toContain("調達種別: 役務");
    expect(prompt).toContain("【資料】");
    expect(prompt).toContain("--- 資料種別: 公告 ---");
    expect(prompt).toContain("案件名：清掃業務委託");
    expect(prompt).toContain("--- ここまで ---");
    expect(prompt).toContain("【出力するJSON】");
    expect(prompt).toContain('{"name": "string|null"}');
  });

  it("資料は連結せず、種別ごとに区切ったブロックを続けて並べる", () => {
    const prompt = buildUserPrompt(
      { agencyName: "x", noticeNo: "x", procurement: "物品" },
      [
        { kind: "公告", text: "公告の本文" },
        { kind: "仕様書", text: "仕様書の本文" },
      ],
      "{}",
    );

    const firstBlock = prompt.indexOf("--- 資料種別: 公告 ---");
    const secondBlock = prompt.indexOf("--- 資料種別: 仕様書 ---");
    expect(firstBlock).toBeGreaterThanOrEqual(0);
    expect(secondBlock).toBeGreaterThan(firstBlock);
  });
});
