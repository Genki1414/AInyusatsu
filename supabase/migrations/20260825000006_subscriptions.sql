-- 契約と決済（タスク4-7）。
-- 参照：docs/ClaudeCode_実装指示書.md §4「Stripe Checkout ＋ Webhook 3種＋トライアル30日」
--       同 §5「Stripe Webhook は stripe_event_id で冪等に。同じイベントが複数回来ます」
--
-- 【金額を持たない】
-- 価格はStripe側（Price）で持ち、こちらには価格idも金額も置かない。
-- 価格を変えたときにDBを直す必要が無いようにする。

create table subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  -- 1組織1契約。組織が消えたら契約の記録も消す
  org_id                 uuid not null unique references organizations(id) on delete cascade,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  plan                   text not null default 'standard',
  status                 text not null default '未契約',
    -- 未契約 / トライアル中 / 有効 / 支払い遅延 / 解約済（packages/domain/src/billing.ts）
  payment_method         text,                            -- カード / 銀行振込
  trial_ends_at          timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  updated_at             timestamptz not null default now(),
  created_at             timestamptz not null default now()
);

create index subscriptions_status_idx on subscriptions (status);

alter table subscriptions enable row level security;

-- 利用者は自社の契約を見られるだけ。書き込むのはWebhook（service_role）のみ。
-- 画面から状態を書き換えられると、支払っていないのに「有効」にできてしまう。
create policy "org members can read own subscription" on subscriptions
  for select to authenticated
  using (org_id = public.current_org_id());

comment on table subscriptions is '組織ごとの契約状態。金額と価格はStripe側で持つ';
comment on column subscriptions.status is '自分たちの言葉での契約状態。Stripeの状態名をそのまま入れない（決済事業者を差し替えられるようにするため）';
comment on column subscriptions.payment_method is 'カード / 銀行振込。銀行振込は入金までに数日かかるため、画面の案内を変える';

-- 受け取ったWebhookの記録。同じイベントが複数回届くので、これで二重処理を防ぐ。
create table stripe_events (
  id          text primary key,                           -- Stripeのevent id（evt_...）
  type        text not null,
  received_at timestamptz not null default now()
);

-- 利用者には見せない（ポリシーを作らないので、service_role以外は読めない）
alter table stripe_events enable row level security;

comment on table stripe_events is 'Stripe Webhookの受信記録。同じイベントを二度処理しないための冪等キー';
