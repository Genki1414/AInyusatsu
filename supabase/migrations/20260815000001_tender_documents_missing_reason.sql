-- 資料が無い理由を2つに分ける（CLAUDE.md 最重要の前提7 / docs/資料取得方針_v3.md）。
--
--   機関が出していない（正常） … 数量表が存在しない役務案件など。アラートしない
--   取得に失敗した（要対応）   … リンク切れ、ICカードが必要など。手動取得の対象
--
-- これまでは tender_documents に行が無いことしか分からず、この2つを区別できなかった。
-- 「機関が実際に出していた資料種別」と「資料一覧を確認できた日時」を案件側に持たせることで、
-- 行が無い理由を判定できるようにする（packages/domain/src/document_status.ts）。

alter table tenders
  -- 資料一覧を確認できた日時。null なら未確認（巡回前・巡回が途中で落ちた）
  add column documents_checked_at timestamptz,
  -- 機関が実際に出していた資料種別（公告/入札説明書/仕様書/数量表/様式/その他）。
  -- documents_checked_at が入っているときだけ意味を持つ
  add column published_doc_kinds text[] not null default '{}',
  -- 資料の取得そのものに失敗したときの理由（AUTH_REQUIRED / LAYOUT_CHANGED / RATE_LIMITED 等）。
  -- AI解析の失敗（failure_code）とは別の軸なので、列を分ける（互いに上書きしないため）
  add column documents_failure_code text,
  add column documents_failure_reason text;

comment on column tenders.documents_checked_at is '資料一覧を確認できた日時。nullは未確認';
comment on column tenders.published_doc_kinds is '機関が実際に出していた資料種別。一覧に無い種別は「機関が出していない（正常）」';
comment on column tenders.documents_failure_code is '資料取得の失敗コード。AI解析のfailure_codeとは別の軸';
comment on column tenders.documents_failure_reason is '資料取得の失敗理由（人が読む用）';

-- 手当てが必要な案件（資料の取得に失敗した案件）を拾うための索引。
create index on tenders (documents_failure_code) where documents_failure_code is not null;
