-- どの見積への返信か分からないメールも捨てずに残せるようにする（タスク4-3）。
--
-- 受信口（apps/web/app/api/inbound/resend/route.ts）は
-- 「どの見積か分からない返信も捨てない。人が見て判断できるよう記録は残す」方針だが、
-- inbound_messages.org_id が not null のままだったため、実際には保存に失敗して
-- 500を返し、Svixの再送を延々と受けるだけになっていた（返信そのものは失われる）。
--
-- 宛先が q.<response_token>@... の形でなければ、どの組織の話かは推測できない。
-- 推測で他社の受信箱に入れるほうが危険なので、org_id は null のまま残せるようにする。
--
-- 【見えかたへの影響】
-- RLSは `org_id = public.current_org_id()` で判定している。org_id が null の行は
-- どの組織の利用者にも一致しない（nullとの比較はtrueにならない）ため、
-- 顧客企業の画面には出ない。本部が service_role で確認して手当てする。

alter table inbound_messages alter column org_id drop not null;

comment on column inbound_messages.org_id is
  'どの組織への返信か。宛先から特定できなければ null（推測で結びつけない）。null の行はRLSでどの組織にも見えない';
