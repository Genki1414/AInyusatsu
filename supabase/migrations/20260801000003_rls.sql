-- 全テーブルRLSを有効化する。
--
-- ポリシーは3パターンに分ける。
--   A. 自組織のみ（org_id を持つテーブル、および organizations 自身）
--      → org_id / id = public.current_org_id() で自組織の行のみ許可
--   B. tenders型（全org読み取り可・書き込みはservice_roleのみ）
--      → tenders はCLAUDE.mdで明示された例外。tenders の子データ（tender_documents /
--        tender_analyses / tender_lots / tender_forms）と、機関・コネクタの参照マスタ
--        （agencies / connectors）も、org横断で共有される非orgデータのため同じ型を適用する
--   C. service_role専用（内部運用データ）
--      → crawl_runs / crawl_errors / events はorgに紐づかない内部運用・分析データのため、
--        authenticated/anon 向けのポリシーを設けない（service_roleのみアクセス可）
--
-- service_role は常にRLSをバイパスするため、Aパターンでも書き込みが
-- service_role専用になるテーブル（例: tenders以外でservice_roleからのみ更新する想定の列）は
-- 個別にwithチェックを絞ってはいない。書き込み経路の制御はアプリ層（サーバー側のみ）で担保する。

-- 自組織判定ヘルパー。呼び出し元ユーザー（auth.uid()）が所属するorg_idを返す。
-- users テーブル自体もRLS対象になるため、参照時の再帰を避けるためsecurity definerで実行する。
-- 前提：public.users.id は auth.users.id（auth.uid()）と一致させる運用とする。
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.users where id = auth.uid()
$$;

grant execute on function public.current_org_id() to authenticated;

-- organizations --------------------------------------------------------
-- id列自体が組織の識別子のため、他テーブルのorg_id列と同様に自組織のみを許可する。
alter table organizations enable row level security;

create policy "org members can access own organization" on organizations
  for all to authenticated
  using (id = public.current_org_id())
  with check (id = public.current_org_id());

-- users ------------------------------------------------------------------
alter table users enable row level security;

create policy "org members can access own org users" on users
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- agencies -----------------------------------------------------------------
-- 機関マスタ。org横断で共有される参照データ。書き込みはservice_role（収集ジョブ）のみ。
alter table agencies enable row level security;

create policy "authenticated can read agencies" on agencies
  for select to authenticated
  using (true);

-- connectors ---------------------------------------------------------------
-- コネクタ設定。org横断で共有される参照データ。書き込みはservice_role（収集ジョブ）のみ。
alter table connectors enable row level security;

create policy "authenticated can read connectors" on connectors
  for select to authenticated
  using (true);

-- tenders --------------------------------------------------------------
-- 【例外】案件は全ユーザー共通の1レコード（CLAUDE.md 最重要の前提1）。
-- 読み取りは全org許可、書き込みはservice_role（収集・解析ジョブ）のみに限定する。
-- そのため authenticated/anon 向けのinsert/update/deleteポリシーは意図的に設けない。
alter table tenders enable row level security;

create policy "authenticated can read tenders" on tenders
  for select to authenticated
  using (true);

-- tender_documents -------------------------------------------------------
-- tenders の子データ（案件に紐づく共通データ）のため、tendersと同じ例外パターンを適用する。
-- 原本（storage_key）をユーザーに配布しない方針（資料取得方針_v3.md）はアプリ層で担保する。
alter table tender_documents enable row level security;

create policy "authenticated can read tender_documents" on tender_documents
  for select to authenticated
  using (true);

-- tender_analyses ---------------------------------------------------------
alter table tender_analyses enable row level security;

create policy "authenticated can read tender_analyses" on tender_analyses
  for select to authenticated
  using (true);

-- tender_lots ---------------------------------------------------------------
alter table tender_lots enable row level security;

create policy "authenticated can read tender_lots" on tender_lots
  for select to authenticated
  using (true);

-- tender_forms --------------------------------------------------------------
alter table tender_forms enable row level security;

create policy "authenticated can read tender_forms" on tender_forms
  for select to authenticated
  using (true);

-- crawl_runs ------------------------------------------------------------
-- 収集ジョブの内部運用データ。org横断の顧客向けデータではないため、
-- authenticated/anon向けのポリシーは設けない（service_role専用）。
alter table crawl_runs enable row level security;

-- crawl_errors ------------------------------------------------------------
alter table crawl_errors enable row level security;

-- company_profiles --------------------------------------------------------
alter table company_profiles enable row level security;

create policy "org members can access own company_profiles" on company_profiles
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- criteria_sets -----------------------------------------------------------
alter table criteria_sets enable row level security;

create policy "org members can access own criteria_sets" on criteria_sets
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- proposals -----------------------------------------------------------------
alter table proposals enable row level security;

create policy "org members can access own proposals" on proposals
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- company_tenders -----------------------------------------------------------
alter table company_tenders enable row level security;

create policy "org members can access own company_tenders" on company_tenders
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- partners --------------------------------------------------------------
alter table partners enable row level security;

create policy "org members can access own partners" on partners
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- quote_requests ------------------------------------------------------------
alter table quote_requests enable row level security;

create policy "org members can access own quote_requests" on quote_requests
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- quotes ----------------------------------------------------------------
-- quotes自体はorg_id列を持たないため、親テーブルquote_requestsのorg_idで判定する。
alter table quotes enable row level security;

create policy "org members can access own quotes" on quotes
  for all to authenticated
  using (
    exists (
      select 1 from quote_requests qr
      where qr.id = quotes.request_id
        and qr.org_id = public.current_org_id()
    )
  )
  with check (
    exists (
      select 1 from quote_requests qr
      where qr.id = quotes.request_id
        and qr.org_id = public.current_org_id()
    )
  );

-- inbound_messages ------------------------------------------------------------
alter table inbound_messages enable row level security;

create policy "org members can access own inbound_messages" on inbound_messages
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- questions -----------------------------------------------------------------
alter table questions enable row level security;

create policy "org members can access own questions" on questions
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- awards ----------------------------------------------------------------
-- org_idがnullの行は品目別相場としての共有データ（落札実績オープンデータ由来）。
-- org_idがある行は自社案件のみで、自組織以外からは見えない。
alter table awards enable row level security;

create policy "authenticated can view market and own awards" on awards
  for select to authenticated
  using (org_id is null or org_id = public.current_org_id());

create policy "org members can manage own awards" on awards
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- events ------------------------------------------------------------------
-- KPIイベントの内部分析データ。authenticated/anon向けのポリシーは設けない（service_role専用）。
alter table events enable row level security;
