-- タイムアウトを LAYOUT_CHANGED から TIMEOUT へ付け替える。
--
-- 【なぜ直すか】
-- 資料取得の失敗をすべて LAYOUT_CHANGED（画面構成の変化）として記録していた。
-- 2026-09-01〜09-03 に34件が積まれたが、中身は**すべて30秒のタイムアウト**で、
-- セレクタは壊れていなかった。原因は巡回が三重に走ってメモリを食い合っていたこと
-- （expireInSeconds の既定15分に対し、巡回は40〜50分かかっていた）。
--
-- 運営画面には「コネクタのセレクタを直す」と出続ける。直すものが無いのに
-- 34件が「要対応」として並ぶと、**本当に直すべきものが埋もれる**。
--
-- 【本文は書き換えない】
-- 失敗の理由（documents_failure_reason / message）はそのまま残す。
-- 分類だけを直す。あとから見た人が、元の文面で判断し直せるようにしておく。
--
-- 【当てはまるものだけ】
-- Playwright が出す "Timeout 30000ms exceeded" の形が入っているものに限る。
-- 判別できないものは触らない（推測で分類を変えない）。

update tenders
set documents_failure_code = 'TIMEOUT'
where documents_failure_code = 'LAYOUT_CHANGED'
  and documents_failure_reason ~ 'Timeout [0-9]+ms exceeded';

update crawl_errors
set code = 'TIMEOUT'
where code = 'LAYOUT_CHANGED'
  and message ~ 'Timeout [0-9]+ms exceeded';
