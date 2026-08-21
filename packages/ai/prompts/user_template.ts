// AI解析プロンプト集.md §0-3「ユーザープロンプトの共通の型」。
// 資料は連結せず、種別ごとに区切って渡す（本文の指示どおり）。プレースホルダー（{{...}}）を
// 実際の値で埋める関数として実装している以外は、テンプレートの文言・構成は変えていない。
//
// 【プロンプトキャッシュ】組み立てた文字列を、前半（案件の既知情報＋資料）と
// 後半（出力するJSON＋追加の指示）に分けて返す。前半は6本のプロンプトで完全に同じなので、
// アダプタ側でここまでをキャッシュ対象にする。テンプレートの文言は変えていない
// （つなげれば従来とまったく同じ文字列になる）。

import type { UserPrompt } from "../src/extract";

export type PromptDocument = { kind: string; text: string };

export type TenderMeta = {
  agencyName: string;
  noticeNo: string;
  procurement: string;
};

/**
 * 6本のプロンプトで共通の前半。案件の既知情報と資料まで。
 * ここが1文字でも変わるとキャッシュが外れるため、プロンプトごとの差分は入れない。
 */
export function buildSharedPrompt(meta: TenderMeta, documents: PromptDocument[]): string {
  const documentsBlock = documents.map((doc) => `--- 資料種別: ${doc.kind} ---\n${doc.text}\n--- ここまで ---`).join("\n\n");

  return `【案件の既知情報】
発注機関: ${meta.agencyName}
公告番号: ${meta.noticeNo}
調達種別: ${meta.procurement}

【資料】
${documentsBlock}`;
}

/** §0-3のテンプレートに実際の値を埋め込み、キャッシュできる前半と固有の後半に分けて返す。 */
export function buildUserPrompt(
  meta: TenderMeta,
  documents: PromptDocument[],
  schema: string,
  instructions?: string,
): UserPrompt {
  const body = instructions
    ? `【出力するJSON】\n${schema}\n\n${instructions}`
    : `【出力するJSON】\n${schema}`;
  return { cachedPrefix: buildSharedPrompt(meta, documents), body };
}

/** 前半と後半をつないだ、実際にモデルへ渡るのと同じ文字列。ログ・テスト用。 */
export function flattenUserPrompt(prompt: UserPrompt): string {
  return prompt.cachedPrefix === null ? prompt.body : `${prompt.cachedPrefix}\n\n${prompt.body}`;
}
