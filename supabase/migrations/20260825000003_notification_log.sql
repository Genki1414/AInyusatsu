-- 送った通知の記録（タスク3-2 notify）。
-- 参照：docs/実装仕様書_v1.md §5「notify：1日1通にまとめる（案件ごとに送らない）」
--
-- 【なぜ表が要るか】
-- 「1日1通」を守るには、その日にもう送ったかを覚えておく必要がある。
-- proposals.status を 配信済 にするだけでは足りない。新着提案が0件で、期限だけを
-- 知らせた日は proposals が動かないため、ジョブが2回走ると2通目が飛ぶ。
--
-- 【送る前に記録する】
-- (org_id, kind, target_date) を一意にして、送信前にこの行を確保する。
-- 二重に走っても2通目は一意制約で弾かれる。送信が全部失敗したときは、
-- ワーカーがこの行を消して、次の実行でやり直せるようにする。

create table notification_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  kind        text not null,                            -- daily_digest
  target_date date not null,                            -- JSTの日付
  sent_at     timestamptz not null default now(),
  recipients  int not null default 0,                   -- 実際に送れた宛先の数
  unique (org_id, kind, target_date)
);

create index notification_log_org_idx on notification_log (org_id, sent_at desc);

alter table notification_log enable row level security;

-- 利用者は自社の記録を見られるだけ。書き込むのはワーカー（service_role）のみ
create policy "org members can read own notification_log" on notification_log
  for select to authenticated
  using (org_id = public.current_org_id());

comment on table notification_log is '送った通知の記録。1日1通を守るための冪等キーを兼ねる';
comment on column notification_log.target_date is 'どの日ぶんの通知か（Asia/Tokyo の日付）';
comment on column notification_log.recipients is '実際に送れた宛先の数。0なら送信に失敗している';
