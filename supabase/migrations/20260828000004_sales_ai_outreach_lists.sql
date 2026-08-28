-- 営業AI（eigyouAI）で作った送信先リストの番号を、案件×業種にひもづけて残す。
--
-- 【なぜ要るか】
-- outreach-actions.ts の sendOutreach() は営業AI側にリストを作らせるが、
-- その list_id はこれまでReact側の一時的な状態（useActionState）にしか無く、
-- 画面を閉じると失われていた。「数日後に返信を確認しに戻ってくる」
-- （結果の取り込み。docs/reference/営業AI連携_設計.md「3. 結果（未実装）」）には、
-- どのlist_idを見ればよいかを覚えておく場所が要る。
--
-- 【1案件×1業種に複数行できる】
-- 送信ボタンを押すたびに営業AI側で新しいリストが作られる（同じ名前でも使い回さない）。
-- 返信の確認では、この案件×業種に紐づく全list_idを見に行く（過去に何度か送っていても
-- 取りこぼさないため）。
create table sales_ai_outreach_lists (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  tender_id   uuid not null references tenders(id) on delete cascade,
  trade       text not null,
  list_id     integer not null,
  list_name   text not null,
  created_at  timestamptz not null default now()
);

create index idx_sales_ai_outreach_lists_lookup on sales_ai_outreach_lists (org_id, tender_id, trade);

alter table sales_ai_outreach_lists enable row level security;

create policy "org members manage own outreach lists" on sales_ai_outreach_lists
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

comment on table sales_ai_outreach_lists is
  '営業AI（eigyouAI）で作った送信先リストのlist_idを、案件×業種にひもづけて記録する。結果の取り込み（返信の確認）で使う';
