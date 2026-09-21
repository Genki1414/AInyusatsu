-- 2段階バッチをワーカーが自動で進めるための親子関係と引継ぎ完了時刻。
-- 第1段を反映しただけでは案件を解析完了にせず、followup_completed_at が入るまで
-- 第2段（または緊急案件の同期解析）への引継ぎ対象として残す。

alter table analysis_batches
  add column parent_batch_id uuid references analysis_batches(id) on delete set null,
  add column followup_completed_at timestamptz;

create index analysis_batches_parent_batch_id_idx on analysis_batches (parent_batch_id);
create index analysis_batches_followup_idx
  on analysis_batches (stage, status, followup_completed_at)
  where stage = 1 and status = 'applied';

comment on column analysis_batches.parent_batch_id is
  '第2段を作った元の第1段analysis_batches.id。2段階処理の追跡に使う';
comment on column analysis_batches.followup_completed_at is
  '第1段の案件を第2段バッチまたは緊急同期解析へ引き継いだ時刻';
