// AI解析プロンプト集.md §6「質問案の生成」。追加の指示の本文はそのまま使う（書き換えない）。

export const QUESTIONS_SCHEMA_DESCRIPTION = `{
  "questions": [
    { "text": "string", "basis": "string", "quote": "string", "source": "string",
      "impact": "見積|参加可否|工程|その他" }
  ],
  "qa_deadline": "YYYY-MM-DDTHH:mm|null",
  "unknown_reason": "string|null"
}`;

export const QUESTIONS_INSTRUCTIONS = `・質問を作るのは、次のいずれかに当てはまる場合だけです
  1. 数量や範囲が確定できず、見積に影響する
  2. 参加資格の解釈が分かれる
  3. 資料の間で記述が矛盾している
  4. 費用負担の所在が書かれていない

・作らない質問
  - 資料を読めば分かること
  - 一般的な確認（「詳細を教えてください」など）
  - 発注機関が回答できない事柄（他社の状況、予定価格）

・文体は、発注機関に送る文面としてそのまま使える丁寧語にしてください
・1問1論点。複数の論点を1つの質問にまとめないでください
・basis には「なぜ質問が必要か」を1文で書きます（利用者が送る判断をするための材料）
・最大3件。0件でも構いません`;
