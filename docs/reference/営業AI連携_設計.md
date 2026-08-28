# 営業AI連携 設計（2製品にまたがる取り決め）

AI入札部（このリポジトリ）と営業AI（[Genki1414/eigyouAI](https://github.com/Genki1414/eigyouAI)）の
あいだで決めておくこと。**営業AI側の作業者に、この文書をそのまま渡せるようにしてある。**

運用の手順は `docs/reference/営業AI連携.md`、価格は `docs/reference/価格.md`。

> **2026-08-28、営業AIのコードを実際に読んで確かめた**（`api.py` / `db.py` / `senders.py` /
> `target_lists.py` / `config.py` / `offers.py` / `HANDOFF.md`）。
> 以下は推測ではなく、その時点のコードに基づく。参照した関数名を各所に書いてある。
> なお営業AIは **T54 で「ヒラケル」に改称**した（旧 AshiBase／足場ベース）。

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
| 相手ごとの差し込み | | ●（マージタグ。後述） |
| **フォームへの送信** | | **●** |
| 送信先の除外・回数の上限・停止 | | ● |
| 送信結果の保持 | | ● |
| 返信を協力会社として登録 | ● | |

**安全装置を2か所に置かない。** 除外・上限・停止スイッチは営業AIだけが持つ。
AI入札部側に作り直すと、片方だけ直したときに食い違う。

## 流れ

### 1. 契約したとき（本部の作業）

```
本部：AI入札部のアカウントを発行（/admin/accounts）
  ↓
本部：営業AIのテナントを作る（POST /api/ops/tenants）
      → api_key が一度だけ返る。既定のオファーも同時に作られる
  ↓
本部：monthly_send_quota = 500 を設定  ← ★ APIで渡せない。DBを直接触ることになる
  ↓
本部：AI入札部に営業AIのURLとapi_keyを保存
      （/admin/accounts のアカウント行「営業AI連携」）
  ↓
本部：「つながるか確認する」で疎通を確かめる
```

**顧客は営業AIの画面を開かない**（ユーザー決定 2026-08-28）。
基本プランに送信500通/月が含まれる。

**送信元（顧客名義）の設定は要らない。** 送信のたびに `sender_override` で渡す（後述）。

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
AI入札部：POST /api/tenant/lists      （リストを作る）
AI入札部：POST /api/tenant/lists/<id>/send（dry_run:false, cancel_recent_days:30）
  ↓
営業AI：can_contact / 上限 / 停止スイッチを見てから、フォームへ送信
```

**件数を見ないと送信ボタンが出ない。** 何社に送るか知らないまま押させない。

**1回では全部送れない。** 営業AIは1回の呼び出しで最大50社まで
（`config.FORM_MAX_PER_RUN`）、1テナント1時間で最大50社
（`FORM_MAX_PER_TENANT_PER_HOUR`）。超えた分は送られずに残る。
残っているときは「続きを送信する」を出し、もう一度押せば送れていない会社にだけ送る
（送信済みの会社には送らない。`touches.sent_at` で判定される）。

### 3. 結果（実装済み。当初の設計とは変えた）

**当初の想定は成り立たない。**
`GET /api/tenant/lists/<id>?status=replied` は実装済みだが、この `replied` は
**人が手で立てるフラグ**で、`POST /api/tenant/lists/<id>/outcome` からしか
セットされない（`h_tenant_list_member_outcome`。docstring に「β版。メール自動取得等は
しない」と明記）。営業AIはメールボックスを見ていない。

返信は**顧客自身のメールアドレスに届く**（打診文に書いた連絡先）。
つまり「返信があったこと」を最初に知るのは顧客で、営業AIではない。

```
営業AI：送信結果を form_send_log と target_list_members に持つ
  ↓
AI入札部：GET /api/tenant/lists/<id>?status=success で「送った会社」を出す
  ↓
利用者：返信をもらった会社に「協力会社として登録する」
  ↓
AI入札部：partners に追加
AI入札部：POST /api/tenant/lists/<id>/outcome で replied も立てる（両方の記録を揃える）
  ↓
次の案件から見積依頼を出せる
```

**ここが繋がって初めて、開拓が価値になる。** 送っただけでは何も増えない。

`?status=success` で返る各社には `name` / `pref` / `phone` / `email` /
`website_url` / `contact_url` が入っている（`target_lists.get_list()`）。
協力会社として登録するのに足りる。

## 使うAPI

参照：`eigyouAI/api.py`。認証は `Authorization: Bearer <tenant.api_key>`。

| 用途 | エンドポイント | 状態 |
|---|---|---|
| 件数の確認 | `POST /api/tenant/lists/preview` | 実装済み・使用中 |
| リストの作成 | `POST /api/tenant/lists` | 実装済み・使用中 |
| 送信 | `POST /api/tenant/lists/<id>/send` | 実装済み・使用中 |
| 送った会社の取得 | `GET /api/tenant/lists/<id>?status=success` | 実装済み・**未使用** |
| 返信の記録 | `POST /api/tenant/lists/<id>/outcome` | 実装済み・**未使用** |
| 今月の送信数と枠 | `GET /api/tenant/dashboard` | 実装済み・**未使用** |
| 停止されているか | `GET /api/tenant/kill-switch` | 実装済み・**未使用** |
| テナントの作成（本部） | `POST /api/ops/tenants` | 実装済み |
| 送信の停止（本部） | `POST /api/ops/kill-switch` | 実装済み |

### 送信の応答を読み違えていた（2026-08-28 修正）

`POST /api/tenant/lists/<id>/send` が返すのはこの形（`target_lists.send_list()`）。

```json
{ "campaign_id": 31, "target_count": 120, "dry_run": false,
  "cancelled_recent": 4,
  "stats": { "sent": 50, "failed": 70, "blocked": 0, "suppressed": 0, "stopped": 0 } }
```

**上位に `sent` は無い。`stats` の中にある。**
こちらのアダプタは上位の `sent`／`count`／`requested` を探していたため、
**実際には送信できているのに「送信できませんでした」と表示していた。**
利用者がリストを作り直して二重に送る危険があった。修正済み
（`packages/outreach/adapters/eigyou_ai.ts`）。

読むべき値：

| キー | 意味 |
|---|---|
| `target_count` | 対象になった会社の数（問い合わせURLがある会社に絞り、`cancel_recent_days` で外したあと） |
| `stats.sent` | 実際にフォームへ送れた数 |
| `stats.failed` | 送信を試みて失敗した数。**送信上限に当たった分もここに入る**（`SKIP_QUOTA_EXCEEDED`） |
| `stats.blocked` | 配信停止・テナント除外・重複で送らなかった数 |
| `stats.stopped` | Kill Switch で止まった数 |
| `cancelled_recent` | `cancel_recent_days` で外れた数 |
| `dry_run` | true なら**1社にも届いていない** |

`target_count` をそのまま「◯社へ送信しました」と出してはいけない。

## 営業AI側に足してほしいもの

> **A と B はパッチを書いてある。** `docs/reference/営業AI連携_依頼.md` と
> `docs/reference/営業AI連携_パッチ.diff`。営業AIの自己テストが通ること
> （343/343）まで確認済み。営業AI側のセッションで当てるだけ。

### A. 業種の語彙を返すAPI

```
GET /api/tenant/trades
→ [{"code": "tobi", "label": "とび"}, {"code": "tosou", "label": "塗装"}, ...]
```

いま AI入札部の業種（電気・清掃・警備…）と営業AIの業種コード（`tobi` 等）の
対応表を**本部が手で書いている**。営業AI側に語彙を返す手段が無いため。

**これが無いと、業種を増やすたびに全顧客の対応表を手で直すことになる。**
1本あれば、AI入札部が自動で対応表を埋められる。

`config.TARGET_TRADES` をそのまま返すだけでよい
（いまは `{"とび": "tobi", "土工": "tobi", "塗装": "tosou", "解体": "kaitai"}`。
**日本語ラベル→コードで、複数のラベルが同じコードを指す**ことに注意）。

### B. テナント作成時に送信上限を渡せるようにする　★これが一番危ない

```
POST /api/ops/tenants
  { ..., "monthly_send_quota": 500, "daily_send_quota": 50 }
```

`h_ops_tenants_create()` は `name` / `sender_email` / `kind` / `sender_name` /
`sender_address` / `optout_url` しか受け取らない。上限は渡せない。

**問題は「手作業が挟まる」ことではなく、忘れたときの既定値。**

```python
# senders.py _check_quota()
monthly_q = row["monthly_send_quota"] or C.FORM_MAX_PER_TENANT_PER_MONTH_DEFAULT
# config.py
FORM_MAX_PER_TENANT_PER_MONTH_DEFAULT = 4000   # 営業AI単体の最低プラン相当
```

**設定を忘れると 500通ではなく 4,000通/月 になる。** 8倍。
契約と実際に送れる量が食い違ったまま、誰も気づかない。

`tenants.monthly_send_quota` / `daily_send_quota` の列は既にある
（`db.py` の列追加リスト）。受け口を足すだけ。

**それまでの対策**：`GET /api/tenant/dashboard` が `quota.monthly_send_quota` を
返すので、本部の「つながるか確認する」で500になっているかを確かめられるようにする
（AI入札部側の作業。下の表の6）。

### C. 業種と企業を増やす（**未着手**）

いまの `companies` は建設業許可業者の3業種（`tobi` / `tosou` / `kaitai`）だけ。
AI入札部が必要とするのは **電気・設備保守・廃棄物処理・情報処理・給食・什器納入・警備**など。
**ほとんど重ならない。**

T54 で「全業種のB2B企業向けサービス」へブランドを変えたが、
**対象企業データの拡張は T54 のスコープ外**とされ、`HANDOFF.md`「5. 連絡すべき判断」に
こう残っている。

> 全業種のB2B企業データをどこから調達するか(T54でユーザーから要望済みだが、
> データソース<有償リスト購入/公開データ/顧客CSV持込>の選定は未着手)

建設業許可業者名簿には29業種あるので `08 電気工事` などは取れるが、
清掃・警備・情報処理・廃棄物処理は**建設業許可の枠外**でこの名簿に無い。

**ここが揃うまで、この機能はほぼ動かない。**

## AI入札部側に足すもの

| | 内容 | 状態 |
|---|---|---|
| 1 | **本部側の接続設定画面**（`/admin/accounts` からURL・APIキー・対応表） | **済**（2026-08-28）。APIキーは顧客のRLSでも読めない |
| 2 | **送信結果の読み違えの修正**（`stats.sent` を見る） | **済**（2026-08-28） |
| 3 | **`cancel_recent_days` を渡す**（既定30日） | **済**（2026-08-28）。理由は下の「頻度の歯止め」 |
| 4 | **結果の取り込み**（送った会社を出して協力会社として登録） | **済**（2026-08-28） |
| 5 | **`sender_override` で顧客名義を渡す** | 未。送信元の二重管理を無くせる |
| 6 | 枠と残り通数の確認（`GET /api/tenant/dashboard`） | 未。**500になっているかの検算**も兼ねる |
| 7 | 停止されているかの確認（`GET /api/tenant/kill-switch`） | 未。送信ボタンを押す前に止まっていると分かる |
| 8 | 打診文にマージタグを入れる（`##TO_COMPANY_NAME##`） | 未。宛名が入る |
| 9 | 対応表の自動取得（上のAができたら） | 未 |

### 5. 送信元の二重管理は `sender_override` で解消できる

当初「営業AIのテナントの `sender_*` と AI入札部の自社情報が二重になる」を
未解決の論点にしていたが、**送信のたびに上書きできる**。

```
POST /api/tenant/lists/<id>/send
  { ..., "sender_override": { "name": "◯◯建設株式会社", "email": "...",
                               "phone": "...", "last_name": "...", ... } }
```

受け取るキー（`api.py` `_SENDER_OVERRIDE_KEYS`）：
`name` / `email` / `phone` / `department` / `position` /
`last_name` / `first_name` / `last_name_kana` / `first_name_kana` /
`postal_code` / `prefecture` / `city` / `block` / `building`。

保存はされない（その送信だけ）。
**AI入札部の自社情報を正とし、送るたびに渡せばよい。** 同期は要らない。

### 8. マージタグ

`senders.render_merge_tags()` が置き換えるのは2つだけ。

| タグ | 中身 |
|---|---|
| `##TO_COMPANY_NAME##` | 送り先の会社名 |
| `##FROM_FAMILY_NAME##` | 送信者の姓（無ければ送信者名） |

未対応のタグは**そのまま本文に残る**（黙って消えない設計）。
使うときは綴りを間違えないこと。

## 分かったこと

### 頻度の歯止めは営業AI側に無くなっている

`db.can_contact()` に残っているのは3つだけ。

- `suppression`（配信停止・オプトアウト。特定電子メール法の対応）
- `tenant_exclusions`（テナントごとの除外設定）
- `dedup_of`（重複レコード）

**生涯接触上限と最短再接触間隔は T44（2026-08-25）で撤廃された**
（`config.py` のコメントと `HANDOFF.md` T44）。営業AI本来の使い方
（100社×月4,000通）に向けた判断で、営業AIとしては筋が通っている。

ただし**協力会社の開拓では前提が違う**。相手はこれから取引したい会社で、
雑に何度も送ると関係が始まらない。そこで送信のたびに
`cancel_recent_days: 30` を渡すことにした（AI入札部側で対応済み）。

**記録は営業AI側に一本化する。** こちらに「送信済み」の表を持つと必ず食い違う。

### 企業データは全テナント共有

`target_lists._base_where()` は
`owner_tenant_id IS NULL OR owner_tenant_id=?` で絞る。
`owner_tenant_id IS NULL` は**全テナント共有のマスタ**で、
AI入札部の顧客全員が同じ会社を候補として見る。

つまり **顧客Aが送った会社に、翌日 顧客Bも送れる。**
`can_contact()` はこれを止めない。

`cancel_recent_days` の判定は
`SELECT DISTINCT company_id FROM touches WHERE ... sent_at>=?` で、
**テナントで絞っていない**（`target_lists.send_list()`）。
結果として全テナント横断で効く。

- 良い面：協力会社の候補が短期間に何社からも連絡を受けるのを防げる
- 悪い面：顧客Aが送った30日間、顧客Bはその会社に送れない

**これが意図した挙動なのか、営業AI側に確認したい。**
意図でないなら `tenant_id` を条件に足すことになるが、
そうすると上の「良い面」が消える。こちらとしては現状のままが望ましい。

### Kill Switch の初期値は「停止」

`db.py` に「Kill Switchの初期値は『停止中』(安全側)。本番送信を許可するには、
必ず人間が明示的に `kill_switch_cli.py resume` で解除する必要がある」とある。

**新しい環境を立てた直後は送信できない。** 契約時の手順に入れておくこと。

### オファーはテナント作成時に自動で作られる

`send_list()` は「このテナントにはオファーが設定されていません」で止まるが、
`offers.add_tenant()` が既定のオファー（`target_rule='1=0'`）を同時に作る。
`POST /api/ops/tenants` で作れば追加の作業は要らない。

### HTTPS

`api.py` のコメントに「このAPIがまだ平文HTTP」とあるが、
`deploy/docker-compose.yml` に「2026-08-21のHTTPS化」とあり、
本番は既存の nginx がTLSを終端している。**コメントのほうが古い。**
AI入札部は `https://` しか受け付けない（APIキーを平文で送らないため）が、支障は無い。

## まだ決めていない論点

### 500通という数字の根拠

Playwrightで送るので費用はほぼゼロ（`docs/reference/価格.md`）。
**費用から決めた数字ではない。** 1業種の開拓で何社に当たるのかが分かっていない。

営業AI単体の最低プランが月4,000通（`FORM_MAX_PER_TENANT_PER_MONTH_DEFAULT`）、
価格帯が9,800〜19,800円（`config.PRICE_TIERS`）であることは参考になる。
**45,000円のプランに500通は、営業AI単体の最低プランの1/8**という位置づけになる。

### 契約が止まったとき

AI入札部で組織を停止（`org_access` が `停止`）したとき、
営業AI側の送信も止めるべき。`POST /api/ops/kill-switch`（scope=tenant）がある。
**いまは連動していない。**

ただし停止した組織の利用者は案件画面を開けないので、送信ボタンも押せない。
急ぎではない。

## やらないと決めたこと

- **無人での送信。** 定期実行やジョブから送信APIを呼ばない
  （CLAUDE.md「やらないこと」）
- **AI入札部側で除外リストや上限を持つこと。** 営業AI側のものを使う
- **顧客に営業AIの画面を触らせること。** 契約は本部が結び、設定も本部が行う
