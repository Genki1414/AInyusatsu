// AI解析プロンプト集.md §0-3「ユーザープロンプトの共通の型」。
// 資料は連結せず、種別ごとに区切って渡す（本文の指示どおり）。プレースホルダー（{{...}}）を
// 実際の値で埋める関数として実装している以外は、テンプレートの文言・構成は変えていない。

export type PromptDocument = { kind: string; text: string };

export type TenderMeta = {
  agencyName: string;
  noticeNo: string;
  procurement: string;
};

/** §0-3のテンプレートに実際の値を埋め込む。 */
export function buildUserPrompt(meta: TenderMeta, documents: PromptDocument[], schema: string): string {
  const documentsBlock = documents.map((doc) => `--- 資料種別: ${doc.kind} ---\n${doc.text}\n--- ここまで ---`).join("\n\n");

  return `【案件の既知情報】
発注機関: ${meta.agencyName}
公告番号: ${meta.noticeNo}
調達種別: ${meta.procurement}

【資料】
${documentsBlock}

【出力するJSON】
${schema}`;
}
