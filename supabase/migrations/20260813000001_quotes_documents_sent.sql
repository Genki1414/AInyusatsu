-- 資料請求（documents_requested）への自動送付の記録。
-- 協力会社が回答ページで「資料をお願いする」を選ぶと、本部が取得済みの資料への
-- 署名付きURLを自動でメール送付する（ユーザー決定 2026-08-21。CLAUDE.md「やらないこと」の
-- 改訂と対応）。送付できたらこの列に日時を記録し、見積状況タブで確認できるようにする。
alter table quotes add column documents_sent_at timestamptz;
