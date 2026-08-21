"use server";

// 協力会社の回答（タスク4-2）。ログイン不要のため、tokenの一致だけを根拠にservice_roleで
// 該当のquotes行を更新する（他の経路と違い、認証済みユーザーのセッションが存在しない）。
//
// このページでは見積金額は受け付けない（正式な見積書として弱いため）。「見送る」「資料請求」の
// どちらかを記録し、資料請求なら本部取得資料の署名付きURLを協力会社へ自動送付したうえで、
// 依頼元の担当者にも通知する（CLAUDE.md 最重要の前提4の例外。ユーザー決定 2026-08-21）。
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { sendEmail } from "@ai-nyusatsu-bu/notifications";

export type QuoteResponseState = { error: string | null; saved: boolean };

const BUCKET = process.env.TENDER_DOCUMENTS_BUCKET || "tender-documents";
// 署名付きURLの有効期限（7日）。回答から資料確認までに間が空くことを見込む。
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

function toNullableString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.trim();
}

const responseSchema = z.object({ memo: z.string().nullable() });

type QuoteRequestRef = {
  trade: string;
  tender_id: string;
  org_id: string;
  tenders: { name: string } | { name: string }[] | null;
  organizations: { name: string } | { name: string }[] | null;
};

type QuoteContext = {
  id: string;
  partner: { name: string; email: string | null } | null;
  request: {
    trade: string;
    tender_id: string;
    org_id: string;
    tender_name: string;
    org_name: string;
  } | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function submitQuoteResponse(
  token: string,
  _prevState: QuoteResponseState,
  formData: FormData,
): Promise<QuoteResponseState> {
  const memo = toNullableString(formData.get("memo"));
  const parsed = responseSchema.safeParse({ memo });
  if (!parsed.success) {
    return { error: "入力内容を確認してください", saved: false };
  }

  const choice = formData.get("choice");
  if (choice !== "decline" && choice !== "request_documents") {
    return { error: "「今回は見送る」「資料をお願いする」のいずれかを選んでください", saved: false };
  }
  const requestedDocuments = choice === "request_documents";

  const supabase = createServiceClient();
  const { data: quoteRow } = await supabase
    .from("quotes")
    .select("id, partners(name, email), quote_requests(trade, tender_id, org_id, tenders(name), organizations(name))")
    .eq("response_token", token)
    .maybeSingle<{
      id: string;
      partners: { name: string; email: string | null } | { name: string; email: string | null }[] | null;
      quote_requests: QuoteRequestRef | QuoteRequestRef[] | null;
    }>();
  if (!quoteRow) {
    return { error: "回答フォームが見つかりません。URLをご確認ください。", saved: false };
  }

  const req = one(quoteRow.quote_requests);
  const ctx: QuoteContext = {
    id: quoteRow.id,
    partner: one(quoteRow.partners),
    request: req
      ? {
          trade: req.trade,
          tender_id: req.tender_id,
          org_id: req.org_id,
          tender_name: one(req.tenders)?.name ?? "案件名未確認",
          org_name: one(req.organizations)?.name ?? "発注元企業",
        }
      : null,
  };

  const { error } = await supabase
    .from("quotes")
    .update({
      declined: !requestedDocuments,
      documents_requested: requestedDocuments,
      memo: parsed.data.memo,
      replied_at: new Date().toISOString(),
      source: "回答フォーム",
    })
    .eq("id", ctx.id);
  if (error) {
    return { error: "送信に失敗しました。時間をおいて再度お試しください。", saved: false };
  }

  // 資料の自動送付と担当者への通知。ここで失敗しても回答自体は記録済みなので、
  // 協力会社の画面はエラーにしない（担当者側の通知本文に失敗を残す）。
  if (requestedDocuments) {
    await sendDocumentsAndNotify(supabase, ctx);
  } else {
    await notifyOwner(supabase, ctx, "今回は見送る", parsed.data.memo, null);
  }

  revalidatePath(`/q/${token}`);
  return { error: null, saved: true };
}

type Supabase = ReturnType<typeof createServiceClient>;

/** 本部が取得済みの資料の署名付きURLを協力会社へ送り、担当者にも通知する。 */
async function sendDocumentsAndNotify(supabase: Supabase, ctx: QuoteContext): Promise<void> {
  if (!ctx.request) {
    await notifyOwner(supabase, ctx, "資料請求", null, "案件情報が取得できず、資料を送付できませんでした");
    return;
  }

  const { data: documents } = await supabase
    .from("tender_documents")
    .select("kind, storage_key")
    .eq("tender_id", ctx.request.tender_id)
    .eq("fetched", true)
    .not("storage_key", "is", null)
    .returns<{ kind: string; storage_key: string }[]>();

  const links: string[] = [];
  for (const doc of documents ?? []) {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_key, SIGNED_URL_TTL_SECONDS);
    if (signed?.signedUrl) links.push(`【${doc.kind}】${signed.signedUrl}`);
  }

  if (links.length === 0) {
    await notifyOwner(supabase, ctx, "資料請求", null, "取得済みの資料が無いため自動送付できませんでした。手動での対応が必要です");
    return;
  }
  if (!ctx.partner?.email) {
    await notifyOwner(supabase, ctx, "資料請求", null, "協力会社のメールアドレスが未登録のため自動送付できませんでした");
    return;
  }

  const body = [
    `${ctx.partner.name} 様`,
    "",
    "お世話になっております。",
    `${ctx.request.org_name}でございます。`,
    "",
    `ご依頼いただきました「${ctx.request.tender_name}」の資料をお送りいたします。`,
    "下記のリンクからダウンロードしてください（7日間有効です）。",
    "",
    ...links,
    "",
    "お見積りのご検討をよろしくお願いいたします。",
    "",
    "--",
    ctx.request.org_name,
  ].join("\n");

  let sendError: string | null = null;
  try {
    await sendEmail({ to: ctx.partner.email, subject: `【資料送付】${ctx.request.tender_name}`, text: body });
    await supabase.from("quotes").update({ documents_sent_at: new Date().toISOString() }).eq("id", ctx.id);
  } catch (err) {
    sendError = err instanceof Error ? err.message : "資料の送付に失敗しました";
  }

  await notifyOwner(supabase, ctx, "資料請求", null, sendError ? `資料の自動送付に失敗しました：${sendError}` : null);
}

/** 依頼元（org）の担当者へ、協力会社の回答を通知する。 */
async function notifyOwner(
  supabase: Supabase,
  ctx: QuoteContext,
  choiceLabel: string,
  memo: string | null,
  warning: string | null,
): Promise<void> {
  if (!ctx.request) return;

  const { data: owners } = await supabase
    .from("users")
    .select("email")
    .eq("org_id", ctx.request.org_id)
    .returns<{ email: string }[]>();
  const to = owners?.[0]?.email;
  if (!to) return;

  const body = [
    `${ctx.partner?.name ?? "協力会社"} から見積依頼への回答がありました。`,
    "",
    `案件：${ctx.request.tender_name}`,
    `業種：${ctx.request.trade}`,
    `回答：${choiceLabel}`,
    memo ? `備考：${memo}` : "",
    warning ? `※${warning}` : "",
    "",
    "詳しくは案件詳細の「見積状況」タブをご確認ください。",
  ]
    .filter((line) => line !== "")
    .join("\n");

  try {
    await sendEmail({ to, subject: `【見積依頼への回答】${ctx.request.tender_name}`, text: body });
  } catch {
    // 通知の失敗で協力会社側の回答をエラーにはしない（回答自体は記録済み）。
  }
}
