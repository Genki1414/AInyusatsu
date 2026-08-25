"use server";

import { buildQuoteRequestEmail, groupLotsByTrade, replyToList } from "@ai-nyusatsu-bu/domain";
import { inboundEmailDomain, sendEmail } from "@ai-nyusatsu-bu/notifications";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { getAppUrl } from "@/lib/app-url";
import { TRADE_OPTIONS } from "@/lib/catalog";
import { loadSenderIdentity } from "@/lib/sender";
import { DUE_AT_PLACEHOLDER, RESPONSE_URL_PLACEHOLDER } from "./quote-request-shared";

/** 依頼先のチェックボックスのフィールド名の接頭辞（画面側と揃える）。 */
const TRADE_FIELD_PREFIX = "partners_";

type TenderRow = {
  name: string;
  place: string | null;
  term_from: string | null;
  term_to: string | null;
  agencies: { name: string } | { name: string }[] | null;
};

type LotRow = { id: string; line_no: number; item: string; spec: string | null; qty: number | string | null; unit: string | null; trade: string | null };

type PartnerRow = { id: string; name: string; email: string | null };

function agencyName(agencies: TenderRow["agencies"]): string {
  if (!agencies) return "";
  return Array.isArray(agencies) ? (agencies[0]?.name ?? "") : agencies.name;
}

