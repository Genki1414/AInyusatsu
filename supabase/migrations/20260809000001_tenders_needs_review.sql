-- 抽出後のルールベース検証（タスク2-3b）の結果を保存する列を追加する。
-- 参照：docs/AI解析プロンプト集.md §1「抽出後のルールベース検証（必須）」
--
-- needs_review   : 期限の前後関係チェック・和暦変換ミスの検出（ルール1〜4）のいずれかに
--                   違反した場合true。提案時（タスク3系）に警告を表示する想定。
-- review_reasons : 違反した理由（人が読める文言）の一覧。違反が無ければ空配列のまま。

alter table tenders
  add column needs_review boolean not null default false,
  add column review_reasons text[] not null default '{}';
