"use server";

// 自社情報の設定。
// 会社名は協力会社へ送るメール（挨拶・署名）と画面のヘッダーに使われる。
// 一般管理費率・目標利益率は原価集計（タスク4-5）で応札価格の案を出すのに使う。
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";

// 率は画面では%で入力し、DBには小数（0.12など）で持つ（organizations.overhead_rate は numeric(5,4)）。
const percent = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v !== "", `${label}を入力してください`)
    .refine((v) => /^\d+(\.\d+)?$/.test(v), `${label}は半角数字で入力してください`)
    .transform((v) => Number(v))
    .refine((v) => v >= 0 && v <= 100, `${label}は0〜100の範囲で入力してください`)
    .transform((v) => Math.round(v * 100) / 10000);

const companyNameSchema = z.object({
  orgName: z.string().trim().min(1, "会社名を入力してください").max(100, "会社名は100文字以内で入力してください"),
  overheadRate: percent("一般管理費率"),
  profitRate: percent("目標利益率"),
});

export type CompanyNameState = { error: string | null; saved: boolean };

/**
 * 自社情報（会社名・一般管理費率・目標利益率）を変更する。
 * organizationsのRLSは自組織のみ許可しているため、ユーザーのセッションのまま更新できる。
 */
export async function saveCompanyName(_prevState: CompanyNameState, formData: FormData): Promise<CompanyNameState> {
  const parsed = companyNameSchema.safeParse({
    orgName: formData.get("org_name"),
    overheadRate: String(formData.get("overhead_rate") ?? ""),
    profitRate: String(formData.get("profit_rate") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力内容を確認してください", saved: false };
  }

  const { orgId } = await requireOrgContext();
  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      name: parsed.data.orgName,
      overhead_rate: parsed.data.overheadRate,
      profit_rate: parsed.data.profitRate,
    })
    .eq("id", orgId);
  if (error) {
    console.error("[company] 自社情報の保存に失敗しました", error);
    return { error: "保存に失敗しました。時間をおいて再度お試しください。", saved: false };
  }

  // ヘッダーの表示名は全画面で使うため、まとめて再検証する。
  revalidatePath("/", "layout");
  return { error: null, saved: true };
}
