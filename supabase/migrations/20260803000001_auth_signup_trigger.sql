-- 新規登録（auth.users への insert）をトリガーに、organizations / users / company_profiles を
-- 自動作成する。RLS（org_id = current_org_id()）は本人のusers行が無いと成立しないため、
-- 初回作成はRLSをバイパスするsecurity definer関数で行う（CLAUDE.md「DBアクセスはサーバー側のみ」）。
-- 参照：docs/実装仕様書_v1.md §2, ClaudeCode_実装指示書.md タスク1-3

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  org_name text;
  user_name text;
begin
  org_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'org_name'), ''), new.email);
  user_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), new.email);

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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
