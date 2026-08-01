-- 初期スキーマ。docs/実装仕様書_v1.md「2. データモデル」のDDLをそのまま適用する。
-- テーブル定義自体の変更はここでは行わない（レビューはSQLの妥当性を担保する）。

-- 利用企業とユーザー ------------------------------------------------------
create table organizations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  plan            text not null default 'beta',
  overhead_rate   numeric(5,4) not null default 0.12,   -- 一般管理費率
  profit_rate     numeric(5,4) not null default 0.10,   -- 目標利益率
  created_at      timestamptz not null default now()
);

create table users (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references organizations(id) on delete cascade,
  email     citext not null unique,
  name      text not null,
  role      text not null default 'member',            -- owner / member
  created_at timestamptz not null default now()
);

-- 機関マスタ（カバレッジ計測の母集団） ------------------------------------
create table agencies (
  id            text primary key,                       -- 'mof-kanto'
  name          text not null,
  parent_id     text references agencies(id),
  category      text not null,                          -- 府省 / 地方支分部局 / 独立行政法人 / 特殊法人
  sources       jsonb not null default '[]',            -- [{connector, url, kind}]
  expected_freq text,                                   -- weekly / monthly など欠測検知の基準
  last_success_at timestamptz,
  active        boolean not null default true
);

-- コネクタ ----------------------------------------------------------------
create table connectors (
  id        text primary key,                           -- 'geps'
  name      text not null,
  kind      text not null,                              -- 電子調達 / 官庁サイト / 公開Web / 公開PDF / メール / FAX
  state     text not null default 'active',             -- active / manual / disabled
  config    jsonb not null default '{}',
  last_run_at timestamptz
);

