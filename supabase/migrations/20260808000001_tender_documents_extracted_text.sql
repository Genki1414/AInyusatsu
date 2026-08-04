-- 資料のテキスト抽出（タスク2-2）の結果を保存する列を追加する。
-- 参照：docs/実装仕様書_v1.md §4.1、§2（tender_documents）
--
-- extracted_text : テキストPDFはそのまま抽出、画像PDF（スキャン）はOCRしたテキスト。
--                   AI解析（タスク2-3）はこの列を入力に使う。
-- extract_error   : 抽出に失敗した理由（OCR_FAILED等）。成功時はnullのまま。
--                    値が入っている行は再試行しない（現状の制約。手動でnullに戻せば再試行される）。

alter table tender_documents
  add column extracted_text text,
  add column extract_error text;
