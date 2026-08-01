-- citext 型を使用するための拡張機能を有効化する。
-- users.email / partners.email で大文字小文字を区別しないメールアドレス比較に使う。
-- （gen_random_uuid() はPostgreSQL 13以降コア機能のため拡張は不要）
create extension if not exists citext;
