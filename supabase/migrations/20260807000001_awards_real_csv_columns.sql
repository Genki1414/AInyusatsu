-- 落札実績オープンデータの実データを確認した結果、当初の列マッピング（推定）と実際のCSV構造が
-- 異なっていた（見出し行が無い・列構成が違う）ため、実データから取得できる列を追加する。
-- 参照：docs/reference/落札実績オープンデータ_列定義（推定）.md
--
-- 実データには「予定価格」「品目分類」「調達機関名称」に相当する列が無いため、budget/item/
-- agency_class/contract_type/tax_included/rate はこのCSV由来の行では常にnullになる（推測しない）。

alter table awards add column name text;               -- 案件名称
alter table awards add column winner_name text;         -- 落札者名称
alter table awards add column corporate_number text;    -- 法人番号（13桁）
