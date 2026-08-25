-- 即時通知（タスク3-2）を、同じ表で重複なく記録できるようにする。
-- 参照：docs/実装仕様書_v1.md §8「即時通知は3つだけ：質問期限48時間前、提出期限48時間前、見積の返信受信」
--
-- 【なぜ鍵を変えるか】
-- 毎朝のダイジェストは「組織 × 日付」で1通なので (org_id, kind, target_date) で足りた。
-- 即時通知は違う。提出期限48時間前の通知は「案件ごとに1回だけ」で、日付では決まらない。
-- 毎時走るジョブなので、日付で数えると48時間のあいだ毎日送ってしまう。
--
-- そこで、何に対する通知かを含めた文字列（dedupe_key）を鍵にする。
--   daily_digest:2026-08-25       毎朝のダイジェスト（組織 × 日付で1通）
--   提出期限48h:<tender_id>        案件ごとに1回だけ
--   質問期限48h:<tender_id>        同上（提出期限とは別に送る）
--   見積の返信:<inbound_message_id> 受信1件につき1回だけ
--
-- 鍵の組み立ては packages/domain/src/instant_notice.ts に置く（送信側と一致させるため）。

alter table notification_log add column dedupe_key text;

-- 既存の行はすべて毎朝のダイジェスト。同じ規則で埋める
update notification_log set dedupe_key = 'daily_digest:' || target_date::text where dedupe_key is null;

alter table notification_log alter column dedupe_key set not null;

alter table notification_log drop constraint if exists notification_log_org_id_kind_target_date_key;

create unique index notification_log_dedupe_key_idx on notification_log (org_id, dedupe_key);

comment on column notification_log.dedupe_key is
  '何に対する通知か。組織ごとに一意。同じ通知を二度送らないための鍵（packages/domain/src/instant_notice.ts が組み立てる）';
comment on column notification_log.target_date is
  'いつ送ったか（Asia/Tokyo の日付）。即時通知では送信日が入るだけで、重複の判定には使わない';
