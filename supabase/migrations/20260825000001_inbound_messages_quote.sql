-- 受信した返信を、どの見積への返信かで結びつける（タスク4-3）。
-- 参照：docs/実装仕様書_v1.md §4.4「返信パース（見積の自動取込）」
--
-- inbound_messages は org / partner / tender は持っていたが、quote への参照が無かった。
-- 取り込み（quotes.amount への反映）には、どの見積の返信かを確定させる必要がある。
-- 返信先アドレス（q.<response_token>@...）から特定できるので、その結果をここに残す。

alter table inbound_messages add column quote_id uuid references quotes(id) on delete set null;

-- 見積の画面から「この見積への返信」を引くための索引
create index inbound_messages_quote_id_idx on inbound_messages (quote_id, received_at desc);

-- 同じwebhookが複数回届いても二重に取り込まないための鍵。
-- Svixは配信を再試行するため、同じメッセージが2回以上来る前提で作る。
alter table inbound_messages add column provider_message_id text;

create unique index inbound_messages_provider_message_id_key
  on inbound_messages (provider_message_id)
  where provider_message_id is not null;

comment on column inbound_messages.quote_id is '返信先アドレスから特定した見積。特定できなければ null（推測で結びつけない）';
comment on column inbound_messages.provider_message_id is 'Webhookのメッセージid。再送で二重に取り込まないための冪等キー';
