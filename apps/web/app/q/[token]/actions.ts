"use server";

// 協力会社の回答（タスク4-2）。ログイン不要のため、tokenの一致だけを根拠にservice_roleで
// 該当のquotes行を更新する（他の経路と違い、認証済みユーザーのセッションが存在しない）。
//
// このページでは見積金額は受け付けない（正式な見積書として弱いため）。「見送る」「資料請求」の
// どちらかを記録し、資料請求なら本部取得資料の署名付きURLを協力会社へ自動送付する
// （CLAUDE.md 最重要の前提4の例外。ユーザー決定 2026-08-21）。
//
// 依頼元の担当者へのメール通知は行わない。通知の送信元を各顧客企業のドメインで用意する
// 必要があり運用が回らないため（ユーザー決定 2026-08-21）。担当者は案件詳細の
// 「見積状況」タブで回答を確認する。
//
// メール文面・資料の並び順・署名付きURLの有効期限は packages/domain の純ロジック
// （quote_response.ts）に置き、ここでは副作用（DB更新・Storage・送信）だけを行う。
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServiceClient } from "@ai-nyusatsu-bu/db";
import { sendEmail } from "@ai-nyusatsu-bu/notifications";
import { loadSenderIdentity } from "@/lib/sender";
import {
  buildDocumentsEmail,
  documentFilenames,
  signedUrlTtlSeconds,
  sortDocumentsByKind,
  type QuoteResponseChoice,
} from "@ai-nyusatsu-bu/domain";

export type QuoteResponseState = { error: string | null; saved: boolean };

const BUCKET = process.env.TENDER_DOCUMENTS_BUCKET || "tender-documents";

function jst(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function toNullableString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.trim();
}

const responseSchema = z.object({
  choice: z.enum(["request_documents", "decline"], {
    errorMap: () => ({ message: "「資料をお願いする」「今回は見送る」のいずれかを選んでください" }),
  }),
  memo: z.string().max(2000, "備考は2000文字以内で入力してください").nullable(),
});

type QuoteRequestRef = {
  trade: string;
  tender_id: string;
  org_id: string;
  due_at: string | null;
  tenders: { name: string } | { name: string }[] | null;
  organizations: { name: string } | { name: string }[] | null;
};

