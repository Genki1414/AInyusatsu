-- 営業AIへ作った送信先リストの控え（9月分：協力会社開拓）。
--
-- 【なぜ要るか（1）：同じリストへ送り直すため】
-- 営業AIは1回の呼び出しで最大50社までしか送らない（config.FORM_MAX_PER_RUN）。
-- 残りを送るには、もう一度送信を頼む必要がある。
--
-- このとき**同じリストへ送らなければならない**。
-- 営業AIは「リスト＝キャンペーン」で、送信済みかどうかは
-- touches(campaign_id, company_id) で見ている（target_lists.send_list()）。
-- 新しいリストを作ると新しいキャンペーンになり、**もう送った会社にもう一度届く**。
-- リストの番号を覚えていないと、それが起きる。
--
-- 【なぜ要るか（2）：結果を後から見るため】
-- 送った会社の一覧は営業AIのリストにしかない
-- （GET /api/tenant/lists/<id>?status=success）。
-- 返信をもらった会社を協力会社として登録するのは数日後になるので、
-- 画面を閉じたら分からなくなるようでは使えない。
--
-- 【1つの案件×業種につき1リスト】
-- 送り直しは同じリストに積む。業種が違えば打診文も違うので、リストを分ける。

create table outreach_sends (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  tender_id    uuid not null references tenders(id) on delete cascade,
  trade        text not null,
  -- 営業AI側のリスト番号。この製品のIDではない
  list_id      integer not null,
  list_name    text not null,
  created_at   timestamptz not null default now(),
  -- 最後に送信を頼んだ時刻。まだ一度も送れていなければ null
  last_sent_at timestamptz,
  unique (org_id, tender_id, trade)
);

create index outreach_sends_org_tender_idx on outreach_sends (org_id, tender_id);

alter table outreach_sends enable row level security;

-- 自社の控えだけ。他組織がどこへ打診したかは見えない
create policy "org members manage own outreach sends" on outreach_sends
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

comment on table outreach_sends is
  '営業AIへ作った送信先リストの控え。送り直しを同じリストへ積むために要る（別リストにすると送信済みの会社にもう一度届く）';
comment on column outreach_sends.list_id is
  '営業AI側の target_lists.id。送信済みの判定は営業AIが campaign_id で行うため、送り直しは必ずこの番号へ';
