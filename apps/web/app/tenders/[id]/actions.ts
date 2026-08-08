"use server";

import { buildQuoteRequestEmail, groupLotsByTrade } from "@ai-nyusatsu-bu/domain";
import { sendEmail } from "@ai-nyusatsu-bu/notifications";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { DUE_AT_PLACEHOLDER } from "./quote-request-shared";

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

  const { orgId } = await requireOrgContext();
  const supabase = await createClient();

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
  const tradeGroups = groupLotsByTrade(lots ?? []);

  let requestCount = 0;
  let sentCount = 0;
  const failed: string[] = [];

  for (const group of tradeGroups) {
    const partnerIds = formData.getAll(`partners_${group.trade}`).filter((v): v is string => typeof v === "string");
    if (partnerIds.length === 0) continue;

    // フォームのtextareaは常に値を持つ（プレビュー生成時のDUE_AT_PLACEHOLDERを含む）ため、
    // 「空かどうか」では編集の有無を判定できない。ユーザーが編集していてもいなくても、
    // プレースホルダーを実際の回答期限へ置換してから使う。
    const bodyOverride = formData.get(`body_${group.trade}`);
    const rawBody =
      typeof bodyOverride === "string" && bodyOverride.trim() !== ""
        ? bodyOverride
        : buildQuoteRequestEmail({
            tenderName: tender.name,
            agencyName: agencyName(tender.agencies),
            place: tender.place,
            termFrom: tender.term_from,
            termTo: tender.term_to,
            dueAtLabel: DUE_AT_PLACEHOLDER,
            trade: group.trade,
            lots: group.lots,
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

      const { error: quoteError } = await supabase
        .from("quotes")
        .insert({ request_id: request.id, partner_id: partnerId, channel: "メール" });
      if (quoteError) {
        failed.push(`${partner.name}：見積の記録に失敗しました`);
        continue;
      }

      if (!partner.email) {
        failed.push(`${partner.name}：メールアドレス未登録のため送信していません`);
        continue;
      }
      try {
        await sendEmail({ to: partner.email, subject, text: body });
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
