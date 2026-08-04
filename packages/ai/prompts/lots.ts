// AI解析プロンプト集.md §3「数量表の構造化と業種割当」。追加の指示の本文はそのまま使う（書き換えない）。

export const LOTS_SCHEMA_DESCRIPTION = `{
  "lots": [
    { "line_no": 1, "item": "string", "spec": "string|null",
      "qty": 0, "unit": "string|null",
      "trade": "string|null", "confidence": 0.0,
      "evidence": "string", "source": "string" }
  ],
  "trades_summary": [
    { "trade": "string", "confidence": 0.0, "evidence": "string", "source": "string",
      "excluded": false, "excluded_reason": "string|null" }
  ],
  "no_quantity_table": false,
  "unknown_reason": "string|null"
}`;

export const LOTS_INSTRUCTIONS = `・trade は次の辞書から選んでください。当てはまるものがなければ null にします
  清掃／貯水槽清掃／害虫防除／廃棄物処理／警備／設備保守／電気／空調／植栽／
  什器納入／事務用品／印刷／運送／給食／情報処理／その他

・「日常清掃」「定期清掃」「床維持」はすべて『清掃』に寄せます
・1行が複数の業種にまたがる場合は、主たる業種を1つ選び、evidence にその判断理由を書きます

・confidence の基準
  1.0〜0.8: 資料に業種名が明示されている
  0.8〜0.5: 作業内容から明らかに判断できる
  0.5〜0.3: 推定を含む
  0.3未満:  判断できない → trade は null にする

・trades_summary には、この案件で見積を依頼すべき業種をまとめます
  仕様書に「別契約とする」「本業務に含まない」と書かれている作業は
  excluded: true とし、excluded_reason に原文の引用を入れてください

・数量表が添付されていない案件では no_quantity_table: true とし、
  仕様書の記述から trades_summary だけを作成してください（lots は空配列）

・数量表が画像から読み取られたものである場合、読み取りに自信がない行は
  confidence を下げ、evidence に「OCR読み取り」と明記してください`;
