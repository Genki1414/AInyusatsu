-- ワーカーが生きていることの合図。
--
-- 【なぜ要るか】
-- 2026-09-03 にワーカーが落ち、**6日間だれも気づかなかった**。
-- 異常を知らせる notify-ops はワーカーの中にあるので、ワーカーが死ぬと通知も死ぬ。
-- 「何も届かない」を正常と読み違える構造になっていた。
--
-- Railwayのログを見れば分かるが、毎日ログを開きに行く運用は続かない。
-- いつも見る運営画面に出すために、ワーカー自身が生きている合図をここへ書く。
--
-- 【1行しか持たない】
-- 履歴は要らない。知りたいのは「最後に動いたのはいつか」だけ。
-- 行を増やすと、古い行を消す仕事が増えるだけで何も得られない。

create table worker_heartbeats (
  -- 常に 'worker'。1行に上書きし続ける
  id         text primary key default 'worker',
  -- 最後に生きていた時刻。10分ごとに更新される
  beat_at    timestamptz not null default now(),
  -- そのプロセスが起動した時刻。ここが変わっていれば再起動している
  started_at timestamptz not null default now(),
  -- 登録しているジョブの数。減っていれば DISABLED_JOBS の設定ミスに気づける
  jobs       int not null default 0
);

-- 本部だけが見る。顧客には関係のない情報なので、
-- ポリシーを作らずRLSだけ有効にする（service_role からしか読めない状態にする）
alter table worker_heartbeats enable row level security;

comment on table worker_heartbeats is
  'ワーカーが生きている合図。10分ごとに1行を上書きする。運営画面で最終稼働を出すために使う';
