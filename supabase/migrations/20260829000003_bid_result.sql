-- 入札の結果（落札できたか）を記録する。
--
-- 【なぜ利用者が入れるか】
-- 開札の結果は発注機関が公表するが、公表の形も時期も機関ごとにばらばらで、
-- 自動で確実に拾えない。**取れないものを取れたことにしない**（CLAUDE.md 最重要の前提7）。
-- 落札実績オープンデータ（awards）は月次で、案件との突き合わせも名称頼りなので、
-- 「この案件で自社が落札したか」は分からない。
--
-- 【なぜ stance と分けるか】
-- stance（参加するか）は入札の前に決める意思で、bid_result は後から分かる事実。
-- 同じ列にすると「参加」が結果に上書きされ、そもそも参加したのかが分からなくなる。
--
-- 【金額を1つの列にする理由】
-- 落札したときは自社の落札金額、落札できなかったときは分かれば他社の落札金額を入れる。
-- どちらも「その案件がいくらで決まったか」で、次の応札価格を決めるときの材料は同じ。
-- 自社か他社かは bid_result を見れば分かるので、列を分けない。

alter table company_tenders
  add column if not exists bid_result text not null default '未入力';

-- 円単位の integer（CLAUDE.md「金額は円単位の integer。小数を使わない」）
alter table company_tenders
  add column if not exists result_amount bigint;

alter table company_tenders
  add column if not exists result_at timestamptz;

alter table company_tenders
  add column if not exists result_memo text;

create index if not exists company_tenders_bid_result_idx on company_tenders (org_id, bid_result);

comment on column company_tenders.bid_result is
  '未入力 / 落札 / 落札できず / 辞退 / 中止。利用者が開札後に入れる。stance（参加するかの意思）とは別で、上書きしない';
comment on column company_tenders.result_amount is
  '落札金額（円）。落札なら自社の金額、落札できずなら分かれば他社の金額。次の応札価格を決める材料になる';
comment on column company_tenders.result_memo is
  '結果についての覚え書き（何位だったか、なぜ辞退したか等）。次に活かすために残す';
