# 営業AI（ヒラケル）側への依頼

AI入札部との連携で、営業AI側に足してほしい2本。
**パッチを書いて、営業AIの自己テストが通ることまで確認してある**
（`docs/reference/営業AI連携_パッチ.diff`）。

- 対象コミット：`6ef7a1b`（`claude/project-handoff-0ubqc1`、2026-08-28）
- 変更：`api.py` +105 / `offers.py` +17
- 自己テスト：`python3 api.py test` → **343件すべて成功**（元は334件。9件足した）

背景と全体の設計は `docs/reference/営業AI連携_設計.md`。

## 当て方

```bash
cd <eigyouAIのクローン>
git apply 営業AI連携_パッチ.diff
python3 run.py all --demo    # テスト用のデータが無ければ先に1回
python3 api.py test          # 343 / 343 になること
```

---

## 1. `POST /api/ops/tenants` に送信枠を渡せるようにする　★こちらが重要

### なぜ

いまの `h_ops_tenants_create()` は送信枠を受け取らない。省略すると
`tenants.monthly_send_quota` が NULL のままになり、`senders._check_quota()` が
`config.FORM_MAX_PER_TENANT_PER_MONTH_DEFAULT` を使う。

```python
FORM_MAX_PER_TENANT_PER_MONTH_DEFAULT = 4000
```

**AI入札部の基本プランは月500通。設定を忘れると 4,000通になる。8倍。**
契約と実際に送れる量が食い違ったまま、誰も気づかない。

### 何をしたか

```
POST /api/ops/tenants
  { "name": "...", "sender_email": "...",
    "monthly_send_quota": 500, "daily_send_quota": 50 }
→ { "ok": true, "tenant_id": 12, "api_key": "...",
    "monthly_send_quota": 500, "daily_send_quota": 50,
    "quota_is_default": false }
```

- 正の整数のみ受け付ける。`0`・負の数・文字列は 400
  （**黙って無視して既定値に落とさない**。そこが今回の事故の元なので）
- **応答に、実際に効く値と `quota_is_default` を必ず含める。**
  省略して既定値へ落ちたことが、呼び出し側ですぐ分かる
- `offers.add_tenant()` に `monthly_send_quota` / `daily_send_quota` を追加。
  列は `db.ensure_schema()` の `ALTER TABLE` で後から足されたものなので、
  INSERT の列には入れず、指定されたときだけ UPDATE している

既定値そのもの（4,000通）は変えていない。**営業AI自身の顧客に影響するため、
そこは営業AI側の判断。**

---

## 2. `GET /api/tenant/trades`（業種の語彙）

### なぜ

AI入札部の業種（電気・清掃・警備…）と営業AIの業種コード（`tobi` 等）は別の語彙で、
いまは**本部が対応表を手で書いている**。営業AI側に語彙を返す手段が無いため。

`target_lists.build_filter_sql()` は**知らない業種の値を黙って捨てる**。
捨てられると業種の条件そのものが消えて、**その都道府県の全社が対象になる**。
面識の無い会社への一斉送信になるので、AI入札部側は3か所で止めているが、
そもそも正しいコードが分かれば止める必要がない。

### 何をしたか

```
GET /api/tenant/trades      （Authorization: Bearer <tenant.api_key>）
→ { "trades": [
      {"code": "kaitai", "label": "解体", "labels": ["解体"]},
      {"code": "tobi",   "label": "とび", "labels": ["とび", "土工"]},
      {"code": "tosou",  "label": "塗装", "labels": ["塗装"]}
    ] }
```

- `config.TARGET_TRADES` を返すだけ。読み取り専用で、他テナントの情報は渡さない
- `TARGET_TRADES` は**「日本語ラベル → コード」で、複数のラベルが同じコードを指す**
  （とび・土工 → `tobi`）。コードごとにまとめて `labels` に全部入れている
- テストで `target_lists._ALLOWED_TRADES` と一致することを確かめている。
  **返すコードと、絞り込みが受け付けるコードが食い違わないようにするため**

---

## 足したテスト（9件）

`api.py` の `self_test()` に、既存と同じ書き方で追加。

| | |
|---|---|
| 認証ヘッダなしの `GET /api/tenant/trades` は401 | |
| 業種コードの一覧が取れる | `config.TARGET_TRADES` と一致 |
| 同じコードを指す複数のラベルがまとまって返る | とび・土工 → `tobi` |
| 返すコードが `build_filter_sql` の受け付けるものと一致 | 捨てられる値を渡させない |
| 送信枠を省略すると既定値と `quota_is_default=True` | |
| 送信枠を指定できる | |
| 指定した送信枠が `tenants` に保存される | `_check_quota()` が読む列 |
| `0` や負の数は400 | |
| 文字列は400 | 黙って無視して既定値にしない |

---

## この2本には入れていないこと

### 業種と企業を増やす

いまの `companies` は建設業許可業者の3業種だけで、AI入札部が必要とする
電気・清掃・警備・情報処理・廃棄物処理などとほとんど重ならない。
`HANDOFF.md`「5. 連絡すべき判断」に「データソースの選定は未着手」と残っている。

**ここが揃うまで、AI入札部の協力会社開拓はほぼ動かない。**
ただしデータソースの選定は判断が要る話なので、コードでは触っていない。

### `cancel_recent_days` のテナント分離

`target_lists.send_list()` の

```python
SELECT DISTINCT company_id FROM touches
 WHERE company_id IN (...) AND sent_at IS NOT NULL AND sent_at>=?
```

には `tenant_id` の条件が無く、**全テナント横断で効く**。

AI入札部としては**このままが望ましい**。企業データは全テナント共有なので、
同じ協力会社の候補が短期間に何社からも連絡を受けるのを防げる。
相手はこれから取引したい会社なので、そこは守りたい。

**ただし意図した挙動かどうかは分からないので、確認したい。**
意図でないなら直すことになるが、そのときはAI入札部側で
別の歯止めを持つ必要がある（設計文書の「頻度の歯止め」）。
