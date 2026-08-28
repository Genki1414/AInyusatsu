-- 営業AIの接続設定を本部が持つようにする（ユーザー決定 2026-08-28）。
--
-- 【何が変わったか】
-- 作ったときは「顧客が自分の営業AIアカウントで開拓する」前提だった。
-- そのあと「AI入札部の契約者は営業AIにも登録する。テナントは本部が作り、
-- 顧客は営業AIの画面を開かない」と決まった（docs/reference/営業AI連携_設計.md）。
--
-- 本部が発行したAPIキーを、顧客が読み書きできるままにしておくと次の2つが起きる。
--   1. 顧客がキーを差し替えて、本部の把握していない営業AIへ送れてしまう
--   2. キーを取り出して営業AIのAPIを直に叩けてしまう。件数を見てから送る・
--      対応表に無い業種では送らない、といったこちらの歯止めが全部外れる
--
-- 【なぜ列の権限まで外すか】
-- RLSは行単位なので、読める行の全列が読める。APIキーだけを隠すには
-- 列の SELECT 権限を外すしかない。表単位の SELECT が残っていると列単位の
-- REVOKE は効かない（PostgreSQL の仕様）ので、いったん外してから列ごとに付け直す。
--
-- base_url と trade_map は顧客も読める。案件画面で「この業種は営業AIで探せるか」を
-- 出すのに要る（apps/web/app/tenders/[id]/page.tsx の loadOutreachTrades）。
-- APIキーが要る処理は service_role で読む（apps/web/lib/sales-ai.ts）。

drop policy if exists "org members manage own sales ai connection" on sales_ai_connections;

-- 読み取りだけ。書き込みポリシーは作らない（service_role＝本部のみ）
create policy "org members can read own sales ai connection" on sales_ai_connections
  for select to authenticated
  using (org_id = public.current_org_id());

revoke select on sales_ai_connections from authenticated;
grant select (org_id, base_url, trade_map, checked_at, check_error, updated_at)
  on sales_ai_connections to authenticated;

comment on table sales_ai_connections is
  '営業AI（eigyouAI）の接続設定。テナントは本部が作り、設定も本部が行う。顧客は営業AIの画面を開かない';
comment on column sales_ai_connections.api_key is
  '本部が営業AIで発行したテナントのAPIキー。authenticated には列の読み取り権限を与えていない（service_role のみ）';
comment on column sales_ai_connections.trade_map is
  'AI入札部の業種 → 営業AIの業種コード。営業AIに語彙を返すAPIが無いため本部が書く';
