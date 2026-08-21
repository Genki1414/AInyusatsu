"use server";

// 協力会社の回答（タスク4-2）。ログイン不要のため、tokenの一致だけを根拠にservice_roleで
// 該当のquotes行を更新する（他の経路と違い、認証済みユーザーのセッションが存在しない）。
//
// このページでは見積金額は受け付けない（正式な見積書として弱いため）。「見送る」「資料請求」の
// どちらかを記録するだけで、資料そのものの配布や実際の見積金額のやり取りは従来どおり
// メール等で行う（実際の金額はタスク4-3のメール返信取込で記録する想定）。
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServiceClient } from "@ai-nyusatsu-bu/db";

export type QuoteResponseState = { error: string | null; saved: boolean };

function toNullableString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.trim();
}

const responseSchema = z.object({ memo: z.string().nullable() });

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
  const update = {
    declined: choice === "decline",
    documents_requested: choice === "request_documents",
    memo: parsed.data.memo,
  };

  const supabase = createServiceClient();
  const { data: quote } = await supabase.from("quotes").select("id").eq("response_token", token).maybeSingle<{ id: string }>();
  if (!quote) {
    return { error: "回答フォームが見つかりません。URLをご確認ください。", saved: false };
  }

  const { error } = await supabase
    .from("quotes")
    .update({ ...update, replied_at: new Date().toISOString(), source: "回答フォーム" })
    .eq("id", quote.id);
  if (error) {
    return { error: "送信に失敗しました。時間をおいて再度お試しください。", saved: false };
  }

  revalidatePath(`/q/${token}`);
  return { error: null, saved: true };
}