-- 案件マスタ（全ユーザー共通・重複排除） ----------------------------------
create table tenders (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,                 -- 'T-2026-000842' 表示用
  dedupe_key      text not null unique,                 -- agency_id/notice_no/submit_deadline(date)
  agency_id       text not null references agencies(id),
  org_unit        text,                                 -- 部局
  notice_no       text,
  name            text not null,
  procurement     text not null,                        -- 役務 / 物品 / 工事
  qual_category   text not null,                        -- 役務の提供等 / 物品の販売 / 物品の製造 / 建設工事
  item            text,                                 -- 営業品目
  grade           text,                                 -- 'B以上'
  areas           text[] not null default '{}',         -- 競争参加地域
  notice_date     date,
  submit_deadline timestamptz,
  qa_deadline     timestamptz,
  bid_open_at     timestamptz,
  place           text,
  term_from       date,
  term_to         date,
  budget          bigint,                               -- 予定価格（非公表は null）
  source_url      text,
  acquire_method  text not null,                        -- 電子調達 / 公開Web / 公開PDF / メール / FAX
  connector_id    text references connectors(id),
  collect_status  text not null default '未取得',
    -- 未取得/取得中/取得済/AI解析中/解析完了/公開中/終了
  failure_code    text,
  failure_reason  text,
  retry_count     int not null default 0,
  next_retry_at   timestamptz,
  fetched_at      timestamptz,
  published_at    timestamptz,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index on tenders (collect_status, submit_deadline);
create index on tenders (item, procurement);
create index on tenders (submit_deadline);

create table tender_documents (
  id          uuid primary key default gen_random_uuid(),
  tender_id   uuid not null references tenders(id) on delete cascade,
  kind        text not null,                            -- 公告/入札説明書/仕様書/数量表/様式/その他
  fetched     boolean not null default false,
  storage_key text,
  source_url  text,
  sha256      text,
  page_count  int,
  ocr_used    boolean not null default false,
  fetched_at  timestamptz,
  unique (tender_id, kind, sha256)
);

create table tender_analyses (
  id           uuid primary key default gen_random_uuid(),
  tender_id    uuid not null references tenders(id) on delete cascade,
  version      int not null default 1,
  model        text not null,
  summary      text,
  qualifications jsonb not null default '[]',           -- [{text, source}]
  conditions   jsonb not null default '[]',
  trades       jsonb not null default '[]',             -- [{trade, confidence, evidence, excluded}]
  estimate_scope jsonb not null default '[]',
  notes        jsonb not null default '[]',
  official_acquire text,
  raw          jsonb,                                   -- モデルの生出力（検証用）
  created_at   timestamptz not null default now(),
  unique (tender_id, version)
);

create table tender_lots (                              -- 数量表の行
  id         uuid primary key default gen_random_uuid(),
  tender_id  uuid not null references tenders(id) on delete cascade,
  line_no    int not null,
  item       text not null,
  spec       text,
  qty        numeric,
  unit       text,
  trade      text,                                      -- AIが割り当てた業種
  confidence numeric(4,3),
  unique (tender_id, line_no)
);

create table tender_forms (                             -- 提出書類（様式から抽出）
  id         uuid primary key default gen_random_uuid(),
  tender_id  uuid not null references tenders(id) on delete cascade,
  name       text not null,
  source     text,                                      -- 様式第1号 など
  required   boolean not null default true,
  note       text
);

-- 収集ジョブ --------------------------------------------------------------
create table crawl_runs (
  id           uuid primary key default gen_random_uuid(),
  connector_id text not null references connectors(id),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  found        int default 0,
  merged       int default 0,                           -- 重複としてマージした件数
  documents    int default 0,
  failed       int default 0,
  status       text not null default 'running'
);

create table crawl_errors (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid references crawl_runs(id) on delete cascade,
  tender_id  uuid references tenders(id) on delete cascade,
  agency_id  text references agencies(id),
  code       text not null,                             -- §6のコード
  message    text,
  payload    jsonb,
  created_at timestamptz not null default now()
);

-- 企業側データ ------------------------------------------------------------
create table company_profiles (
  org_id        uuid primary key references organizations(id) on delete cascade,
  qual_categories text[] not null default '{}',
  grades        jsonb not null default '{}',            -- {"役務の提供等":"B"}
  items         text[] not null default '{}',
  areas         text[] not null default '{}',
  qual_valid_to date,
  updated_at    timestamptz not null default now()
);

create table criteria_sets (                            -- 条件セット
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  name       text not null,
  items      text[] not null default '{}',
  areas      text[] not null default '{}',
  keywords   text[] not null default '{}',
  ng_words   text[] not null default '{}',
  ng_agencies text[] not null default '{}',
  min_budget bigint, max_budget bigint,
  min_days   int not null default 5,
  active     boolean not null default true
);

create table proposals (                                -- 企業 × 案件 × 条件セット
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  tender_id     uuid not null references tenders(id) on delete cascade,
  criteria_set_id uuid references criteria_sets(id) on delete set null,
  status        text not null default '提案対象',
    -- 提案対象/配信済/既読/検討中/対象外
  score         int not null,
  reasons_ok    jsonb not null default '[]',
  reasons_ng    jsonb not null default '[]',
  excluded_reason text,
  matched_at    timestamptz not null default now(),
  delivered_at  timestamptz,
  read_at       timestamptz,
  unique (org_id, tender_id, criteria_set_id)
);
create index on proposals (org_id, status, score desc);

create table company_tenders (                          -- 企業の作業状態
  org_id          uuid not null references organizations(id) on delete cascade,
  tender_id       uuid not null references tenders(id) on delete cascade,
  official_status text not null default '未取得',        -- 未取得/申請中/取得済
  official_at     timestamptz,
  work_status     text not null default '募集開始',
  bid_price       bigint,
  assignee_id     uuid references users(id),
  memo            text,
  primary key (org_id, tender_id)
);

-- 協力会社と見積 ----------------------------------------------------------
create table partners (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references organizations(id) on delete cascade,
  name      text not null,
  person    text, tel text, email citext, line_user_id text,
  base      text,
  trades    text[] not null default '{}',
  areas     text[] not null default '{}',
  rating    numeric(2,1),
  memo      text,
  active    boolean not null default true
);

create table quote_requests (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  tender_id  uuid not null references tenders(id) on delete cascade,
  trade      text not null,
  due_at     timestamptz,
  body       text,
  lot_ids    uuid[] not null default '{}',              -- 送った数量表の行
  sent_at    timestamptz
);

create table quotes (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid references quote_requests(id) on delete cascade,
  partner_id   uuid not null references partners(id),
  amount       bigint,
  channel      text,                                    -- LINE / メール
  replied_at   timestamptz,
  source       text,                                    -- 自動取込 / 手入力
  memo         text,
  declined     boolean not null default false,
  adopted      boolean not null default false,
  reminded_at  timestamptz
);
create index on quotes (request_id, amount);

create table inbound_messages (                         -- 返信の受信箱
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  partner_id  uuid references partners(id),
  tender_id   uuid references tenders(id),
  channel     text not null,
  received_at timestamptz not null default now(),
  body        text not null,
  attachments jsonb not null default '[]',
  parsed_amount bigint,
  parse_confidence numeric(4,3),
  status      text not null default '未取込',            -- 未取込/取込済/対象外
  raw         jsonb
);

create table questions (                                -- 発注機関への質問
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  tender_id  uuid not null references tenders(id) on delete cascade,
  text       text not null,
  basis      text,
  status     text not null default '下書き',             -- 下書き/送信済/回答あり
  answer     text,
  sent_at    timestamptz
);

create table awards (                                   -- 落札結果（相場データ）
  id         uuid primary key default gen_random_uuid(),
  tender_id  uuid references tenders(id) on delete set null,
  org_id     uuid references organizations(id) on delete set null,  -- 自社案件のみ
  item       text,
  agency_id  text references agencies(id),
  budget     bigint,
  amount     bigint not null,
  won        boolean,
  bidders    int,
  opened_at  date,
  source     text not null default 'manual'             -- manual / crawler
);
create index on awards (item, opened_at desc);

-- KPI計測 ----------------------------------------------------------------
create table events (
  id         bigserial primary key,
  org_id     uuid, user_id uuid, tender_id uuid,
  name       text not null,                             -- §10
  props      jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on events (name, created_at);
