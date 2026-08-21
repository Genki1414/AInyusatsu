"use server";

// 自社情報の設定。会社名は協力会社へ送るメール（挨拶・署名）と画面のヘッダーに使われる。
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";

const companyNameSchema = z.object({
  orgName: z.string().trim().min(1, "会社名を入力してください").max(100, "会社名は100文字以内で入力してください"),
});

export type CompanyNameState = { error: string | null; saved: boolean };

/**
 * 会社名を変更する。
 * organizationsのRLSは自組織のみ許可しているため、ユーザーのセッションのまま更新できる。
 */
export async function saveCompanyName(_prevState: CompanyNameState, formData: FormData): Promise<CompanyNameState> {
  const parsed = companyNameSchema.safeParse({ orgName: formData.get("org_name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力内容を確認してください", saved: false };
  }

  const { orgId } = await requireOrgContext();
  const supabase = await createClient();
  const { error } = await supabase.from("organizations").update({ name: parsed.data.orgName }).eq("id", orgId);
  if (error) {
    console.error("[company] 会社名の保存に失敗しました", error);
    return { error: "保存に失敗しました。時間をおいて再度お試しください。", saved: false };
  }

  // ヘッダーの表示名は全画面で使うため、まとめて再検証する。
  revalidatePath("/", "layout");
  return { error: null, saved: true };
}