type QuoteContext = {
  id: string;
  partner: { name: string; email: string | null } | null;
  request: {
    trade: string;
    tenderId: string;
    orgId: string;
    dueAt: string | null;
    tenderName: string;
    orgName: string;
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
  const parsed = responseSchema.safeParse({
    choice: formData.get("choice"),
    memo: toNullableString(formData.get("memo")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力内容を確認してください", saved: false };
  }
  const choice: QuoteResponseChoice = parsed.data.choice;
  const requestedDocuments = choice === "request_documents";

  const supabase = createServiceClient();
  const { data: quoteRow, error: loadError } = await supabase
    .from("quotes")
    .select("id, partners(name, email), quote_requests(trade, tender_id, org_id, due_at, tenders(name), organizations(name))")
    .eq("response_token", token)
    .maybeSingle<{
      id: string;
      partners: { name: string; email: string | null } | { name: string; email: string | null }[] | null;
      quote_requests: QuoteRequestRef | QuoteRequestRef[] | null;
    }>();
  if (loadError) {
    console.error("[quote-response] 回答フォームの読み込みに失敗しました", loadError);
    return { error: "送信に失敗しました。時間をおいて再度お試しください。", saved: false };
  }
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
          tenderId: req.tender_id,
          orgId: req.org_id,
          dueAt: req.due_at,
          tenderName: one(req.tenders)?.name ?? "案件名未確認",
          orgName: one(req.organizations)?.name ?? "発注元企業",
        }
      : null,
  };

  const { error: updateError } = await supabase
    .from("quotes")
    .update({
      declined: !requestedDocuments,
      documents_requested: requestedDocuments,
      memo: parsed.data.memo,
      replied_at: new Date().toISOString(),
      source: "回答フォーム",
    })
    .eq("id", ctx.id);
  if (updateError) {
    console.error("[quote-response] 回答の保存に失敗しました", updateError);
    return { error: "送信に失敗しました。時間をおいて再度お試しください。", saved: false };
  }

  // 資料の自動送付。ここで失敗しても回答自体は記録済みなので、協力会社の画面はエラーに
  // しない（失敗はログに残し、見積状況タブに「資料の自動送付に失敗（要対応）」として出す）。
  if (requestedDocuments) {
    const warning = await sendDocuments(supabase, ctx);
    if (warning) console.error(`[quote-response] ${warning}（quote=${ctx.id}）`);
  }

  revalidatePath(`/q/${token}`);
  if (ctx.request) revalidatePath(`/tenders/${ctx.request.tenderId}`);
  return { error: null, saved: true };
}

type Supabase = ReturnType<typeof createServiceClient>;

/**
 * 本部が取得済みの資料の署名付きURLを協力会社へ送る。
 * 送れなかった場合は、担当者への通知に載せる理由（文字列）を返す。成功時はnull。
 */
async function sendDocuments(supabase: Supabase, ctx: QuoteContext): Promise<string | null> {
  if (!ctx.request) return "案件情報が取得できず、資料を送付できませんでした";
  if (!ctx.partner?.email) return "協力会社のメールアドレスが未登録のため自動送付できませんでした";

  const { data: documents, error: docsError } = await supabase
    .from("tender_documents")
    .select("kind, storage_key, filename")
    .eq("tender_id", ctx.request.tenderId)
    .eq("fetched", true)
    .not("storage_key", "is", null)
    .returns<{ kind: string; storage_key: string; filename: string | null }[]>();
  if (docsError) {
    console.error("[quote-response] 資料の取得に失敗しました", docsError);
    return `資料の取得に失敗したため自動送付できませんでした：${docsError.message}`;
  }
  if (!documents || documents.length === 0) {
    return "取得済みの資料が無いため自動送付できませんでした。手動での対応が必要です";
  }

  // 署名付きURLは回答期限まで確実に使えるようにする（期限＋7日、下限7日・上限90日）。
  const now = new Date();
  const dueAt = ctx.request.dueAt ? new Date(ctx.request.dueAt) : null;
  const ttl = signedUrlTtlSeconds(dueAt, now);
  const expiresAtLabel = new Date(now.getTime() + ttl * 1000).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

  // downloadを付けてContent-Disposition: attachmentにする。付けないと、保存時のcontent-typeに
  // よってはブラウザがPDFを開かずに中身をそのまま表示してしまう（実機で確認）。
  const targets = documentFilenames(sortDocumentsByKind(documents));
  const links: { kind: string; label: string; url: string }[] = [];
  const failed: string[] = [];
  for (const doc of targets) {
    const { data: signed, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(doc.storage_key, ttl, { download: doc.label });
    if (error || !signed?.signedUrl) {
      console.error(`[quote-response] 署名付きURLの発行に失敗しました（${doc.storage_key}）`, error);
      failed.push(doc.label);
      continue;
    }
    links.push({ kind: doc.kind, label: doc.label, url: signed.signedUrl });
  }
  if (links.length === 0) {
    return "資料のダウンロードURLを発行できなかったため自動送付できませんでした。手動での対応が必要です";
  }

  // 差出人・返信先は依頼元の顧客企業に向ける（協力会社の取引相手は運営会社ではない）。
  const ownerEmail = await firstOrgEmail(supabase, ctx.request.orgId);
  const sender = await loadSenderIdentity(supabase, ctx.request.orgId, ctx.request.orgName, ownerEmail);

  const { subject, body } = buildDocumentsEmail({
    partnerName: ctx.partner.name,
    senderOrgName: ctx.request.orgName,
    senderContactEmail: sender.replyTo,
    tenderName: ctx.request.tenderName,
    trade: ctx.request.trade,
    dueAtLabel: jst(ctx.request.dueAt),
    expiresAtLabel,
    links,
  });

  try {
    await sendEmail({ to: ctx.partner.email, subject, text: body, from: sender.from, replyTo: sender.replyTo });
  } catch (err) {
    console.error("[quote-response] 資料送付メールの送信に失敗しました", err);
    return `資料の自動送付に失敗しました：${err instanceof Error ? err.message : "原因不明"}`;
  }

  const { error: stampError } = await supabase
    .from("quotes")
    .update({ documents_sent_at: new Date().toISOString() })
    .eq("id", ctx.id);
  if (stampError) {
    console.error("[quote-response] 資料送付日時の記録に失敗しました", stampError);
  }

  // 一部だけ発行に失敗した場合は、送付はできているが担当者に知らせる。
  return failed.length > 0 ? `一部の資料（${failed.join("・")}）を送付できませんでした。手動での対応が必要です` : null;
}

/** 協力会社への返信先に使う、自組織のメールアドレスを1件取得する。 */
async function firstOrgEmail(supabase: Supabase, orgId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("users")
    .select("email, role")
    .eq("org_id", orgId)
    .order("role") // owner が member より先に来る
    .limit(1)
    .maybeSingle<{ email: string; role: string }>();
  if (error) {
    console.error("[quote-response] 返信先ユーザーの取得に失敗しました", error);
    return null;
  }
  return data?.email ?? null;
}

/**
 * 回答ページが開かれたことを記録する（開封確認）。
 * 初回の開封だけを記録し、以後の再訪では上書きしない（is("opened_at", null) で絞る）。
 * 失敗しても協力会社の操作は妨げない（ログに残すだけ）。
 */
export async function recordQuoteOpened(token: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("quotes")
    .update({ opened_at: new Date().toISOString() })
    .eq("response_token", token)
    .is("opened_at", null);
  if (error) {
    console.error("[quote-response] 開封の記録に失敗しました", error);
  }
}
