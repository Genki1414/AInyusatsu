-- 案件ごとの「参加するかどうか」の判断（見送り / 検討 / 保留 / 参加）。
--
-- 【なぜ proposals ではなく company_tenders か】
-- proposals.status にも「検討中 / 対象外」はあるが、あれは**条件セットごとの提案**の状態で、
-- 1つの案件が条件セットの数だけ行を持つ。同じ案件に「検討中」と「対象外」が並びうる。
-- 利用者が決めるのは案件そのものへの態度なので、(org_id, tender_id) で1つに決まる
-- company_tenders に置く。
--
-- 【なぜ work_status と分けるか】
-- work_status（募集開始 / 積算中 / 提出済）は**作業がどこまで進んだか**で、
-- 応札価格を入れた・書類を出した、といった操作で自動的に動く。
-- stance は**人がどうしたいか**で、機械が勝手に変えてはいけない。
-- 1つの列に混ぜると、価格を入れた拍子に「参加」が消えるようなことが起きる。
--
-- 【既定は「未定」】
-- 何も選んでいない状態を「検討」と決めつけない。
-- 一覧で「まだ判断していない案件」を出せるようにする。

alter table company_tenders
  add column if not exists stance text not null default '未定';

-- いつ決めたか。「3日前に参加と決めたのに何も進んでいない」を見つけるのに使う
alter table company_tenders
  add column if not exists stance_at timestamptz;

create index if not exists company_tenders_stance_idx on company_tenders (org_id, stance);

comment on column company_tenders.stance is
  '未定 / 検討 / 保留 / 参加 / 見送り。利用者が案件ごとに決める。work_status（作業の進み）とは別の軸で、機械が勝手に変えない';
comment on column company_tenders.stance_at is
  'stance を最後に変えた日時。決めたまま止まっている案件を見つけるのに使う';
