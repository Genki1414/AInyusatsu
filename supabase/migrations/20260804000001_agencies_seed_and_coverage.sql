-- 機関マスタのseed投入と、葉ノード基準のカバレッジ照合ビュー。
-- 参照：docs/機関マスタ_v2.md §3（seed）, §4（カバレッジの数え方）
--
-- 【変換に関する注記】
-- docs/機関マスタ_v2.md のseed CSVは (connector, list_url, note) を独立した列として
-- 記載しているが、実装仕様書_v1.md §2 の agencies テーブルにはそれらの列は無く、
-- 代わりに sources jsonb（[{connector, url, kind}] 想定）がある。
-- ここでは connector→connector、list_url→url、kind は列挙が無いため一律 "list"
-- （巡回対象の一覧ページの意）とし、note の内容は失わないよう sources の各要素に
-- note フィールドとして残す（jsonbなのでスキーマ上問題ない）。
--
-- 【親ノードの補完】
-- seedのparent_id（mof/mlit/mod/mhlw/rinya/mext）は、agencies(id) を参照するNOT NULL
-- ではないFKだが実在しないと挿入できない。docs/機関マスタ_v2.md のseedにはこれらの
-- 府省本体の行が含まれていない（おそらく記載漏れ）ため、階層を成立させるために
-- 府省本体のプレースホルダ行をここで補う。名称は公知の正式名称のみを使用し、
-- 巡回先URL等の推測は行わない（sources は空のまま）。

insert into agencies (id, name, category, parent_id, sources, expected_freq, active) values
  ('mof',   '財務省',     '府省', null, '[]'::jsonb, null, true),
  ('mlit',  '国土交通省', '府省', null, '[]'::jsonb, null, true),
  ('mod',   '防衛省',     '府省', null, '[]'::jsonb, null, true),
  ('mhlw',  '厚生労働省', '府省', null, '[]'::jsonb, null, true),
  ('rinya', '林野庁',     '外局', null, '[]'::jsonb, null, true),
  ('mext',  '文部科学省', '府省', null, '[]'::jsonb, null, true);

insert into agencies (id, name, category, parent_id, sources, expected_freq, active) values
  ('kkj', '官公需情報ポータル(API)', '横断', null,
    '[{"connector":"kkj","url":"https://www.kkj.go.jp/api/","kind":"api","note":"国・独法・自治体を横断。案件の発見に使用"}]'::jsonb,
    'daily', true),
  ('p-portal', '調達ポータル', '横断', null,
    '[{"connector":"geps","url":"https://www.p-portal.go.jp/","kind":"list","note":"各府省の物品・役務。資料取得と当日ぶんの補完"}]'::jsonb,
    'daily', true),
  ('mof-tohoku', '東北財務局', '地方支分部局', 'mof',
    '[{"connector":"agency-site","url":"https://lfb.mof.go.jp/tohoku/b4_nyusatsu/","kind":"list","note":"年度別ページあり"}]'::jsonb,
    'weekly', true),
  ('mof-kantou', '関東財務局', '地方支分部局', 'mof',
    '[{"connector":"agency-site","url":"https://lfb.mof.go.jp/kantou/new_nyuusatsu.htm","kind":"list","note":"新着一覧が日付順で最良"}]'::jsonb,
    'weekly', true),
  ('mlit-thr', '東北地方整備局', '地方支分部局', 'mlit',
    '[{"connector":"agency-site","url":"https://www.thr.mlit.go.jp/nyusatsu.html","kind":"list","note":"配下の事務所を別途展開"}]'::jsonb,
    'weekly', true),
  ('mlit-thr-sendai', '仙台河川国道事務所', '事務所', 'mlit-thr',
    '[{"connector":"agency-site","url":"https://www.thr.mlit.go.jp/sendai/jigyousyamuke/koukoku/04ekimu_list01.html","kind":"list"}]'::jsonb,
    'monthly', true),
  ('mlit-thr-tougi', '東北技術事務所', '事務所', 'mlit-thr',
    '[{"connector":"agency-site","url":"https://www.thr.mlit.go.jp/tougi/nyusatsu/nyusatsu.html","kind":"list"}]'::jsonb,
    'monthly', true),
  ('mlit-ktr', '関東地方整備局', '地方支分部局', 'mlit',
    '[{"connector":"agency-site","url":"https://www.ktr.mlit.go.jp/nyuusatu/","kind":"list","note":"配下の事務所を別途展開"}]'::jsonb,
    'weekly', true),
  ('nho', '国立病院機構（本部）', '独立行政法人', null,
    '[{"connector":"agency-site","url":"https://nho.hosp.go.jp/bid/bid_notification.html","kind":"list","note":"各病院を別途展開"}]'::jsonb,
    'weekly', true),
  ('mod-tohoku', '東北防衛局', '地方支分部局', 'mod',
    '[{"connector":"agency-site","url":"https://www.mod.go.jp/rdb/tohoku/contract/annocement/index_27.html","kind":"list","note":"総務部/企画部/調達部に分かれる"}]'::jsonb,
    'weekly', true),
  ('mhlw-kantoshinetsu', '関東信越厚生局', '地方支分部局', 'mhlw',
    '[{"connector":"agency-site","url":"https://kouseikyoku.mhlw.go.jp/kantoshinetsu/chotatsu/","kind":"list"}]'::jsonb,
    'monthly', true),
  ('rinya-kanto', '関東森林管理局', '地方支分部局', 'rinya',
    '[{"connector":"agency-site","url":"https://www.rinya.maff.go.jp/kanto/apply/publicsale/","kind":"list","note":"森林管理署ごとにもページあり"}]'::jsonb,
    'monthly', true),
  ('mext-portal', '文部科学省 調達総合案内', '府省', 'mext',
    '[{"connector":"agency-site","url":"https://pf.mext.go.jp/gpo3/kanpo/gpoindex.asp","kind":"list","note":"所管独法・国立大学法人のリンク集あり。メルマガ配信あり"}]'::jsonb,
    'daily', true),
  ('tohoku-univ', '東北大学', '国立大学法人', 'mext',
    '[{"connector":"agency-site","url":"http://www.bureau.tohoku.ac.jp/keiyaku/kouhyou/nyuusatsu.html","kind":"list","note":"文科省の調達総合案内にも掲載"}]'::jsonb,
    'weekly', true);

-- カバレッジ照合（葉ノード基準）------------------------------------------
-- 局だけを登録して95%を達成しても事務所単位の取りこぼしが分からないため、
-- 「子を持たない機関（実際に公告を出す単位）」を母集団にする（機関マスタ_v2.md §4）。
-- security_invoker: ビューを呼び出したロールの権限（＝agenciesのRLS）で実行する。
-- 指定しないとビュー所有者（migration実行ロール）の権限で実行され、RLSを迂回してしまう。
create view agency_leaf_coverage
with (security_invoker = true)
as
with leaves as (
  select a.id from agencies a
  where a.active
    and not exists (select 1 from agencies c where c.parent_id = a.id and c.active)
)
select
  count(*) filter (where ag.last_success_at > now() - interval '30 days')::float
  / nullif(count(*), 0) as coverage,
  count(*) as leaf_count,
  count(*) filter (where ag.last_success_at > now() - interval '30 days') as fresh_count
from leaves l join agencies ag on ag.id = l.id;

-- RLS: agenciesと同様、org横断の参照データ。書き込みはservice_roleのみ。
-- ビューはベーステーブル（agencies）のRLSポリシーをそのまま引き継ぐため、
-- 追加のGRANT/POLICYは不要（agenciesの "authenticated can read agencies" が適用される）。
