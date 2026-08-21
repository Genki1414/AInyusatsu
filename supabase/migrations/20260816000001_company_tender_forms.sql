-- 提出書類チェックリスト（タスク4-6）。
--
-- 提出書類そのもの（tender_forms）は全ユーザー共通の案件データだが、
-- 「未着手／作成中／完了」の進み具合は企業ごとの作業状態なので別テーブルに置く
-- （CLAUDE.md 最重要の前提1「企業ごとのデータは必ず別テーブル」）。

create table company_tender_forms (
  org_id     uuid not null references organizations(id) on delete cascade,
  form_id    uuid not null references tender_forms(id) on delete cascade,
  -- tender_forms は再解析のたびに作り直されるが、画面は案件単位で引くため案件も持つ
  tender_id  uuid not null references tenders(id) on delete cascade,
  state      text not null default '未着手',              -- 未着手/作成中/完了
  updated_at timestamptz not null default now(),
  primary key (org_id, form_id)
);

create index on company_tender_forms (org_id, tender_id);

alter table company_tender_forms enable row level security;

create policy "org members can access own company_tender_forms" on company_tender_forms
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

comment on table company_tender_forms is '提出書類チェックリストの進み具合（企業ごと）';
comment on column company_tender_forms.state is '未着手/作成中/完了。必須書類がすべて完了になるまで提出済みにできない';

-- 提出した日時。work_status だけでは「いつ提出したか」が残らないため列を足す。
alter table company_tenders add column submitted_at timestamptz;

comment on column company_tenders.submitted_at is '入札書を提出した日時。提出後の取り下げはできない';
