-- 既存の組織に2人目以降のログインを足せるようにする（アカウント追加。月5,000円）。
--
-- 【なぜトリガーを直すか】
-- handle_new_user() は auth.users に行が入るたびに**必ず新しい組織を作る**
-- （20260803000001_auth_signup_trigger.sql）。1社1ログインの前提で書かれていた。
-- そのまま2人目を作ると、同じ会社なのに別の組織ができて、案件も協力会社も見えない。
--
-- raw_user_meta_data に org_id があれば、その組織に紐づけて users だけを作る。
-- 無ければこれまでどおり新しい組織を作る（1人目の発行は挙動を変えない）。
--
-- 【なぜ役割を分けるか】
-- 1人目は owner、2人目以降は member にする。いまRLSは org_id だけを見ていて
-- role では何も分けていないが、あとで「誰が停止を依頼できるか」を決めるときに、
-- 記録が無いと決めようがない。
--
-- 【なぜ依頼を表で持つか】
-- 料金が発生する操作を顧客が自分で完了できてはいけない（請求書払いのため）。
-- 顧客は依頼を出すだけ、発行するのは本部（docs/reference/価格.md）。
-- 電話やメールで受けると、言った言わないになり、請求の根拠も残らない。

-- ── 1. 既存組織に参加できるようにする ──────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  joining_org_id uuid;
  org_name text;
  user_name text;
begin
  user_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), new.email);
  joining_org_id := nullif(trim(new.raw_user_meta_data ->> 'org_id'), '')::uuid;

  if joining_org_id is not null then
    -- 既存の組織へ2人目以降として参加する。
    -- 存在しない組織IDを渡されたら、黙って新しい組織を作らずに落とす
    -- （握りつぶすと「発行できたのに何も見えない」アカウントができる）。
    if not exists (select 1 from public.organizations where id = joining_org_id) then
      raise exception '指定された組織が見つかりません（org_id=%）', joining_org_id;
    end if;

    insert into public.users (id, org_id, email, name, role)
    values (new.id, joining_org_id, new.email, user_name, 'member');

    -- organizations も company_profiles も既にある。作らない
    return new;
  end if;

  -- これまでどおり、新しい会社として作る
  org_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'org_name'), ''), new.email);

  insert into public.organizations (name)
  values (org_name)
  returning id into new_org_id;

  insert into public.users (id, org_id, email, name, role)
  values (new.id, new_org_id, new.email, user_name, 'owner');

  insert into public.company_profiles (org_id)
  values (new_org_id);

  return new;
end;
$$;

comment on function public.handle_new_user is
  'auth.users への insert で users を作る。raw_user_meta_data.org_id があれば既存組織へ参加（2人目以降）、無ければ新しい組織を作る';

-- ── 2. アカウント追加の依頼 ──────────────────────────────────
create table account_requests (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  -- 追加する人。発行時にそのまま使う
  name         text not null,
  email        citext not null,
  -- 依頼を出した人。誰が頼んだか分からないと本部が確認できない
  requested_by uuid references users(id) on delete set null,
  note         text,
  -- 依頼中 / 発行済み / 取り下げ
  status       text not null default '依頼中',
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

create index account_requests_status_idx on account_requests (status, created_at);
create index account_requests_org_idx on account_requests (org_id);

-- 同じ人を二重に依頼させない。取り下げ・発行済みは何度でも作れる
create unique index account_requests_pending_email_idx
  on account_requests (org_id, email) where status = '依頼中';

alter table account_requests enable row level security;

-- 顧客は自社の依頼を出す・見る・取り下げる。発行は本部（service_role）のみ
create policy "org members manage own account requests" on account_requests
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

comment on table account_requests is
  'アカウント追加の依頼。料金が発生するので顧客は依頼まで、発行は本部が行う（docs/reference/価格.md）';
comment on column account_requests.status is
  '依頼中 / 発行済み / 取り下げ。発行できるのは service_role（本部）だけ';
