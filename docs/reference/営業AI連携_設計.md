# 営業AI連携 設計（2製品にまたがる取り決め）

AI入札部（このリポジトリ）と営業AI（[Genki1414/eigyouAI](https://github.com/Genki1414/eigyouAI)）の
あいだで決めておくこと。**営業AI側の作業者に、この文書をそのまま渡せるようにしてある。**

運用の手順は `docs/reference/営業AI連携.md`、価格は `docs/reference/価格.md`。

## 解決したいこと

案件に必要な業種の協力会社がいないと、その業種の見積が取れず、**案件そのものを諦める**。
その業種を扱っている会社を探して打診する作業を、利用者のボタン1回にする。

## 役割分担

**境界の原則：AI入札部は「誰に何を送るか」を決める。営業AIは「送る」。**

| | AI入札部 | 営業AI |
|---|---|---|
| 案件の収集・解析 | ● | |
| 不足している業種の判定 | ● | |
| 候補企業の保有 | | ● |
| 候補の絞り込み条件（業種・地域）を決める | ● | |
| 絞り込みの実行 | | ● |
| 打診文の組み立て | ● | |
| 相手ごとの文面の作り分け | | ●（将来） |
| **フォームへの送信** | | **●** |
| 送信先の除外・回数の上限・停止 | | ● |
| 送信結果の保持 | | ● |
| 返信を協力会社として登録 | ● | |

**安全装置を2か所に置かない。** 除外・上限・停止スイッチは営業AIだけが持つ。
AI入札部側に作り直すと、片方だけ直したときに食い違う。

## 流れ

### 1. 契約したとき（本部の作業。`/admin/sales-ai` で完結する）

```
本部：AI入札部のアカウントを発行（/admin/accounts）
  ↓
本部：/admin/sales-ai を開き、契約者を選んで「営業AIにテナントを作る」
      （内部で POST /api/ops/tenants を呼ぶ。api_key は表に出さず
       そのまま sales_ai_connections に保存する。塗りつぶし表示のみ）
  ↓
本部：同じ画面で「送信元（顧客名義）」を入力して送信
      （内部で POST /api/tenant/sender-templates → /activate を呼ぶ。
       契約者本人の名義にする。AI入札部自身のアドレスにはしない）
  ↓
本部：業種の対応表（trade_map）を「接続を手で編集する」から入力
```

**顧客は営業AIの画面を開かない**（ユーザー決定 2026-08-28）。
基本プランに送信500通/月が含まれる。

`monthly_send_quota` の指定は今もテナント作成時に渡せない
（下の「営業AI側に足してほしいもの B」参照。作成後にDBを直接触る運用が残る）。

### 2. 送信するとき（利用者の操作）

```
利用者：案件の「見積依頼」タブを開く
  ↓
AI入札部：依頼先が0社の業種に「営業AIで候補を探して送る」を出す
  ↓
利用者：「何社いるか見る」
  ↓
AI入札部：POST /api/tenant/lists/preview（業種＋都道府県で絞る）
  ↓
利用者：「◯社へ送信する」（確認ダイアログ）   ← 人がやるのはここだけ
  ↓
AI入札部：POST /api/tenant/lists      （初回のみ。リストを作る。
          番号は outreach_sends に控える。同じ案件×業種の2回目以降は
          控えた番号へ積む——新しいリストを作ると新しいキャンペーンになり、
          もう送った会社にもう一度届くため）
AI入札部：POST /api/tenant/lists/<id>/send（dry_run:falseで送信を頼む。
          cancel_recent_days は指定しない——直近に送った会社を除外する
          動きは要らないというユーザー決定 2026-08-29）
  ↓
営業AI：can_contact / 上限 / 停止スイッチを見てから、フォームへ送信
```

**件数を見ないと送信ボタンが出ない。** 何社に送るか知らないまま押させない。

**1回では全部送れないことがある。** 営業AIは1回の呼び出しで最大50社まで
（`FORM_MAX_PER_RUN`）、1テナント1時間で最大50社
（`FORM_MAX_PER_TENANT_PER_HOUR`）。超えた分は送られずに残るので、
「50社へ送信しました。残り70社はまだ送れていません」のように**送れなかった分を
必ず出す**（`summarizeOutreachSend()`）。ボタンは「続きを送信する」に変わり、
もう一度押すと同じリストへ、送れていない会社にだけ送る。

### 3. 結果（実装済み）

**「返信のあった会社」を営業AIから引かない。** 営業AIの `replied` は**人が手で
立てるフラグ**で、営業AIはメールボックスを見ていない（β版。api.py の
docstringに明記）。返信は打診文に書いた連絡先＝**利用者自身のメールに届く**ので、
待っていても営業AI側には永遠に立たない。代わりに「送った会社」を出して、
返信をもらった会社を利用者に選んでもらう。

```
営業AI：送信結果を form_send_log と target_list_members に持つ
  ↓
利用者：案件の見積依頼タブで「送った会社を見る」（依頼先が埋まったあとも出る。
      1社登録したら一覧が消える、では続きを登録できないため）
  ↓
AI入札部：outreach_sends に控えた list_id で
      GET /api/tenant/lists/<id>?status=success を呼び、実際に送れた会社を出す
  ↓
利用者：返信をもらった会社の「協力会社として登録」を押す
  ↓
AI入札部：partners に追加（社名で照合し、二重登録しない。㈱・(株)・空白の
      違いだけは吸収する）。メールアドレスが無い会社は登録できても
      見積依頼は送れないため、その旨を一覧とメッセージに出す
      ↓
      POST /api/tenant/lists/<id>/outcome で営業AI側にも replied を記録する
      （営業AIのダッシュボードは target_list_members.replied を数えているため。
      失敗しても登録自体は取り消さない）
```

**ここが繋がって、開拓が価値になった。** 送っただけでは何も増えない、を解消した。

実装：`apps/web/app/tenders/[id]/outreach-actions.ts`
（`loadOutreachResults`/`registerPartnerFromOutreach`）、
`packages/outreach/adapters/eigyou_ai.ts` の `listSentCompanies()`/`markReplied()`、
`packages/domain/src/outreach_partner.ts`（詰め替えの純ロジック）、
`supabase/migrations/20260828000003_outreach_sends.sql`。

## 使うAPI（すべて既存）

参照：`eigyouAI/api.py`。認証は `Authorization: Bearer <tenant.api_key>`。

| 用途 | エンドポイント | 状態 |
|---|---|---|
| 件数の確認 | `POST /api/tenant/lists/preview` | 実装済み |
| リストの作成 | `POST /api/tenant/lists` | 実装済み |
| 送信 | `POST /api/tenant/lists/<id>/send` | 実装済み（`cancel_recent_days`は指定しない） |
| 送った会社の取得 | `GET /api/tenant/lists/<id>?status=success` | 実装済み（`listSentCompanies`） |
| 返信の記録 | `POST /api/tenant/lists/<id>/outcome` | 実装済み（`markReplied`） |
| 業種コードの一覧（T56） | `GET /api/tenant/trades` | 実装済み（`listTrades`） |
| 今月の送信数 | `GET /api/tenant/dashboard` | 実装済み・**未使用**（`GET /api/tenant/quota`のほうが判定式と一致するため使わない） |
| 停止されているか | `GET /api/tenant/kill-switch` | 実装済み（`getKillSwitchStatus`。送信前の警告表示に使用） |
| テナントの作成（本部） | `POST /api/ops/tenants` | 実装済み |
| 送信の停止（本部） | `POST /api/ops/kill-switch` | 実装済み（`setKillSwitch`。契約の停止・再開に連動） |
| 残り送信可能数（T55） | `GET /api/tenant/quota` | 実装済み（`getQuotaStatus`。見積依頼タブに一言添える形で表示） |
| クォータ追加購入（T55、本部専用） | `POST /api/ops/tenants/<id>/quota-purchase` | 実装済み・アダプタ済み（`purchaseQuota`）・**どこからも呼んでいない**（後述） |

**AI入札部が使っているのは上の3つだけ。** 残りは繋げば使える。

### 直っていたバグ：送信できていなかった（`sendTargetList`）

`packages/outreach/adapters/eigyou_ai.ts` の `sendTargetList()` が、営業AI側の
`POST /api/tenant/lists/<id>/send` の実際の応答（`target_lists.send_list()`が返す
`{campaign_id, target_count, dry_run, stats, cancelled_recent}`）ではなく、
存在しないトップレベルの `sent` / `count` / `requested` を読もうとしていた。
**この実装のままだと、実際の送信は毎回 `PARSE_INVALID` で失敗していた**
（プレビューとリスト作成は通るので、途中までは動いているように見える）。
`target_count` と `stats` を読むよう修正し、テストに実際の応答形を使った。

### 追加：クォータ追加購入（T55。ユーザー決定 2026-08-28）

基本プラン（500通/月）を使い切ったとき、AI入札部側からStripeで500通/¥5,000単位の
追加購入をできるようにする（**決済まわりは後回し**というユーザー決定。まずは
営業AI側の受け口とAI入札部側のアダプタだけ用意した）。

```
利用者：AI入札部の画面で追加購入を申し込む（未実装）
  ↓
AI入札部：Stripeで一回払いのCheckoutを作る（未実装。packages/billing/adapters/stripe.ts
          は月額サブスクのみで、一回払いの型は無い）
  ↓
Stripe：決済成功 → Webhook（未実装）
  ↓
AI入札部：POST /api/ops/tenants/<id>/quota-purchase を叩く
          （`purchaseQuota()`。external_refにStripeの決済IDを入れて冪等にする）
  ↓
営業AI：quota_purchasesに記録。以後30日間、実効クォータに加算される
```

**`GET /api/tenant/quota` は「3. 今月の残り通数の表示」（下の表）をそのまま満たす。**
`GET /api/tenant/dashboard`（カレンダー月・成功数のみ）ではなく、
`senders.py._check_quota()` の判定式（直近30日ローリング・全試行数）と
完全に一致するこちらを使うほうがよい（表示は余裕があるのに送信はブロックされる、
という食い違いを避けられる）。案件の見積依頼タブ（`outreach-actions.ts`）で
何社いるか見た・送信したときに一言添える形で実装済み。専用の画面（一覧・履歴）は無い。

## 営業AI側に足してほしいもの

### A. ~~業種の語彙を返すAPI~~（唯一、本当に無いもの。解決。T56）

```
GET /api/tenant/trades
→ {"trades": [{"code": "tobi", "label": "とび・土工"}, {"code": "tosou", "label": "塗装"}, ...]}
```

営業AI側に実装済み（eigyouAI T56、`h_tenant_trades_get`）。`config.TARGET_TRADES`を
そのまま返す。同じコードに複数の表示名がある場合（「とび」「土工」がどちらも`tobi`）は
「・」で連結して1件にまとめる。**AI入札部側でも消費するようになった**
（`packages/outreach/adapters/eigyou_ai.ts` `listTrades()`）。対応表（trade_map）を
入力する`/company`の営業AI連携カードに「業種コードを確認する」ボタンを追加し、
実際に対応しているコードと表示名を一覧表示する。対応表への反映（`電気 = denki`の
行を書くこと）自体はまだ手作業のまま——自動でtrade_mapを埋める画面ではなく、
コードを当てずっぽうで書かずに済むようにしただけ。

いまも業種そのものは3種類（`tobi`/`tosou`/`kaitai`）のまま——このAPIは語彙を
「返す手段」を用意しただけで、業種を増やす作業（下のC）とは別。

### B. ~~テナント作成時に送信上限を渡せるようにする~~（解決。T56）

```
POST /api/ops/tenants
  { ..., "monthly_send_quota": 500, "daily_send_quota": 50 }
```

営業AI側で対応済み。どちらも任意項目（未指定ならNULL=既定値）で、0以下や文字列は400。
`createTenant()`（`packages/outreach/adapters/eigyou_ai.ts`）はまだこの2つを渡していない
——渡すようになれば「作ったあとDBを直接触る」手作業が要らなくなる。
`/admin/sales-ai`の「営業AIにテナントを作る」フォームに入力欄を足すかは未定
（基本プラン500通/月は今のところ営業AI側の既定値のままで足りているため）。

### C. 業種と企業を増やす（作業中）

いまの `companies` は建設業許可業者の3業種（`tobi` / `tosou` / `kaitai`）だけ。
AI入札部が必要とするのは **電気・設備保守・廃棄物処理・情報処理・給食・什器納入・警備**など。
**ほとんど重ならない。**

建設業許可業者名簿には29業種あるので `08 電気工事` などは取れるが、
清掃・警備・情報処理・廃棄物処理は**建設業許可の枠外**でこの名簿に無い。
別の名簿（全省庁統一資格の有資格者名簿など）が要る。

## AI入札部側に足すもの

| | 内容 | 優先度 |
|---|---|---|
| 1 | ~~本部側の接続設定画面~~ | **済み**。`/admin/sales-ai` を新設（`/admin/accounts` は既にAI入札部のアカウント発行に使われていたため別ルートにした）。テナント作成（`createTenant`）・対応表の編集・疎通確認まで1画面で完結する。**送信元（顧客名義）の入力は無くした**——顧客が `/company` で自社情報を保存するたびに自動同期する形に変えた（下の「送信元の情報が二重になる」参照。手間が多すぎるというユーザー決定 2026-08-28その2） |
| 2 | ~~結果の取り込み~~（返信のあった会社を協力会社として登録） | **済み**。案件の見積依頼タブに「返信を確認する」を追加。`apps/web/app/tenders/[id]/outreach-import-actions.ts` |
| 3 | ~~今月の残り通数の表示~~（`GET /api/tenant/quota`。T55でアダプタ`getQuotaStatus`済み） | **済み**。案件の見積依頼タブ（`SalesAiBlock`）で、何社いるか見た・送信したときに「今月の残り送信可能数：◯通」を一言添える（`outreach-actions.ts` `quotaNote()`）。取れなくても失敗させない（送信そのものは成立させる）。専用の画面は作っていない |
| 4 | ~~停止されているかの確認~~（`GET /api/tenant/kill-switch`） | **済み**。案件の見積依頼タブで「何社いるか見る」を押したときに一緒に確認し、止まっていれば警告を出して送信ボタン自体を出さない（`outreach-actions.ts` `killSwitchWarning()`）。契約停止に伴う連動（項目「契約が止まったとき」）とは別に、営業AI側で個別に止められているケースもここで拾える |
| 5 | 対応表の自動取得（上のAができたら） | 低。**一覧の表示まではT56で済み**（`/admin/sales-ai`・`/company`の「業種コードを確認する」）。対応表への反映（trade_mapを書くこと自体）はまだ手作業のまま |
| 6 | クォータ追加購入の申し込み画面＋Stripe一回払いCheckout＋Webhook（T55の`purchaseQuota`を呼ぶ） | 中。**決済は後回しにするユーザー決定**（2026-08-28）。アダプタは用意済み |

## 決めていない論点

### 二重送信をどちらで防ぐか（解決。2種類を分けて考える）

**(1) 同じキャンペーン内での送り直し。** 営業AIは1回に最大50社までしか送らない。
残りを送るとき新しいリストを作ると新しいキャンペーンになり、営業AI側の
送信済み判定（`touches(campaign_id, company_id)`）がやり直しになって、
もう送った会社にもう一度届く。これは防ぐ必要があるので、
`outreach_sends` に `(org_id, tender_id, trade)` 単位でリスト番号を1件だけ控え、
2回目以降の送信は必ずそこへ積む（新しいリストを作らない）。

**(2) 期間をまたいだ再送（直近に送った会社を除外する `cancel_recent_days`）は使わない。**
（**ユーザー決定 2026-08-29**）。実装はしたが、以後の送信では `cancel_recent_days` を
渡さない。営業AI側は未指定なら誰も除外しないので、直近に送った会社にも
普通に送信対象になる。

### 送信元の情報が二重になる（解決。ユーザー決定 2026-08-28→その2）

営業AIのテナント／sender_templatesは `sender_name` / `sender_email` / `sender_address` /
`optout_url` 等を持つ。AI入札部が自社の見積依頼で使う送信元
（`packages/domain/src/sender_identity.ts`）とは**別の名義**にする：
協力会社開拓の問い合わせフォームには**契約者本人の名義**を載せる（AI入札部自身の
アドレスにはしない）。AI入札部の見積依頼は自社名義のまま、これは変わらない。

最初は `/admin/sales-ai` で本部が契約者ごとに手入力していたが、**手間が多すぎるという
ユーザー決定（2026-08-28その2）**で自動同期に変えた：

- 会社名・送信元メールは `organizations.name` / `reply_to`（無ければオーナーの
  `users.email`）をそのまま使う。二重入力しない
- 住所・電話番号・氏名等は新しいテーブル `organization_mailing_identity`
  （`supabase/migrations/20260828000003_...`）に、顧客が `/company` の
  「郵送名義」で自分で入力する
- `apps/web/lib/sales_ai_sync.ts` の `syncSalesAiSenderIdentity()` が、
  `/company` の保存（自社情報・郵送名義のどちらでも）のたびに営業AI側の
  送信元テンプレートへ自動反映する（`setSenderIdentity()` を呼ぶ）
- `/admin/sales-ai` の「営業AIにテナントを作る」直後にも1回自動で同期する
- 自動同期が失敗したとき（営業AI側が一時的に落ちていた等）のために、
  `/admin/sales-ai` に手で叩ける「送信元を今すぐ同期する」ボタンだけ残した
  （入力欄は無い＝本部が値を打ち直すことはない）

`company_profiles`（入札資格の業種・等級等）とは別物のまま、二重に持たせていない。

**`sales_ai_connections.api_key` は顧客のRLSでも読めない**（列の読み取り権限を
`authenticated` から外してある。`supabase/migrations/20260828000002_sales_ai_connections_admin.sql`）。
案件画面（`outreach-actions.ts`）や `/company` からの自動同期呼び出しは、
`apps/web/lib/sales-ai.ts` の `loadSalesAiConnection()` や
`createServiceClient()`（`syncSalesAiSenderIdentity()` の呼び出し側）で
service_role として読む。顧客のセッションのクライアントをそのまま渡すと
api_keyが読めず必ず失敗するので、新しい呼び出し元を足すときは注意すること。

### クォータ追加購入の運用キー・テナントIDをどこに持つか（T55。解決）

`POST /api/ops/tenants/<id>/quota-purchase` は、テナントごとの `api_key` ではなく
**本部だけが持つ運用キー**（営業AI側の`SALES_ENGINE_API_KEY`と同じ値を、AI入札部側の
環境変数`SALES_ENGINE_API_KEY`にも設定する）と、**営業AI側の内部tenant.id（数値）** で呼ぶ。

`/admin/sales-ai`（上の表の1）を実装したことで解決した：
`sales_ai_connections.tenant_id` 列（新規migration）に、`/admin/sales-ai`の
「営業AIにテナントを作る」が`createTenant()`の応答からそのまま保存する。
運用キーはDBには置かず、環境変数（Vercel）のまま——顧客はもちろん、本部の画面にも
生の値を表示しない。

**`purchaseQuota()` 自体はまだどこからも呼んでいない**（上の表の6＝Stripe連携が
後回しのため）。テナントIDの保存先だけ先に用意した状態。

### 500通という数字の根拠

Playwrightで送るので費用はほぼゼロ（`docs/reference/価格.md`）。
**費用から決めた数字ではない。** 1業種の開拓で何社に当たるのかが分かっていない。

### 契約が止まったとき（解決）

AI入札部で組織を停止・再開する（`/admin/accounts`）と、
`setKillSwitch()`（`packages/outreach/adapters/eigyou_ai.ts`）が
`POST /api/ops/kill-switch`（scope=tenant）を呼び、営業AI側の送信も連動して
止める・再開する。営業AIのテナントがまだ無い組織（`sales_ai_connections.tenant_id`
が無い）では何もしない。連動できなかった場合（運用キー未設定・営業AI側の
一時的な障害等）は、停止・再開そのものは成立させたうえで、その旨を本部の画面に
一言添える（`apps/web/app/admin/accounts/actions.ts` の `syncKillSwitch()`）。

## やらないと決めたこと

- **無人での送信。** 定期実行やジョブから送信APIを呼ばない
  （CLAUDE.md「やらないこと」）
- **AI入札部側で除外リストや上限を持つこと。** 営業AI側のものを使う
- **顧客に営業AIの画面を触らせること。** 契約は本部が結び、設定も本部が行う
