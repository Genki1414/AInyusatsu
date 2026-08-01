# connectors/

geps（調達ポータル）/ agency-site / public-page / public-pdf / mail / kkj（官公需情報ポータルAPI）
（実装仕様書_v1.md §3、案件収集戦略_v2.md、調達ポータルコネクタ設計.md を参照）

- `p-portal-awards.ts`：落札実績オープンデータ（zip/CSV）のダウンロード（タスク1-8）。
  `AWARDS_OPEN_DATA_BASE_URL` 環境変数の設定が必要。詳細は
  `docs/reference/落札実績オープンデータ_列定義（推定）.md` を参照
