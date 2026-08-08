"use server";

// 協力会社の回答（タスク4-2）。ログイン不要のため、tokenの一致だけを根拠にservice_roleで
// 該当のquotes行を更新する（他の経路と違い、認証済みユーザーのセッションが存在しない）。
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServiceClient } from "@ai-nyusatsu-bu/db";

export type QuoteResponseState = { error: string | null; saved: boolean };

function toNullableString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.trim();
}

const quoteSchema = z.object({ amount: z.number().int().min(1, "見積金額を入力してください"), memo: z.string().nullable() });
const declineSchema = z.object({ memo: z.string().nullable() });

export async function submitQuoteResponse(
  token: string,
  _prevState: QuoteResponseState,
  formData: FormData,
): Promise<QuoteResponseState> {
  const memo = toNullableString(formData.get("memo"));
  const declined = formData.get("choice") === "decline";

  let update: { declined: boolean; amount: number | null; memo: string | null };
  if (declined) {
    const parsed = declineSchema.safeParse({ memo });
    if (!parsed.success) return { error: "入力内容を確認してください", saved: false };
    update = { declined: true, amount: null, memo: parsed.data.memo };
  } else {
    const amountRaw = formData.get("amount");
    const amount = typeof amountRaw === "string" && amountRaw.trim() !== "" ? Number(amountRaw) : Number.NaN;
    const parsed = quoteSchema.safeParse({ amount, memo });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "入力内容を確認してください", saved: false };
    update = { declined: false, amount: parsed.data.amount, memo: parsed.data.memo };
  }

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
