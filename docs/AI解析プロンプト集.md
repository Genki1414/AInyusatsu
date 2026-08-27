# AI解析 プロンプト集

`packages/ai/prompts/` にそのまま置ける形で書いています。**Claude Codeに自己流で書かせないこと。**
ここが解析精度の中核であり、ゴールドセットで測定する対象そのものです。

モデル：Claude（`claude-sonnet-4-6` 相当）／temperature: 0 ／出力はJSONのみ

---

## 0. 共通の設計

### 0-1. 6本に分ける理由

1回のプロンプトで全項目を抽出させると精度が落ちます。**抽出する対象ごとに分けます。**

| # | プロンプト | 主な入力資料 | 出力 |
|---|---|---|---|
| 1 | 基本情報と期限 | 公告 | 案件名・機関・期限3種・資格区分・等級・地域・予定価格 |
| 2 | 参加資格と参加条件 | 公告・入札説明書 | 資格要件・参加条件（1条件1行） |
| 3 | 数量表の構造化と業種割当 | 数量表・仕様書 | 行ごとの項目／数量／業種 |
| 4 | 提出書類の抽出 | 様式・入札説明書 | 書類名・様式番号・必須か |
| 5 | 注意事項の抽出 | 仕様書・入札説明書 | 見落とすと失格・赤字になる制約 |
| 6 | 質問案の生成 | 1〜5の結果＋原文 | 発注機関への質問案（最大3件） |

### 0-2. 全プロンプト共通のシステムプロンプト

```
あなたは日本の公共調達の入札公告を読む担当者です。
与えられた資料から、指定されたJSONだけを出力します。

必ず守ること:
1. 資料に書かれていないことは推測しない。分からない項目は null にする
2. すべての抽出項目に、原文からの引用（30字以内）と出典（資料種別と章・条番号）を付ける
3. 引用は原文のまま。要約や言い換えをしない
4. 日付は西暦のISO 8601（YYYY-MM-DDTHH:mm）に正規化する。和暦（令和8年）は西暦に変換する
   （時刻は日本時間として扱う。タイムゾーンは書かなくてよい。保存時に日本時間として
   固定される：packages/ai/src/schemas/common.ts の toJstTimestamp）
5. 金額は数値のみ（円単位の整数）。「円」「税抜」などの単位や注記は別項目に入れる
6. JSON以外は一切出力しない。説明文・前置き・コードブロックの記号も付けない
7. 判断に迷う場合は null にし、unknown_reason にその理由を短く書く

してはいけないこと:
- 一般的な入札の慣行から補完すること
- 他の案件の内容を参考にすること
- 「おそらく」「一般的には」といった推測に基づく記入
```

### 0-3. ユーザープロンプトの共通の型

```
【案件の既知情報】
発注機関: {{agency_name}}
公告番号: {{notice_no}}
調達種別: {{procurement}}

【資料】
--- 資料種別: {{kind}} ---
{{text}}
--- ここまで ---
（複数の資料がある場合は、種別ごとに区切って続ける）

【出力するJSON】
{{schema}}
```

**資料は連結せず、種別ごとに区切って渡します。** 連結すると出典を特定できなくなります。

---

## 1. 基本情報と期限

**この抽出だけは合格ライン100%です。** 期限を誤ると失格・機会損失に直結します。

### 出力スキーマ

```json
{
  "name": { "value": "string|null", "quote": "string|null", "source": "string|null" },
  "agency": { "value": "string|null", "quote": null, "source": null },
  "org_unit": { "value": "string|null", "quote": null, "source": null },
  "notice_no": { "value": "string|null", "quote": null, "source": null },
  "notice_date": { "value": "YYYY-MM-DD|null", "quote": null, "source": null },
  "submit_deadline": { "value": "YYYY-MM-DDTHH:mm|YYYY-MM-DD|null", "quote": null, "source": null },
  "qa_deadline":     { "value": "YYYY-MM-DDTHH:mm|YYYY-MM-DD|null", "quote": null, "source": null },
  "bid_open_at":     { "value": "YYYY-MM-DDTHH:mm|YYYY-MM-DD|null", "quote": null, "source": null },
  "term_from": { "value": "YYYY-MM-DD|null", "quote": null, "source": null },
  "term_to":   { "value": "YYYY-MM-DD|null", "quote": null, "source": null },
  "place": { "value": "string|null", "quote": null, "source": null },
  "qual_category": { "value": "役務の提供等|物品の販売|物品の製造|null", "quote": null, "source": null },
  "item":  { "value": "string|null", "quote": null, "source": null },
  "grade": { "value": "string|null", "quote": null, "source": null },
  "areas": { "value": ["string"], "quote": null, "source": null },
  "budget": { "value": 0, "disclosed": true, "quote": null, "source": null },
  "jv_allowed": { "value": true, "quote": null, "source": null },
  "electronic_bidding": { "value": true, "quote": null, "source": null },
  "unknown_fields": ["string"]
}
```

### 追加の指示（ユーザープロンプトの末尾に付ける）

