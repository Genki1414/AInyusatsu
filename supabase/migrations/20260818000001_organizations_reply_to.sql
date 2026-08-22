-- 協力会社へ送るメールの返信先を、企業ごとに設定できるようにする。
--
-- 協力会社にとっての取引相手は、サービスの運営会社ではなく依頼元の顧客企業。
-- 差出人の表示名は organizations.name をそのまま使い、返信先はここで指定する。
-- 未設定なら登録者（owner）のアドレスに落とすので、返信が宙に浮くことはない
-- （packages/domain/src/sender_identity.ts）。
--
-- 実アドレスがサービスのドメインなのは、顧客企業のドメインから送るには
-- そのドメインをResendで認証する必要があり、導入時にそれを求めると離脱するため
-- （ユーザー判断 2026-08-22）。自社ドメインでの送信は、希望する顧客向けの
-- 上位の設定として別途用意する。

alter table organizations add column reply_to text;

comment on column organizations.reply_to is '協力会社への送信メールの返信先。未設定ならownerのアドレスを使う';
