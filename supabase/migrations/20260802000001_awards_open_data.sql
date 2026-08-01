-- 落札実績オープンデータの取り込み用に awards を拡張し、market_rates（集計キャッシュ）と
-- award_imports（取り込み実行記録）を追加する。
-- 参照：docs/落札実績オープンデータ_取り込み設計.md §5

alter table awards add column procurement_no text;         -- 調達案件番号（19桁）
alter table awards add column agency_class text;           -- 本省/地方支分部局/独立行政法人等
alter table awards add column contract_type text;          -- 総額/単価/複数年度
alter table awards add column tax_included boolean;
alter table awards add column rate numeric(6,4);           -- 落札率。非公表なら null
alter table awards add column outlier boolean not null default false;
alter table awards add column source_batch text;           -- 取り込んだファイル名

-- procurement_no はオープンデータ由来の行にのみ入る（手入力の自社実績は null のままでよい）。
-- 同一ファイルを再取り込みしても件数が増えないよう、この2列でupsertする。
create unique index awards_procurement_no_opened_at_key on awards (procurement_no, opened_at);

-- 集計キャッシュ（画面はここだけを見る）
create table market_rates (
  item          text not null,
  agency_class  text not null,
  amount_band   text not null,
  period_months int not null default 24,
  n             int not null,
  rate_median   numeric(6,4),
  rate_avg      numeric(6,4),
  rate_p25      numeric(6,4),
  rate_p75      numeric(6,4),
  updated_at    timestamptz not null default now(),
  primary key (item, agency_class, amount_band, period_months)
);

-- 取り込みの記録
create table award_imports (
  id         bigserial primary key,
  kind       text not null,        -- full / diff
  target_date date,
  rows_total int, rows_upserted int, rows_skipped int,
  status     text not null,        -- succeeded / no_data / failed
  detail     jsonb,
  created_at timestamptz not null default now()
);

-- RLS -----------------------------------------------------------------
-- market_rates: org横断で共有される集計データ（tenders/agenciesと同じ「読み取り全org可・
-- 書き込みはservice_roleのみ」型）。
alter table market_rates enable row level security;

create policy "authenticated can read market_rates" on market_rates
  for select to authenticated
  using (true);

-- award_imports: 取り込みジョブの内部運用記録。crawl_runs/crawl_errorsと同様、
-- authenticated/anon向けのポリシーは設けない（service_role専用）。
alter table award_imports enable row level security;
