// AI解析プロンプト集.md §4「提出書類の抽出」。追加の指示の本文はそのまま使う（書き換えない）。

export const FORMS_SCHEMA_DESCRIPTION = `{
  "forms": [
    { "name": "string", "form_no": "string|null", "required": true,
      "note": "string|null", "quote": "string", "source": "string" }
  ],
  "submission_method": { "value": "string|null", "quote": "string|null", "source": "string|null" },
  "unknown_reason": "string|null"
}`;

export const FORMS_INSTRUCTIONS = `・様式ファイルのファイル名だけでなく、入札説明書の「提出書類」の記載も見てください
・両方にある場合は統合し、様式番号（様式第1号、別紙5 など）を form_no に入れます
・「該当する場合のみ提出」「必要に応じて」とあるものは required: false とし、
  note にその条件を書いてください
・入札書・委任状・資格審査結果通知書の写しは、記載がなくても一般に必要ですが、
  **資料に記載がなければ含めないでください**（推測しない）
・提出方法（電子調達システム／持参／郵送）を submission_method に入れます`;
