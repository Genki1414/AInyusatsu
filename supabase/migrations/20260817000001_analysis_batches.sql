-- Batch API での案件解析（コスト対策③）の進み具合を追跡する。
--
-- Batch API は全トークンが50%引きになる代わりに、投入してから結果が出るまで
-- たいてい1時間・最大24時間かかる。投入したきり忘れると、結果が29日で消えて
-- 費用だけが残るため、投入したバッチを必ずここに記録する。
--
-- 2段階に分ける理由（packages/ai/src/batch_plan.ts 参照）：
--   第1段（stage=1）基本情報だけを投入し、資料をプロンプトキャッシュへ書き込む
--   第2段（stage=2）第1段の完了後に残り4本を投入し、キャッシュから読む
-- 5本を1つのバッチに混ぜると、書き込みを待たずに残りが走ってキャッシュが効かない。

create table analysis_batches (
  id           uuid primary key default gen_random_uuid(),
  -- Anthropic 側のバッチID（msgbatch_...）。結果の回収に使う
  batch_id     text not null unique,
  stage        int not null,                          -- 1: キャッシュ書き込み / 2: 残り4本
  status       text not null default 'in_progress',   -- in_progress / ended / applied / canceled / failed
  -- このバッチに含めた案件。第2段を組み立てるときと、取りこぼしの確認に使う
  tender_ids   uuid[] not null default '{}',
  request_count int not null default 0,
  succeeded    int,
  errored      int,
  -- 回収した結果をDBへ反映できた案件数
  applied      int,
  -- 実際のトークン消費（キャッシュが効いたかの実測）
  usage        jsonb,
  failure_reason text,
  submitted_at timestamptz not null default now(),
  ended_at     timestamptz,
  applied_at   timestamptz
);

create index on analysis_batches (status, submitted_at);

comment on table analysis_batches is 'Batch APIでの案件解析の進み具合。投入したバッチを取りこぼさないための記録';
comment on column analysis_batches.stage is '1=基本情報のみ（キャッシュ書き込み） 2=残り4本（キャッシュ読み出し）';
comment on column analysis_batches.usage is '実際のトークン消費。バッチでプロンプトキャッシュが効いたかの実測に使う';

alter table analysis_batches enable row level security;
-- 内部運用データのため service_role のみ（crawl_runs / crawl_errors と同じ扱い）。
-- authenticated 向けのポリシーは設けない。
