-- 管理画面用に月間AI原価を実行方式・成否別で集計する。
-- 生ログをブラウザ側で全件読むとSupabaseの行数上限で過少集計になるためDB側で集約する。

create or replace function ai_usage_summary_between(p_from timestamptz, p_to timestamptz)
returns table (
  execution_mode text,
  status text,
  event_count bigint,
  calls bigint,
  estimated_cost_yen bigint,
  input_tokens bigint,
  cache_read_tokens bigint,
  output_tokens bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.execution_mode,
    e.status,
    count(*)::bigint,
    coalesce(sum(e.calls), 0)::bigint,
    coalesce(sum(e.estimated_cost_yen), 0)::bigint,
    coalesce(sum(e.input_tokens), 0)::bigint,
    coalesce(sum(e.cache_read_tokens), 0)::bigint,
    coalesce(sum(e.output_tokens), 0)::bigint
  from ai_usage_events e
  where e.occurred_at >= p_from
    and e.occurred_at < p_to
  group by e.execution_mode, e.status
  order by e.execution_mode, e.status;
$$;

revoke all on function ai_usage_summary_between(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function ai_usage_summary_between(timestamptz, timestamptz) to service_role;