```
この抽出で特に注意すること:

・期限は3種類あります。混同しないでください
  - submit_deadline: 入札書（または参加表明書）の提出期限
  - qa_deadline: 質問・照会の受付期限
  - bid_open_at: 開札の日時
  資料に「入札書受領期限」「入札締切」とあれば submit_deadline です。
  「質問書の提出期限」「照会期限」は qa_deadline です。

・時刻が書かれていない期限は、日付だけ（YYYY-MM-DD）で返してください。
  書かれていない時刻を補わないでください。原文に「令和８年９月10日（木）まで」としか
  なければ "2026-09-10" です。"2026-09-10T17:00" と書いてはいけません。
  「17時まで」「午後5時」のように時刻が書かれているときだけ、時刻を付けます
・「令和8年7月7日」は 2026-07-07 です

・item は全省庁統一資格の「営業品目」です。案件名ではありません。
  「調査・研究」「情報処理」「ソフトウェア開発」「建物管理等各種保守管理」「その他」
  のような、資格の登録区分として資料に書かれている語を入れてください。
  ふつうは競争参加資格の条件の中に「『役務の提供等』の『情報処理』の営業品目」の
  ように書かれています。
  資料に営業品目の記載が無ければ null にします。件名で代用しないでください
・予定価格が「非公表」「事後公表」の場合は disclosed: false、value: null にします
・等級は「B以上」「C又はD」など原文の表記のまま value に入れてください。正規化しません
・areas は「関東・甲信越」のような競争参加地域の区分です。履行場所とは別です
・単体企業に限る旨の記載があれば jv_allowed: false です。記載がなければ null
```

### 抽出後のルールベース検証（必須）

LLMの出力をそのまま信じません。**保存前に次を機械的に検査します。**

```
1. submit_deadline < bid_open_at であること（逆なら取り違えの可能性 → 人へ）
2. qa_deadline < submit_deadline であること
3. notice_date <= submit_deadline であること
4. すべての日付が公告日から2年以内であること（和暦変換ミスの検出）
5. 期限のいずれかが null のとき、その旨を unknown_fields に含んでいること
6. budget が disclosed: true なのに value が null でないこと
```

**1〜4のいずれかに違反したら、その案件は自動で「要確認」フラグを立て、提案時に警告を表示します。**

---

## 2. 参加資格と参加条件

### 出力スキーマ

```json
{
  "qualifications": [
    { "text": "string", "category": "資格|等級|地域|実績|認証・許可|体制|その他",
      "quote": "string", "source": "string" }
  ],
  "conditions": [
    { "text": "string", "quote": "string", "source": "string" }
  ],
  "unknown_reason": "string|null"
}
```

### 追加の指示

```
・1つの条件に複数の要件が含まれる場合は、分割して1行ずつにしてください
  例:「東京都内に本店または営業所を有し、かつ同種業務の実績を1件以上有する者」
    → 2行に分ける（体制／実績）

・category の判断
  - 資格: 全省庁統一資格の区分（役務の提供等 など）
  - 等級: A・B・C・D の格付け要件
  - 地域: 競争参加地域、本店・営業所の所在地要件
  - 実績: 同種業務の実績、施工実績
  - 認証・許可: 建築物環境衛生総合管理業の登録、警備業の認定、産業廃棄物処理業の許可 など
  - 体制: 有資格者の配置、対処拠点、常駐要員 など
  - その他: 上記に当てはまらないもの

・「〜でないこと」（欠格要件）も conditions に含めてください
・予算決算及び会計令第70条・第71条の一般的な欠格条項は、1行にまとめて構いません
```

### よくある失敗

| 失敗 | 対策 |
|---|---|
| 実績要件の「直近3年で1件以上」の数量条件が落ちる | 数値と期間を text に必ず含める |
| 許可・認証の要件が「その他」に入る | category の例を増やす |
| 入札説明書にしか書かれていない条件を拾わない | 公告と入札説明書の両方を渡す |

---

## 3. 数量表の構造化と業種割当

**この抽出が見積依頼の質を決めます。** 誤ると協力会社に間違った数量を送ることになります。

### 出力スキーマ

```json
{
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
}
```

### 追加の指示

```
・trade は次の辞書から選んでください。当てはまるものがなければ null にします
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
  confidence を下げ、evidence に「OCR読み取り」と明記してください
```

### 抽出後の検証

```
1. qty が数値であること。「一式」は qty: 1, unit: "式" に正規化
2. 同一 line_no の重複がないこと
3. trades_summary の各 trade が辞書に含まれること
4. confidence < 0.3 の trade が null になっていること
```

---

## 4. 提出書類の抽出

### 出力スキーマ

```json
{
  "forms": [
    { "name": "string", "form_no": "string|null", "required": true,
      "note": "string|null", "quote": "string", "source": "string" }
  ],
  "submission_method": { "value": "string|null", "quote": null, "source": null },
  "unknown_reason": "string|null"
}
```

### 追加の指示

