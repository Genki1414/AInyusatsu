import { describe, expect, it } from "vitest";
import { buildSharedPrompt, buildUserPrompt, flattenUserPrompt } from "./user_template";

const META = { agencyName: "関東地方整備局", noticeNo: "第123号", procurement: "役務" };
const DOCS = [{ kind: "公告", text: "案件名：清掃業務委託" }];

describe("buildUserPrompt", () => {
  it("AI解析プロンプト集.md §0-3のテンプレート構成（見出し・区切り）を保つ", () => {
    const prompt = flattenUserPrompt(buildUserPrompt(META, DOCS, '{"name": "string|null"}'));

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
    const prompt = flattenUserPrompt(
      buildUserPrompt({ agencyName: "x", noticeNo: "x", procurement: "物品" }, [
        { kind: "公告", text: "公告の本文" },
        { kind: "仕様書", text: "仕様書の本文" },
      ], "{}"),
    );

    const firstBlock = prompt.indexOf("--- 資料種別: 公告 ---");
    const secondBlock = prompt.indexOf("--- 資料種別: 仕様書 ---");
    expect(firstBlock).toBeGreaterThanOrEqual(0);
    expect(secondBlock).toBeGreaterThan(firstBlock);
  });

  it("追加の指示は後半（プロンプト固有の側）に入る", () => {
    const prompt = buildUserPrompt(META, DOCS, "{}", "この抽出で特に注意すること: 期限は3種類あります");
    expect(prompt.body).toContain("期限は3種類あります");
    expect(prompt.cachedPrefix).not.toContain("期限は3種類あります");
  });
});

describe("プロンプトキャッシュのための分割", () => {
  it("資料は前半に入り、出力スキーマは後半に入る", () => {
    const prompt = buildUserPrompt(META, DOCS, '{"name": "string|null"}');
    expect(prompt.cachedPrefix).toContain("案件名：清掃業務委託");
    expect(prompt.cachedPrefix).not.toContain("【出力するJSON】");
    expect(prompt.body).toContain("【出力するJSON】");
  });

  it("スキーマと指示が違っても、前半は完全に同じ文字列になる（同じでないとキャッシュが外れる）", () => {
    const a = buildUserPrompt(META, DOCS, '{"name": "string"}', "基本情報の注意");
    const b = buildUserPrompt(META, DOCS, '{"lots": []}', "数量表の注意");
    expect(a.cachedPrefix).toBe(b.cachedPrefix);
    expect(a.body).not.toBe(b.body);
  });

  it("資料が違えば前半も違う（別案件のキャッシュを読まない）", () => {
    const a = buildUserPrompt(META, DOCS, "{}");
    const b = buildUserPrompt(META, [{ kind: "公告", text: "別の案件" }], "{}");
    expect(a.cachedPrefix).not.toBe(b.cachedPrefix);
  });

  it("buildSharedPromptの結果が、そのまま前半になる", () => {
    expect(buildUserPrompt(META, DOCS, "{}").cachedPrefix).toBe(buildSharedPrompt(META, DOCS));
  });
});

describe("flattenUserPrompt", () => {
  it("前半が無ければ後半だけを返す（単発のプロンプト）", () => {
    expect(flattenUserPrompt({ cachedPrefix: null, body: "本文だけ" })).toBe("本文だけ");
  });

  it("前半と後半を空行でつなぐ", () => {
    expect(flattenUserPrompt({ cachedPrefix: "前半", body: "後半" })).toBe("前半\n\n後半");
  });
});
