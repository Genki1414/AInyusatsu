-- AI API の実費を案件・処理単位で残し、日次/月次の予算上限を守れるようにする。
-- ログだけでは Railway の保存期間を過ぎると追えず、再試行やキャッシュ不発による
-- 原価増にも気づけないため、課金に使われるトークンと円換算額を永続化する。

create table ai_usage_events (
  id                         uuid primary key default gen_random_uuid(),
  tender_id                  uuid references tenders(id) on delete set null,
  org_id                     uuid references organizations(id) on delete set null,
  operation                  text not null,
  execution_mode             text not null default 'synchronous',
  model                      text not null,
  status                     text not null check (status in ('succeeded', 'failed')),
  calls                      int not null default 0 check (calls >= 0),
  input_tokens               bigint not null default 0 check (input_tokens >= 0),
  cache_creation_tokens      bigint not null default 0 check (cache_creation_tokens >= 0),
  cache_read_tokens          bigint not null default 0 check (cache_read_tokens >= 0),
  output_tokens              bigint not null default 0 check (output_tokens >= 0),
  billable_input_equivalent  bigint not null default 0 check (billable_input_equivalent >= 0),
  input_saving_rate          numeric(7,6) not null default 0,
  estimated_cost_yen         int not null default 0 check (estimated_cost_yen >= 0),
  detail                     jsonb not null default '{}'::jsonb,
  occurred_at                timestamptz not null default now()
);

create index ai_usage_events_occurred_at_idx on ai_usage_events (occurred_at desc);
create index ai_usage_events_tender_id_idx on ai_usage_events (tender_id, occurred_at desc);
create index ai_usage_events_operation_idx on ai_usage_events (operation, occurred_at desc);

comment on table ai_usage_events is
  'AI APIの課金実績。日次/月次の予算停止と案件別原価の確認に使う';
comment on column ai_usage_events.estimated_cost_yen is
  'API応答の実トークンを、その時点のコード上の単価・為替で円換算した概算額';

alter table ai_usage_events enable row level security;
-- 本部の内部原価なので顧客向けポリシーは作らない。service_role のみ読み書きする。

-- Supabase の通常selectは最大行数に制限があるため、月間合計はDB側で集計する。
create or replace function ai_spend_between(p_from timestamptz, p_to timestamptz)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(estimated_cost_yen), 0)::bigint
  from ai_usage_events
  where occurred_at >= p_from
    and occurred_at < p_to;
$$;

revoke all on function ai_spend_between(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function ai_spend_between(timestamptz, timestamptz) to service_role;
