-- 協力会社の回答ページ（/q/[token]、タスク4-2）用のトークン。
-- ログイン不要で本人だけがアクセスできるよう、quotesの行ごとに推測不可能な値を発行する
-- （主キーidとは別の値にすることで、他の経路からidが漏れても回答ページには使えないようにする）。
alter table quotes add column response_token uuid not null default gen_random_uuid();
create unique index quotes_response_token_key on quotes (response_token);
