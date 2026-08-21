-- 見積依頼先のAIおすすめ選定（タスク4-1拡張）の結果をキャッシュするテーブル。
-- 「見積依頼」タブを開くたびにAI（Claude API）へ問い合わせるとコスト・待ち時間が
-- 積み重なるため、org×tender×trade単位で結果を保存し、次回以降は再利用する。
-- 参照：packages/ai/src/recommend.ts, apps/web/app/tenders/[id]/recommend.ts

create table quote_recommendations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  tender_id       uuid not null references tenders(id) on delete cascade,
  trade           text not null,
  model           text not null,
  recommendations jsonb not null default '[]',          -- [{partner_id, reason}]
  note            text,
  created_at      timestamptz not null default now(),
  unique (org_id, tender_id, trade)
);

alter table quote_recommendations enable row level security;

create policy "org members can access own quote_recommendations" on quote_recommendations
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
