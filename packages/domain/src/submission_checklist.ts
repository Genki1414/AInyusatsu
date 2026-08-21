// 提出書類チェックリスト（タスク4-6）の純ロジック。
// 参照：docs/ai-nyusatsu-bu-prototype-v7.jsx の FormsTab
//
// 「書類が1つ足りずに失格」を防ぐのが目的なので、必須書類がすべて「完了」になるまで
// 提出済みにできない。副作用（DB更新）は呼び出し側が行う。

export const FORM_STATES = ["未着手", "作成中", "完了"] as const;

export type FormState = (typeof FORM_STATES)[number];

export function isFormState(value: unknown): value is FormState {
  return typeof value === "string" && (FORM_STATES as readonly string[]).includes(value);
}

/** tender_forms の1行（AI解析が抽出した提出書類）。 */
export type ChecklistForm = {
  id: string;
  name: string;
  /** 様式番号（様式第1号 など）。tender_forms.source */
  source: string | null;
  /** 「該当する場合のみ提出」の書類は false。提出可否の判定には数えない */
  required: boolean;
  note: string | null;
};

export type ChecklistItem = ChecklistForm & { state: FormState };

/**
 * 抽出した書類に、企業ごとの進み具合を重ねる。
 * 必須の書類を先に並べる（提出をふさいでいるものが上に来るようにする）。
 */
export function buildChecklist(forms: ChecklistForm[], states: Record<string, FormState>): ChecklistItem[] {
  return [...forms]
    .map((form) => ({ ...form, state: states[form.id] ?? "未着手" }))
    .sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name, "ja"));
}

export type ChecklistProgress = {
  /** 完了した必須書類の数 */
  done: number;
  /** 必須書類の総数 */
  total: number;
  /** 完了していない必須書類の数 */
  remaining: number;
  /** 提出済みにできるか。必須書類が0件のときは判断材料が無いので false */
  canSubmit: boolean;
  /** 任意（該当する場合のみ提出）の書類の数 */
  optional: number;
};

/**
 * 提出できる状態かを判定する。
 *
 * 「該当する場合のみ提出」の書類（required: false）は、該当しなければ完了にしようが無いため
 * 判定に含めない。含めると、関係のない書類のせいで提出済みにできなくなる。
 * 一覧には出すので、利用者が自分で確認できる。
 *
 * 必須書類が1件も抽出できていない場合は canSubmit を false にする。様式の解析が
 * 終わっていない状態であり、「揃っている」と言える根拠が無いため（推測しない）。
 */
export function checklistProgress(items: ChecklistItem[]): ChecklistProgress {
  const required = items.filter((i) => i.required);
  const done = required.filter((i) => i.state === "完了").length;
  return {
    done,
    total: required.length,
    remaining: required.length - done,
    canSubmit: required.length > 0 && done === required.length,
    optional: items.length - required.length,
  };
}
