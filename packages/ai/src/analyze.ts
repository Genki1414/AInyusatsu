// 6本のプロンプト（AI解析プロンプト集.md §1〜§6）を、それぞれ実行可能な関数として組み立てる。
// タスク2-4（解析結果の保存）はこれらの戻り値を tender_analyses / tender_lots / tender_forms へ書き戻す。

import { SYSTEM_PROMPT } from "../prompts/system";
import { buildUserPrompt, flattenUserPrompt, type PromptDocument, type TenderMeta } from "../prompts/user_template";
import { BASIC_INFO_INSTRUCTIONS, BASIC_INFO_SCHEMA_DESCRIPTION } from "../prompts/basic_info";
import { QUALIFICATIONS_INSTRUCTIONS, QUALIFICATIONS_SCHEMA_DESCRIPTION } from "../prompts/qualifications";
import { LOTS_INSTRUCTIONS, LOTS_SCHEMA_DESCRIPTION } from "../prompts/lots";
import { FORMS_INSTRUCTIONS, FORMS_SCHEMA_DESCRIPTION } from "../prompts/forms";
import { NOTES_INSTRUCTIONS, NOTES_SCHEMA_DESCRIPTION } from "../prompts/notes";
import { QUESTIONS_INSTRUCTIONS, QUESTIONS_SCHEMA_DESCRIPTION } from "../prompts/questions";
import { extract, type CallModel, type OnInvalid, type OnUsage, type UserPrompt } from "./extract";
import { DocumentsTooLargeError, planPromptDocuments } from "./document_budget";
import { basicInfoSchema, type BasicInfo } from "./schemas/basic_info";
import { qualificationsSchema, type Qualifications } from "./schemas/qualifications";
import { lotsSchema, type Lots } from "./schemas/lots";
import { formsSchema, type Forms } from "./schemas/forms";
import { notesSchema, type Notes } from "./schemas/notes";
import { questionsSchema, type Questions } from "./schemas/questions";

export type { PromptDocument, TenderMeta } from "../prompts/user_template";

type RunOptions = {
  meta: TenderMeta;
  documents: PromptDocument[];
  callModel: CallModel;
  onInvalid?: OnInvalid;
  /** 実際のトークン消費。プロンプトキャッシュが効いているかの計測に使う */
  onUsage?: OnUsage;
};

/**
 * 案件解析に使う5本のプロンプト（§1〜§5）の定義。
 * 同期実行（analyzeX）とバッチ実行（Batch API）の両方がここを参照するので、
 * 「どのプロンプトがどのスキーマを使うか」の対応はこの1か所だけに置く。
 * §6（質問案）は案件解析のパイプラインには含まないため入れていない。
 */
export const ANALYSIS_PROMPTS = {
  basic_info: {
    schemaDescription: BASIC_INFO_SCHEMA_DESCRIPTION,
    instructions: BASIC_INFO_INSTRUCTIONS,
    schema: basicInfoSchema,
  },
  qualifications: {
    schemaDescription: QUALIFICATIONS_SCHEMA_DESCRIPTION,
    instructions: QUALIFICATIONS_INSTRUCTIONS,
    schema: qualificationsSchema,
  },
  lots: {
    schemaDescription: LOTS_SCHEMA_DESCRIPTION,
    instructions: LOTS_INSTRUCTIONS,
    schema: lotsSchema,
  },
  forms: {
    schemaDescription: FORMS_SCHEMA_DESCRIPTION,
    instructions: FORMS_INSTRUCTIONS,
    schema: formsSchema,
  },
  notes: {
    schemaDescription: NOTES_SCHEMA_DESCRIPTION,
    instructions: NOTES_INSTRUCTIONS,
    schema: notesSchema,
  },
} as const;

export type AnalysisPromptName = keyof typeof ANALYSIS_PROMPTS;

/**
 * ユーザープロンプト＝共通テンプレート＋そのプロンプト固有の追加の指示。
 * 共通部分（案件の既知情報＋資料）と固有部分に分けて返す。共通部分は5本とも同じ文字列に
 * なるため、アダプタ側でここまでをキャッシュできる。
 *
 * 資料が入力上限に収まらない案件では、そのプロンプトの主資料だけに絞る（退避モード）。
 * 絞ると資料がプロンプトごとに変わってキャッシュの共通部分が消えるため、その場合は
 * キャッシュ対象を持たせない（持たせると書き込みだけが起きて割高になる）。
 * 絞っても収まらなければ DocumentsTooLargeError を投げ、そのプロンプトだけ失敗させる。
 */
