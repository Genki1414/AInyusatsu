-- コネクタマスタにkkj（官公需情報ポータル検索API）を登録する。
-- 参照：docs/reference/KKJ_api_guide.pdf、タスク1-5

insert into connectors (id, name, kind, state) values
  ('kkj', '官公需情報ポータル（検索API）', '官庁サイト', 'active');
