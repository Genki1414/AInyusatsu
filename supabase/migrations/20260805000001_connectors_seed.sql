-- コネクタマスタにgepsを登録する。tenders.connector_id / agencies.sources 双方から
-- 参照される想定（agencies.sourcesは既にjsonbで'connector":"geps"'を参照済み）。
-- 参照：docs/調達ポータルコネクタ設計.md、タスク1-7

insert into connectors (id, name, kind, state) values
  ('geps', '調達ポータル（政府電子調達システム）', '電子調達', 'active');
