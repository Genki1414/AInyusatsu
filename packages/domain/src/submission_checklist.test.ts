import { describe, expect, it } from "vitest";
import { buildChecklist, checklistProgress, isFormState, type ChecklistForm } from "./submission_checklist";

const FORMS: ChecklistForm[] = [
  { id: "f1", name: "入札書", source: "様式第1号", required: true, note: null },
  { id: "f2", name: "委任状", source: "様式第3号", required: false, note: "代理人が入札する場合のみ" },
  { id: "f3", name: "内訳書", source: "様式第2号", required: true, note: null },
];

describe("buildChecklist", () => {
  it("進み具合が無い書類は「未着手」から始まる", () => {
    const items = buildChecklist(FORMS, {});
    expect(items.every((i) => i.state === "未着手")).toBe(true);
  });

  it("企業ごとの進み具合を重ねる", () => {
    const items = buildChecklist(FORMS, { f1: "完了", f3: "作成中" });
    expect(items.find((i) => i.id === "f1")?.state).toBe("完了");
    expect(items.find((i) => i.id === "f3")?.state).toBe("作成中");
  });

  it("必須の書類を先に並べる（提出をふさいでいるものを上に出す）", () => {
    expect(buildChecklist(FORMS, {}).map((i) => i.id)).toEqual(["f3", "f1", "f2"]);
  });

  it("元の配列を変更しない", () => {
    const input = [...FORMS];
    buildChecklist(input, {});
    expect(input.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
  });
});

describe("checklistProgress", () => {
  it("必須書類がすべて完了になるまで提出済みにできない", () => {
    const items = buildChecklist(FORMS, { f1: "完了" });
    expect(checklistProgress(items)).toEqual({ done: 1, total: 2, remaining: 1, canSubmit: false, optional: 1 });
  });

  it("必須書類がすべて完了なら提出済みにできる", () => {
    const items = buildChecklist(FORMS, { f1: "完了", f3: "完了" });
    expect(checklistProgress(items)).toEqual({ done: 2, total: 2, remaining: 0, canSubmit: true, optional: 1 });
  });

  it("任意（該当する場合のみ提出）の書類は提出の判定に含めない", () => {
    // 委任状（f2）が未着手のままでも提出できる。含めると関係のない書類で止まってしまう
    const items = buildChecklist(FORMS, { f1: "完了", f3: "完了", f2: "未着手" });
    expect(checklistProgress(items).canSubmit).toBe(true);
  });

  it("必須書類が1件も抽出できていなければ提出済みにできない（揃っている根拠が無い）", () => {
    const optionalOnly = buildChecklist([FORMS[1]], {});
    expect(checklistProgress(optionalOnly)).toEqual({ done: 0, total: 0, remaining: 0, canSubmit: false, optional: 1 });
    expect(checklistProgress([])).toEqual({ done: 0, total: 0, remaining: 0, canSubmit: false, optional: 0 });
  });
});

describe("isFormState", () => {
  it("辞書内の値だけを受け付ける", () => {
    expect(isFormState("完了")).toBe(true);
    expect(isFormState("提出済")).toBe(false);
    expect(isFormState(null)).toBe(false);
  });
});
