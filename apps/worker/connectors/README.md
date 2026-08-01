# connectors/

geps（調達ポータル）/ agency-site / public-page / public-pdf / mail / kkj（官公需情報ポータルAPI）
（実装仕様書_v1.md §3、案件収集戦略_v2.md、調達ポータルコネクタ設計.md を参照）

- `p-portal-awards.ts`：落札実績オープンデータ（zip/CSV）のダウンロード（タスク1-8）。
  `AWARDS_OPEN_DATA_BASE_URL` 環境変数の設定が必要。詳細は
  `docs/reference/落札実績オープンデータ_列定義（推定）.md` を参照
- `kkj.ts`：官公需情報ポータルAPI（タスク1-5）。`docs/reference/KKJ_api_guide.pdf`（公式仕様書）
  に基づきタグ名ベースでXMLを解析する。エンドポイントは`KKJ_API_URL`環境変数で上書き可能
  （既定 `http://www.kkj.go.jp/api/`）。`tenders`へのupsertは`../jobs/kkj_sync.ts`で行う。
  未確認事項は`docs/reference/KKJ_API_確認事項.md`を参照
- `geps.ts`：調達ポータルの検索・詳細取得・資料ダウンロード（タスク1-7）。Playwright使用。
  実際のDOM構造は未検証（本セッションから`www.p-portal.go.jp`に到達できないため）。
  ICカード不要（「連絡先情報をはじめから入力する」経路のみを使う）
