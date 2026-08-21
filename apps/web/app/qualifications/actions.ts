"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { rematchOrgProposals } from "@/lib/rematch";
import { QUAL_CATEGORIES } from "@/lib/catalog";

const qualificationsSchema = z.object({
  qualCategories: z.array(z.enum(QUAL_CATEGORIES)),
  items: z.array(z.string().min(1)),
  areas: z.array(z.string().min(1)),
  qualValidTo: z.string().nullable(),
  grades: z.record(z.string(), z.string()),
});

export type QualificationsState = { error: string | null; saved: boolean };

export async function saveQualifications(_prevState: QualificationsState, formData: FormData): Promise<QualificationsState> {
  const grades: Record<string, string> = {};
  for (const category of QUAL_CATEGORIES) {
    const value = formData.get(`grade_${category}`);
    if (typeof value === "string" && value.trim() !== "") grades[category] = value.trim();
  }
  const qualValidTo = formData.get("qual_valid_to");

  const parsed = qualificationsSchema.safeParse({
    qualCategories: formData.getAll("qual_categories"),
    items: formData.getAll("items"),
    areas: formData.getAll("areas"),
    qualValidTo: typeof qualValidTo === "string" && qualValidTo !== "" ? qualValidTo : null,
    grades,
  });
  if (!parsed.success) {
    return { error: "入力内容を確認してください", saved: false };
  }

  const { orgId } = await requireOrgContext();
  const supabase = await createClient();
  const { error } = await supabase
    .from("company_profiles")
    .update({
      qual_categories: parsed.data.qualCategories,
      items: parsed.data.items,
      areas: parsed.data.areas,
      qual_valid_to: parsed.data.qualValidTo,
      grades: parsed.data.grades,
    })
    .eq("org_id", orgId);
  if (error) {
    return { error: error.message, saved: false };
  }

  await rematchOrgProposals(supabase, orgId);
  revalidatePath("/qualifications");
  revalidatePath("/proposals");
  revalidatePath("/");
  return { error: null, saved: true };
}

const companyNameSchema = z.object({
  orgName: z.string().trim().min(1, "会社名を入力してください").max(100, "会社名は100文字以内で入力してください"),
});

export type CompanyNameState = { error: string | null; saved: boolean };

/**
 * 会社名を変更する。協力会社へのメール（挨拶・署名）と画面のヘッダーに使われる。
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
    console.error("[qualifications] 会社名の保存に失敗しました", error);
    return { error: "保存に失敗しました。時間をおいて再度お試しください。", saved: false };
  }

  // ヘッダーの表示名は全画面で使うため、まとめて再検証する。
  revalidatePath("/", "layout");
  return { error: null, saved: true };
}
