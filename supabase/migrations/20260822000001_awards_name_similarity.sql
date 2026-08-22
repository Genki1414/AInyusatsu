-- 落札実績を案件名で探せるようにする（trigram検索）。
-- 参照：docs/reference/落札実績オープンデータ_列定義（推定）.md §1
--
-- 【なぜ必要か】
-- 落札実績オープンデータには予定価格・品目分類・調達機関名称の列が無いため、
-- 品目や発注機関では過去の実績を引けない。案件名で引くしかない。
--
-- ところが実データの案件名は揺れが大きい。
--   網走開発建設部本部外　消防用設備等点検業務
--   令和８年度管理施設消防用設備保守点検（武雄河川事務所）
--   （R8）第三吉島住宅ほか消防用設備等点検等業務
-- 施設名がすべて違い、「等」「外」「ほか」「保守」の有無も揺れる。
-- 完全一致・部分一致だけでは拾えない。
--
-- 【trigramを使う理由】
-- 3文字単位の重なりで近さを測る、Postgres標準の方法。日本語でも機能する。
-- 語を分解して意味を推し量る（形態素解析なしでは推測になる）必要がない。

create extension if not exists pg_trgm with schema extensions;

-- 82,000件を毎回なめると遅い。GINインデックスで候補だけを引く。
create index if not exists awards_name_trgm_idx on awards using gin (name extensions.gin_trgm_ops);

-- 案件名の近い落札実績を返す。
--
-- security invoker（既定）なので awards のRLSがそのまま効く
-- （org_idがnullの共有データと、自組織の実績だけが見える）。
-- search_path を固定し、呼び出し側のsearch_pathに影響されないようにする。
create or replace function public.find_similar_awards(
  p_name text,
  p_limit int default 20,
  p_min_similarity real default 0.3
)
returns table (
  name text,
  amount bigint,
  opened_at date,
  winner_name text,
  similarity real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    a.name,
    a.amount,
    a.opened_at,
    a.winner_name,
    extensions.similarity(a.name, p_name) as similarity
  from awards a
  where a.name is not null
    -- % はGINインデックスを使う。既定のしきい値（0.3）で候補を絞ってから
    and a.name operator(extensions.%) p_name
    and extensions.similarity(a.name, p_name) >= p_min_similarity
  order by extensions.similarity(a.name, p_name) desc, a.opened_at desc
  -- 呼び出し側が極端な値を渡しても、全件を返さない
  limit least(greatest(p_limit, 1), 100);
$$;

comment on function public.find_similar_awards is
  '案件名が近い落札実績を返す。落札実績オープンデータには品目・機関名の列が無いため、名称でしか引けない。';
