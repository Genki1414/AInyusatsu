-- 段取りのうち、利用者が自分で「やった」とチェックしたもの。
--
-- 【なぜ手でチェックできるようにするか】
-- 段取りの多くは本サービスの記録から分かる（見積依頼を送った、応札価格を決めた等）。
-- しかし分からないものがある。質問を電話でしたか、開札の結果を確認したか、は
-- 本サービスには届かない。**取れないものを取れたことにしない**（CLAUDE.md 最重要の前提7）ので、
-- そこは利用者に入れてもらう。
--
-- 【記録で分かるものは、記録が優先】
-- 記録で終わったと分かる段取りは、手でチェックを外せない。
-- 画面が記録に反することを書くと、どちらが本当か分からなくなる。
--
-- 【なぜラベルではなくキーで持つか】
-- docs / qa / quote / price / forms / submit / open を入れる。
-- 画面の文言を直しても、記録が消えないようにするため。

alter table company_tenders
  add column if not exists roadmap_done text[] not null default '{}';

comment on column company_tenders.roadmap_done is
  '利用者が自分でチェックした段取りのキー（docs/qa/quote/price/forms/submit/open）。本サービスの記録で終わったと分かる段取りは、ここに無くても済として扱う';
