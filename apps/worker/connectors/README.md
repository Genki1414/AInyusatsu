# connectors/

geps（調達ポータル）/ agency-site / public-page / public-pdf / mail / kkj（官公需情報ポータルAPI）
（実装仕様書_v1.md §3、案件収集戦略_v2.md、調達ポータルコネクタ設計.md を参照）

- `kkj.ts`：官公需情報ポータルAPI（タスク1-5）。エンドポイント・パラメータ名は未検証のため
  `KKJ_API_URL` / `KKJ_API_DATE_PARAM` 環境変数で上書き可能。詳細は
  `docs/reference/KKJ_API_確認事項.md` を参照。`tenders`へのupsertは機関マスタとの
  名寄せが未整備のため未実装（同文書§1参照）
