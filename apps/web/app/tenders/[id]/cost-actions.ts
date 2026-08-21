"use server";

// 原価集計と応札価格の検討（タスク4-5）の更新。
//
// 見積金額は、協力会社から届いた見積書を見て担当者が手で入力する。回答ページ（/q/[token]）
// では金額を受け付けない方針のため（正式な見積書として弱い。ユーザー決定 2026-08-21）、
// いまのところ金額が入る経路はここだけになる。
//
// 積算そのものは行わない（CLAUDE.md「やらないこと」）。入力された金額を足すだけ。

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrgContext } from "@/lib/auth";

export type CostActionState = { error: string | null; saved: boolean };

const amountSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[,，\s]/g, ""))
  .refine((v) => v === "" || /^\d+$/.test(v), "金額は半角数字で入力してください（円・税抜）")
  .transform((v) => (v === "" ? null : Number(v)))
  .refine((v) => v === null || v <= 100_000_000_000, "金額が大きすぎます。桁を確認してください");

/**
 * 見積金額を手入力で記録する。空欄で送ると未回答に戻す。
 * 他組織の見積を書き換えられないよう、依頼が自組織のものかを確かめてから更新する。
 */
export async function setQuoteAmount(
  tenderId: string,
  quoteId: string,
  _prevState: CostActionState,
  formData: FormData,
): Promise<CostActionState> {
  const parsed = amountSchema.safeParse(String(formData.get("amount") ?? ""));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "金額を確認してください", saved: false };
  }

  const { supabase, orgId } = await requireOrgContext();
  const owned = await ownsQuote(supabase, orgId, tenderId, quoteId);
  if (!owned) return { error: "見積が見つかりません", saved: false };

  const { error } = await supabase
    .from("quotes")
    .update({
      amount: parsed.data,
      // 金額が入ったこと自体が回答の記録になる（回答ページを使わずメールで届いた場合）
      replied_at: parsed.data === null ? null : new Date().toISOString(),
      source: "手入力",
    })
    .eq("id", quoteId);
  if (error) {
    console.error("[cost] 見積金額の保存に失敗しました", error);
    return { error: "保存できませんでした。時間をおいて再度お試しください。", saved: false };
  }

  revalidatePath(`/tenders/${tenderId}`);
  return { error: null, saved: true };
}

/** その業種で採用する見積を選ぶ。同じ業種の他の見積の採用は外す。 */
export async function adoptQuote(tenderId: string, trade: string, quoteId: string): Promise<void> {
  const { supabase, orgId } = await requireOrgContext();
  const owned = await ownsQuote(supabase, orgId, tenderId, quoteId);
  if (!owned) throw new Error("見積が見つかりません");

  // 同じ案件・同じ業種の見積をいったんすべて非採用にしてから、選ばれたものだけ採用にする。
  const { data: siblings, error: siblingsError } = await supabase
    .from("quotes")
    .select("id, quote_requests!inner(tender_id, org_id, trade)")
    .eq("quote_requests.tender_id", tenderId)
    .eq("quote_requests.org_id", orgId)
    .eq("quote_requests.trade", trade)
    .returns<{ id: string }[]>();
  if (siblingsError) throw new Error(`見積の取得に失敗しました: ${siblingsError.message}`);

  const ids = (siblings ?? []).map((s) => s.id);
  if (ids.length > 0) {
    const { error: clearError } = await supabase.from("quotes").update({ adopted: false }).in("id", ids);
    if (clearError) throw new Error(`採用の解除に失敗しました: ${clearError.message}`);
  }

  const { error } = await supabase.from("quotes").update({ adopted: true }).eq("id", quoteId);
  if (error) throw new Error(`採用の保存に失敗しました: ${error.message}`);

  revalidatePath(`/tenders/${tenderId}`);
}

/** 応札価格を決定する。積算は行わず、画面に出ている案をそのまま記録する。 */
export async function decideBidPrice(
  tenderId: string,
  _prevState: CostActionState,
  formData: FormData,
): Promise<CostActionState> {
  const parsed = amountSchema.safeParse(String(formData.get("bid_price") ?? ""));
  if (!parsed.success || parsed.data === null) {
    return { error: parsed.success ? "応札価格を入力してください" : (parsed.error.issues[0]?.message ?? "金額を確認してください"), saved: false };
  }

  const { supabase, orgId } = await requireOrgContext();
  const { error } = await supabase.from("company_tenders").upsert(
    { org_id: orgId, tender_id: tenderId, bid_price: parsed.data, work_status: "積算中" },
    { onConflict: "org_id,tender_id" },
  );
  if (error) {
    console.error("[cost] 応札価格の保存に失敗しました", error);
    return { error: "保存できませんでした。時間をおいて再度お試しください。", saved: false };
  }

  revalidatePath(`/tenders/${tenderId}`);
  return { error: null, saved: true };
}

type Supabase = Awaited<ReturnType<typeof requireOrgContext>>["supabase"];

/** その見積が、この組織のこの案件に対する依頼のものかを確かめる。 */
async function ownsQuote(supabase: Supabase, orgId: string, tenderId: string, quoteId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("quotes")
    .select("id, quote_requests!inner(tender_id, org_id)")
    .eq("id", quoteId)
    .eq("quote_requests.tender_id", tenderId)
    .eq("quote_requests.org_id", orgId)
    .maybeSingle<{ id: string }>();
  if (error) {
    console.error("[cost] 見積の確認に失敗しました", error);
    return false;
  }
  return data !== null;
}
