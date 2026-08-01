# KKJ（官公需情報ポータル）API 確認事項

`docs/reference/KKJ_api_guide.pdf`（公式API仕様書 V1.1、平成28年5月27日）をユーザーから
受け取り、内容を確認して実装を全面的に修正した。以前この文書に記載していた「未検証の推定」
（位置ベースのXML抽出、機関名の突合ができないためtendersへ投入できない、等）は、公式仕様書の
内容に基づき解消・置き換えている。

## 0. 実装した範囲・していない範囲

| 範囲 | 状態 |
|---|---|
| KKJレスポンスの正規化（`packages/domain/src/kkj.ts`） | ✅ 実装・単体テスト済み（`api_guide.pdf` §4の実出力構造に基づく） |
| HTTP取得＋XMLパース（`apps/worker/connectors/kkj.ts`） | ✅ タグ名ベースで実装（§4.2「出現順序は不定」の明記に対応） |
| ジョブ化（`apps/worker/jobs/kkj_sync.ts`） | ✅ 実装。`OrganizationName`から`agencyIdFromName`（GEPSと共通ロジック）でagency_idを導出し、tendersへupsertする |
| 資料（PDF等）のダウンロード | ❌ スコープ外。`ExternalDocumentURI`は他省庁サイトの公告掲載URLであり、資料一式の取得は調達ポータル（GEPS）側の役割（CLAUDE.md「本部が必ず資料を取得する」） |

## 1. api_guide.pdfで確定した事項（旧文書の「未確認事項」を解消）

| # | 事項 | 確定内容 |
|---|---|---|
| 1 | APIエンドポイント | `http://www.kkj.go.jp/api/`（**httpsではなくhttp**）。`KKJ_API_URL`で上書き可能 |
| 2 | 検索の必須パラメーター | `Query`/`Project_Name`/`Organization_Name`/`LG_Code`のいずれか1つが必須。日付だけで全国横断検索するため、`LG_Code`に全都道府県コード（01〜47）を指定する（`buildKkjQuery`） |
| 3 | 日付絞り込み | `CFT_Issue_Date`パラメーター（期間形式）。単日は`開始終了日`形式（例：`2026-07-31`）で指定する |
| 4 | 上限件数 | `Count`。既定10、1000以上指定時は1000とみなす。**ページングの仕組みは無い**（§4.1「繰り返し2」の説明に明記）。1日の該当件数が1000件を超える機関・カテゴリがある場合、超過分は取得できない（現状は検知・記録もしていない） |
| 5 | XMLのタグ名・構造 | §4.1に全体構造、§4.2に各タグの説明が明記されている。**「SearchResultタグ内など、一つ上位のタグが同じであるタグの出現順序は、不定です」と明記** → 位置ベースの抽出は誤りと判明したため、タグ名で読む実装に修正済み |
| 6 | 日時フィールドの意味 | `Date`＝システムが公告を取得した日時。`CftIssueDate`＝公告日（無ければ`Date`と同じ値が入る、と仕様書に明記）。`OpeningTendersEvent`＝開札日（曖昧さなし） |
| 7 | エラー時の応答 | `<Results><Error>メッセージ</Error></Results>`。`parseKkjResponse`はこれを検出して例外を投げる |
| 8 | Certification（入札資格）の複数値 | 空白区切りで複数格納されうる（現状は文字列のままtenders.gradeへ保持し、パースはしていない） |

## 2. 意図的に取り込んでいないフィールド

- **`TenderSubmissionDeadline`**：タグ名は"Deadline"（期限）だが、仕様書の日本語説明は
  「入札開始日」（開始日）となっており、名称と説明が矛盾している。CLAUDE.mdの
  「期限の誤りは失格に直結する。推測せず、取れなければnullにする」方針に従い、
  `NormalizedKkjTender`にもtenders.submit_deadlineにも一切マッピングしない。
  提出期限はAI解析（実資料の再取得）で確定させる。

## 3. まだ確認できていない事項

| # | 事項 | 現在の実装での扱い |
|---|---|---|
| 1 | 1日・1機関等で1000件を超えるケースの実在有無とページング代替手段の有無 | 未対応。実データで発生した場合、`crawl_runs`上は`found`が1000で頭打ちになるだけで打ち切りの検知はしていない（GEPSの`isSearchTruncated`に相当する仕組みが無い） |
| 2 | `Attachments`が実際に返るか（オプション項目） | `normalizeKkjItem`は空配列にフォールバックする実装済みだが、実データでの充足率は未確認 |
| 3 | `PeriodEndTime`（納入期限日）を`tenders.term_to`にマッピングした妥当性 | 意味上は近いが完全に一致するとは限らない（履行期間の終了日と納入期限日は制度上ずれうる）。要件が厳密になった場合は別カラムの追加を検討する |
| 4 | 国の機関（府省・独法）の案件が実際に返るか、`OrganizationName`の表記が機関マスタ（機関マスタ_v2.md）とどの程度一致するか | 未確認。一致しない場合は`agencyIdFromName`による自動採番（`auto-`プレフィックス）の機関としてagenciesに登録される（GEPSと同じ挙動） |
| 5 | `Certification`の実際の値の粒度（例：`A B`のような空白区切りが実在するか） | 未対応。現状は文字列のままtenders.gradeへ保持するのみ |

## 4. 次にやること（優先順）

1. `KKJ_API_URL`を実際のURLのまま、`runKkjSync("YYYY-MM-DD")`を1日ぶん実行し、`crawl_runs`の
   `found`/`merged`/`failed`と実際のヒット件数が一致するか確認する
2. 1000件超のケースが実在するかを、既知の案件数が多いカテゴリ・日付で確認する
3. `Certification`・`Attachments`の実データでの充足状況を確認し、必要なら`kkj.ts`のパースを調整する
4. `OrganizationName`の表記ゆれ（機関マスタとの一致率）を確認し、`agencies`テーブルの
   自動登録（`auto-`）と機関マスタ（手動キュレーション）の突き合わせ方針を検討する
