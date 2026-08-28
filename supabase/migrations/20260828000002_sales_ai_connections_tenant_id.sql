-- 営業AI（eigyouAI）側の内部tenant.id（数値）を保存する（本部側の接続設定 /admin/sales-ai）。
--
-- 【何に使うか】
-- POST /api/ops/tenants/<id>/quota-purchase（T55のクォータ追加購入。
-- packages/outreach/adapters/eigyou_ai.ts の purchaseQuota()）は、テナントごとの
-- api_key ではなく本部専用の運用キーで呼び、どのテナントかをこの数値で指定する。
-- 今まで保存先が無く、docs/reference/営業AI連携_設計.md に「まだ決めていない」と
-- 記録されていた（本部側の接続設定画面が未実装だったため）。
--
-- 【RLSは変えない】
-- sales_ai_connections の既存ポリシー（org_id = current_org_id()）はそのまま。
-- 本部からの読み書きは requireAdmin() が渡す service_role クライアントで行う
-- （RLSをバイパスする。apps/web/lib/admin.ts 参照）。顧客はこの列を編集する
-- 手段を持たない（顧客向け画面 apps/web/app/company からは触れない）。

alter table sales_ai_connections
  add column if not exists tenant_id integer;

comment on column sales_ai_connections.tenant_id is
  '営業AI（eigyouAI）側の内部tenant.id。本部が /admin/sales-ai でテナントを作ったときに保存する。POST /api/ops/tenants/<id>/quota-purchase 等、本部専用の運用APIを呼ぶときに使う';
