-- 自社の郵送・電話番号等の名義（協力会社開拓の問い合わせフォーム送信元に使う。T55の続き）。
--
-- 【なぜ本部の手入力をやめたか】
-- 最初は本部がAI入札部の契約者ごとに /admin/sales-ai で手入力していたが、手間が
-- 多すぎるというユーザー決定（2026-08-28その2）。顧客が自分の会社情報として /company で
-- 一度入力すれば、営業AI側の送信元テンプレート（sender-templates）へ自動的に同期される
-- 形にする（apps/web/lib/sales_ai_sync.ts）。
--
-- 【なぜ organizations や company_profiles に足さないか】
-- organizations は課金設定（overhead_rate/profit_rate）と表示名で手一杯、
-- company_profiles は入札資格（qual_categories等）専用。ここは営業AI連携専用の
-- 郵送名義なので、別テーブルにして関心を分ける。
--
-- 【会社名・メールアドレスはここに含めない】
-- 会社名は organizations.name、送信元メールは organizations.reply_to
-- （無ければオーナーの users.email）をそのまま使う。二重に持つと必ず食い違う。
create table organization_mailing_identity (
  org_id          uuid primary key references organizations(id) on delete cascade,
  last_name       text,
  first_name      text,
  last_name_kana  text,
  first_name_kana text,
  postal_code     text,
  prefecture      text,
  city            text,
  block           text,
  building        text,
  phone           text,
  department      text,
  position        text,
  updated_at      timestamptz not null default now()
);

alter table organization_mailing_identity enable row level security;

-- 自組織の分だけ。sales_ai_connections と同じ形
create policy "org members manage own mailing identity" on organization_mailing_identity
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

comment on table organization_mailing_identity is
  '営業AI（eigyouAI）の送信元テンプレートへ自動同期する、自社の郵送名義。apps/web/lib/sales_ai_sync.ts参照';