export function buildAnalysisPrompt(
  promptName: AnalysisPromptName,
  meta: TenderMeta,
  documents: PromptDocument[],
): UserPrompt {
  const spec = ANALYSIS_PROMPTS[promptName];
  const plan = planPromptDocuments(promptName, documents);
  if (plan.mode === "over") {
    throw new DocumentsTooLargeError(promptName, plan.tokens, plan.limit);
  }

  const prompt = buildUserPrompt(meta, plan.documents, spec.schemaDescription, spec.instructions);
  if (plan.cacheable) return prompt;

  // eslint-disable-next-line no-console
  console.warn(
    `[analyze] 資料が上限を超えるため主資料だけに絞りました（${promptName}）。` +
      `除外: ${plan.omitted.map((o) => o.kind).join("・") || "なし"}`,
  );
  return { cachedPrefix: null, body: flattenUserPrompt(prompt) };
}

/** §1 基本情報と期限。合格ライン100%（期限を誤ると失格・機会損失に直結する）。 */
export async function analyzeBasicInfo(opts: RunOptions): Promise<BasicInfo> {
  return extract({
    promptName: "basic_info",
    system: SYSTEM_PROMPT,
    user: buildAnalysisPrompt("basic_info", opts.meta, opts.documents),
    schema: basicInfoSchema,
    callModel: opts.callModel,
    onInvalid: opts.onInvalid,
    onUsage: opts.onUsage,
  });
}

/** §2 参加資格と参加条件。 */
export async function analyzeQualifications(opts: RunOptions): Promise<Qualifications> {
  return extract({
    promptName: "qualifications",
    system: SYSTEM_PROMPT,
    user: buildAnalysisPrompt("qualifications", opts.meta, opts.documents),
    schema: qualificationsSchema,
    callModel: opts.callModel,
    onInvalid: opts.onInvalid,
    onUsage: opts.onUsage,
  });
}

/** §3 数量表の構造化と業種割当。見積依頼の質を決める。 */
export async function analyzeLots(opts: RunOptions): Promise<Lots> {
  return extract({
    promptName: "lots",
    system: SYSTEM_PROMPT,
    user: buildAnalysisPrompt("lots", opts.meta, opts.documents),
    schema: lotsSchema,
    callModel: opts.callModel,
    onInvalid: opts.onInvalid,
    onUsage: opts.onUsage,
  });
}

/** §4 提出書類の抽出。再現率を優先する（迷ったら含める）。 */
export async function analyzeForms(opts: RunOptions): Promise<Forms> {
  return extract({
    promptName: "forms",
    system: SYSTEM_PROMPT,
    user: buildAnalysisPrompt("forms", opts.meta, opts.documents),
    schema: formsSchema,
    callModel: opts.callModel,
    onInvalid: opts.onInvalid,
    onUsage: opts.onUsage,
  });
}

/** §5 注意事項の抽出。見落とすと失格・赤字になる制約だけを拾う。 */
export async function analyzeNotes(opts: RunOptions): Promise<Notes> {
  return extract({
    promptName: "notes",
    system: SYSTEM_PROMPT,
    user: buildAnalysisPrompt("notes", opts.meta, opts.documents),
    schema: notesSchema,
    callModel: opts.callModel,
    onInvalid: opts.onInvalid,
    onUsage: opts.onUsage,
  });
}

/** §6 質問案の生成。§1〜§5の結果と原文をもとに、発注機関への質問案を最大3件作る。 */
export async function analyzeQuestions(opts: RunOptions): Promise<Questions> {
  return extract({
    promptName: "questions",
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(opts.meta, opts.documents, QUESTIONS_SCHEMA_DESCRIPTION, QUESTIONS_INSTRUCTIONS),
    schema: questionsSchema,
    callModel: opts.callModel,
    onInvalid: opts.onInvalid,
    onUsage: opts.onUsage,
  });
}