```
・様式ファイルのファイル名だけでなく、入札説明書の「提出書類」の記載も見てください
・両方にある場合は統合し、様式番号（様式第1号、別紙5 など）を form_no に入れます
・「該当する場合のみ提出」「必要に応じて」とあるものは required: false とし、
  note にその条件を書いてください
・入札書・委任状・資格審査結果通知書の写しは、記載がなくても一般に必要ですが、
  **資料に記載がなければ含めないでください**（推測しない）
・提出方法（電子調達システム／持参／郵送）を submission_method に入れます
```

**この抽出は再現率を優先します。** 迷ったら含める（人が消す方が、漏れて失格になるより安全）。
プロンプトにその方針を明記してあります。

---

## 5. 注意事項の抽出

**見落とすと失格になるか、赤字になる制約**だけを拾います。一般的な説明は不要です。

### 出力スキーマ

```json
{
  "notes": [
    { "text": "string", "importance": "critical|normal",
      "reason": "失格|コスト|工程|その他",
      "quote": "string", "source": "string" }
  ],
  "unknown_reason": "string|null"
}
```

### 追加の指示

```
・優先して拾う表現
  「〜に限る」「〜を除く」「〜は落札者の負担とする」「〜しなければ失格とする」
  「〜の提出をもって」「事前に〜が必要」「〜時間内に限る」「〜を有する者に限る」

・importance: critical にするもの
  - 満たさないと失格・無効になるもの
  - 落札者の費用負担が発生するもの（処分費、原状回復、保険）
  - 作業時間・立入手続の制限（コストに直結）

・拾わないもの
  - 一般的な契約手続の説明
  - 法令の条文をそのまま引いただけの記述
  - 他の項目（参加資格・提出書類）で既に抽出しているもの

・最大10件。多い場合は importance: critical を優先します
```

---

## 6. 質問案の生成

### 出力スキーマ

```json
{
  "questions": [
    { "text": "string", "basis": "string", "quote": "string", "source": "string",
      "impact": "見積|参加可否|工程|その他" }
  ],
  "qa_deadline": "YYYY-MM-DDTHH:mm|null",
  "unknown_reason": "string|null"
}
```

### 追加の指示

```
・質問を作るのは、次のいずれかに当てはまる場合だけです
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
・最大3件。0件でも構いません
```

---

## 7. 見積返信のパース（別系統）

協力会社からのLINE・メール返信を解析します。**慎重side に倒します。**

### 出力スキーマ

```json
{
  "amount": 0,
  "amount_confidence": 0.0,
  "tax_included": true,
  "declined": false,
  "needs_survey": false,
  "note": "string|null",
  "unknown_reason": "string|null"
}
```

### プロンプト

```
協力会社から届いた、見積依頼への返信を解析します。

判定のルール:
・金額が1つに定まらない場合は amount を null にします
  （内訳が複数書かれている場合、合計を推測して計算しないでください）
・「見送ります」「対応できません」「今回はお断りします」→ declined: true
・「現地を確認したい」「下見をしたい」「図面を見てから」→ needs_survey: true
・税込・税抜が明記されていない場合は tax_included: null
・金額らしき数値が電話番号・日付・数量である可能性がある場合は amount を null にします

amount_confidence の基準:
  1.0〜0.8: 「〇〇円でお願いします」のように金額が明示されている
  0.8〜0.5: 金額はあるが税区分などが不明
  0.5未満:  金額の特定に自信がない → null にする

JSON以外は出力しません。
```

**amount が null または confidence < 0.5 の返信は、自動で取り込まず受信箱に残します。**
画面には必ず元の文面を並べて表示します。

---

## 8. 実装メモ

### 呼び出しの共通処理

```ts
async function extract<T>(promptName: string, input: PromptInput, schema: ZodSchema<T>) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await claude({ system: SYSTEM, messages: [...], temperature: 0 });
    const parsed = safeJsonParse(res);          // ```json のフェンスを除去してから
    const result = schema.safeParse(parsed);
    if (result.success) return result.data;
    logError("PARSE_INVALID", { promptName, attempt, issues: result.error.issues });
  }
  throw new ParseInvalidError(promptName);      // 2回失敗したら人の確認キューへ
}
```

- **必ずZodで検証してから保存する。** LLMの出力を直接DBに入れない
- 失敗は `PARSE_INVALID` として記録し、案件は「解析失敗」として残す（黙って落とさない）
- 資料が長い場合は、資料種別ごとに分割して呼ぶ（プロンプト1は公告だけ、など）

### 資料が一部しかない場合

**揃っていなくても、あるものだけで実行します。**

- 仕様書がない → プロンプト3は `no_quantity_table: true` と `unknown_reason` を返す
- 様式がない → プロンプト4は空配列と `unknown_reason` を返す
- これらは**エラーではありません。** UIに「未判定」と表示するための正常な結果です

### コスト管理

- 1案件あたりのトークン量を記録する（`tender_analyses.raw` にメタ情報として）
- 資料が大きい案件（100ページ超）は、章立てで分割してから渡す
- 月次でコストを集計。**1案件あたりの解析コストは、契約単価の判断材料になります**

### 変更したときは必ず測る

プロンプトを1文字でも変えたら、**ゴールドセット20件で測り直してください**（→ `ゴールドセット作成手順書.md`）。
「良くなった気がする」で進めると、気づかないうちに劣化します。