// datetime-local（タイムゾーン無し）の入力値をAsia/Tokyoとして解釈しISO文字列にする
// （CLAUDE.md「日時はDBにtimestamptz、表示はAsia/Tokyo」）。
function toJstIso(value: string): string | null {
  const date = new Date(`${value}:00+09:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const dueAtSchema = z.string().min(1, "回答期限を入力してください");

export type SendQuoteRequestsState = {
  error: string | null;
  summary: string | null;
};

export async function sendQuoteRequests(
  tenderId: string,
  _prevState: SendQuoteRequestsState,
  formData: FormData,
): Promise<SendQuoteRequestsState> {
  const dueAtParsed = dueAtSchema.safeParse(formData.get("due_at"));
  if (!dueAtParsed.success) {
    return { error: dueAtParsed.error.issues[0]?.message ?? "入力内容を確認してください", summary: null };
  }
  const dueAtIso = toJstIso(dueAtParsed.data);
  if (!dueAtIso) {
    return { error: "回答期限の形式が正しくありません", summary: null };
  }
  const dueAtLabel = new Date(dueAtIso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

  const { supabase: sb0, orgId, orgName, userName, userEmail } = await requireOrgContext();

  // 差出人の表示名は依頼元の顧客企業、返信先も顧客企業に向ける（CLAUDE.md の運用方針）。
  // 協力会社にとっての取引相手はサービスの運営会社ではないため、ここを取り違えると
  // 受け取った側が誰からの依頼か分からなくなる。
  const sender = await loadSenderIdentity(sb0, orgId, orgName, userEmail);
  const supabase = await createClient();

  // 御社による正式取得が完了するまでは送信させない（画面側のガードに加え、こちらでも検証する）。
  const { data: companyTender } = await supabase
    .from("company_tenders")
    .select("official_status")
    .eq("tender_id", tenderId)
    .maybeSingle<{ official_status: string }>();
  if (companyTender?.official_status !== "取得済") {
    return { error: "資料の正式取得（取得済）が完了してから見積依頼を送信できます。「資料」タブから設定してください。", summary: null };
  }

  const [{ data: tender, error: tenderError }, { data: lots, error: lotsError }, { data: partners, error: partnersError }] = await Promise.all([
    supabase.from("tenders").select("name, place, term_from, term_to, agencies(name)").eq("id", tenderId).single<TenderRow>(),
    supabase
      .from("tender_lots")
      .select("id, line_no, item, spec, qty, unit, trade")
      .eq("tender_id", tenderId)
      .order("line_no")
      .returns<LotRow[]>(),
    supabase.from("partners").select("id, name, email").eq("active", true).returns<PartnerRow[]>(),
  ]);
  if (tenderError || !tender) return { error: "案件の取得に失敗しました", summary: null };
  if (lotsError) return { error: `数量表の取得に失敗しました: ${lotsError.message}`, summary: null };
  if (partnersError) return { error: `協力会社の取得に失敗しました: ${partnersError.message}`, summary: null };

  const partnerById = new Map((partners ?? []).map((p) => [p.id, p]));
  const lotGroups = groupLotsByTrade(lots ?? []);
  const lotsByTrade = new Map(lotGroups.map((g) => [g.trade, g.lots]));

  // 数量表が無い案件でも依頼できるよう、画面で業種を足せるようにしている（前提7）。
  // どの業種が送信対象かはフォームのキー（partners_<業種>）から読む。
  // 任意の文字列で quote_requests.trade を作られないよう、数量表の業種か
  // 業種辞書（TRADE_OPTIONS）にあるものだけを受け付ける。
  const allowedTrades = new Set<string>([...lotsByTrade.keys(), ...TRADE_OPTIONS]);
  const submittedTrades = [
    ...new Set(
      [...formData.keys()]
        .filter((key) => key.startsWith(TRADE_FIELD_PREFIX))
        .map((key) => key.slice(TRADE_FIELD_PREFIX.length)),
    ),
  ].filter((trade) => allowedTrades.has(trade));

  const tradeGroups = submittedTrades.map((trade) => ({ trade, lots: lotsByTrade.get(trade) ?? [] }));

  let requestCount = 0;
  let sentCount = 0;
  const failed: string[] = [];

  for (const group of tradeGroups) {
    const partnerIds = formData
      .getAll(`${TRADE_FIELD_PREFIX}${group.trade}`)
      .filter((v): v is string => typeof v === "string");
    if (partnerIds.length === 0) continue;

    // フォームのtextareaは常に値を持つ（プレビュー生成時のDUE_AT_PLACEHOLDERを含む）ため、
    // 「空かどうか」では編集の有無を判定できない。ユーザーが編集していてもいなくても、
    // プレースホルダーを実際の回答期限へ置換してから使う。
    const bodyOverride = formData.get(`body_${group.trade}`);
    const rawBody =
      typeof bodyOverride === "string" && bodyOverride.trim() !== ""
        ? bodyOverride
        : buildQuoteRequestEmail({
            senderOrgName: orgName,
            senderContactName: userName,
            // 署名の連絡先は返信先（Reply-To）と揃える。食い違うと、協力会社から見て
            // 返信ボタンの宛先と本文の連絡先が別になる
            senderContactEmail: sender.replyTo,
            tenderName: tender.name,
            agencyName: agencyName(tender.agencies),
            place: tender.place,
            termFrom: tender.term_from,
            termTo: tender.term_to,
            dueAtLabel: DUE_AT_PLACEHOLDER,
            trade: group.trade,
            lots: group.lots,
            responseUrl: RESPONSE_URL_PLACEHOLDER,
          }).body;
    const body = rawBody.split(DUE_AT_PLACEHOLDER).join(dueAtLabel);
    const subject = `【見積依頼】${tender.name}`;

    const { data: request, error: requestError } = await supabase
      .from("quote_requests")
      .insert({
        org_id: orgId,
        tender_id: tenderId,
        trade: group.trade,
        due_at: dueAtIso,
        body,
        lot_ids: group.lots.map((l) => l.id),
        sent_at: new Date().toISOString(),
      })
      .select("id")
      .single<{ id: string }>();
    if (requestError || !request) {
      failed.push(`${group.trade}：依頼の保存に失敗しました（${requestError?.message ?? "不明なエラー"}）`);
      continue;
    }
    requestCount++;

    for (const partnerId of partnerIds) {
      const partner = partnerById.get(partnerId);
      if (!partner) continue;

      const { data: quote, error: quoteError } = await supabase
        .from("quotes")
        .insert({ request_id: request.id, partner_id: partnerId, channel: "メール" })
        .select("response_token")
        .single<{ response_token: string }>();
      if (quoteError || !quote) {
        failed.push(`${partner.name}：見積の記録に失敗しました`);
        continue;
      }

      if (!partner.email) {
        failed.push(`${partner.name}：メールアドレス未登録のため送信していません`);
        continue;
      }
      // 回答ページのURLは協力会社（quotesの行）ごとに異なるため、共通のbodyに埋め込んだ
      // プレースホルダーを、この協力会社のURLへ送信直前に置換する。
      const responseUrl = `${getAppUrl()}/q/${quote.response_token}`;
      const personalizedBody = body.split(RESPONSE_URL_PLACEHOLDER).join(responseUrl);
      try {
        await sendEmail({
          to: partner.email,
          subject,
          text: personalizedBody,
          from: sender.from,
          // 顧客企業と、この見積あての受信アドレスの両方を返信先にする。
          // 協力会社が「返信」を1回押すだけで両方へ届く（タスク4-3）
          replyTo: replyToList(sender.replyTo, quote.response_token, inboundEmailDomain()),
        });
        sentCount++;
      } catch (err) {
        failed.push(`${partner.name}：${err instanceof Error ? err.message : "送信に失敗しました"}`);
      }
    }
  }

  if (requestCount === 0) {
    return { error: "送信先の協力会社を1社以上選択してください", summary: null };
  }

  const summary =
    failed.length === 0
      ? `${sentCount}社へ送信しました。返信は自動で取り込みます。`
      : `${sentCount}社へ送信しました。一部失敗があります：${failed.join("／")}`;
  return { error: null, summary };
}
