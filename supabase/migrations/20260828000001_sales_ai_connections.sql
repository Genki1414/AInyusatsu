-- 営業AI（eigyouAI）への接続設定（9月分：協力会社開拓）。
--
-- 【なぜ組織ごとか】
-- 協力会社は顧客企業ごとのデータで、開拓も顧客が自分の営業AIアカウントで行う
-- （ユーザー決定 2026-08-28）。本部が代行しないので、接続情報も組織ごとに持つ。
--
-- 【業種の対応表をなぜ持つか】
-- AI入札部の業種（電気・清掃・警備…）と営業AI側の業種コードは別の語彙で、
-- 営業AIには語彙を返すAPIが無い。こちらからは知りようがないので、顧客が書く。
--
-- 営業AIの絞り込みは知らない業種の値を黙って捨てる。捨てられると業種の条件が消えて
-- 「その都道府県の全社」が対象になり、面識の無い会社への一斉送信になる。
-- 対応表に無い業種では候補を探す操作をさせない（apps/web 側で止める）。
--
-- 【APIキーの扱い】
-- 顧客自身の資格情報なので、自組織だけが読み書きできるようにする。
-- 画面には伏せ字でしか出さない（packages/domain/src/sales_ai.ts の maskApiKey）。

create table sales_ai_connections (
  org_id         uuid primary key references organizations(id) on delete cascade,
  base_url       text not null,
  api_key        text not null,
  -- {"電気": "denki"} の形。AI入札部の業種 → 営業AIの業種コード
  trade_map      jsonb not null default '{}',
  -- 疎通確認の結果。失敗の理由を残す（握りつぶさない）
  checked_at     timestamptz,
  check_error    text,
  updated_at     timestamptz not null default now()
);

alter table sales_ai_connections enable row level security;

-- 自社の設定だけ。他組織の接続情報は見えない
create policy "org members manage own sales ai connection" on sales_ai_connections
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

comment on table sales_ai_connections is '顧客ごとの営業AI（eigyouAI）接続設定。開拓は顧客が自分のアカウントで行う';
comment on column sales_ai_connections.trade_map is 'AI入札部の業種 → 営業AIの業種コード。営業AIに語彙を返すAPIが無いため顧客が書く';
comment on column sales_ai_connections.check_error is '疎通確認が失敗した理由。成功したら null に戻す';
