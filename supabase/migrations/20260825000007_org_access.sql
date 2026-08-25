-- 本部が発行・停止する利用権（タスク4-8の続き）。
--
-- 【なぜ必要か】
-- 支払いは請求書払いのみにすると決まった（ユーザー決定 2026-08-25）。
-- カード決済のように自動で契約が始まらないため、アカウントの発行と停止は本部が行う。
--
-- 【なぜ organizations に持たせないか】
-- organizations のRLSは `for all`（自組織なら読み書き可）。
-- そこに状態を置くと、顧客が自分で「停止」を「利用中」に戻せてしまう。
-- 別の表にして、読み取りだけを許可する。書けるのは service_role（本部）だけ。
--
-- 【行が無い＝停止】
-- 既定値を '停止' にしたうえで、行が無い組織も使えないものとして扱う
-- （apps/web/lib/auth.ts）。作り忘れたときに「使えてしまう」より、
-- 「使えない」ほうが安全なため。セルフ登録でこっそり組織が増えても使えない。

create table org_access (
  org_id           uuid primary key references organizations(id) on delete cascade,
  status           text not null default '停止',        -- 利用中 / 停止
  activated_at     timestamptz,
  suspended_at     timestamptz,
  suspended_reason text,
  -- 本部用のメモ（請求先・担当者・支払条件など）。顧客にも見えるので、
  -- 顧客に見せられないことは書かない
  note             text,
  updated_at       timestamptz not null default now()
);

create index org_access_status_idx on org_access (status);

alter table org_access enable row level security;

-- 利用者は自社の状態を読めるだけ。書き込みポリシーは作らない（service_role のみ）
create policy "org members can read own access" on org_access
  for select to authenticated
  using (org_id = public.current_org_id());

comment on table org_access is '本部が発行・停止する利用権。請求書払いのため契約の開始と停止は本部が行う';
comment on column org_access.status is '利用中 / 停止。行が無い組織も停止として扱う（作り忘れで使えてしまうのを防ぐ）';
comment on column org_access.note is '本部用のメモ。顧客も読めるので、顧客に見せられないことは書かない';

-- すでに使っている組織は、いままでどおり使えるようにする。
-- これから作られる組織は既定の '停止' から始まり、本部が発行して初めて使える。
insert into org_access (org_id, status, activated_at)
select id, '利用中', created_at from organizations;
